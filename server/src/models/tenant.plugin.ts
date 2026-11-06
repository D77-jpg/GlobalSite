// Adapted from GlobalCRM server/src/models/tenant.plugin.ts @ a94a285.
// Fail closed, immutable organization IDs, restricted auth lookups; bulk writes blocked.
import { Schema, Types } from "mongoose";
import { tenantContext } from "./tenant-context";
export function tenantPlugin(
  schema: Schema,
  options: {
    identity?: boolean;
    authLookup?: boolean;
    scheduler?: boolean;
    publicLookup?: boolean;
  } = {},
) {
  if (!options.identity)
    schema.add({
      organizationId: {
        type: Schema.Types.ObjectId,
        required: true,
        immutable: true,
        index: true,
      },
    });
  function scope(query: any) {
    const ctx = tenantContext();
    if (options.identity) {
      if (ctx?.system !== "identity")
        throw new Error("IDENTITY_CONTEXT_REQUIRED");
      return;
    }
    if (ctx?.organizationId) {
      const update = query.getUpdate?.();
      if (update) {
        if (
          Array.isArray(update) ||
          Object.keys(update).some((k) => !k.startsWith("$"))
        )
          throw new Error("TENANT_UNSAFE_UPDATE");
        for (const operator of Object.keys(update)) {
          if (
            Object.keys(update[operator] ?? {}).some(
              (k) => k === "organizationId" || k.startsWith("organizationId."),
            ) ||
            Object.values(update[operator] ?? {}).includes("organizationId")
          )
            throw new Error("TENANT_IMMUTABLE");
        }
        if (query.getOptions().upsert)
          update.$setOnInsert = {
            ...update.$setOnInsert,
            organizationId: ctx.organizationId,
          };
      }
      query.and([{ organizationId: ctx.organizationId }]);
      return;
    }
    if (
      options.publicLookup &&
      ctx?.system === "inquiry" &&
      query.op === "findOne"
    ) {
      const q = query.getFilter();
      if (
        q.publicId !== ctx.publicId ||
        q.enabled !== true ||
        Object.keys(q).some((k) => !["publicId", "enabled"].includes(k))
      )
        throw new Error("RESTRICTED_PUBLIC_LOOKUP");
      return;
    }
    if (options.authLookup && ctx?.system === "identity") {
      const keys = Object.keys(query.getFilter());
      if (
        !keys.some((k) =>
          [
            "_id",
            "userId",
            "tokenHash",
            "accessHash",
            "refreshHash",
            "inviteTokenHash",
          ].includes(k),
        )
      )
        throw new Error("RESTRICTED_IDENTITY_LOOKUP");
      return;
    }
    if (
      options.scheduler &&
      ctx?.system === "scheduler" &&
      query.op === "findOneAndUpdate"
    )
      return;
    throw new Error("TENANT_REQUIRED");
  }
  for (const hook of [
    "find",
    "findOne",
    "countDocuments",
    "distinct",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
    "findOneAndUpdate",
    "findOneAndDelete",
    "findOneAndReplace",
    "replaceOne",
  ] as const)
    schema.pre(hook, function () {
      scope(this);
    });
  schema.pre("validate", function () {
    const ctx = tenantContext();
    if (options.identity) {
      if (ctx?.system !== "identity")
        throw new Error("IDENTITY_CONTEXT_REQUIRED");
      return;
    }
    if (!ctx?.organizationId) throw new Error("TENANT_REQUIRED");
    if (
      this.get("organizationId") &&
      String(this.get("organizationId")) !== ctx.organizationId
    )
      throw new Error("TENANT_MISMATCH");
    this.set("organizationId", ctx.organizationId);
  });
  schema.pre("aggregate", function () {
    const ctx = tenantContext();
    if (!ctx?.organizationId || options.identity)
      throw new Error("TENANT_REQUIRED");
    const pipeline = this.pipeline();
    // These stages can escape tenant filtering into another collection/database.
    if (
      JSON.stringify(pipeline).match(
        /"\$(lookup|unionWith|out|merge|search|geoNear)"/,
      )
    )
      throw new Error("TENANT_UNSAFE_AGGREGATE");
    pipeline.unshift({
      $match: { organizationId: new Types.ObjectId(ctx.organizationId) },
    });
  });
  schema.pre("deleteOne", { document: true, query: false }, function () {
    throw new Error("TENANT_USE_SCOPED_WRITES");
  });
  schema.pre("updateOne", { document: true, query: false }, function () {
    throw new Error("TENANT_USE_SCOPED_WRITES");
  });
  schema.pre("insertMany", function () {
    throw new Error("TENANT_USE_CREATE");
  });
  schema.pre("bulkWrite", function () {
    throw new Error("TENANT_USE_SCOPED_WRITES");
  });
}
