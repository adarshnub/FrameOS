import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { createMcpServer } from "./mcp/server.js";
import { createServices } from "./services/services.js";

const config = await loadConfig();
const services = await createServices(config);
const server = createMcpServer(services);
const transport = new StdioServerTransport(process.stdin, process.stdout, {
  maxBufferSize: 10 * 1_024 * 1_024,
});

const shutdown = async () => {
  await server.close();
  await services.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.connect(transport);
