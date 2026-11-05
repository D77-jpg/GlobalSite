// Adapted from GlobalCRM server/src/middleware/request-id.middleware.ts @ a94a285.
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { count } from "../services/metrics.service";
export const requestId: RequestHandler = (req, res, next) => {
  res.locals.requestId = randomUUID();
  res.setHeader("X-Request-Id", res.locals.requestId);
  res.once("finish", () => count(req.method, res.statusCode));
  next();
};
