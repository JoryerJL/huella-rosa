# Huella Rosa MCP server

MCP server for AI agents (Claude Code, Devin) that help an intake person import patients:
the person gives the agent an Excel file or a photo of the paper form, the agent analyzes it with
Huella Rosa's own parser, form reader and matching, **shows the plan**, and imports only what the
person confirms (SPEC 6.7). Built with [FastMCP](https://github.com/punkpeye/fastmcp) over HTTP
streaming at `/mcp`.

## Sign-in: the agent acts as you

There are no shared keys. The first time an agent uses the server it gets `401` with a
`WWW-Authenticate` challenge, discovers the Huella Rosa sign-in (OAuth 2.1 with PKCE and dynamic
client registration, as the MCP authorization spec describes) and **opens the browser** on the page
"Conectar un agente de IA a tu cuenta". The person enters their usuario and PIN (same checks, rate
limit and error as the app login) and approves. From then on the agent acts as that person, with
that person's role:

- Only **Captura** (intake) accounts can analyze and import. Other roles get a plain error.
- Access tokens last 1 hour and refresh tokens rotate; only their SHA-256 is stored.
- Each person sees and disconnects their agents in the app (**Agentes conectados**, top bar);
  administration can disconnect any. A disconnected agent gets `401` on its next request.
- Every call is in the audit log: "Análisis por agente de <nombre> (<cliente>)" and
  "Importación confirmada por <nombre> vía agente (<cliente>)", with ids and counts only.

## Tools

| Tool | What it does |
|---|---|
| `get_import_template` | Columns Huella Rosa reads from a spreadsheet, required fields and format rules |
| `analyze_spreadsheet({ fileBase64, fileName })` | Reads an .xlsx or .csv with the app's parser, validates and matches each row. **Saves nothing.** Returns a `previewId` (30 minutes), the column mapping and each row as `NEW`, `POSSIBLE_MATCH` (candidates with reasons) or `INVALID` (plain reason) |
| `analyze_form_photo({ imageBase64, mimeType, fileName? })` | Reads the identification fields of the paper form with the app's form reader (`OCR_MODE`, never a generative model), with confidence per field, and looks for existing patients. **Saves nothing.** Clinical fields are never returned |
| `apply_import({ previewId, decisions, confirmedByUser: true, confirmationText })` | Runs **only** the confirmed decisions: `register` (new patient), `isHer` (adds the row to the record **the person chose**, filling empty fields only), `skip`. Rows without a decision stay for review in the app. A preview can be applied once |

The tool descriptions tell the agent to always show the plan and ask for an explicit yes before
`apply_import`, and never to decide a match on its own. Applied rows go through the same write path
as the review screen, and the batch appears in **Importar** history as "Desde el agente de <nombre>".

## Connect an agent

Claude Code:

```sh
claude mcp add --transport http huella-rosa http://localhost:3002/mcp
```

The first time you use it, Claude Code opens the browser so you sign in with your Huella Rosa
usuario and PIN. Devin (or any MCP client with Streamable HTTP and OAuth): add a remote MCP server
with URL `http://<host>:3002/mcp`; it follows the same sign-in. A cloud agent needs the server
reachable over HTTPS (set `MCP_PUBLIC_URL` and `OAUTH_ISSUER` on the Huella Rosa server).

## Example conversation

> **Laura (Captura):** Te paso el Excel de la brigada (`plantilla-llena.xlsx`). ¿Qué importarías?
>
> **Agente** *(calls `analyze_spreadsheet`)*: Revisé 5 filas, todavía no guardé nada:
> - 3 pacientes nuevas: Patricia Núñez Salazar, Verónica Ibarra Quintero, Teresa Olvera Campos.
> - La fila 5, "Juana Martinez Garcia" (30/07/1972), se parece mucho a **Juana Martínez García**,
>   que ya tiene expediente (misma fecha de nacimiento, nombre parecido). ¿Es ella?
> - La fila 6, Carmen Ruelas Pineda, tiene una fecha que no existe (31/02/1990). La dejo fuera
>   para que la corrijas en el Excel.
>
> ¿Registro las 3 nuevas y qué hago con Juana?
>
> **Laura:** Sí, registra las tres. Juana sí es ella.
>
> **Agente** *(calls `apply_import` with 3 × `register` and `isHer` for the Juana you chose)*:
> Listo: 3 registradas y la fila de Juana se agregó a su expediente. La fila de Carmen quedó en
> Importar para que la revises.

## Run

```sh
npm run dev -w @er/mcp      # http://localhost:3002/mcp; API and sign-in at http://localhost:3001
```

| Variable | Default |
|---|---|
| `HR_API_URL` | `http://localhost:3001` (Huella Rosa API) |
| `HR_AUTH_URL` | same as `HR_API_URL` (OAuth issuer the agent signs in with) |
| `MCP_PORT` | `3002` |
| `MCP_PUBLIC_URL` | `http://localhost:<MCP_PORT>/mcp` (the OAuth resource) |

The Huella Rosa server publishes its OAuth metadata at
`/.well-known/oauth-authorization-server`; its issuer is `OAUTH_ISSUER` (default
`http://localhost:<PORT>`).

## Tests

```sh
npm test -w @er/mcp      # tool handlers and the token check with a mocked API
npm run e2e -w @er/mcp   # against running servers on a freshly seeded database
```

`scripts/e2e.ts` uses the official MCP SDK client with its OAuth support: discovery from the `401`,
client registration, PKCE, sign-in as `lperez`, then `analyze_spreadsheet` on
`datos-ficticios/excel/plantilla-llena.xlsx` (3 new, 1 possible match with Juana, 1 invalid),
`apply_import` with 3 × register + Juana "es ella", `analyze_form_photo` on
`datos-ficticios/formatos/formato-01.svg` (Lucía, STRONG), a doctor account getting a plain error,
and a disconnected agent getting `401`. Set `HR_API_URL`, `MCP_URL` and optionally `PATIENT_DB` (the
server's SQLite file) to also check patient counts and audit entries.

Only fictitious data: sending real patient data to an external AI service is a personal-data
transfer that needs a privacy notice, a provider contract and legal review.
