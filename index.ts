import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { Type } from "typebox";
import { exploreCodeGraph } from "./core";

const ExploreParams = Type.Object({
	query: Type.String({ description: "Structural code question or symbol to explore" }),
	maxFiles: Type.Optional(Type.Number({ description: "Maximum number of source files to include" })),
	projectPath: Type.Optional(Type.String({ description: "Project directory with an initialized CodeGraph index; relative paths use the current project as their base" })),
});

function failureResult(error: unknown) {
	const message = error instanceof Error ? error.message : String(error);
	return {
		content: [{ type: "text" as const, text: `CodeGraph exploration failed: ${message}. Continue with normal file-search tools; no index or configuration was changed.` }],
		details: {},
		isError: true,
	};
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "codegraph_explore",
		label: "CodeGraph Explore",
		description: "Explore code structure using the local CodeGraph index. Prefer this for structural questions; use grep/read for literal text searches or when CodeGraph is unavailable.",
		parameters: ExploreParams,
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
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
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /codegraph <symbol or question>", "info");
				return;
			}
			try {
				const text = await exploreCodeGraph(query, ctx.cwd, ctx.signal);
				pi.sendMessage({ customType: "codegraph-result", content: text, display: true });
			} catch (error) {
				ctx.ui.notify(failureResult(error).content[0].text, "warning");
			}
		},
	});
}
