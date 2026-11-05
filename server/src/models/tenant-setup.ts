// Adapted from GlobalCRM server/src/models/tenant-setup.ts @ a94a285.
// Register before model compilation, without global subdocument hooks.
export { tenantPlugin as applyTenant } from "./tenant.plugin";
