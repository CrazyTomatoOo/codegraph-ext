import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";

type JsonRpcResponse = {
	id?: number;
	result?: any;
	error?: { code?: number; message?: string; data?: unknown };
};

const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

function describeError(error: unknown, stderr: string) {
	const message = error instanceof Error ? error.message : String(error);
	const diagnostic = stderr.trim();
	return diagnostic ? `${message}: ${diagnostic}` : message;
}

function extractText(result: any) {
	return result?.content?.map((part: any) => part.text).filter(Boolean).join("\n");
}

async function resolveProjectPath(projectPath: string) {
	const absolutePath = path.resolve(projectPath);
	let details;
	try {
		details = await stat(absolutePath);
	} catch {
		throw new Error(`Project path does not exist: ${absolutePath}`);
	}
	if (!details.isDirectory()) throw new Error(`Project path is not a directory: ${absolutePath}`);
	return absolutePath;
}

export async function exploreCodeGraph(query: string, projectPath: string, signal?: AbortSignal, maxFiles?: number) {
	if (signal?.aborted) throw new Error("CodeGraph exploration cancelled");
	const cwd = await resolveProjectPath(projectPath);
	const requestTimeoutMs = Number(process.env.CODEGRAPH_MCP_TIMEOUT_MS) || DEFAULT_REQUEST_TIMEOUT_MS;
	return withMcpServer(cwd, signal, requestTimeoutMs, async (request) => {
		await request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "codegraph-ext", version: "0.1.0" },
		});
		await request("notifications/initialized");
		const result = await request("tools/call", {
			name: "codegraph_explore",
			arguments: { query, ...(maxFiles === undefined ? {} : { maxFiles }) },
		});
		if (result?.isError) {
			const text = extractText(result);
			throw new Error(text || "CodeGraph reported an exploration error");
		}
		const text = extractText(result);
		if (typeof text !== "string" || !text.trim()) throw new Error("CodeGraph returned an empty explore result");
		return text;
	});
}

async function withMcpServer<T>(cwd: string, signal: AbortSignal | undefined, requestTimeoutMs: number, run: (request: (method: string, params?: unknown) => Promise<any>) => Promise<T>): Promise<T> {
	const child = spawn("codegraph", ["serve", "--mcp", "--path", cwd], {
		cwd,
		env: process.env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stderr = "";
	let stdoutBuffer = "";
	let settled = false;
	let sequence = 0;
	const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
	let rejectProcess: ((error: Error) => void) | undefined;
	const processFailure = new Promise<never>((_, reject) => { rejectProcess = reject; });
	const fail = (error: Error) => {
		for (const item of pending.values()) {
			clearTimeout(item.timer);
			item.reject(error);
		}
		pending.clear();
		rejectProcess?.(error);
	};
	const onAbort = () => fail(new Error("CodeGraph exploration cancelled"));
	if (signal?.aborted) onAbort();
	else signal?.addEventListener("abort", onAbort, { once: true });
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-4_000); });
	child.stdout?.setEncoding("utf8");
	child.stdout?.on("data", (chunk: string) => {
		stdoutBuffer += chunk;
		let newline = stdoutBuffer.indexOf("\n");
		while (newline !== -1) {
			const line = stdoutBuffer.slice(0, newline).trim();
			stdoutBuffer = stdoutBuffer.slice(newline + 1);
			if (line) {
				try {
					const response = JSON.parse(line) as JsonRpcResponse;
					if (typeof response.id !== "number") throw new Error("CodeGraph returned an invalid JSON-RPC response");
					const item = pending.get(response.id);
					if (!item) continue;
					pending.delete(response.id);
					clearTimeout(item.timer);
					if (response.error) item.reject(new Error(response.error.message || "CodeGraph MCP request failed"));
					else item.resolve(response.result);
				} catch (error) {
					fail(error instanceof Error ? error : new Error(String(error)));
				}
			}
			newline = stdoutBuffer.indexOf("\n");
		}
	});
	child.on("error", (error) => fail(new Error(describeError(error, stderr))));
	child.on("exit", (code, exitSignal) => {
		if (!settled) fail(new Error(describeError(new Error(`CodeGraph server exited ${code === null ? `with signal ${exitSignal}` : `with code ${code}`}`), stderr)));
	});
	const request = (method: string, params?: unknown) => new Promise<any>((resolve, reject) => {
		if (method === "notifications/initialized") {
			if (!child.stdin) {
				reject(new Error("CodeGraph server input stream is unavailable"));
				return;
			}
			child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`, (error) => {
				if (error) reject(new Error(describeError(error, stderr)));
				else resolve(undefined);
			});
			return;
		}
		const id = ++sequence;
		const timer = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`CodeGraph request timed out after ${requestTimeoutMs / 1000} seconds`));
		}, requestTimeoutMs);
		pending.set(id, { resolve, reject, timer });
		child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (error) => {
			if (!error) return;
			pending.delete(id);
			clearTimeout(timer);
			reject(new Error(describeError(error, stderr)));
		});
	});
	try {
		return await Promise.race([run(request), processFailure]);
	} catch (error) {
		throw new Error(describeError(error, stderr));
	} finally {
		settled = true;
		signal?.removeEventListener("abort", onAbort);
		for (const item of pending.values()) clearTimeout(item.timer);
		pending.clear();
		child.stdin?.end();
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGTERM");
			await Promise.race([
				new Promise<void>((resolve) => child.once("exit", () => resolve())),
				new Promise<void>((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 250)),
			]);
		}
	}
}
