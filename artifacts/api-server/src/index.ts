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

/* ── Keep-Alive: prevents Render free-tier sleep ── */
function startKeepAlive(): void {
  const externalUrl =
    process.env["RENDER_EXTERNAL_URL"] ||
    process.env["APP_URL"] ||
    `http://localhost:${port}`;

  const pingUrl = `${externalUrl}/api/healthz`;
  const INTERVAL_MS = 4 * 60 * 1000; // every 4 minutes

  logger.info({ pingUrl }, "Keep-alive started");

  setInterval(async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(pingUrl, { signal: controller.signal });
      clearTimeout(timer);
      logger.info({ status: res.status }, "Keep-alive ping OK");
    } catch (err) {
      logger.warn({ err }, "Keep-alive ping failed — will retry next interval");
    }
  }, INTERVAL_MS);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startKeepAlive();
});
