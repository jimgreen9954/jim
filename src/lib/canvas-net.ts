export type Kind = "in" | "out" | "nand" | "latch" | "c0" | "c1";
export type CNode = { id: string; kind: Kind; x: number; y: number };
export type CWire = { from: string; to: string; toPin: 0 | 1 };

export type Built = {
  hex: `0x${string}`;
  nIn: number;
  nOut: number;
  nand: number;
  latch: number;
};

const u24 = (n: number) => [(n >> 16) & 255, (n >> 8) & 255, n & 255];

function into(wires: CWire[], id: string, pin: 0 | 1) {
  return wires.filter((w) => w.to === id && w.toPin === pin);
}

/** Compile a canvas into the TapeOut netlist. Outputs are the last signals. */
export function compile(nodes: CNode[], wires: CWire[]): Built | { error: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inputs = nodes.filter((n) => n.kind === "in").sort((a, b) => a.y - b.y || a.x - b.x);
  const outputs = nodes.filter((n) => n.kind === "out").sort((a, b) => a.y - b.y || a.x - b.x);
  const gates = nodes.filter((n) => n.kind === "nand" || n.kind === "latch");
  if (inputs.length < 1 || inputs.length > 16) return { error: "inputs" };
  if (outputs.length < 1 || outputs.length > 8) return { error: "outputs" };
  if (gates.length < 1 || gates.length > 64) return { error: "gates" };

  const src = (id: string, pin: 0 | 1) => into(wires, id, pin);
  for (const g of gates) {
    const pins = g.kind === "nand" ? ([0, 1] as const) : ([0] as const);
    for (const pin of pins) {
      if (src(g.id, pin).length !== 1) return { error: "unwired" };
    }
  }
  const outSrc: string[] = [];
  for (const o of outputs) {
    const hits = src(o.id, 0);
    if (hits.length !== 1) return { error: "outwire" };
    const from = byId.get(hits[0].from);
    if (!from || (from.kind !== "nand" && from.kind !== "latch")) return { error: "outkind" };
    outSrc.push(from.id);
  }
  if (new Set(outSrc).size !== outSrc.length) return { error: "sameout" };
  const outSet = new Set(outSrc);

  const nandDeps = (id: string) => {
    const node = byId.get(id);
    if (!node || node.kind !== "nand") return [];
    return [0, 1]
      .map((pin) => byId.get(src(id, pin as 0 | 1)[0].from))
      .filter((n): n is CNode => Boolean(n && (n.kind === "nand" || n.kind === "latch")))
      .map((n) => n.id);
  };
  for (const id of outSet) {
    if (gates.some((g) => g.kind === "nand" && nandDeps(g.id).includes(id))) return { error: "after" };
  }

  const pending = gates.filter((g) => !outSet.has(g.id)).map((g) => g.id);
  const order: string[] = [];
  const placed = new Set<string>();
  while (pending.length) {
    const idx = pending.findIndex((id) => nandDeps(id).every((d) => placed.has(d)));
    if (idx < 0) return { error: "cycle" };
    const id = pending.splice(idx, 1)[0];
    order.push(id);
    placed.add(id);
  }
  for (const id of outSrc) {
    if (nandDeps(id).some((d) => !placed.has(d))) return { error: "cycle" };
    order.push(id);
    placed.add(id);
  }

  const signal = new Map<string, number>();
  inputs.forEach((n, i) => signal.set(n.id, 2 + i));
  for (const n of nodes) {
    if (n.kind === "c0") signal.set(n.id, 0);
    if (n.kind === "c1") signal.set(n.id, 1);
  }
  let next = 2 + inputs.length;
  for (const id of order) signal.set(id, next++);

  const bytes: number[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    const read = (pin: 0 | 1) => signal.get(src(id, pin)[0].from);
    if (node.kind === "nand") {
      const a = read(0);
      const b = read(1);
      if (a == null || b == null) return { error: "nosig" };
      bytes.push(0, ...u24(a), ...u24(b));
    } else {
      const d = read(0);
      if (d == null) return { error: "nosig" };
      bytes.push(1, ...u24(d));
    }
  }
  return {
    hex: `0x${bytes.map((b) => b.toString(16).padStart(2, "0")).join("")}`,
    nIn: inputs.length,
    nOut: outputs.length,
    nand: gates.filter((g) => g.kind === "nand").length,
    latch: gates.filter((g) => g.kind === "latch").length,
  };
}

export function simulate(
  nodes: CNode[],
  wires: CWire[],
  bits: boolean[],
  latchPrev: Record<string, boolean>,
): { outs: boolean[]; latch: Record<string, boolean> } | { error: string } {
  const built = compile(nodes, wires);
  if ("error" in built) return built;
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inputs = nodes.filter((n) => n.kind === "in").sort((a, b) => a.y - b.y || a.x - b.x);
  const outputs = nodes.filter((n) => n.kind === "out").sort((a, b) => a.y - b.y || a.x - b.x);
  const value = new Map<string, boolean>();
  for (const n of nodes) {
    if (n.kind === "c0") value.set(n.id, false);
    if (n.kind === "c1") value.set(n.id, true);
  }
  inputs.forEach((n, i) => value.set(n.id, Boolean(bits[i])));
  const gates = nodes.filter((n) => n.kind === "nand" || n.kind === "latch");
  const outSrc = outputs.map((o) => into(wires, o.id, 0)[0].from);
  const outSet = new Set(outSrc);
  const pending = gates.filter((g) => !outSet.has(g.id)).map((g) => g.id);
  const order: string[] = [];
  const placed = new Set<string>();
  const nandDeps = (id: string) => {
    const node = byId.get(id);
    if (!node || node.kind !== "nand") return [];
    return [0, 1]
      .map((pin) => byId.get(into(wires, id, pin as 0 | 1)[0].from))
      .filter((n): n is CNode => Boolean(n && (n.kind === "nand" || n.kind === "latch")))
      .map((n) => n.id);
  };
  const left = [...pending];
  while (left.length) {
    const idx = left.findIndex((id) => nandDeps(id).every((d) => placed.has(d)));
    if (idx < 0) return { error: "cycle" };
    const id = left.splice(idx, 1)[0];
    order.push(id);
    placed.add(id);
  }
  for (const id of outSrc) {
    order.push(id);
    placed.add(id);
  }
  const nextLatch: Record<string, boolean> = {};
  for (const id of order) {
    const node = byId.get(id)!;
    const read = (pin: 0 | 1) => value.get(into(wires, id, pin)[0].from) ?? false;
    if (node.kind === "nand") value.set(id, !(read(0) && read(1)));
    else {
      value.set(id, Boolean(latchPrev[id]));
      nextLatch[id] = read(0);
    }
  }
  return { outs: outputs.map((o) => value.get(into(wires, o.id, 0)[0].from) ?? false), latch: nextLatch };
}
