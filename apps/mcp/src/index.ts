import { createHuellaApi } from "./api";
import { createServer } from "./server";

// Entry point: HR_API_URL (Huella Rosa server) and MCP_PORT (default 3002), endpoint /mcp.
const apiUrl = process.env.HR_API_URL ?? "http://localhost:3001";
const port = Number(process.env.MCP_PORT ?? 3002);

const server = createServer(createHuellaApi(apiUrl));

await server.start({ transportType: "httpStream", httpStream: { port, endpoint: "/mcp" } });
console.log(`Huella Rosa MCP server on http://localhost:${port}/mcp (API ${apiUrl})`);
