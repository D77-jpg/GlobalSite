import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AppError } from "../errors";

// Reviewed, pinned guidance shipped with the application. No dynamic remote skills,
// file paths from users, third-party scripts or unbounded code execution.
export function siteSkillProfile() {
  try {
    const guidance = fs.readFileSync(
      path.resolve(__dirname, "../../agent-skills/brand-site.md"),
      "utf8",
    );
    if (!guidance.trim() || Buffer.byteLength(guidance) > 17000)
      throw new Error("INVALID_PROFILE");
    return {
      version: "brand-site-v4",
      hash: createHash("sha256").update(guidance).digest("hex"),
      guidance,
    };
  } catch {
    throw new AppError(409, "AGENT_SKILLS_UNAVAILABLE");
  }
}
