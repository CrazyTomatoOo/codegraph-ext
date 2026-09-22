import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { registerCodeGraphHandlers } from "./register";

const ExploreParams = Type.Object({
	query: Type.String({ description: "Structural code question or symbol to explore" }),
	maxFiles: Type.Optional(Type.Number({ description: "Maximum number of source files to include" })),
	projectPath: Type.Optional(Type.String({ description: "Project directory with an initialized CodeGraph index; relative paths use the current project as their base" })),
});

export default function (pi: ExtensionAPI) {
	registerCodeGraphHandlers(pi, ExploreParams);
}
