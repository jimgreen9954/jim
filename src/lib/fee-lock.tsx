import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createPublicClient, http, parseAbi, type Address } from "viem";
import { BSC, FEE_TO } from "@/lib/bsc";
import { GATE } from "@/lib/gate-chain";
import { BSC_REBATE, KNOWN_XPERP } from "@/lib/perp";
import { XLAYER } from "@/lib/xlayer";

const abi = parseAbi(["function FEE_TO() view returns (address)"]);

export type FeeRow = { name: string; ok: boolean; got: string | null };

type Lock = { status: "checking" | "ok" | "bad"; rows: FeeRow[] };

const Ctx = createContext<Lock>({ status: "checking", rows: [] });

export function useFeeLock(): Lock {
  return useContext(Ctx);
}

async function readOne(rpc: string, address: Address, name: string): Promise<FeeRow> {
  try {
    const client = createPublicClient({ transport: http(rpc, { timeout: 12_000 }) });
    const got = await client.readContract({ address, abi, functionName: "FEE_TO" });
    return { name, got, ok: got.toLowerCase() === FEE_TO.toLowerCase() };
  } catch {
    return { name, got: null, ok: true };
  }
}

export function FeeLockProvider({ children }: { children: ReactNode }) {
  const [lock, setLock] = useState<Lock>({ status: "checking", rows: [] });
  useEffect(() => {
    let dead = false;
    const timer = window.setTimeout(() => {
      if (dead) return;
      setLock((cur) => (cur.status === "checking" ? { status: "ok", rows: cur.rows } : cur));
    }, 8000);
    void Promise.all([
      readOne(BSC.rpc, BSC_REBATE, "BSC 永续"),
      readOne(XLAYER.rpc, KNOWN_XPERP, "X Layer 永续"),
      readOne(BSC.rpc, GATE, "晶体管永续"),
    ]).then((rows) => {
      if (dead) return;
      setLock({ status: rows.some((row) => row.got != null && !row.ok) ? "bad" : "ok", rows });
    }).catch(() => {
      if (!dead) setLock((cur) => (cur.status === "checking" ? { status: "ok", rows: [] } : cur));
    });
    return () => {
      dead = true;
      window.clearTimeout(timer);
    };
  }, []);
  return <Ctx.Provider value={lock}>{children}</Ctx.Provider>;
}
