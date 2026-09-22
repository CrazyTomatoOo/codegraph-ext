import { spawn } from "node:child_process";

const DEFAULT_PROMPT_HOOK_TIMEOUT_MS = 2_500;
const MAX_PROMPT_HOOK_OUTPUT_BYTES = 256_000;

function getPromptHookTimeoutMs() {
	const configured = Number.parseInt(process.env.CODEGRAPH_PROMPT_HOOK_TIMEOUT_MS ?? "", 10);
	return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_PROMPT_HOOK_TIMEOUT_MS;
}

export function runCodeGraphPromptHook(prompt: string, cwd: string): Promise<string> {
	if (process.env.CODEGRAPH_NO_PROMPT_HOOK === "1") return Promise.resolve("");

	return new Promise((resolve) => {
		let output = "";
		let settled = false;
		const child = spawn("codegraph", ["prompt-hook"], {
			cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "ignore"],
		});
		const finish = (value: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve(value.trim());
		};
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			finish("");
			const forceKill = setTimeout(() => child.kill("SIGKILL"), 250);
			forceKill.unref();
		}, getPromptHookTimeoutMs());
		timeout.unref();
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			output += chunk;
			if (Buffer.byteLength(output) > MAX_PROMPT_HOOK_OUTPUT_BYTES) {
				child.kill("SIGTERM");
				finish("");
			}
		});
		child.on("error", () => finish(""));
		child.on("close", (code) => finish(code === 0 ? output : ""));
		child.stdin?.on("error", () => finish(""));
		child.stdin?.end(JSON.stringify({ prompt, cwd }));
	});
}
