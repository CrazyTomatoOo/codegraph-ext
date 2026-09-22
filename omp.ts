import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerCodeGraphHandlers, type FocusedToolSchemas } from "./register";

export default function (pi: ExtensionAPI) {
	const ExploreParams = pi.zod.object({
		query: pi.zod.string(),
		maxFiles: pi.zod.number().optional(),
		projectPath: pi.zod.string().optional(),
	});
	const FileFormats = ["tree", "flat", "grouped"] as const;
	const SearchKinds = ["function", "method", "class", "interface", "type", "variable", "route", "component"] as const;
	const FocusedParams: FocusedToolSchemas = {
		codegraph_node: pi.zod.object({
			symbol: pi.zod.string().optional(),
			includeCode: pi.zod.boolean().optional(),
			file: pi.zod.string().optional(),
			offset: pi.zod.number().optional(),
			limit: pi.zod.number().optional(),
			symbolsOnly: pi.zod.boolean().optional(),
			line: pi.zod.number().optional(),
			projectPath: pi.zod.string().optional(),
		}),
		codegraph_search: pi.zod.object({
			query: pi.zod.string(),
			kind: pi.zod.enum(SearchKinds).optional(),
			limit: pi.zod.number().optional(),
			projectPath: pi.zod.string().optional(),
		}),
		codegraph_files: pi.zod.object({
			path: pi.zod.string().optional(),
			pattern: pi.zod.string().optional(),
			format: pi.zod.enum(FileFormats).optional(),
			includeMetadata: pi.zod.boolean().optional(),
			maxDepth: pi.zod.number().optional(),
			projectPath: pi.zod.string().optional(),
		}),
		codegraph_status: pi.zod.object({
			projectPath: pi.zod.string().optional(),
		}),
	};

	registerCodeGraphHandlers(pi, ExploreParams, FocusedParams);
}
