import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Type } from "typebox";
import extension from "../index.ts";
import ompExtension from "../omp.ts";

const originalPath = process.env.PATH;
const originalTimeout = process.env.CODEGRAPH_MCP_TIMEOUT_MS;
const originalHookTimeout = process.env.CODEGRAPH_PROMPT_HOOK_TIMEOUT_MS;
const originalHookDisabled = process.env.CODEGRAPH_NO_PROMPT_HOOK;

async function setupFakeCli(mode = "success") {
	const root = await mkdtemp(path.join(os.tmpdir(), "codegraph-ext-test-"));
	const bin = path.join(root, "bin");
	const project = path.join(root, "project");
	const pidPath = path.join(root, "child.pid");
	await mkdir(bin);
	await mkdir(project);
	const cliPath = path.join(bin, "codegraph");
	await writeFile(cliPath, `#!/usr/bin/env node
const mode = process.env.CODEGRAPH_TEST_MODE;
if (process.env.CODEGRAPH_TEST_PID_FILE) require("node:fs").writeFileSync(process.env.CODEGRAPH_TEST_PID_FILE, String(process.pid));
if (process.argv[2] === "prompt-hook") {
	let hookInput = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", (chunk) => hookInput += chunk);
	process.stdin.on("end", () => {
		if (process.env.CODEGRAPH_TEST_HOOK_INPUT_FILE) require("node:fs").writeFileSync(process.env.CODEGRAPH_TEST_HOOK_INPUT_FILE, hookInput);
		if (mode === "hook-error") process.exit(1);
		if (mode === "hook-timeout") { setInterval(() => {}, 1000); return; }
		if (mode !== "hook-empty" && mode !== "hook-no-index") process.stdout.write(process.env.CODEGRAPH_TEST_HOOK_OUTPUT || "<codegraph_context>Relevant graph context</codegraph_context>");
	});
	process.stdin.resume();
	return;
}
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {});
process.stdin.resume();
function send(message) { process.stdout.write(JSON.stringify(message) + "\\n"); }
process.stdin.on("data", () => {
	const lines = input.split("\\n");
	input = lines.pop() || "";
	for (const line of lines) {
		if (!line) continue;
		const request = JSON.parse(line);
		if (request.method === "initialize") {
			if (mode === "malformed") process.stdout.write("not-json\\n");
			else if (mode === "error") send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message: "index unavailable" } });
			else send({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "fake", version: "1" } } });
		} else if (request.method === "tools/call") {
			const supportedTools = ["codegraph_explore", "codegraph_node", "codegraph_search", "codegraph_files", "codegraph_status"];
			if (!supportedTools.includes(request.params.name)) {
				send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown tool: " + request.params.name } });
				continue;
			}
			if (mode === "stderr") { process.stderr.write("index is missing\\n"); process.exit(2); }
			if (mode === "timeout") continue;
			if (mode === "invalid" || mode === "no-index") {
				const text = mode === "invalid" ? "Error: invalid tool arguments" : "Error: no CodeGraph index found";
				send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text }], isError: true } });
				process.exit(0);
			}
			if (process.env.CODEGRAPH_TEST_CALLS_FILE) require("node:fs").appendFileSync(process.env.CODEGRAPH_TEST_CALLS_FILE, JSON.stringify(request.params) + "\\n");
			const details = { tool: request.params.name, arguments: request.params.arguments, structured: true };
			const text = request.params.name === "codegraph_explore"
				? JSON.stringify({ query: request.params.arguments.query, maxFiles: request.params.arguments.maxFiles, files: ["src/main.ts"] })
				: JSON.stringify(details);
			send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text }], structuredContent: details } });
			process.exit(0);
		} else if (request.method === "notifications/initialized") {
			if (mode === "exit") process.exit(7);
		}
	}
});
`);
	await chmod(cliPath, 0o755);
	process.env.PATH = `${bin}${path.delimiter}${originalPath ?? ""}`;
	process.env.CODEGRAPH_TEST_MODE = mode;
	process.env.CODEGRAPH_TEST_PID_FILE = pidPath;
	return { root, project, pidPath };
}

function register() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const hooks = new Map<string, any[]>();
	const messages: any[] = [];
	const pi = {
		typebox: Type,
		on(event: string, handler: any) { hooks.set(event, [...hooks.get(event) ?? [], handler]); },
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		sendMessage(message: any) { messages.push(message); return message; },
	};
	extension(pi as any);
	return { tools, commands, hooks, messages };
}

function registerOmp() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const hooks = new Map<string, any[]>();
	const messages: any[] = [];
	const scalar = (type: string) => ({ type, optional() { return { type, optional: true }; } });
	const zod = {
		string: () => scalar("string"),
		number: () => scalar("number"),
		boolean: () => scalar("boolean"),
		enum: (options: readonly string[]) => ({ type: "enum", options, optional() { return { type: "enum", options, optional: true }; } }),
		object: (shape: unknown) => ({ type: "object", shape }),
	};
	const pi = {
		zod,
		on(event: string, handler: any) { hooks.set(event, [...hooks.get(event) ?? [], handler]); },
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		sendMessage(message: any) { messages.push(message); return message; },
	};
	ompExtension(pi as any);
	return { tools, commands, hooks, messages };
}

test.afterEach(() => {
	process.env.PATH = originalPath;
	if (originalTimeout === undefined) delete process.env.CODEGRAPH_MCP_TIMEOUT_MS;
	else process.env.CODEGRAPH_MCP_TIMEOUT_MS = originalTimeout;
	if (originalHookTimeout === undefined) delete process.env.CODEGRAPH_PROMPT_HOOK_TIMEOUT_MS;
	else process.env.CODEGRAPH_PROMPT_HOOK_TIMEOUT_MS = originalHookTimeout;
	if (originalHookDisabled === undefined) delete process.env.CODEGRAPH_NO_PROMPT_HOOK;
	else process.env.CODEGRAPH_NO_PROMPT_HOOK = originalHookDisabled;
	delete process.env.CODEGRAPH_TEST_MODE;
	delete process.env.CODEGRAPH_TEST_PID_FILE;
	delete process.env.CODEGRAPH_TEST_HOOK_INPUT_FILE;
	delete process.env.CODEGRAPH_TEST_HOOK_OUTPUT;
	delete process.env.CODEGRAPH_TEST_CALLS_FILE;
});

test("registers codegraph_explore and keeps the slash command", () => {
	const { tools, commands } = register();
	assert.equal(tools.has("codegraph_explore"), true);
	assert.equal(commands.has("codegraph"), true);
});

test("explore tool uses the MCP CLI and returns readable results", async () => {
	const fixture = await setupFakeCli();
	try {
		const { tools } = register();
		const result = await tools.get("codegraph_explore").execute("id", { query: "where is main?", maxFiles: 4, projectPath: "project" }, new AbortController().signal, undefined, { cwd: fixture.root });
		assert.match(result.content[0].text, /src\/main\.ts/);
		assert.match(result.content[0].text, /"maxFiles":4/);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("slash command shares explore behavior", async () => {
	const fixture = await setupFakeCli();
	try {
		const { commands, messages } = register();
		const command = commands.get("codegraph");
		await command.handler("where is main?", {
			cwd: fixture.project,
			signal: undefined,
			ui: { notify() { throw new Error("unexpected notification"); } },
		});
		assert.match(messages[0].content, /src\/main\.ts/);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("MCP failures are returned as operation-local errors", async () => {
	for (const mode of ["error", "malformed", "exit", "stderr"]) {
		const fixture = await setupFakeCli(mode);
		try {
			const { tools } = register();
			const result = await tools.get("codegraph_explore").execute("id", { query: "inspect" }, new AbortController().signal, undefined, { cwd: fixture.project });
			assert.equal(result.isError, true, mode);
			assert.match(result.content[0].text, /CodeGraph|index/i, mode);
			if (mode === "stderr") assert.match(result.content[0].text, /index is missing/);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	}
});

test("missing CLI fails only the current operation", async () => {
	const fixture = await setupFakeCli();
	try {
		process.env.PATH = path.join(fixture.root, "missing-bin");
		const { tools } = register();
		const result = await tools.get("codegraph_explore").execute("id", { query: "inspect" }, undefined, undefined, { cwd: fixture.project });
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /CodeGraph exploration failed/);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("timeout and cancellation end their child process", async () => {
	for (const action of ["timeout", "cancel"]) {
		const fixture = await setupFakeCli("timeout");
		try {
			process.env.CODEGRAPH_MCP_TIMEOUT_MS = "80";
			const controller = new AbortController();
			if (action === "cancel") setTimeout(() => controller.abort(), 25);
			const { tools } = register();
			const result = await tools.get("codegraph_explore").execute("id", { query: "wait" }, controller.signal, undefined, { cwd: fixture.project });
			assert.equal(result.isError, true, action);
			assert.match(result.content[0].text, action === "timeout" ? /timed out/ : /cancelled/);
			const childPid = Number(await readFile(fixture.pidPath, "utf8"));
			assert.throws(() => process.kill(childPid, 0), { code: "ESRCH" }, `${action} child must be reaped`);
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	}
});

test("OMP entry shares explore success, command, and fail-open behavior", async () => {
	const fixture = await setupFakeCli();
	const notifications: string[] = [];
	try {
		const { tools, commands, messages } = registerOmp();
		const context = { cwd: fixture.root, signal: undefined, ui: { notify(message: string) { notifications.push(message); } } };
		const result = await tools.get("codegraph_explore").execute("id", { query: "OMP structural query", maxFiles: 5 }, undefined, undefined, context);
		assert.match(result.content[0].text, /OMP structural query/);
		await commands.get("codegraph").handler("OMP command query", context);
		assert.match(messages[0].content, /OMP command query/);
		assert.deepEqual(notifications, []);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}

	const failedFixture = await setupFakeCli("error");
	try {
		const { tools, commands } = registerOmp();
		const context = {
			cwd: failedFixture.root,
			signal: undefined,
			ui: { notify(message: string) { notifications.push(message); } },
		};
		const result = await tools.get("codegraph_explore").execute("id", { query: "missing index" }, undefined, undefined, context);
		assert.equal(result.isError, true);
		assert.match(result.content[0].text, /index unavailable/);
		await commands.get("codegraph").handler("missing index", context);
		assert.match(notifications[0], /index unavailable/);
	} finally {
		await rm(failedFixture.root, { recursive: true, force: true });
	}
});

test("pi and OMP append the same guidance and hidden prompt-hook context", async () => {
	const fixture = await setupFakeCli();
	const inputPath = path.join(fixture.root, "hook-input.json");
	process.env.CODEGRAPH_TEST_HOOK_INPUT_FILE = inputPath;
	try {
		const pi = register();
		const omp = registerOmp();
		const event = { prompt: "How does the request flow?", systemPrompt: "base prompt" };
		const ctx = { cwd: fixture.project };
		const piResult = await pi.hooks.get("before_agent_start")![0](event, ctx);
		const ompResult = await omp.hooks.get("before_agent_start")![0](event, ctx);
		const input = JSON.parse(await readFile(inputPath, "utf8"));
		assert.deepEqual(input, { prompt: event.prompt, cwd: fixture.project });
		assert.deepEqual(piResult.systemPrompt, ompResult.systemPrompt);
		assert.match(piResult.systemPrompt, /^base prompt/);
		assert.equal(piResult.systemPrompt.split("Prefer CodeGraph").length - 1, 1);
		assert.equal(piResult.message.content, "<codegraph_context>Relevant graph context</codegraph_context>");
		assert.equal(ompResult.message.content, piResult.message.content);
		assert.equal(piResult.message.display, false);
		assert.equal(ompResult.message.display, false);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("before_agent_start accepts the Pi string systemPrompt contract", async () => {
	const fixture = await setupFakeCli();
	try {
		const { hooks } = register();
		const result = await hooks.get("before_agent_start")![0](
			{ prompt: "How does the request flow?", systemPrompt: "base prompt" },
			{ cwd: fixture.project },
		);
		assert.match(result.systemPrompt, /^base prompt/);
		assert.match(result.systemPrompt, /Prefer CodeGraph/);
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("prompt hook fails open for empty output, missing index, failures, and timeouts", async () => {
	for (const mode of ["hook-empty", "hook-no-index", "hook-error", "hook-timeout"]) {
		const fixture = await setupFakeCli(mode);
		try {
			process.env.CODEGRAPH_PROMPT_HOOK_TIMEOUT_MS = "40";
			for (const registerHost of [register, registerOmp]) {
				const { hooks } = registerHost();
				const result = await hooks.get("before_agent_start")![0]({ prompt: "structural?", systemPrompt: "base" }, { cwd: fixture.project });
				assert.equal(result.message, undefined, `${mode} ${registerHost.name}`);
				assert.match(result.systemPrompt, /^base/);
				assert.match(result.systemPrompt, /Prefer CodeGraph/);
			}
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	}

	const fixture = await setupFakeCli();
	try {
		process.env.CODEGRAPH_NO_PROMPT_HOOK = "1";
		process.env.CODEGRAPH_TEST_HOOK_INPUT_FILE = path.join(fixture.root, "should-not-run.json");
		const { hooks } = registerOmp();
		const result = await hooks.get("before_agent_start")![0]({ prompt: "structural?", systemPrompt: "base" }, { cwd: fixture.project });
		assert.equal(result.message, undefined);
		assert.match(result.systemPrompt, /Prefer CodeGraph/);
		await assert.rejects(readFile(process.env.CODEGRAPH_TEST_HOOK_INPUT_FILE));
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("missing prompt-hook CLI does not block either host", async () => {
	const fixture = await setupFakeCli();
	try {
		process.env.PATH = path.join(fixture.root, "missing-bin");
		for (const registerHost of [register, registerOmp]) {
			const { hooks } = registerHost();
			const result = await hooks.get("before_agent_start")![0]({ prompt: "structural?", systemPrompt: "base" }, { cwd: fixture.project });
			assert.equal(result.message, undefined);
			assert.match(result.systemPrompt, /^base/);
			assert.match(result.systemPrompt, /Prefer CodeGraph/);
		}
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("pi and OMP focused tools map supported MCP arguments and preserve structured details", async () => {
	const cases = [
		{ name: "codegraph_node", fields: ["symbol", "includeCode", "file", "offset", "limit", "symbolsOnly", "line", "projectPath"], args: { symbol: "registerCodeGraphHandlers", includeCode: true, file: "codegraph-ext/register.ts", line: 22, projectPath: "project" } },
		{ name: "codegraph_search", fields: ["query", "kind", "limit", "projectPath"], args: { query: "registerCodeGraphHandlers", kind: "function", limit: 3, projectPath: "project" } },
		{ name: "codegraph_files", fields: ["path", "pattern", "format", "includeMetadata", "maxDepth", "projectPath"], args: { path: "codegraph-ext", pattern: "*.ts", format: "flat", includeMetadata: false, maxDepth: 2, projectPath: "project" } },
		{ name: "codegraph_status", fields: ["projectPath"], args: { projectPath: "project" } },
	];
	const fixture = await setupFakeCli();
	const callsPath = path.join(fixture.root, "calls.jsonl");
	process.env.CODEGRAPH_TEST_CALLS_FILE = callsPath;
	try {
		for (const registerHost of [register, registerOmp]) {
			const { tools } = registerHost();
			for (const toolCase of cases) {
				assert.equal(tools.has(toolCase.name), true, `${registerHost.name} registers ${toolCase.name}`);
				const schema = tools.get(toolCase.name).parameters;
				const properties = schema.properties ?? schema.shape;
				assert.deepEqual(Object.keys(properties).sort(), toolCase.fields.sort());
				const result = await tools.get(toolCase.name).execute("id", toolCase.args, undefined, undefined, { cwd: fixture.root });
				assert.match(result.content[0].text, new RegExp(toolCase.name));
				assert.equal(result.details.structured, true);
			}
			for (const omitted of ["codegraph_callers", "codegraph_callees", "codegraph_impact"]) {
				assert.equal(tools.has(omitted), false, `${registerHost.name} does not expose ${omitted}`);
			}
			const searchSchema = tools.get("codegraph_search").parameters;
			const searchProperties = searchSchema.properties ?? searchSchema.shape;
			const kindValues = searchProperties.kind.enum ?? searchProperties.kind.options ?? searchProperties.kind.anyOf.map((item: any) => item.const);
			assert.deepEqual(kindValues, ["function", "method", "class", "interface", "type", "variable", "route", "component"]);
			const filesSchema = tools.get("codegraph_files").parameters;
			const filesProperties = filesSchema.properties ?? filesSchema.shape;
			const formatValues = filesProperties.format.enum ?? filesProperties.format.options ?? filesProperties.format.anyOf.map((item: any) => item.const);
			assert.deepEqual(formatValues, ["tree", "flat", "grouped"]);
		}
		const calls = (await readFile(callsPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(calls.length, cases.length * 2);
		for (let index = 0; index < calls.length; index++) {
			const expected = cases[index % cases.length];
			assert.equal(calls[index].name, expected.name);
			assert.deepEqual(calls[index].arguments, { ...expected.args, projectPath: fixture.project });
		}
	} finally {
		await rm(fixture.root, { recursive: true, force: true });
	}
});

test("focused tools fail locally for invalid calls and missing indexes in both hosts", async () => {
	for (const mode of ["invalid", "no-index"]) {
		const fixture = await setupFakeCli(mode);
		try {
			for (const registerHost of [register, registerOmp]) {
				const { tools } = registerHost();
				for (const name of ["codegraph_node", "codegraph_search", "codegraph_files", "codegraph_status"]) {
					const result = await tools.get(name).execute("id", {}, undefined, undefined, { cwd: fixture.project });
					assert.equal(result.isError, true, `${mode} ${registerHost.name} ${name}`);
					assert.match(result.content[0].text, /CodeGraph .* failed/);
				}
			}
		} finally {
			await rm(fixture.root, { recursive: true, force: true });
		}
	}
});
