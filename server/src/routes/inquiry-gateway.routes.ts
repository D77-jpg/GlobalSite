import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import multer from "multer";
import { isIP } from "node:net";
import { ZodError } from "zod";
import { RateLimit } from "../models";
import { runIdentity } from "../models/tenant-context";
import { otpHash } from "../services/credential-crypto";
import { config } from "../config";
import { AppError, ensure } from "../errors";
import * as service from "../services/inquiry.service";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2097152,
    files: 3,
    fields: 1,
    fieldSize: 24576,
    parts: 4,
  },
}).array("attachments", 3);
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    void fn(req, res).catch(next);
export function createInquiryGateway() {
  const app = express();
  app.disable("x-powered-by");
  const proxies = config.inquiryTrustedProxy
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const valid = proxies.every((s) => {
    const [ip, bits, extra] = s.split("/"),
      v = isIP(ip);
    return (
      !extra &&
      !!v &&
      (bits === undefined ||
        (/^\d+$/.test(bits) && Number(bits) <= (v === 4 ? 32 : 128)))
    );
  });
  app.set("trust proxy", valid && proxies.length ? proxies : false);
  app.use((req, res, next) => {
    res.set({ "Cache-Control": "no-store", Vary: "Origin" });
    void (async () => {
      const minute = Math.floor(Date.now() / 60000),
        key =
          "inquiry-global:" +
          otpHash(req.ip ?? "unknown", "inquiry-gateway") +
          ":" +
          minute;
      const row = await runIdentity(() =>
        RateLimit.findOneAndUpdate(
          { key },
          {
            $inc: { count: 1 },
            $setOnInsert: { expiresAt: new Date((minute + 2) * 60000) },
          },
          { upsert: true, new: true },
        ),
      );
      if (row.count > 180) {
        res.set("Retry-After", "60");
        throw new AppError(429, "INQUIRY_RATE_LIMIT");
      }
      // Continue explicitly; wrap handlers normally terminate a response.
      res.locals.globalAllowed = true;
    })()
      .then(() => next())
      .catch(next);
  });
  // The first rate middleware does not produce a response; use a regular continuation.
  app.use("/sites/:publicId", (req, res, next) => {
    if (!res.locals.globalAllowed)
      return next(new AppError(429, "INQUIRY_RATE_LIMIT"));
    void service
      .withGateway(req.params.publicId, async (route) => {
        const preflight = req.method === "OPTIONS",
          a = await service.gatewayAccess(
            route,
            String(req.headers.origin ?? ""),
            String(req.headers["x-preview-token"] ?? ""),
            preflight,
          );
        res.set({
          "Access-Control-Allow-Origin": a.origin,
          Vary: "Origin",
          "Cache-Control": "no-store",
        });
        await service.gatewayRate(
          String(a.site._id),
          req.ip ?? "unknown",
          req.method === "POST",
        );
        if (preflight) {
          ensure(
            ["GET", "POST"].includes(
              String(req.headers["access-control-request-method"] ?? ""),
            ),
            403,
            "ORIGIN_DENIED",
          );
          const requested = String(
            req.headers["access-control-request-headers"] ?? "",
          )
            .toLowerCase()
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean);
          ensure(
            requested.every((x) =>
              ["content-type", "x-preview-token"].includes(x),
            ),
            403,
            "ORIGIN_DENIED",
          );
          res
            .set({
              "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
              "Access-Control-Allow-Headers": "Content-Type, X-Preview-Token",
              "Access-Control-Max-Age": "600",
            })
            .status(204)
            .end();
          return;
        }
        res.locals.inquiry = a;
        next();
      })
      .catch(next);
  });
  app.get(
    "/sites/:publicId/config",
    wrap(async (_req, res) =>
      res.json({
        success: true,
        data: service.publicConfig(res.locals.inquiry),
      }),
    ),
  );
  app.post(
    "/sites/:publicId/inquiries",
    (req, res, next) => {
      const length = Number(req.headers["content-length"] ?? 0);
      if (length > 3 * 2097152 + 32768)
        return next(new AppError(413, "INQUIRY_ATTACHMENT_LIMIT"));
      if (req.is("multipart/form-data")) upload(req, res, next);
      else if (req.is("application/json"))
        express.json({ limit: "24kb" })(req, res, next);
      else next(new AppError(400, "CONTENT_TYPE_INVALID"));
    },
    wrap(async (req, res) => {
      let data = req.body;
      if (req.is("multipart/form-data")) {
        try {
          data = JSON.parse(req.body?.payload);
        } catch {
          throw new AppError(400, "INVALID_INPUT");
        }
      }
      const result = await service.archiveInquiry(
        res.locals.inquiry,
        data,
        (req.files ?? []) as Express.Multer.File[],
        req.get("user-agent") ?? "",
      );
      res.status(202).json({ success: true, data: result });
    }),
  );
  app.use((_req, _res, next) => next(new AppError(404, "NOT_FOUND")));
  app.use((error: any, _req: Request, res: Response, _next: NextFunction) => {
    const limit = error instanceof multer.MulterError,
      status =
        error instanceof AppError
          ? error.status
          : error?.type === "entity.too.large" || limit
            ? 413
            : error instanceof ZodError || error?.type === "entity.parse.failed"
              ? 400
              : 500;
    const code =
      error instanceof AppError
        ? error.code
        : limit
          ? "INQUIRY_ATTACHMENT_LIMIT"
          : status === 413
            ? "BODY_TOO_LARGE"
            : status === 400
              ? "INVALID_INPUT"
              : "INQUIRY_UNAVAILABLE";
    if (status === 429) res.set("Retry-After", "60");
    res.status(status).json({ success: false, error: { code } });
  });
  return app;
}
