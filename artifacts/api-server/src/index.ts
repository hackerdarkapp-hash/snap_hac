import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}


/* ── Keep-Alive: self-ping every 4 minutes to prevent sleep ── */
function startKeepAlive(port: number): void {
  const INTERVAL_MS = 4 * 60 * 1000;
  setInterval(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      await fetch(`http://localhost:${port}/api/healthz`, { signal: controller.signal });
      clearTimeout(timer);
    } catch { /* ignore */ }
  }, INTERVAL_MS);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startKeepAlive(port);
});
