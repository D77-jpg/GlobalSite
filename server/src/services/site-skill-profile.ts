import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { AppError } from "../errors";

const ALLOWED_PACKS = new Set(["precision", "atelier", "monolith"]);

/**
 * S37 §4.1: loads reviewed, allowlisted style-pack guidance from
 * agent-skills/packs/<pack>.md. Never accepts arbitrary paths or remote URLs.
 */
export function packSkillGuidance(pack?: string | null): string {
  if (!pack || !ALLOWED_PACKS.has(pack)) return "";
  try {
    const file = path.resolve(
      __dirname,
      "../../agent-skills/packs/" + pack + ".md",
    );
    if (!fs.existsSync(file)) return "";
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text || Buffer.byteLength(text) > 4000) return "";
    return text;
  } catch {
    return "";
  }
}

// Reviewed, pinned guidance shipped with the application. No dynamic remote skills,
// file paths from users, third-party scripts or unbounded code execution.
export function siteSkillProfile(pack?: string | null) {
  try {
    const base = fs.readFileSync(
      path.resolve(__dirname, "../../agent-skills/brand-site.md"),
      "utf8",
    );
    if (!base.trim() || Buffer.byteLength(base) > 17000)
      throw new Error("INVALID_PROFILE");
    const extra = packSkillGuidance(pack);
    const guidance = extra ? base.trimEnd() + "\n\n" + extra + "\n" : base;
    return {
      version: "brand-site-v4",
      hash: createHash("sha256").update(guidance).digest("hex"),
      guidance,
    };
  } catch {
    throw new AppError(409, "AGENT_SKILLS_UNAVAILABLE");
  }
}
