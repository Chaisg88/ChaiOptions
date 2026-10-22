import http from "node:http";
import { createApplication } from "./application.js";
try {
  process.loadEnvFile();
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const app = await createApplication();
const server = http
  .createServer(app.handle)
  .listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log(
      (process.env.APP_NAME || "Chai") +
        " running on port " +
        (process.env.PORT || 3000),
    ),
  );
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    server.close(async () => {
      await app.close();
      process.exit(0);
    });
  });
