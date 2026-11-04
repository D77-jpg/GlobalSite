// Adapted from GlobalCRM server/src/services/metrics.service.ts @ a94a285; bounded labels.
const counts = new Map<string, number>();
export function count(method: string, status: number) {
  const key = method + "_" + Math.floor(status / 100) + "xx";
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
export function metrics() {
  return (
    [...counts]
      .map(
        ([key, value]) =>
          'globalsite_requests_total{result="' + key + '"} ' + value,
      )
      .join("\n") + "\n"
  );
}
