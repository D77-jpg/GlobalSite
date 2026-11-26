// Adapted from GlobalCRM server/src/services/metrics.service.ts @ a94a285; bounded labels.
// S37 §4.10: adds bounded worker task & AI outcome counters (never PII, tenant IDs or URLs).
const counts = new Map<string, number>();
const taskCounts = new Map<string, number>();
const taskDurationMs = new Map<string, number>();
const aiCounts = new Map<string, number>();

const sanitizeLabel = (raw: string) =>
  raw.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40) || "unknown";

export function count(method: string, status: number) {
  const key = sanitizeLabel(method) + "_" + Math.floor(status / 100) + "xx";
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

export function recordTaskMetric(
  kind: string,
  status: "done" | "pending" | "dead" | "error",
  durationMs: number,
) {
  const k = sanitizeLabel(kind) + "|" + status;
  taskCounts.set(k, (taskCounts.get(k) ?? 0) + 1);
  if (Number.isFinite(durationMs) && durationMs >= 0) {
    const dk = sanitizeLabel(kind);
    taskDurationMs.set(dk, (taskDurationMs.get(dk) ?? 0) + Math.round(durationMs));
  }
}

export function recordAiMetric(
  task: string,
  outcome: "ok" | "invalid" | "rate_limit" | "transient" | "failed" | "unknown",
) {
  const k = sanitizeLabel(task) + "|" + outcome;
  aiCounts.set(k, (aiCounts.get(k) ?? 0) + 1);
}

export function metrics() {
  const lines: string[] = [];
  for (const [key, value] of counts) {
    lines.push('globalsite_requests_total{result="' + key + '"} ' + value);
  }
  for (const [key, value] of taskCounts) {
    const [kind, status] = key.split("|");
    lines.push(
      'globalsite_worker_tasks_total{kind="' + kind + '",status="' + status + '"} ' + value,
    );
  }
  for (const [kind, value] of taskDurationMs) {
    lines.push('globalsite_worker_task_duration_ms_sum{kind="' + kind + '"} ' + value);
  }
  for (const [key, value] of aiCounts) {
    const [task, outcome] = key.split("|");
    lines.push(
      'globalsite_ai_calls_total{task="' + task + '",outcome="' + outcome + '"} ' + value,
    );
  }
  return lines.join("\n") + "\n";
}
