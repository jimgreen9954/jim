import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type FeeRow = { name: string; ok: boolean; got: string | null };

type Lock = { status: "checking" | "ok" | "bad"; rows: FeeRow[] };

const Ctx = createContext<Lock>({ status: "ok", rows: [] });

export function useFeeLock(): Lock {
  return useContext(Ctx);
}

export function FeeLockProvider({ children }: { children: ReactNode }) {
  const [lock, setLock] = useState<Lock>({ status: "ok", rows: [] });
  useEffect(() => {
    let dead = false;
    const id = window.setTimeout(() => {
      void import("@/lib/fee-probe").then((mod) => mod.probeFees()).then((rows) => {
        if (dead) return;
        const mismatch = rows.some((row) => row.got != null && !row.ok);
        setLock({ status: mismatch ? "bad" : "ok", rows });
      }).catch(() => undefined);
    }, 4000);
    return () => {
      dead = true;
      window.clearTimeout(id);
    };
  }, []);
  return <Ctx.Provider value={lock}>{children}</Ctx.Provider>;
}
