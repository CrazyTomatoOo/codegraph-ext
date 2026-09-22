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
			if (request.params.name !== "codegraph_explore") {
				send({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Unknown tool: " + request.params.name } });
				continue;
			}
			if (mode === "stderr") { process.stderr.write("index is missing\\n"); process.exit(2); }
			if (mode === "timeout") continue;
			send({ jsonrpc: "2.0", id: request.id, result: { content: [{ type: "text", text: JSON.stringify({ query: request.params.arguments.query, maxFiles: request.params.arguments.maxFiles, files: ["src/main.ts"] }) }] } });
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
	const messages: any[] = [];
	const pi = {
		typebox: Type,
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		sendMessage(message: any) { messages.push(message); return message; },
	};
	extension(pi as any);
	return { tools, commands, messages };
}

function registerOmp() {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const messages: any[] = [];
	const scalar = (type: string) => ({ type, optional() { return { type, optional: true }; } });
	const zod = {
		string: () => scalar("string"),
		number: () => scalar("number"),
		object: (shape: unknown) => ({ type: "object", shape }),
	};
	const pi = {
		zod,
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		sendMessage(message: any) { messages.push(message); return message; },
	};
	ompExtension(pi as any);
	return { tools, commands, messages };
}

test.afterEach(() => {
	process.env.PATH = originalPath;
	if (originalTimeout === undefined) delete process.env.CODEGRAPH_MCP_TIMEOUT_MS;
	else process.env.CODEGRAPH_MCP_TIMEOUT_MS = originalTimeout;
	delete process.env.CODEGRAPH_TEST_MODE;
	delete process.env.CODEGRAPH_TEST_PID_FILE;
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
