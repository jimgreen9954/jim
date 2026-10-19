import { cancelOrder, closeDeal, emptyGate, placeOrder, takeOrder, type GateDeal, type GateOrder, type GateState } from "./gate-core";

export type GateBook = { orders: GateOrder[]; deals: GateDeal[] };

const KEY = "tapeliquid-gate-book-v1";

function read(): GateState {
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "") as GateState;
  } catch {
    return emptyGate();
  }
}

function write(state: GateState): GateBook {
  window.localStorage.setItem(KEY, JSON.stringify(state));
  return { orders: state.orders, deals: state.deals };
}

export async function getGateBook(): Promise<GateBook> {
  const state = read();
  return { orders: state.orders, deals: state.deals };
}

export async function postGate(input: { data: { user: string; market: string; name: string; kind: string; long: boolean; price: number; margin: number; lev: number } }): Promise<GateBook> {
  return write(placeOrder(read(), input.data));
}

export async function takeGate(input: { data: { user: string; id: string; margin: number; lev: number } }): Promise<GateBook> {
  return write(takeOrder(read(), input.data.id, input.data.user, input.data.margin, input.data.lev));
}

export async function cancelGate(input: { data: { user: string; id: string } }): Promise<GateBook> {
  return write(cancelOrder(read(), input.data.id, input.data.user));
}

export async function closeGate(input: { data: { user: string; id: string } }): Promise<GateBook> {
  return write(closeDeal(read(), input.data.id, input.data.user));
}
