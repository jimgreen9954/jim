import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { cancelOrder, closeDeal, emptyGate, placeOrder, takeOrder, type GateState } from "./gate-core";
import type { GateBook } from "./gate-book";

const FILE = "/workspace/data/gate-book.json";
let chain: Promise<void> = Promise.resolve();

function read(): GateState {
  try {
    return JSON.parse(readFileSync(FILE, "utf8")) as GateState;
  } catch {
    return emptyGate();
  }
}

function write(state: GateState) {
  mkdirSync("/workspace/data", { recursive: true });
  writeFileSync(FILE, JSON.stringify(state));
}

function view(state: GateState): GateBook {
  return { orders: state.orders, deals: state.deals };
}

function run(change: (state: GateState) => GateState): Promise<GateBook> {
  const job = chain.then(() => {
    const next = change(read());
    write(next);
    return view(next);
  });
  chain = job.then(() => undefined, () => undefined);
  return job;
}

export function readGate(): Promise<GateBook> {
  return run((state) => state);
}

export function placeGate(input: { user: string; market: string; name: string; kind: string; long: boolean; price: number; margin: number; lev: number }) {
  return run((state) => placeOrder(state, input));
}

export function takeGateOrder(user: string, id: string, margin: number, lev: number) {
  return run((state) => takeOrder(state, id, user, margin, lev));
}

export function cancelGateOrder(user: string, id: string) {
  return run((state) => cancelOrder(state, id, user));
}

export function closeGateDeal(user: string, id: string) {
  return run((state) => closeDeal(state, id, user));
}
