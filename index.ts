import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerCodeGraphHandlers, type FocusedToolSchemas } from "./register";

const ExploreParams = Type.Object({
	query: Type.String({ description: "Structural code question or symbol to explore" }),
	maxFiles: Type.Optional(Type.Number({ description: "Maximum number of source files to include" })),
	projectPath: Type.Optional(Type.String({ description: "Project directory with an initialized CodeGraph index; relative paths use the current project as their base" })),
});

const FocusedParams: FocusedToolSchemas = {
	codegraph_node: Type.Object({
		symbol: Type.Optional(Type.String({ description: "Symbol name to inspect; omit when reading a file" })),
		includeCode: Type.Optional(Type.Boolean({ description: "Include the symbol body" })),
		file: Type.Optional(Type.String({ description: "File path or symbol-disambiguating file" })),
		offset: Type.Optional(Type.Number({ description: "1-based starting line in file mode" })),
		limit: Type.Optional(Type.Number({ description: "Maximum file lines or search results" })),
		symbolsOnly: Type.Optional(Type.Boolean({ description: "Return only the file symbol map and dependents" })),
		line: Type.Optional(Type.Number({ description: "Definition line for disambiguation" })),
		projectPath: Type.Optional(Type.String({ description: "Project path; relative paths use the current project as their base" })),
	}),
	codegraph_search: Type.Object({
		query: Type.String({ description: "Symbol name or partial name to search for" }),
		kind: Type.Optional(Type.Union([
			Type.Literal("function"), Type.Literal("method"), Type.Literal("class"), Type.Literal("interface"),
			Type.Literal("type"), Type.Literal("variable"), Type.Literal("route"), Type.Literal("component"),
		])),
		limit: Type.Optional(Type.Number({ description: "Maximum results" })),
		projectPath: Type.Optional(Type.String({ description: "Project path; relative paths use the current project as their base" })),
	}),
	codegraph_files: Type.Object({
		path: Type.Optional(Type.String({ description: "Filter to files under this directory" })),
		pattern: Type.Optional(Type.String({ description: "Glob pattern to filter files" })),
		format: Type.Optional(Type.Union([Type.Literal("tree"), Type.Literal("flat"), Type.Literal("grouped")])),
		includeMetadata: Type.Optional(Type.Boolean({ description: "Include language and symbol count metadata" })),
		maxDepth: Type.Optional(Type.Number({ description: "Maximum directory depth" })),
		projectPath: Type.Optional(Type.String({ description: "Project path; relative paths use the current project as their base" })),
	}),
	codegraph_status: Type.Object({
		projectPath: Type.Optional(Type.String({ description: "Project path; relative paths use the current project as their base" })),
	}),
};

export default function (pi: ExtensionAPI) {
	registerCodeGraphHandlers(pi, ExploreParams, FocusedParams);
}
