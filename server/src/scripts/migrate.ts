import mongoose from "mongoose";
import { connectDatabase } from "../db";
void connectDatabase()
  .then(() => mongoose.disconnect())
  .then(() => console.log("s2-foundation-v1: applied"))
  .catch(() => {
    console.error("migration_failed");
    process.exit(1);
  });
