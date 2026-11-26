// Adapted from GlobalCRM server/src/services/error-monitor.service.ts @ a94a285.
// S37 §4.10: structured error reporting with fixed event/error codes only (never secrets or PII).
export function reportError(requestId: string) {
  console.error(JSON.stringify({ event: "request_failed", requestId }));
}

export function reportWorkerError(kind: string, errorCode: string) {
  console.error(
    JSON.stringify({
      event: "worker_task_failed",
      kind: String(kind).slice(0, 60),
      errorCode: String(errorCode).replace(/[^A-Z0-9_]/gi, "_").slice(0, 60),
    }),
  );
}
