import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("package metadata selects host entries and ships their shared implementation", async () => {
	const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
	assert.deepEqual(manifest.pi.extensions, ["./index.ts"]);
	assert.deepEqual(manifest.omp.extensions, ["./omp.ts"]);
	assert.equal(manifest.engines.node, ">=22.19.0");
	assert.ok(manifest.keywords.includes("pi-package"));
	assert.deepEqual(manifest.files, ["README.md", "LICENSE", "core.ts", "index.ts", "omp.ts", "prompt-hook.ts", "register.ts"]);
	assert.match(await readFile(path.join(packageRoot, "index.ts"), "utf8"), /from "\.\/register"/);
	assert.match(await readFile(path.join(packageRoot, "omp.ts"), "utf8"), /from "\.\/register"/);
	assert.match(manifest.scripts.prepack, /typecheck/);
	assert.match(manifest.scripts.prepack, /test/);
});
