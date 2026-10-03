import { createServerFn } from "@tanstack/react-start";
import type { GateDeal, GateOrder } from "./gate-core";

export type GateBook = { orders: GateOrder[]; deals: GateDeal[] };

const address = (value: unknown) => (typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value) ? value : "");
const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 40) : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : Number(value));

export const getGateBook = createServerFn({ method: "GET" }).handler(async (): Promise<GateBook> => {
  const { readGate } = await import("./gate-book.server");
  return readGate();
});

export const postGate = createServerFn({ method: "POST" })
  .validator((input: { user?: string; market?: string; name?: string; kind?: string; long?: boolean; price?: number; margin?: number; lev?: number }) => {
    const user = address(input?.user);
    const price = num(input?.price);
    const margin = num(input?.margin);
    const lev = num(input?.lev);
    if (!user || !(price > 0) || !(margin > 0) || !(lev >= 1 && lev <= 1000)) throw new Error("order");
    return { user, market: text(input?.market), name: text(input?.name), kind: text(input?.kind), long: Boolean(input?.long), price, margin, lev };
  })
  .handler(async ({ data }): Promise<GateBook> => {
    const { placeGate } = await import("./gate-book.server");
    return placeGate(data);
  });

export const takeGate = createServerFn({ method: "POST" })
  .validator((input: { user?: string; id?: string; margin?: number; lev?: number }) => {
    const user = address(input?.user);
    const margin = num(input?.margin);
    const lev = num(input?.lev);
    if (!user || !input?.id || !(margin > 0) || !(lev >= 1 && lev <= 1000)) throw new Error("take");
    return { user, id: text(input.id), margin, lev };
  })
  .handler(async ({ data }): Promise<GateBook> => {
    const { takeGateOrder } = await import("./gate-book.server");
    return takeGateOrder(data.user, data.id, data.margin, data.lev);
  });

export const cancelGate = createServerFn({ method: "POST" })
  .validator((input: { user?: string; id?: string }) => {
    const user = address(input?.user);
    if (!user || !input?.id) throw new Error("cancel");
    return { user, id: text(input.id) };
  })
  .handler(async ({ data }): Promise<GateBook> => {
    const { cancelGateOrder } = await import("./gate-book.server");
    return cancelGateOrder(data.user, data.id);
  });

export const closeGate = createServerFn({ method: "POST" })
  .validator((input: { user?: string; id?: string }) => {
    const user = address(input?.user);
    if (!user || !input?.id) throw new Error("close");
    return { user, id: text(input.id) };
  })
  .handler(async ({ data }): Promise<GateBook> => {
    const { closeGateDeal } = await import("./gate-book.server");
    return closeGateDeal(data.user, data.id);
  });
