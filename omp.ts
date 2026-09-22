import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { registerCodeGraphHandlers } from "./register";

export default function (pi: ExtensionAPI) {
	const ExploreParams = pi.zod.object({
		query: pi.zod.string(),
		maxFiles: pi.zod.number().optional(),
		projectPath: pi.zod.string().optional(),
	});

	registerCodeGraphHandlers(pi, ExploreParams);
}
