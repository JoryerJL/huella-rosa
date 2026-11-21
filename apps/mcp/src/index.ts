import { createHuellaApi } from "./api";
import { createServer } from "./server";

// Entry point. HR_API_URL: Huella Rosa server (API and OAuth issuer, unless HR_AUTH_URL is set).
// MCP_PORT: default 3002. MCP_PUBLIC_URL: the URL agents use, default http://localhost:<port>/mcp.
const apiUrl = (process.env.HR_API_URL ?? "http://localhost:3001").replace(/\/+$/, "");
const authUrl = (process.env.HR_AUTH_URL ?? apiUrl).replace(/\/+$/, "");
const port = Number(process.env.MCP_PORT ?? 3002);
const resourceUrl = process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}/mcp`;

const server = createServer(createHuellaApi(apiUrl), { resourceUrl, authorizationServer: authUrl });

await server.start({ transportType: "httpStream", httpStream: { port, endpoint: "/mcp" } });
console.log(`Huella Rosa MCP server on ${resourceUrl} (API ${apiUrl}, sign-in ${authUrl})`);
