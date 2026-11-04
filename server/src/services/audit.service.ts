// Adapted from GlobalCRM server/src/services/audit.service.ts @ a94a285; no bodies/PII.
import { AuditLog } from "../models";
export async function audit(
  action: string,
  actorId?: string,
  targetId?: string,
  requestId?: string,
) {
  await AuditLog.create({ action, actorId, targetId, requestId });
}
