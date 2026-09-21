import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Minimal CodeGraph extension entry point.
 *
 * CodeGraph is intentionally invoked through its CLI so this extension remains
 * usable on machines where the optional index is not installed.
 */
export default function (pi: ExtensionAPI) {
	pi.registerCommand("codegraph", {
		description: "Explore the repository with CodeGraph",
		getArgumentCompletions: () => [],
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /codegraph <symbol or question>", "info");
				return;
			}

			const result = await pi.exec("codegraph", ["explore", query]);
			if (result.code !== 0) {
				ctx.ui.notify(result.stderr || "CodeGraph exploration failed", "error");
				return;
			}

			pi.sendMessage({
				customType: "codegraph-result",
				content: result.stdout,
				display: true,
			});
		},
	});
}
