# codegraph-ext

A shared extension for pi and oh-my-pi that exposes the local CodeGraph index
through the native `codegraph_explore` tool and `/codegraph` command. Both host
entries use the same handlers and short-lived stdio MCP core with the installed
`codegraph` CLI.

## Usage

### Requirements

- Node.js `>=22.19.0` and the CodeGraph CLI (`codegraph`) on `PATH`.
- pi `0.83.x`, or a newer compatible version.
- The current stable oh-my-pi (OMP) release.
- A CodeGraph index for indexed lookups. No-index and missing-CLI cases fail open.

CodeGraph compatibility is based on the CLI's MCP interface (`codegraph serve
--mcp`), not a pinned CLI version. Check `codegraph --version` and run the
acceptance checks below when changing the CLI version.

### Install

Install a tagged GitHub release first:

```bash
pi install git:github.com/CrazyTomatoOo/codegraph-ext@<tag>
omp plugin install github:CrazyTomatoOo/codegraph-ext#<tag>
```

After the same release passes the GitHub install checks, install the stable npm
package:

```bash
pi install npm:codegraph-ext
omp plugin install codegraph-ext
```

Both routes use `pi.extensions` to select `index.ts` or `omp.extensions` to
select `omp.ts`; both entries share the same handlers and MCP implementation.

For local development, load a host-specific entry directly:

```bash
pi -e ./index.ts
omp --extension ./omp.ts
```

Inside pi:

```text
/codegraph src/index.ts
/codegraph how does session startup work?
```

The agent can also invoke `codegraph_explore` with a structural question. Both
host entries register the same tool and command handlers, which call CodeGraph's
MCP `codegraph_explore` operation. If the CLI or index is unavailable, only
the current operation fails; the extension never initializes an index or
writes project configuration.

`codegraph_explore` remains the preferred general-purpose tool. For focused
lookups, both hosts also expose `codegraph_node`, `codegraph_search`,
`codegraph_files`, and `codegraph_status`; callers, callees, and impact are not
registered as separate tools.

Before each prompt, both hosts append concise CodeGraph guidance. The official
`codegraph prompt-hook` may add relevant hidden context; empty output or any
hook failure is ignored. Set `CODEGRAPH_NO_PROMPT_HOOK=1` to disable dynamic
context, or `CODEGRAPH_PROMPT_HOOK_TIMEOUT_MS` to change its 2.5-second timeout.

Oh-my-pi loads the TypeScript entry with its Bun runtime. Requests time out after 20 seconds by default. Set
`CODEGRAPH_MCP_TIMEOUT_MS` to override the per-request timeout.

## Development

```bash
npm ci
npm run typecheck
npm test
npm pack --dry-run --json
node scripts/host-acceptance.mjs "$PACKAGE_DIR" "$INDEXED_PROJECT"
```

Set `PACKAGE_DIR` to the unpacked artifact directory and `INDEXED_PROJECT` to
an indexed project. The `prepack` hook runs typechecking and tests for both
`npm pack` and `npm publish`; verify the artifact contains both entries, shared
source, README, and license.
The host matrix command needs `pi`, `omp`, and `codegraph` on `PATH`; set
`PI_BIN`, `OMP_BIN`, and `CODEGRAPH_BIN` to test explicit runtime versions.

## Release verification

1. Update the package version; run the development checks and build the npm
   tarball with `npm pack`.
2. Push the candidate to GitHub, create and push the matching `vX.Y.Z` tag,
   then install that tag in pi and OMP.
3. Run the host matrix against the unpacked tarball in each real host. It
   verifies extension startup, all five tools, `/codegraph`, indexed queries,
   readable no-index guidance, and missing-CLI fail-open behavior.
4. Record `codegraph --version`. Verify prompt-hook disabled behavior with
   `CODEGRAPH_NO_PROMPT_HOOK=1`; the automated suite covers empty hook output.
5. After the GitHub-tag matrix passes, publish that exact version with
   `npm publish` and verify installation from npm in both hosts.

The fake-CLI suite also verifies prompt-hook kill-switch and empty-output
behavior.
