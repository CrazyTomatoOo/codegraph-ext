# codegraph-ext

A pi extension that exposes the local CodeGraph index through `/codegraph`.

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

The command delegates to `codegraph explore <query>` and displays the result
in the conversation. If CodeGraph is unavailable, the command fails open with
an explanatory notification.
