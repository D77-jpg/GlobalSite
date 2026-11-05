type Row = Record<string, any>;
export function orderedNodes(nodes: Row[]): Row[] {
  const result: Row[] = [],
    seen = new Set<string>();
  function add(parent: string | null, depth: number) {
    for (const n of nodes.filter((n) => n.parentKey === parent)) {
      if (seen.has(n.key)) continue;
      seen.add(n.key);
      result.push({ ...n, depth });
      add(n.key, depth + 1);
    }
  }
  add(null, 0);
  for (const n of nodes) if (!seen.has(n.key)) result.push({ ...n, depth: 0 });
  return result;
}
export function moveNode(nodes: Row[], key: string, target: string) {
  if (key === target) return nodes;
  const item = nodes.find((n) => n.key === key),
    to = nodes.find((n) => n.key === target);
  if (!item || !to || item.type === "home") return nodes;
  let parent = to.parentKey;
  const seen = new Set<string>();
  while (parent) {
    if (parent === key || seen.has(parent)) return nodes;
    seen.add(parent);
    parent = nodes.find((n) => n.key === parent)?.parentKey;
  }
  const remaining = nodes.filter((n) => n.key !== key),
    index = remaining.findIndex((n) => n.key === target);
  remaining.splice(index, 0, { ...item, parentKey: to.parentKey });
  return remaining;
}
