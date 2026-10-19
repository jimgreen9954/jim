export type GateOrder = {
  id: string;
  market: string;
  name: string;
  kind: string;
  user: string;
  long: boolean;
  price: number;
  margin: number;
  lev: number;
};

export type GateDeal = {
  id: string;
  market: string;
  name: string;
  kind: string;
  longUser: string;
  shortUser: string;
  entry: number;
  marginL: number;
  marginS: number;
  levL: number;
  levS: number;
};

export type GateState = { seq: number; orders: GateOrder[]; deals: GateDeal[] };

export const emptyGate = (): GateState => ({ seq: 0, orders: [], deals: [] });

function bump(state: GateState): [GateState, string] {
  const seq = state.seq + 1;
  return [{ ...state, seq }, String(seq)];
}

export function placeOrder(state: GateState, input: Omit<GateOrder, "id">): GateState {
  const mine = input.user.toLowerCase();
  const hits = state.orders
    .filter((row) => row.market === input.market && row.long !== input.long && row.user.toLowerCase() !== mine)
    .filter((row) => (input.long ? row.price <= input.price : row.price >= input.price))
    .sort((a, b) => (input.long ? a.price - b.price : b.price - a.price));
  const hit = hits[0];
  if (!hit) {
    const [next, id] = bump(state);
    return { ...next, orders: [{ ...input, id }, ...next.orders].slice(0, 200) };
  }
  return match(state, hit, input);
}

export function takeOrder(state: GateState, id: string, user: string, margin: number, lev: number): GateState {
  const hit = state.orders.find((row) => row.id === id);
  if (!hit || hit.user.toLowerCase() === user.toLowerCase()) return state;
  return match(state, hit, {
    market: hit.market,
    name: hit.name,
    kind: hit.kind,
    user,
    long: !hit.long,
    price: hit.price,
    margin,
    lev,
  });
}

function match(state: GateState, hit: GateOrder, taker: Omit<GateOrder, "id">): GateState {
  const [next, id] = bump({ ...state, orders: state.orders.filter((row) => row.id !== hit.id) });
  const long = taker.long ? taker : hit;
  const short = taker.long ? hit : taker;
  const deal: GateDeal = {
    id,
    market: hit.market,
    name: hit.name,
    kind: hit.kind,
    longUser: long.user,
    shortUser: short.user,
    entry: hit.price,
    marginL: long.margin,
    marginS: short.margin,
    levL: long.lev,
    levS: short.lev,
  };
  return { ...next, deals: [deal, ...next.deals].slice(0, 200) };
}

export function cancelOrder(state: GateState, id: string, user: string): GateState {
  return { ...state, orders: state.orders.filter((row) => !(row.id === id && row.user.toLowerCase() === user.toLowerCase())) };
}

export function closeDeal(state: GateState, id: string, user: string): GateState {
  const me = user.toLowerCase();
  return {
    ...state,
    deals: state.deals.filter((row) => !(row.id === id && (row.longUser.toLowerCase() === me || row.shortUser.toLowerCase() === me))),
  };
}

export function dealPnl(deal: GateDeal, user: string, mark: number): number {
  if (!(mark > 0) || !(deal.entry > 0)) return 0;
  const long = deal.longUser.toLowerCase() === user.toLowerCase();
  const margin = long ? deal.marginL : deal.marginS;
  const lev = long ? deal.levL : deal.levS;
  const other = long ? deal.marginS : deal.marginL;
  const move = ((mark - deal.entry) / deal.entry) * (long ? 1 : -1);
  return Math.max(-margin, Math.min(other, margin * lev * move));
}
