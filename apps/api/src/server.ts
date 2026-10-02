import { config } from "./config";
import { buildApp } from "./app";

async function start() {
  const app = buildApp({ logger: true });
  try {
    await app.listen({ port: config.port, host: config.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      app.close().then(() => process.exit(0));
    });
  }
}

start();
