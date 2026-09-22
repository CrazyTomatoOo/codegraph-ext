import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const packageRoot = path.resolve(process.argv[2] ?? ".");
const indexedProject = path.resolve(process.argv[3] ?? process.cwd());
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const requiredTools = ["codegraph_explore", "codegraph_node", "codegraph_search", "codegraph_files", "codegraph_status"];
const scenarios = ["indexed", "no-index", "missing-cli"];
const hostBinaries = {
	pi: process.env.PI_BIN ?? execFileSync("which", ["pi"], { encoding: "utf8" }).trim(),
	omp: process.env.OMP_BIN ?? execFileSync("which", ["omp"], { encoding: "utf8" }).trim(),
};

function run(binary, args, options = {}) {
	return new Promise((resolve, reject) => {
		const child = spawn(binary, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs ?? 60_000);
		child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
		child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
		child.once("error", reject);
		child.once("close", (code, signal) => {
			clearTimeout(timer);
			if (code === 0) resolve({ stdout, stderr });
			else reject(new Error(`${binary} exited ${code ?? signal}: ${stderr || stdout}`));
		});
		child.stdin.end(options.input ?? "");
	});
}

function parseFrames(text) {
	return text.split(/\r?\n/).flatMap((line) => {
		try {
			return [JSON.parse(line)];
		} catch {
			return [];
		}
	});
}

async function verifyHost(host, scenario, emptyProject, unavailablePath) {
	const entry = host === "pi" ? manifest.pi?.extensions?.[0] : manifest.omp?.extensions?.[0];
	assert.ok(entry, `${host} package entry is declared`);
	const entryPath = path.resolve(packageRoot, entry);
	const scratch = await mkdtemp(path.join(os.tmpdir(), "codegraph-host-acceptance-"));
	const reportPath = path.join(scratch, "report.json");
	const auditPath = path.join(scratch, "audit.ts");
	const projectPath = scenario === "indexed" ? indexedProject : emptyProject;
	const codegraphPath = scenario === "missing-cli" ? unavailablePath : process.env.PATH;
	const rpcCommand = host === "pi" ? "get_commands" : "get_available_commands";
	const auditSource = `
import { writeFile } from "node:fs/promises";
import extension from ${JSON.stringify(entryPath)};

export default function (pi: any) {
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const wrapped = new Proxy(pi, {
		get(target, property) {
			if (property === "registerTool") return (tool: any) => { tools.set(tool.name, tool); return target.registerTool(tool); };
			if (property === "registerCommand") return (name: string, command: any) => { commands.set(name, command); return target.registerCommand(name, command); };
			const value = Reflect.get(target, property, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	extension(wrapped);
	pi.on("session_start", async (_event: any, ctx: any) => {
		const args: Record<string, any> = {
			codegraph_explore: { query: "registerCodeGraphHandlers" },
			codegraph_node: { symbol: "registerCodeGraphHandlers" },
			codegraph_search: { query: "registerCodeGraphHandlers" },
			codegraph_files: { format: "flat", maxDepth: 1 },
			codegraph_status: {},
		};
		const results: Record<string, any> = {};
		for (const name of ${JSON.stringify(requiredTools)}) {
			const tool = tools.get(name);
			results[name] = tool ? await tool.execute("acceptance", { ...args[name], projectPath: ${JSON.stringify(projectPath)} }, undefined, undefined, ctx) : null;
		}
		let commandError = null;
		try {
			const command = commands.get("codegraph");
			if (!command) throw new Error("/codegraph command was not registered");
			await command.handler("release acceptance query", ctx);
		} catch (error) {
			commandError = error instanceof Error ? error.message : String(error);
		}
		await writeFile(${JSON.stringify(reportPath)}, JSON.stringify({ toolNames: [...tools.keys()].sort(), commandNames: [...commands.keys()], results, commandError }));
	});
}
`;
	await writeFile(auditPath, auditSource);
	try {
		const args = ["--mode", "rpc", "--no-session", "--no-extensions", "--extension", auditPath];
		const env = { ...process.env, PATH: codegraphPath };
		const frames = await run(hostBinaries[host], args, {
			cwd: projectPath,
			env,
			input: `${JSON.stringify({ id: "acceptance", type: rpcCommand })}\n`,
		});
		const outputFrames = parseFrames(frames.stdout);
		const commandResponse = outputFrames.find((frame) => frame.type === "response" && frame.command === rpcCommand);
		assert.equal(commandResponse?.success, true, `${host} RPC command list is available`);
		const commands = commandResponse.data?.commands ?? [];
		assert.ok(commands.some((command) => command.name.replace(/^\//, "") === "codegraph"), `${host} exposes /codegraph`);
		const report = JSON.parse(await readFile(reportPath, "utf8"));
		assert.deepEqual(report.toolNames, [...requiredTools].sort(), `${host} registers exactly five CodeGraph tools`);
		assert.equal(report.commandError, null, `${host} /codegraph handler completes without throwing`);
		for (const name of requiredTools) {
			const result = report.results[name];
			assert.ok(result, `${host} executes ${name}`);
			const text = result.content?.map((part) => part.text).filter(Boolean).join("\n") ?? "";
			assert.ok(text.length > 0, `${host} ${name} returns readable content`);
			if (scenario === "indexed") assert.doesNotMatch(text, /No CodeGraph project is loaded/);
			if (scenario === "no-index") assert.match(text, /isn't indexed|No CodeGraph project is loaded/);
			if (scenario === "missing-cli") assert.equal(result.isError, true, `${host} ${name} reports a local error`);
		}
		console.log(`${host}: ${scenario} — 5 tools, /codegraph, readable results`);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}

const emptyProject = await mkdtemp(path.join(os.tmpdir(), "codegraph-empty-project-"));
const unavailablePath = await mkdtemp(path.join(os.tmpdir(), "codegraph-no-cli-"));
try {
	await symlink(process.execPath, path.join(unavailablePath, "node"));
	const cliVersion = await run(process.env.CODEGRAPH_BIN ?? "codegraph", ["--version"]);
	console.log(`CodeGraph CLI: ${cliVersion.stdout.trim()}`);
	for (const host of ["pi", "omp"]) {
		const hostVersion = await run(hostBinaries[host], ["--version"]);
		console.log(`${host}: ${hostVersion.stdout.trim()}`);
		for (const scenario of scenarios) await verifyHost(host, scenario, emptyProject, unavailablePath);
	}
} finally {
	await rm(emptyProject, { recursive: true, force: true });
	await rm(unavailablePath, { recursive: true, force: true });
}
