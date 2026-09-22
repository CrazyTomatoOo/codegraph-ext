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

Requires Node.js `>=22.19.0`; oh-my-pi loads the TypeScript entry with its Bun
runtime. Requests time out after 20 seconds by default. Set
`CODEGRAPH_MCP_TIMEOUT_MS` to override the per-request timeout.

## Development

```bash
npm install
npm test
```
