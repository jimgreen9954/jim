import { useEffect, useMemo, useState } from "react";
import { formatEther, parseEther } from "viem";
import { compile, simulate, type CNode, type CWire, type Kind } from "@/lib/canvas-net";
import { useExchange } from "@/lib/exchange-store";
import { connectXLayer, readProcessor, recipeNetlist, SEAL_NETLIST, TAPE_SHEET, type ProcessorStatus } from "@/lib/xlayer";
import { connectBsc } from "@/lib/bsc";
import { readTapeDesk, readTapeRows, tapeOn, tapePage, tapeTxUrl } from "@/lib/tape-any";
import { getTapeTargets, OURS, type TapeTarget } from "@/lib/tape-targets";
import { currentAccount, onAccount } from "@/lib/wallet";

const RECIPES: [number, number][] = [
  [1, 0], [1, 1], [3, 0], [4, 0], [9, 0], [1, 9], [20, 0], [49, 0], [100, 0], [400, 0],
];

function sheets(have: bigint, chunk: number): bigint {
  if (have <= 0n) return 0n;
  return (have + BigInt(chunk) - 1n) / BigInt(chunk);
}

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function matchSheet(): { nodes: CNode[]; wires: CWire[] } {
  const nodes: CNode[] = [
    { id: "a", kind: "in", x: 24, y: 36 },
    { id: "b", kind: "in", x: 24, y: 108 },
    { id: "c", kind: "in", x: 24, y: 200 },
    { id: "d", kind: "in", x: 24, y: 272 },
    { id: "n1", kind: "nand", x: 220, y: 64 },
    { id: "n2", kind: "nand", x: 220, y: 228 },
    { id: "n3", kind: "nand", x: 420, y: 146 },
    { id: "y", kind: "out", x: 620, y: 156 },
  ];
  const wires: CWire[] = [
    { from: "a", to: "n1", toPin: 0 },
    { from: "b", to: "n1", toPin: 1 },
    { from: "c", to: "n2", toPin: 0 },
    { from: "d", to: "n2", toPin: 1 },
    { from: "n1", to: "n3", toPin: 0 },
    { from: "n2", to: "n3", toPin: 1 },
    { from: "n3", to: "y", toPin: 0 },
  ];
  return { nodes, wires };
}

function recipeSheet(nand: number, latch: number): { nodes: CNode[]; wires: CWire[] } | null {
  if (nand + latch > 12) return null;
  const nodes: CNode[] = [
    { id: "a", kind: "in", x: 24, y: 80 },
    { id: "b", kind: "in", x: 24, y: 180 },
  ];
  const wires: CWire[] = [];
  let last = "";
  for (let i = 0; i < nand; i++) {
    const id = `n${i}`;
    nodes.push({ id, kind: "nand", x: 200 + (i % 4) * 130, y: 40 + Math.floor(i / 4) * 80 });
    wires.push({ from: "a", to: id, toPin: 0 }, { from: "b", to: id, toPin: 1 });
    last = id;
  }
  for (let i = 0; i < latch; i++) {
    const id = `l${i}`;
    nodes.push({ id, kind: "latch", x: 200 + ((nand + i) % 4) * 130, y: 40 + Math.floor((nand + i) / 4) * 80 });
    wires.push({ from: "a", to: id, toPin: 0 });
    last = id;
  }
  nodes.push({ id: "y", kind: "out", x: 680, y: 140 });
  if (last) wires.push({ from: last, to: "y", toPin: 0 });
  return { nodes, wires };
}

type Pin = { node: string; pin: 0 | 1 | "o"; x: number; y: number; out: boolean };

function pinsOf(n: CNode): Pin[] {
  const x = n.x;
  const y = n.y;
  if (n.kind === "in" || n.kind === "c0" || n.kind === "c1") return [{ node: n.id, pin: "o", x: x + 108, y: y + 28, out: true }];
  if (n.kind === "out") return [{ node: n.id, pin: 0, x, y: y + 28, out: false }];
  if (n.kind === "latch") {
    return [
      { node: n.id, pin: 0, x, y: y + 28, out: false },
      { node: n.id, pin: "o", x: x + 108, y: y + 28, out: true },
    ];
  }
  return [
    { node: n.id, pin: 0, x, y: y + 16, out: false },
    { node: n.id, pin: 1, x, y: y + 40, out: false },
    { node: n.id, pin: "o", x: x + 108, y: y + 28, out: true },
  ];
}

function label(kind: Kind) {
  if (kind === "in") return "IN";
  if (kind === "out") return "OUT";
  if (kind === "nand") return "NAND";
  if (kind === "latch") return "LATCH";
  if (kind === "c0") return "0";
  return "1";
}

const ERR: Record<string, [string, string]> = {
  inputs: ["输入要 1 到 16 个", "Use 1 to 16 inputs"],
  outputs: ["输出要 1 到 8 个", "Use 1 to 8 outputs"],
  gates: ["门要 1 到 64 扇", "Use 1 to 64 gates"],
  unwired: ["有门还没接好", "A gate is not wired"],
  outwire: ["输出还没接线", "An output is not wired"],
  outkind: ["输出只能接到 NAND 或 LATCH", "An output must come from NAND or LATCH"],
  sameout: ["两个输出接到了同一扇门", "Two outputs share one gate"],
  after: ["接到输出的门，后面不能再接 NAND", "Nothing may read a gate that is already an output"],
  cycle: ["NAND 接成了环", "The NAND gates loop"],
  nosig: ["有一根线没有信号", "A wire has no signal"],
};

export function TapeCanvas() {
  const lang = useExchange((s) => s.lang);
  const zh = lang === "zh";
  const seed = matchSheet();
  const [nodes, setNodes] = useState<CNode[]>(seed.nodes);
  const [wires, setWires] = useState<CWire[]>(seed.wires);
  const [tool, setTool] = useState<Kind | "wire" | "del">("wire");
  const [arm, setArm] = useState<string | null>(null);
  const [bits, setBits] = useState<boolean[]>([1, 1, 1, 1].map(Boolean));
  const [latch, setLatch] = useState<Record<string, boolean>>({});
  const [recipe, setRecipe] = useState<[number, number] | null>(null);
  const [cpu, setCpu] = useState<ProcessorStatus | null>(null);
  const [fee, setFee] = useState("0.0013");
  const [rows, setRows] = useState<{ id: string; nIn: string; nOut: string; gates: string; owner: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [target, setTarget] = useState<TapeTarget>(OURS);
  const [targets, setTargets] = useState<TapeTarget[]>([OURS]);
  const [find, setFind] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [held, setHeld] = useState<{ nand: bigint; latch: bigint } | null>(null);
  const [heldErr, setHeldErr] = useState(false);
  const [okb, setOkb] = useState<bigint | null>(null);
  const [ack, setAck] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let dead = false;
    getTapeTargets()
      .then((rows) => { if (!dead && rows.length) setTargets(rows); })
      .catch(() => undefined);
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      if (target.ours) readProcessor().then((row) => { if (!dead) setCpu(row); }).catch(() => undefined);
      else if (!dead) setCpu(null);
      readTapeRows(target, 8).then((list) => { if (!dead) setRows(list); }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 8000);
    return () => { dead = true; window.clearInterval(id); };
  }, [target]);

  useEffect(() => onAccount((next) => setAccount(next)), []);

  useEffect(() => {
    let dead = false;
    const pull = () => {
      readTapeDesk(target, account)
        .then((row) => {
          if (dead) return;
          setFee(row.fee);
          setTotal(row.total);
          setOkb(account ? row.native : null);
          if (account) {
            setHeld({ nand: row.nand, latch: row.latch });
            setHeldErr(false);
          } else {
            setHeld(null);
            setHeldErr(false);
          }
        })
        .catch(() => {
          if (!dead && account) setHeldErr(true);
        });
    };
    pull();
    const id = window.setInterval(pull, 5000);
    return () => { dead = true; window.clearInterval(id); };
  }, [account, target]);

  const built = useMemo(() => (recipe ? null : compile(nodes, wires)), [nodes, wires, recipe]);
  const optimal = Boolean(built && !("error" in built) && built.hex === SEAL_NETLIST);
  const sim = useMemo(() => (recipe ? null : simulate(nodes, wires, bits, latch)), [nodes, wires, bits, latch, recipe]);
  const inputs = nodes.filter((n) => n.kind === "in").sort((a, b) => a.y - b.y || a.x - b.x);
  const outputs = nodes.filter((n) => n.kind === "out").sort((a, b) => a.y - b.y || a.x - b.x);

  const place = (kind: Kind, x: number, y: number) => {
    setRecipe(null);
    setNodes((list) => [...list, { id: uid(), kind, x: Math.max(8, x - 40), y: Math.max(8, y - 20) }]);
  };

  const onPin = (pin: Pin) => {
    if (tool === "del") return;
    if (pin.out) {
      setArm(pin.node);
      return;
    }
    if (!arm) return;
    setRecipe(null);
    setWires((list) => [...list.filter((w) => !(w.to === pin.node && w.toPin === pin.pin)), { from: arm, to: pin.node, toPin: pin.pin as 0 | 1 }]);
    setArm(null);
  };

  const say = (code: string) => ERR[code]?.[zh ? 0 : 1] ?? code;

  const go = async () => {
    setBusy(true);
    setBad(false);
    setNote(zh ? "正在连接钱包。" : "Connecting the wallet.");
    try {
      const from = currentAccount() ?? (target.chain === "bsc" ? await connectBsc() : await connectXLayer());
      setAccount(from);
      const desk = await readTapeDesk(target, from);
      const heldNow = { nand: desk.nand, latch: desk.latch };
      setHeld(heldNow);
      const netlist = recipe ? recipeNetlist(recipe[0], recipe[1]) : built && !("error" in built) ? built.hex : null;
      const nIn = recipe ? 2 : built && !("error" in built) ? built.nIn : 0;
      const nOut = recipe ? 1 : built && !("error" in built) ? built.nOut : 0;
      const nand = recipe ? recipe[0] : built && !("error" in built) ? built.nand : 0;
      const latchN = recipe ? recipe[1] : built && !("error" in built) ? built.latch : 0;
      if (!netlist) throw new Error(built && "error" in built ? built.error : "gates");
      if (heldNow.nand < BigInt(nand) || heldNow.latch < BigInt(latchN)) throw new Error("short");
      const unit = target.chain === "bsc" ? "BNB" : "OKB";
      setNote(zh ? `正在 ${target.name} 上流片。签名之后还要等节点交出回执，大网表会更久。回执成功，电路就已经在链上。` : `Taping on ${target.name}. After you sign, the page waits for the node to return the receipt. A large sheet takes longer. When the receipt succeeds, the circuit is already on chain.`);
      const hash = await tapeOn(target, from, netlist, nIn, nOut);
      setHeld(await readTapeDesk(target, from).then((row) => ({ nand: row.nand, latch: row.latch })));
      setNote(zh ? `已流在 ${target.name} 上。电路在这笔交易里，不是还要再铸一笔。本页名单大约 8 秒刷新一次。个人中心要更久，它从旧编号往后查。` : `Taped on ${target.name}. The circuit is in this transaction, not a second mint. This page's list refreshes in about 8 seconds. The account page is slower because it walks older ids first.`);
      window.open(tapeTxUrl(target, hash), "_blank", "noopener,noreferrer");
    } catch (error) {
      setBad(true);
      const message = error instanceof Error ? `${error.message} ${"shortMessage" in error ? String((error as { shortMessage?: string }).shortMessage ?? "") : ""}` : "";
      setNote(
        message === "short" || message.startsWith("short")
          ? zh ? "这台的 NAND 或 LATCH 不够。TAPELIQUID 去晶圆铸造，官网那台去 tapeout.net 铸造。" : "This processor does not have enough NAND or LATCH. Mint TAPELIQUID on the wafer. Mint an official one on tapeout.net."
          : message === "okb" || /insufficient funds/i.test(message)
            ? zh ? `流片费是 ${fee} ${target.chain === "bsc" ? "BNB" : "OKB"}。这个地址不够付费，也付不了 gas。晶体管没动。` : `The tape fee is ${fee} ${target.chain === "bsc" ? "BNB" : "OKB"}. This address cannot pay it. The transistors did not move.`
            : /SSTORE2|too large|out of gas/i.test(message)
            ? zh ? "这张太大，链上写不进去。改点 1.8 万 NAND 或 3 万 LATCH。颗数还在。" : "This sheet is too big to store. Use 18,000 NAND or 30,000 LATCH. The transistors are still there."
            : ERR[message]
            ? say(message)
            : message.includes("rejected") || message.includes("denied")
              ? zh ? "你取消了。" : "You cancelled."
              : zh ? "流片没有完成。颗数还在。" : "Tape-out did not finish. The transistors are still there.",
      );
    } finally {
      setBusy(false);
    }
  };

  const flood = async (kind: "nand" | "latch") => {
    const chunk = kind === "nand" ? TAPE_SHEET.nand : TAPE_SHEET.latch;
    setBusy(true);
    setBad(false);
    let done = 0;
    try {
      const from = currentAccount() ?? (target.chain === "bsc" ? await connectBsc() : await connectXLayer());
      setAccount(from);
      for (let i = 0; i < 24; i++) {
        const desk = await readTapeDesk(target, from);
        const have = kind === "nand" ? desk.nand : desk.latch;
        if (have < 1n) break;
        const n = Number(have > BigInt(chunk) ? BigInt(chunk) : have);
        const nand = kind === "nand" ? n : 0;
        const latchN = kind === "latch" ? n : 0;
        setNote(zh ? `第 ${i + 1} 笔。这张烧掉 ${nand} NAND、${latchN} LATCH。确认后才会下一笔。` : `Sheet ${i + 1}. Burns ${nand} NAND and ${latchN} LATCH. The next one waits for this signature.`);
        await tapeOn(target, from, recipeNetlist(nand, latchN), 2, 1);
        done += 1;
      }
      const left = await readTapeDesk(target, from);
      setHeld({ nand: left.nand, latch: left.latch });
      setNote(zh ? `这一轮签成 ${done} 笔。NAND 还剩 ${left.nand.toString()}，LATCH 还剩 ${left.latch.toString()}。` : `${done} sheets landed. NAND left ${left.nand.toString()}, LATCH left ${left.latch.toString()}.`);
    } catch (error) {
      setBad(true);
      const message = error instanceof Error ? `${error.message} ${"shortMessage" in error ? String((error as { shortMessage?: string }).shortMessage ?? "") : ""}` : "";
      setNote(message.includes("rejected") || message.includes("denied")
        ? zh ? `你取消了。已经流成 ${done} 笔。` : `You cancelled. ${done} sheets already landed.`
        : /SSTORE2|too large/i.test(message)
          ? zh ? `这张太大，写不进去。已经流成 ${done} 笔，剩下的颗数还在。` : `That sheet does not fit. ${done} landed. The rest is still there.`
          : zh ? `停了。已经流成 ${done} 笔，没签成的颗数还在。` : `Stopped. ${done} sheets landed. The rest is still there.`);
    } finally {
      setBusy(false);
    }
  };

  const burn = recipe ? `${recipe[0]} NAND + ${recipe[1]} LATCH` : built && !("error" in built) ? `${built.nand} NAND + ${built.latch} LATCH` : "—";
  const liveErr = !recipe && built && "error" in built ? say(built.error) : null;
  const needN = recipe ? recipe[0] : built && !("error" in built) ? built.nand : null;
  const needL = recipe ? recipe[1] : built && !("error" in built) ? built.latch : null;
  const times = held != null && needN != null && needL != null ? tapeTimes(held.nand, held.latch, needN, needL) : null;
  const feeWei = (() => { try { return parseEther(fee || "0"); } catch { return 0n; } })();
  const okbShort = Boolean(account) && okb != null && okb < feeWei + parseEther("0.0004");
  const short = times != null && times < 1n;
  const ready = !liveErr && needN != null && ack && Boolean(account) && held != null && !short && !okbShort;
  const unit = target.chain === "bsc" ? "BNB" : "OKB";
  const shownTargets = (() => {
    const query = find.trim().toLowerCase();
    const source = query
      ? targets.filter((row) => row.name.toLowerCase().includes(query))
      : targets.filter((row) => row.ours || /genesis|tapeout|behemoth|blonskr/i.test(row.name));
    const seen = new Set<string>();
    const out: TapeTarget[] = [];
    for (const row of source) {
      const key = row.circuits.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      if (out.length >= 12) break;
    }
    return out;
  })();
  const table = useMemo(() => {
    if (recipe || !built || "error" in built || built.nIn > 4 || built.latch > 0) return null;
    const rows: { bits: boolean[]; outs: boolean[] }[] = [];
    for (let i = 0; i < 2 ** built.nIn; i++) {
      const rowBits = Array.from({ length: built.nIn }, (_, k) => Boolean((i >> (built.nIn - 1 - k)) & 1));
      const row = simulate(nodes, wires, rowBits, {});
      if ("error" in row) return null;
      rows.push({ bits: rowBits, outs: row.outs });
    }
    return rows;
  }, [built, nodes, wires, recipe]);

  useEffect(() => { setAck(false); }, [needN, needL, target]);

  return (
    <section className="grid items-start gap-4 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
        <div className="border border-gold bg-card px-3 py-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "选一台再画" : "Pick a processor, then draw"}</p>
          <input value={find} onChange={(event) => setFind(event.target.value)} placeholder={zh ? "搜官网处理器，例如 Genesis、Blonskr" : "Search an official processor"} className="mt-2 w-full border border-gold bg-paper px-3 py-2 outline-none" />
          <div className="mt-2 flex gap-2 overflow-x-auto">
            {shownTargets.map((row) => (
              <button key={row.circuits} type="button" onClick={() => setTarget(row)} className={`min-h-10 shrink-0 border px-3 text-sm ${target.circuits.toLowerCase() === row.circuits.toLowerCase() ? "border-ink bg-ink text-paper" : "border-gold"}`}>
                {row.ours ? "TAPELIQUID" : row.name} · {row.chain === "bsc" ? "BSC" : "X Layer"}
              </button>
            ))}
          </div>
          <p className="mt-2 text-sm text-ink/70">{zh ? `当前是 ${target.name}。烧掉的是这台的 NAND 和 LATCH。${!find.trim() ? " 其他官网处理器输入名字再选。" : ""}` : `Taping ${target.name}. This burns that processor's NAND and LATCH.`}</p>
        </div>
        <div className="border border-gold bg-card px-3 py-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "画布 · 先在浏览器里跑" : "Canvas · runs in the browser first"}</p>
          <h2 className="font-display text-3xl italic">{zh ? `流片 ${target.name}` : `Tape ${target.name}`}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink/80">
            {zh
              ? "这两格是这个钱包在当前这台晶体管合约上的余额，每 5 秒重读。换一台就换一份余额。整台处理器还剩多少，不算你的。"
              : "These two figures are this wallet's balance on the processor you picked. Switching processors switches the balance."}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Hold n={held?.nand ?? null} have={held} need={needN} other={needL} name="NAND" zh={zh} account={account} err={heldErr} />
            <Hold n={held?.latch ?? null} have={held} need={needL} other={needN} name="LATCH" zh={zh} account={account} err={heldErr} />
          </div>
        </div>
        <div className={`border px-3 py-3 ${optimal ? "border-ink bg-foil" : "border-gold bg-card"}`}>
          <p className="text-xs tracking-widest text-gold">{zh ? "最优电路" : "Optimal sheet"}</p>
          <p className="mt-1 font-display text-2xl italic">{zh ? "(A 与 B) 或 (C 与 D)" : "(A and B) or (C and D)"}</p>
          <p className="mt-1 text-sm leading-relaxed">
            {zh
              ? "4 个输入，1 个输出，3 个 NAND，不用 LATCH。两扇 NAND 只能看见 3 个输入，所以 3 扇是最少。点签名只烧这 3 个，再付这台的流片费。"
              : "4 inputs, 1 output, 3 NAND gates, no latch. Two NAND gates can only see 3 inputs, so 3 is the minimum. Signing burns those 3, plus this processor's tape fee."}
          </p>
          {optimal ? (
            <p className="mt-2 text-sm">{zh ? "这张已经在画布上。右边勾上「不能撤回」，再签名。" : "This sheet is on the canvas. Confirm the burn, then sign."}</p>
          ) : (
            <button type="button" className="mt-2 min-h-11 border border-ink bg-ink px-3 text-sm text-paper" onClick={() => { const next = matchSheet(); setNodes(next.nodes); setWires(next.wires); setRecipe(null); setBits([true, true, true, true]); }}>
              {zh ? "装上这张再试" : "Load this sheet"}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(["wire", "nand", "latch", "in", "out", "c0", "c1", "del"] as const).map((id) => (
            <button key={id} type="button" onClick={() => setTool(id)} className={`min-h-10 border px-3 font-mono text-sm ${tool === id ? "border-ink bg-ink text-paper" : "border-gold"}`}>
              {id === "wire" ? (zh ? "接线" : "Wire") : id === "del" ? (zh ? "删除" : "Delete") : id === "nand" ? "NAND" : id === "latch" ? "LATCH" : id === "in" ? "IN" : id === "out" ? "OUT" : id === "c0" ? "0" : "1"}
            </button>
          ))}
          <button type="button" className="min-h-10 border border-gold px-3 text-sm" onClick={() => { const next = matchSheet(); setNodes(next.nodes); setWires(next.wires); setRecipe(null); setBits([true, true, true, true]); }}>
            {zh ? "匹配电路" : "Match"}
          </button>
          <button type="button" className="min-h-10 border border-gold px-3 text-sm" onClick={() => { setNodes([]); setWires([]); setRecipe(null); setArm(null); }}>
            {zh ? "清空" : "Clear"}
          </button>
        </div>
        <div className="flex gap-2 overflow-x-auto">
          {RECIPES.map(([n, l]) => (
            <button
              key={`${n}-${l}`}
              type="button"
              onClick={() => {
                const sheet = recipeSheet(n, l);
                if (sheet) {
                  setNodes(sheet.nodes);
                  setWires(sheet.wires);
                  setRecipe(null);
                  setBits([true, true]);
                } else {
                  setNodes([]);
                  setWires([]);
                  setRecipe([n, l]);
                }
              }}
              className={`shrink-0 border px-3 py-2 font-mono text-sm ${recipe?.[0] === n && recipe?.[1] === l ? "border-ink bg-ink text-paper" : "border-gold"}`}
            >
              {n}N+{l}L
            </button>
          ))}
        </div>
        <div className="border border-gold bg-card px-3 py-3">
          <p className="text-xs tracking-widest text-gold">{zh ? "大张" : "Large sheets"}</p>
          <p className="mt-1 text-sm leading-relaxed">
            {zh
              ? `一张最大 ${TAPE_SHEET.nand.toLocaleString("en-US")} NAND，或 ${TAPE_SHEET.latch.toLocaleString("en-US")} LATCH。5 万那张网表写不进链，会直接失败，颗数不动。按现在的余额，NAND 还要 ${held ? sheets(held.nand, TAPE_SHEET.nand).toString() : "—"} 笔，LATCH 还要 ${held ? sheets(held.latch, TAPE_SHEET.latch).toString() : "—"} 笔。`
              : `One sheet can burn ${TAPE_SHEET.nand.toLocaleString("en-US")} NAND or ${TAPE_SHEET.latch.toLocaleString("en-US")} LATCH. A 50,000 sheet does not fit and the transistors stay put. NAND needs ${held ? sheets(held.nand, TAPE_SHEET.nand).toString() : "—"} signatures, LATCH ${held ? sheets(held.latch, TAPE_SHEET.latch).toString() : "—"}.`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy || !held || held.nand < 1n} onClick={() => void flood("nand")} className="min-h-11 border border-ink bg-ink px-3 text-sm text-paper disabled:opacity-40">
              {zh ? "连流 NAND" : "Tape NAND through"}
            </button>
            <button type="button" disabled={busy || !held || held.latch < 1n} onClick={() => void flood("latch")} className="min-h-11 border border-ink bg-ink px-3 text-sm text-paper disabled:opacity-40">
              {zh ? "连流 LATCH" : "Tape LATCH through"}
            </button>
            {([[5000, 0], [10000, 0], [18000, 0], [0, 10000], [0, 30000]] as [number, number][]).map(([n, l]) => (
              <button key={`${n}-${l}`} type="button" className="min-h-11 border border-gold px-3 font-mono text-sm" onClick={() => { setNodes([]); setWires([]); setRecipe([n, l]); }}>
                {n > 0 ? `${n} NAND` : `${l} LATCH`}
              </button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto border border-gold bg-paper">
          <div
            className="relative h-[320px] w-[640px] sm:h-[460px] sm:w-[760px]"
            onClick={(event) => {
              if (tool === "wire" || tool === "del") return;
              const rect = event.currentTarget.getBoundingClientRect();
              place(tool, event.clientX - rect.left, event.clientY - rect.top);
            }}
          >
            <svg className="absolute inset-0 h-full w-full">
              {wires.map((w, i) => {
                const from = nodes.find((n) => n.id === w.from);
                const to = nodes.find((n) => n.id === w.to);
                if (!from || !to) return null;
                const a = pinsOf(from).find((p) => p.out);
                const b = pinsOf(to).find((p) => p.pin === w.toPin);
                if (!a || !b) return null;
                return <path key={i} d={`M ${a.x} ${a.y} C ${(a.x + b.x) / 2} ${a.y}, ${(a.x + b.x) / 2} ${b.y}, ${b.x} ${b.y}`} fill="none" stroke="currentColor" className="text-gold" strokeWidth="1.5" />;
              })}
            </svg>
            {nodes.map((n) => (
              <div
                key={n.id}
                className={`absolute flex h-14 w-[108px] items-center justify-center border bg-card font-mono text-xs ${arm === n.id ? "border-ink" : "border-gold"}`}
                style={{ left: n.x, top: n.y }}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => {
                  if (tool === "del") {
                    setRecipe(null);
                    setNodes((list) => list.filter((item) => item.id !== n.id));
                    setWires((list) => list.filter((w) => w.from !== n.id && w.to !== n.id));
                    return;
                  }
                  const startX = event.clientX;
                  const startY = event.clientY;
                  const ox = n.x;
                  const oy = n.y;
                  const move = (ev: PointerEvent) => {
                    setNodes((list) => list.map((item) => (item.id === n.id ? { ...item, x: ox + ev.clientX - startX, y: oy + ev.clientY - startY } : item)));
                  };
                  const up = () => {
                    window.removeEventListener("pointermove", move);
                    window.removeEventListener("pointerup", up);
                  };
                  window.addEventListener("pointermove", move);
                  window.addEventListener("pointerup", up);
                }}
              >
                {label(n.kind)}
                {n.kind === "nand" ? (
                  <>
                    <span className="pointer-events-none absolute left-2 top-1 text-[10px] text-ink/50">A</span>
                    <span className="pointer-events-none absolute bottom-1 left-2 text-[10px] text-ink/50">B</span>
                  </>
                ) : null}
                {n.kind === "latch" ? <span className="pointer-events-none absolute left-2 top-1 text-[10px] text-ink/50">D</span> : null}
                {pinsOf(n).map((p) => (
                  <button
                    key={`${p.pin}`}
                    type="button"
                    aria-label="pin"
                    className={`absolute size-3 rounded-full border border-ink ${p.out && arm === n.id ? "bg-gold" : "bg-paper"}`}
                    style={{ left: p.x - n.x - 6, top: p.y - n.y - 6 }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onPin(p);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 border border-gold px-3 py-2">
          <span className="text-xs tracking-widest text-gold">{zh ? "探针" : "Probe"}</span>
          {inputs.map((n, i) => (
            <button key={n.id} type="button" className={`min-h-10 border px-3 font-mono ${bits[i] ? "border-ink bg-ink text-paper" : "border-gold"}`} onClick={() => setBits((list) => { const next = [...list]; next[i] = !next[i]; return next; })}>
              IN{i} {bits[i] ? "1" : "0"}
            </button>
          ))}
          {outputs.map((n, i) => (
            <span key={n.id} className="border border-gold px-3 py-2 font-mono text-sm">OUT{i} {sim && !("error" in sim) ? (sim.outs[i] ? "1" : "0") : "—"}</span>
          ))}
          <button type="button" className="min-h-10 border border-gold px-3 text-sm" onClick={() => { if (sim && !("error" in sim)) setLatch(sim.latch); }}>
            {zh ? "锁存器走一拍" : "Step the latch"}
          </button>
          <button type="button" className="min-h-10 border border-gold px-3 text-sm" onClick={() => setWires((list) => list.slice(0, -1))}>
            {zh ? "撤销上一根线" : "Undo last wire"}
          </button>
          {arm ? <span className="text-sm">{zh ? "已拿起一个输出。再点下一扇的输入脚。" : "Output picked up. Click the next input pin."}</span> : null}
          {liveErr ? <span className="text-sm text-sell">{liveErr}</span> : <span className="text-sm text-ink/70">{zh ? "这行只在浏览器里亮，不写链。" : "This row only lights in the browser. It does not write the chain."}</span>}
          {recipe ? <span className="text-sm">{zh ? `配方 ${recipe[0]}N+${recipe[1]}L 太大，不摊开。签名仍按这个颗数烧。` : `Recipe ${recipe[0]}N+${recipe[1]}L is too big to draw. The signature still burns that count.`}</span> : null}
        </div>
        {table ? (
          <div className="overflow-x-auto border border-gold">
            <p className="border-b border-gold px-3 py-2 text-xs tracking-widest text-gold">{zh ? "签名前的真值表 · 全部输入组合" : "Truth table before you sign · every input"}</p>
            <table className="w-full font-mono text-sm">
              <thead>
                <tr className="text-left text-xs text-ink/60">
                  {inputs.map((_, i) => <th key={`h${i}`} className="px-3 py-1">IN{i}</th>)}
                  {outputs.map((_, i) => <th key={`o${i}`} className="px-3 py-1">OUT{i}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.map((row, i) => {
                  const on = row.bits.every((bit, k) => bit === Boolean(bits[k]));
                  return (
                    <tr key={i} className={on ? "bg-ink text-paper" : ""}>
                      {row.bits.map((bit, k) => <td key={k} className="px-3 py-1">{bit ? "1" : "0"}</td>)}
                      {row.outs.map((bit, k) => <td key={`y${k}`} className="px-3 py-1">{bit ? "1" : "0"}</td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <aside className="flex flex-col gap-3 lg:col-span-4 lg:sticky lg:top-24">
        <div className="border border-gold bg-card px-3 py-3">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-2xl italic">{zh ? "可流片" : "Ready to tape"}</h3>
            <span className="text-xs tracking-widest text-gold">{target.name}</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Hold n={held?.nand ?? null} have={held} need={needN} other={needL} name="NAND" zh={zh} account={account} err={heldErr} />
            <Hold n={held?.latch ?? null} have={held} need={needL} other={needN} name="LATCH" zh={zh} account={account} err={heldErr} />
          </div>
          <p className="mt-2 text-sm">
            {!account
              ? zh ? "连上后读这个地址的 balanceOf。上面整台处理器的剩余不是你的。" : "balanceOf is read after you connect. The processor supply above is not yours."
              : heldErr && !held
                ? zh ? "链上没读到。失败不会写成 0。" : "The chain did not answer. A miss is not written as zero."
                : held && times != null
                  ? zh
                    ? `这张每次 ${needN} NAND、${needL} LATCH。按链上余额还能流 ${times.toString()} 次。`
                    : `This sheet burns ${needN} NAND and ${needL} LATCH. ${times.toString()} tapes left on chain.`
                  : zh ? "正在读链上余额。" : "Reading the chain balance."}
          </p>
          <p className="mt-1 break-all text-xs text-ink/50">{account ? `${account} · ` : ""}{target.transistors}</p>
          <ol className="mt-3 flex flex-col gap-2 text-sm">
            <Check on={!liveErr && needN != null} text={liveErr ?? (zh ? `图已算完，烧掉 ${burn}` : `Sheet is ready. Burns ${burn}`)} />
            <Check on={Boolean(account)} text={account ? `${account.slice(0, 6)}…${account.slice(-4)}` : (zh ? "钱包还没接上" : "Wallet is not connected")} />
            <Check on={Boolean(account) && held != null && !short} text={!account ? (zh ? "接上后读链上余额" : "Balance is read after you connect") : held == null ? (zh ? "正在读链上余额" : "Reading the chain") : short ? (zh ? `这张要 ${needN} NAND、${needL} LATCH。链上是 ${held.nand.toString()} 和 ${held.latch.toString()}，这张次数是 0。` : `This sheet needs ${needN} NAND and ${needL} LATCH. The chain has ${held.nand.toString()} and ${held.latch.toString()}, so this sheet is 0.`) : (zh ? `按这张还能流 ${times?.toString()} 次` : `${times?.toString()} tapes left on this sheet`)} />
            <Check on={ack} text={zh ? "已确认不能撤回" : "Irreversible burn confirmed"} />
          </ol>
          <dl className="mt-3 flex flex-col gap-2 border-t border-gold/40 pt-3 text-sm">
            <Row k={zh ? "链" : "Chain"} v={target.chain === "bsc" ? "BSC" : "X Layer"} />
            <Row k={zh ? "处理器" : "Processor"} v={target.circuits} mono />
            <Row k={zh ? "链上还能流" : "Tapes left"} v={times == null ? "—" : times.toString()} />
            <Row k={zh ? "流片费" : "Tape fee"} v={`${fee} ${unit}`} />
            <Row k={zh ? `这地址的 ${unit}` : `${unit} here`} v={okb == null ? "—" : `${formatEther(okb)} ${unit}`} />
            <Row k={zh ? "费进哪里" : "Fee goes"} v={zh ? "这台处理器的协议流片费，不进本站收费地址" : "That processor's protocol fee, not this site's fee address"} />
            <Row k={zh ? "得到" : "You get"} v={zh ? `${target.name} 上的一张电路` : `One circuit on ${target.name}`} />
            <Row k={zh ? "官网" : "Official"} v={zh ? `同一份合约，已流片 ${total}` : `Same contract, ${total} taped`} />
          </dl>
          {okbShort ? <p className="mt-2 text-sm text-sell">{zh ? `流片费 ${fee} ${unit}，这个地址只有 ${okb == null ? "—" : formatEther(okb)} ${unit}。NAND 没问题的话，是 ${unit} 不够，所以签不出去。` : `The fee is ${fee} ${unit}. This address has ${okb == null ? "—" : formatEther(okb)} ${unit}.`}</p> : null}
          <label className="mt-3 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={ack} onChange={(event) => setAck(event.target.checked)} />
            <span>{zh ? `我知道这张会烧掉 ${burn}，确认后不能撤回，也不是官网 BEM 算力。` : `I know this burns ${burn}, cannot be undone, and is not official BEM hashrate.`}</span>
          </label>
          <p className="mt-3 text-xs leading-5 text-ink/70">
            {zh
              ? "签名后页面会停在「等待钱包」，其实是在等回执。回执一成功，电路就有编号。下面的名单大约 8 秒才重读，个人中心更慢。想马上确认，打开弹出的那笔交易。"
              : "After you sign, the button still says it is waiting. It is waiting for the receipt. The circuit has an id as soon as that receipt succeeds. The list below rereads in about 8 seconds. The account page is slower. Open the transaction to check immediately."}
          </p>
          {!account ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setBad(false);
                const open = target.chain === "bsc" ? connectBsc() : connectXLayer();
                open
                  .then((from) => setAccount(from))
                  .catch(() => {
                    setBad(true);
                    setNote(zh ? "钱包没有连上。" : "The wallet did not connect.");
                  })
                  .finally(() => setBusy(false));
              }}
              className="mt-3 min-h-14 w-full bg-ink font-display text-2xl italic text-paper disabled:opacity-40"
            >
              {zh ? "连接钱包" : "Connect wallet"}
            </button>
          ) : (
            <>
            <button type="button" disabled={!ready || busy} onClick={() => void go()} className="mt-3 min-h-14 w-full bg-ink font-display text-2xl italic text-paper disabled:opacity-40">
              {busy ? (zh ? "等待钱包" : "Waiting for the wallet") : heldErr && !held ? (zh ? "链上没读到" : "Chain unread") : okbShort ? (zh ? `${unit} 不够付流片费` : `Not enough ${unit}`) : short ? (zh ? `这张要 ${needN} 个 NAND` : `This sheet needs ${needN} NAND`) : !ack ? (zh ? "先勾上再签名" : "Confirm, then sign") : liveErr ? (zh ? "先把图接完" : "Finish the sheet") : optimal ? (zh ? "签名并流这张最优" : "Sign this optimal sheet") : (zh ? `签名并流片 ${target.name}` : `Sign and tape ${target.name}`)}
            </button>
            {short && held && held.nand >= 1n ? (
              <button type="button" className="mt-2 min-h-10 w-full border border-gold text-sm" onClick={() => {
                const next = recipeSheet(1, 0);
                if (!next) return;
                setNodes(next.nodes);
                setWires(next.wires);
                setRecipe(null);
                setBits([true, true]);
              }}>
                {zh ? `链上有 ${held.nand.toString()} 个 NAND。改成 1 个 NAND 的图，可流 ${held.nand.toString()} 次。` : `Chain holds ${held.nand.toString()} NAND. Switch to a 1 NAND sheet, ${held.nand.toString()} tapes.`}
              </button>
            ) : null}
            </>
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            <button type="button" className="underline decoration-gold underline-offset-4" onClick={() => { void navigator.clipboard.writeText(target.circuits); setCopied(true); }}>
              {copied ? (zh ? "地址已复制" : "Address copied") : (zh ? "复制这台处理器" : "Copy this processor")}
            </button>
            <a className="underline decoration-gold underline-offset-4" href={tapePage(target)} target="_blank" rel="noreferrer">
              {zh ? "官网同一条" : "Official page"}
            </a>
          </div>
          {note ? <p className={`mt-2 text-sm ${bad ? "text-sell" : ""}`}>{note}</p> : null}
          {cpu ? <p className="mt-2 text-xs text-ink/60">{zh ? `供应量 ${Number(cpu.cap).toLocaleString("en-US")} · 已铸造 ${Number(cpu.minted).toLocaleString("en-US")} · 单价 ${cpu.price} OKB` : `Supply ${Number(cpu.cap).toLocaleString("en-US")} · minted ${Number(cpu.minted).toLocaleString("en-US")} · ${cpu.price} OKB`}</p> : null}
        </div>
        <div className="border border-gold">
          <p className="border-b border-gold px-3 py-2 text-xs tracking-widest text-gold">{zh ? `链上电路 · ${total} · 约 8 秒` : `On-chain circuits · ${total} · about 8s`}</p>
          <div className="grid grid-cols-4 px-3 py-1 text-xs text-ink/50">
            <span>{zh ? "编号" : "Id"}</span><span>{zh ? "门" : "Gates"}</span><span>{zh ? "入/出" : "In/out"}</span><span>{zh ? "持有人" : "Holder"}</span>
          </div>
          <ul>
            {rows.map((row) => (
              <li key={row.id} className="grid grid-cols-4 gap-1 border-t border-gold/40 px-3 py-2 font-mono text-xs">
                <span>#{row.id}</span>
                <span>{row.gates}</span>
                <span>{row.nIn}/{row.nOut}</span>
                <span>{row.owner.slice(0, 6)}…{row.owner.slice(-4)}</span>
              </li>
            ))}
            {rows.length === 0 ? <li className="px-3 py-3 text-sm text-ink/60">{zh ? "链上还没有读到电路。" : "No circuit read from the chain yet."}</li> : null}
          </ul>
        </div>
      </aside>
    </section>
  );
}

function tapeTimes(nand: bigint, latch: bigint, needN: number, needL: number): bigint {
  const byN = needN <= 0 ? null : nand / BigInt(needN);
  const byL = needL <= 0 ? null : latch / BigInt(needL);
  if (byN == null) return byL ?? 0n;
  if (byL == null) return byN;
  return byN < byL ? byN : byL;
}

function Hold({ n, have, need, other, name, zh, account, err }: { n: bigint | null; have: { nand: bigint; latch: bigint } | null; need: number | null; other: number | null; name: string; zh: boolean; account: string | null; err: boolean }) {
  const text = n == null ? "—" : n.toString();
  const times = have && need != null && other != null ? tapeTimes(have.nand, have.latch, name === "NAND" ? need : other, name === "LATCH" ? need : other) : null;
  return (
    <p className="border border-gold bg-paper px-3 py-2">
      <span className="block text-xs tracking-widest text-gold">{zh ? `链上 ${name}` : `On-chain ${name}`}</span>
      <span className="font-mono text-3xl tabular-nums">{text}</span>
      <span className="mt-1 block text-xs text-ink/60">
        {!account
          ? zh ? "连接后读 balanceOf" : "balanceOf after you connect"
          : err && n == null
            ? zh ? "这格没读到" : "This read failed"
            : n == null
              ? zh ? "正在读" : "Reading"
              : times == null
                ? "TAPELIQUID"
                : zh ? `按这张还能流 ${times.toString()} 次` : `${times.toString()} tapes on this sheet`}
      </span>
    </p>
  );
}

function Check({ on, text }: { on: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`mt-0.5 inline-block size-4 shrink-0 border text-center text-[10px] leading-4 ${on ? "border-ink bg-ink text-paper" : "border-gold"}`}>{on ? "✓" : ""}</span>
      <span>{text}</span>
    </li>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-ink/60">{k}</dt>
      <dd className={`text-right ${mono ? "break-all font-mono text-xs" : ""}`}>{v}</dd>
    </div>
  );
}
