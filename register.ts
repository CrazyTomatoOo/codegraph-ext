import path from "node:path";
import { callCodeGraphTool, exploreCodeGraph } from "./core";
import { runCodeGraphPromptHook } from "./prompt-hook";

export const CODEGRAPH_GUIDANCE = "Prefer CodeGraph for structural questions and use codegraph_explore; use grep/read when CodeGraph is insufficient or literal matching is needed.";

export interface ExploreParams {
	query: string;
	maxFiles?: number;
	projectPath?: string;
}

export interface FocusedToolSchemas {
	codegraph_node: any;
	codegraph_search: any;
	codegraph_files: any;
	codegraph_status: any;
}

const FOCUSED_TOOLS = [
	{
		name: "codegraph_node",
		label: "CodeGraph Node",
		description: "Read one symbol or file from the index with source and dependency context.",
	},
	{
		name: "codegraph_search",
		label: "CodeGraph Search",
		description: "Find symbols by name without returning source; prefer codegraph_explore for structural questions.",
	},
	{
		name: "codegraph_files",
		label: "CodeGraph Files",
		description: "List indexed files and their metadata, optionally filtered by path or glob.",
	},
	{
		name: "codegraph_status",
		label: "CodeGraph Status",
		description: "Check CodeGraph index health and statistics.",
	},
] as const;

function failureResult(error: unknown, operation = "exploration") {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text" as const, text: `CodeGraph ${operation} failed: ${message}. Continue with normal file-search tools; no index or configuration was changed.` }],
		details: {},
		isError: true,
	};
}

export function registerCodeGraphHandlers(pi: any, parameters: any, focusedParameters: FocusedToolSchemas) {
	pi.on("before_agent_start", async (event: { prompt: string; systemPrompt: string[] }, ctx: { cwd: string }) => {
		const systemPrompt = event.systemPrompt.some((section) => section.includes(CODEGRAPH_GUIDANCE))
			? event.systemPrompt
			: [...event.systemPrompt, CODEGRAPH_GUIDANCE];
		const context = await runCodeGraphPromptHook(event.prompt, ctx.cwd);
		return {
			systemPrompt,
			...(context ? { message: { customType: "codegraph-context", content: context, display: false } } : {}),
		};
	});

	pi.registerTool({
		name: "codegraph_explore",
		label: "CodeGraph Explore",
		description: "Explore code structure using the local CodeGraph index. Prefer this for structural questions; use grep/read for literal text searches or when CodeGraph is unavailable.",
		parameters,
		async execute(_toolCallId: string, params: ExploreParams, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
			try {
				const projectPath = params.projectPath ? path.resolve(ctx.cwd, params.projectPath) : ctx.cwd;
				const text = await exploreCodeGraph(params.query, projectPath, signal, params.maxFiles);
				return { content: [{ type: "text", text }], details: {} };
			} catch (error) {
				return failureResult(error);
			}
		},
	});

	for (const definition of FOCUSED_TOOLS) {
		pi.registerTool({
			...definition,
			parameters: focusedParameters[definition.name],
			async execute(_toolCallId: string, params: Record<string, unknown>, signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
				try {
					const requestedPath = typeof params.projectPath === "string" ? params.projectPath : ctx.cwd;
					const projectPath = path.resolve(ctx.cwd, requestedPath);
					const result = await callCodeGraphTool(
						definition.name,
						{ ...params, projectPath },
						projectPath,
						signal,
					);
					return { content: [{ type: "text", text: result.text }], details: result.details };
				} catch (error) {
					return failureResult(error, definition.name.replace("codegraph_", ""));
				}
			},
		});
	}

	pi.registerCommand("codegraph", {
		description: "Explore the repository with CodeGraph",
		getArgumentCompletions: () => [],
		handler: async (args: string, ctx: any) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /codegraph <symbol or question>", "info");
				return;
			}
			try {
				const signal = (ctx as { signal?: AbortSignal }).signal;
				const text = await exploreCodeGraph(query, ctx.cwd, signal);
				pi.sendMessage({ customType: "codegraph-result", content: text, display: true });
			} catch (error) {
				ctx.ui.notify(failureResult(error).content[0].text, "warning");
			}
		},
	});
}
