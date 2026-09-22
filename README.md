# codegraph-ext

A shared extension for pi and oh-my-pi that exposes the local CodeGraph index
through the native `codegraph_explore` tool and `/codegraph` command. Both host
entries use the same handlers and short-lived stdio MCP core with the installed
`codegraph` CLI.

## Usage

Install CodeGraph and index the repository, then load the host-specific entry:

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

Requires Node.js `>=22.19.0`; oh-my-pi loads the TypeScript entry with its Bun
runtime. Requests time out after 20 seconds by default. Set
`CODEGRAPH_MCP_TIMEOUT_MS` to override the per-request timeout.

## Development

```bash
npm install
npm test
```
