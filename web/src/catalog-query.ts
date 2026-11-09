import { useEffect, useState } from "react";
import { api } from "./api";

// Keep the previous result during refresh, but never show it for another query.
export function useCatalogueQuery(path: string | null, pollMs = 0) {
  const [result, setResult] = useState<{ path: string; value: any }>();
  const [failure, setFailure] = useState<{ path: string; error: unknown }>();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const value = await api(path);
        if (live) {
          setResult({ path, value });
          setFailure(undefined);
        }
      } catch (error) {
        if (live) setFailure({ path, error });
      } finally {
        if (live && pollMs) timer = setTimeout(load, pollMs);
      }
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [path, pollMs, version]);
  return {
    data: result?.path === path ? result?.value : undefined,
    error: failure?.path === path ? failure?.error : undefined,
    reload: () => setVersion((version) => version + 1),
    replace: (value: any) => {
      if (path) setResult({ path, value });
    },
  };
}
