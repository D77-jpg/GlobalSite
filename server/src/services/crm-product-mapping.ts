// Consumer mapping only. Authority: GlobalCRM integration-v1.openapi.yaml,
// GlobalSiteC1Product @60cdbc48035301c152a58b924558b08a850fa36a. No CRM calls in S3.
import { z } from "zod";
const spec = z.object({
  code: z.string(),
  name: z.string(),
  value: z.string(),
  unit: z.string().nullable(),
});
export const crmProductShape = z
  .object({
    id: z.string().regex(/^[a-f0-9]{24}$/),
    sku: z.string().min(1),
    name: z.string().min(1),
    category: z.string().nullable(),
    description: z.string().nullable(),
    material: z.string().nullable(),
    application: z.string().nullable(),
    certifications: z.array(z.string()),
    moq: z.string().nullable(),
    leadTime: z.string().nullable(),
    specs: z.array(spec),
    status: z.enum(["active", "archived"]),
    images: z.array(
      z.object({
        id: z.string(),
        url: z.string().url(),
        expiresAt: z.string().datetime(),
        mime: z.string(),
        bytes: z.number().int(),
        sha256: z.string(),
      }),
    ),
    updatedAt: z.string().datetime(),
  })
  .passthrough();
export function mapCrmProduct(raw: unknown, connectionId: string) {
  const p = crmProductShape.parse(raw);
  return {
    sku: p.sku,
    name: p.name,
    category: p.category,
    description: p.description,
    material: p.material,
    application: p.application,
    certifications: p.certifications,
    moq: p.moq,
    leadTime: p.leadTime,
    specs: p.specs,
    status: p.status,
    source: "globalcrm",
    externalRef: { connectionId, remoteId: p.id, remoteUpdatedAt: p.updatedAt },
    assetIds: [],
    remoteImages: p.images,
  };
}
