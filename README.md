# codegraph-ext

A pi extension that exposes the local CodeGraph index through the native
`codegraph_explore` tool and `/codegraph` command. Both use the same short-lived
stdio MCP session with the installed `codegraph` CLI.

## Usage

Install CodeGraph and index the repository, then load the extension:

```bash
pi -e ./index.ts
```

Inside pi:

```text
/codegraph src/index.ts
/codegraph how does session startup work?
```

The agent can also invoke `codegraph_explore` with a structural question. Both
the tool and command call CodeGraph's MCP `explore` operation. If the CLI or
index is unavailable, the current operation returns an actionable error and
the pi session remains usable; the extension never initializes an index or
writes project configuration.

Requests time out after 20 seconds by default. Set
`CODEGRAPH_MCP_TIMEOUT_MS` to override the per-request timeout.

## Development

```bash
npm install
npm test
```
