import mongoose from "mongoose";
import { config } from "./config";
import { models, Migration } from "./models";
import { runIdentity } from "./models/tenant-context";
export async function connectDatabase(uri = config.mongo) {
  const database = new URL(
    uri.replace("mongodb://", "http://").replace("mongodb+srv://", "https://"),
  ).pathname.slice(1);
  if (database !== "globalsite") throw new Error("DATABASE_MUST_BE_GLOBALSITE");
  await mongoose.connect(uri, {
    dbName: "globalsite",
    serverSelectionTimeoutMS: 10000,
  });
  await migrate();
}
export async function migrate() {
  for (const model of models) await model.init();
  await runIdentity(() =>
    Migration.updateOne(
      { key: "s2-foundation-v1" }, // gitleaks:allow (non-secret migration ID)
      { $setOnInsert: { completedAt: new Date() } },
      { upsert: true },
    ),
  );
}
