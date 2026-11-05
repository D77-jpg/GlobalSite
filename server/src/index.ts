import mongoose from "mongoose";
import { createApp } from "./app";
import { connectDatabase } from "./db";
import { config } from "./config";
async function main() {
  await connectDatabase();
  const server = createApp().listen(config.port, () =>
    console.info(JSON.stringify({ event: "api_ready", port: config.port })),
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      server.close(() => {
        void mongoose.disconnect().then(() => process.exit(0));
      });
    });
}
void main().catch(() => {
  console.error("api_start_failed");
  process.exit(1);
});
