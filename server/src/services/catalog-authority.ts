import mongoose from "mongoose";
import { Membership, Organization } from "../models";
import { runIdentity, tenantContext } from "../models/tenant-context";
import { ensure } from "../errors";
export async function authorizeActor(
  actorId: string,
  session?: mongoose.ClientSession,
) {
  const organizationId = tenantContext()?.organizationId;
  ensure(organizationId, 403, "TENANT_REQUIRED");
  const member = await Membership.exists({
    userId: actorId,
    status: "active",
    role: { $in: ["admin", "editor"] },
  }).session(session ?? null);
  const org = await runIdentity(
    async () =>
      await Organization.findOne({
        _id: organizationId,
        status: "active",
      }).session(session ?? null),
  );
  ensure(member && org, 403, "ACTOR_REVOKED");
}
