import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";

const port = Number(process.env.PORT ?? 3000);
const { db } = createDb();
const app = buildApp({ db, config: loadConfig() });

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
