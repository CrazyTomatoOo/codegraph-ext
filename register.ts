import path from "node:path";
import { exploreCodeGraph } from "./core";

export interface ExploreParams {
	query: string;
	maxFiles?: number;
	projectPath?: string;
}

function failureResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text" as const, text: `CodeGraph exploration failed: ${message}. Continue with normal file-search tools; no index or configuration was changed.` }],
		details: {},
		isError: true,
	};
}

export function registerCodeGraphHandlers(pi: any, parameters: any) {
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
