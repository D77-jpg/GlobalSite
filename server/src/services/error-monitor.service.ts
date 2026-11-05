// Adapted from GlobalCRM server/src/services/error-monitor.service.ts @ a94a285.
export function reportError(requestId: string) {
  console.error(JSON.stringify({ event: "request_failed", requestId }));
}
