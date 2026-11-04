// Adapted from GlobalCRM server/src/models/tenant-context.ts @ a94a285.
// No broad bypass; execute lazy Mongoose queries before leaving the scoped context.
import { AsyncLocalStorage } from "node:async_hooks";
import { Types } from "mongoose";
type Context = { organizationId?: string; system?: "identity" | "scheduler" };
const storage = new AsyncLocalStorage<Context>();
export const tenantContext = () => storage.getStore();
function run<T>(ctx: Context, fn: () => T) {
  return storage.run(ctx, () => {
    const value = fn();
    return value && typeof (value as any).then === "function"
      ? Promise.resolve(value)
      : value;
  });
}
export function runWithTenant<T>(
  id: string,
  fn: () => PromiseLike<T>,
): Promise<T>;
export function runWithTenant<T>(id: string, fn: () => T): T;
export function runWithTenant<T>(id: string, fn: () => T) {
  if (!Types.ObjectId.isValid(id)) throw new Error("TENANT_REQUIRED");
  return run({ organizationId: id }, fn);
}
export function runIdentity<T>(fn: () => PromiseLike<T>): Promise<T>;
export function runIdentity<T>(fn: () => T): T;
export function runIdentity<T>(fn: () => T) {
  return run({ system: "identity" }, fn);
}
export function runScheduler<T>(fn: () => PromiseLike<T>): Promise<T>;
export function runScheduler<T>(fn: () => T): T;
export function runScheduler<T>(fn: () => T) {
  return run({ system: "scheduler" }, fn);
}
