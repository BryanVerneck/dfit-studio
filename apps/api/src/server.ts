import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { startGenerationScheduler } from "./jobs/generation.js";

const port = Number(process.env.PORT ?? 3000);
const { db } = createDb();
// Set WEB_DIR to the built web app (apps/web/dist) to serve it from this same service.
const app = buildApp({ db, config: loadConfig(), webDir: process.env.WEB_DIR });

// Creates upcoming class sessions every day. Set DISABLE_SCHEDULER=true to run it elsewhere or by hand.
if (process.env.DISABLE_SCHEDULER !== "true") {
  const stop = startGenerationScheduler(db, app.log, { hour: Number(process.env.GENERATION_HOUR ?? 3) });
  app.addHook("onClose", async () => stop());
}

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
