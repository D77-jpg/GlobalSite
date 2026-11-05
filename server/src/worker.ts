// Adapted from GlobalCRM server/src/worker.ts @ a94a285; independent GlobalSite jobs.
import mongoose from "mongoose";
import { connectDatabase } from "./db";
import { startBackgroundJobs } from "./background/runtime";
async function main() {
  await connectDatabase();
  const stop = startBackgroundJobs();
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      void stop()
        .then(() => mongoose.disconnect())
        .then(() => process.exit(0));
    });
  console.info(JSON.stringify({ event: "worker_ready" }));
}
void main().catch(() => {
  console.error("worker_start_failed");
  process.exit(1);
});
