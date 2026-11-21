# Huella Rosa MCP server

MCP server for AI agents (Devin, Claude) that clean up messy spreadsheets and **propose** patient
identification rows to Huella Rosa (SPEC 6.7). Built with [FastMCP](https://github.com/punkpeye/fastmcp)
over HTTP streaming at `/mcp`.

**Nothing is saved by an agent.** Every proposal becomes an import batch that an intake person
reviews row by row in the app (`/intake/import/<id>`). Agents cannot confirm, link, merge, delete
or search patients, and never see clinical data, row values or match candidates: only counts.

## Tools

| Tool | What it does |
|---|---|
| `get_import_template` | Columns, required fields, format rules and the 500-row limit |
| `propose_import({ rows, note? })` | Creates a batch (source `MCP`) for human review. Returns `{ batchId, counts, reviewUrl, message }` |
| `get_import_status({ batchId })` | Status and counts of a batch the same agent proposed |

Rows carry identification fields only: `fullName`, `birthDate` (YYYY-MM-DD), `birthState`,
`formId`, `phone`, `mobile`, `residence`, `affiliation`. The server runs the same validation and
matching as an Excel upload; invalid rows are kept with a plain reason for the reviewer.

## Agent tokens

An administrator creates a token in the app (**Administración → Agentes de IA**) or with
`POST /api/agent-tokens { name }`. The token (`hr_agent_…`) is shown **once**; only its SHA-256
is stored. It acts with role `intake` on `/api/agent/*` only, is limited to 60 requests per minute,
and every call is audited as `agent:<token name>`. Revoking it cuts access immediately on the API;
the MCP server re-checks tokens at most every 30 seconds and right after the API rejects one.

## Run

```sh
npm run dev -w @er/mcp      # http://localhost:3002/mcp, API at http://localhost:3001
```

| Variable | Default |
|---|---|
| `HR_API_URL` | `http://localhost:3001` |
| `MCP_PORT` | `3002` |

## Connect an agent

Claude Code:

```sh
claude mcp add --transport http huella-rosa http://localhost:3002/mcp --header "Authorization: Bearer <token>"
```

Devin (or any MCP client with Streamable HTTP): add a remote MCP server with URL
`http://<host>:3002/mcp` and the header `Authorization: Bearer <token>`. The server must be
reachable from where the agent runs (for a cloud agent, expose it with HTTPS).

A good prompt: *"Read this spreadsheet, call `get_import_template`, normalize the rows without
inventing values, and call `propose_import`."* See `datos-ficticios/excel/agente-ejemplo.json` for
four messy fictitious rows and how an agent would normalize them.

## Tests

```sh
npm test -w @er/mcp                     # tool handlers and auth with a mocked API
npm run e2e -w @er/mcp                  # against running servers; see scripts/e2e.ts
```

`scripts/e2e.ts` creates a token as the demo admin, connects with the official MCP SDK client,
lists the three tools, proposes the four example rows, checks counts, the intake listing, the
agent-token refusal on other routes and the revoked-token refusal. Set `HR_API_URL`, `MCP_URL`
and optionally `PATIENT_DB` (the server's SQLite file) to count patients before and after.

Only fictitious data: sending real patient data to an external AI service is a personal-data
transfer that needs a privacy notice, a provider contract and legal review.
