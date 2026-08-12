import { loadConfig } from "./config.js";
import { buildHttpServer } from "./http/server.js";
import { createServices } from "./services/services.js";

const config = await loadConfig();
const services = await createServices(config);
const server = await buildHttpServer(services);

const shutdown = async () => {
  await server.close();
};

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.listen({ host: config.host, port: config.port });
server.log.info(
  {
    host: config.host,
    port: config.port,
    authTokenPath: config.authTokenPath,
    remoteMode: config.remoteMode,
  },
  "FrameOS daemon listening",
);
