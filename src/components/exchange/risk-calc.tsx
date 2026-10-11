import { useMemo, useState } from "react";

function num(text: string): number | null {
  const value = Number(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function money(value: number | null, digits = 4): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function pct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(2)}%`;
}

export function WorkshopRisk({ zh }: { zh: boolean }) {
  const [open, setOpen] = useState(false);
  const [equity, setEquity] = useState("1000");
  const [risk, setRisk] = useState("1");
  const [entry, setEntry] = useState("");
  const [stop, setStop] = useState("");
  const [target, setTarget] = useState("");
  const [feeBps, setFeeBps] = useState("20");
  const [lev, setLev] = useState("1");
  const [side, setSide] = useState<"long" | "short">("long");

  const plan = useMemo(() => {
    const bank = num(equity);
    const riskPct = num(risk);
    const px = num(entry);
    const stopPx = num(stop);
    const goal = num(target);
    const bps = Number(feeBps);
    const leverage = num(lev);
    if (!bank || !px || !Number.isFinite(bps) || bps < 0 || bps >= 10000 || !leverage) return null;
    const fee = bps / 10000;
    const long = side === "long";
    const be = long ? px / (1 - fee) : px * (1 - fee);
    const unit = (exit: number) => (long ? exit * (1 - fee) - px : px * (1 - fee) - exit);
    const stopOk = stopPx != null && (long ? stopPx < px : stopPx > px);
    const lossUnit = stopOk && stopPx != null ? -unit(stopPx) : null;
    const riskCash = riskPct != null ? bank * riskPct / 100 : null;
    const qty = lossUnit && lossUnit > 0 && riskCash != null ? riskCash / lossUnit : null;
    const notional = qty != null ? qty * px : null;
    const margin = notional != null ? notional / leverage : null;
    const pnl = (exit: number) => (qty == null ? null : qty * unit(exit));
    const targetPnl = goal != null ? pnl(goal) : null;
    const stopPnl = stopOk && stopPx != null ? pnl(stopPx) : null;
    const reward = targetPnl != null && stopPnl != null && stopPnl < 0 ? targetPnl / -stopPnl : null;
    const ruin = stopPnl != null && stopPnl < 0 ? Math.floor(bank / -stopPnl) : null;
    const feeDrag = targetPnl != null && qty != null && goal != null ? (qty * goal * fee) / Math.max(targetPnl, 1e-12) : null;
    const liq = long ? px * (1 - 0.5 / leverage) : px * (1 + 0.5 / leverage);
    const shocks = [-0.8, -0.5, -0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2, 0.5, 1, 2];
    return { bank, px, fee, be, qty, notional, margin, targetPnl, stopPnl, reward, ruin, feeDrag, liq, leverage, shocks, unit };
  }, [equity, risk, entry, stop, target, feeBps, lev, side]);

  const field = (label: string, value: string, set: (next: string) => void) => (
    <label className="block text-xs">
      <span className="text-ink/50">{label}</span>
      <input value={value} onChange={(event) => set(event.target.value)} inputMode="decimal" className="mt-1 min-h-11 w-full border border-gold bg-transparent px-2 font-mono text-sm" />
    </label>
  );

  return (
    <article className="border border-gold bg-card px-3 py-3">
      <p className="text-sm leading-6">{zh ? "交易可以亏光。只用能接受归零的资金，仓位自己安排。本站不判断该买多少，也不保证回本。" : "A trade can go to zero. Use only money you can lose, and size the position yourself. This site does not decide the size and does not promise a break-even."}</p>
      <button type="button" onClick={() => setOpen((on) => !on)} className="mt-2 min-h-11 text-sm underline decoration-gold underline-offset-4">{open ? (zh ? "收起盈亏计算" : "Hide the calculator") : (zh ? "盈亏、亏损、回本" : "Profit, loss, break-even")}</button>
      {open ? (
        <div className="mt-3 grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setSide("long")} className={`min-h-11 border border-gold text-sm ${side === "long" ? "bg-ink text-paper" : ""}`}>{zh ? "先买后卖" : "Buy, then sell"}</button>
            <button type="button" onClick={() => setSide("short")} className={`min-h-11 border border-gold text-sm ${side === "short" ? "bg-ink text-paper" : ""}`}>{zh ? "先卖后买" : "Sell, then buy"}</button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {field(zh ? "本金" : "Equity", equity, setEquity)}
            {field(zh ? "这笔最多亏本金的 %" : "Max loss, % of equity", risk, setRisk)}
            {field(zh ? "入场价" : "Entry", entry, setEntry)}
            {field(zh ? "止损价" : "Stop", stop, setStop)}
            {field(zh ? "目标价" : "Target", target, setTarget)}
            {field(zh ? "单边手续费，万分比" : "Fee, bps each way", feeBps, setFeeBps)}
            {field(zh ? "杠杆，现货填 1" : "Leverage, 1 for spot", lev, setLev)}
          </div>
          <p className="text-xs leading-5 text-ink/55">{zh ? "现货按卖方实收 99.8% 计。买方按标价支付。回本价是扣完这一边手续费后不赚不亏的价格。数量按止损处的净亏损刚好等于上面的风险额度。杠杆只用于估算保证金亏一半的价格，不代表这份现货合约有强平。" : "Spot uses the 99.8 percent the seller receives. The buyer pays the listed price. Break-even is the price that is flat after that fee. Size is set so the net loss at the stop equals the risk budget. Leverage only estimates a half-margin price. This spot contract does not liquidate."}</p>
          {plan ? (
            <>
              <dl className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
                {[
                  [zh ? "建议数量" : "Size", money(plan.qty, 6)],
                  [zh ? "名义金额" : "Notional", money(plan.notional, 2)],
                  [zh ? "保证金" : "Margin", money(plan.margin, 2)],
                  [zh ? "回本价" : "Break-even", money(plan.be, 6)],
                  [zh ? "目标净盈亏" : "Net at target", money(plan.targetPnl, 2)],
                  [zh ? "止损净亏损" : "Net at stop", money(plan.stopPnl, 2)],
                  [zh ? "盈亏比" : "Payoff ratio", plan.reward == null ? "—" : plan.reward.toFixed(2)],
                  [zh ? "连亏到本金耗尽" : "Losses to flat", plan.ruin == null ? "—" : String(plan.ruin)],
                  [zh ? "手续费占目标盈利" : "Fee / target profit", pct(plan.feeDrag)],
                  [zh ? "价格归零的亏损" : "Loss if price is 0", money(plan.qty == null ? null : plan.qty * plan.unit(0), 2)],
                  [zh ? "仓位占本金" : "Position / equity", plan.notional == null ? "—" : pct(plan.notional / plan.bank)],
                  [zh ? "保证金亏一半的价格" : "Half-margin price", plan.leverage <= 1 ? (zh ? "现货无此价" : "Not used at 1×") : money(plan.liq, 6)],
                ].map(([k, v]) => (
                  <div key={k} className="border border-gold/40 px-2 py-2">
                    <dt className="text-[10px] text-ink/45">{k}</dt>
                    <dd className="font-mono">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="overflow-x-auto border border-gold/40">
                <table className="w-full min-w-[28rem] text-left text-xs">
                  <thead className="text-ink/45">
                    <tr>
                      <th className="px-2 py-2 font-normal">{zh ? "价格变动" : "Move"}</th>
                      <th className="px-2 py-2 font-normal">{zh ? "价格" : "Price"}</th>
                      <th className="px-2 py-2 font-normal">{zh ? "净盈亏" : "Net"}</th>
                      <th className="px-2 py-2 font-normal">{zh ? "占本金" : "Of equity"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.shocks.map((shock) => {
                      const exit = plan.px * (1 + shock);
                      const net = plan.qty == null ? null : plan.qty * plan.unit(exit);
                      return (
                        <tr key={shock} className="border-t border-gold/30">
                          <td className="px-2 py-1.5 font-mono">{pct(shock)}</td>
                          <td className="px-2 py-1.5 font-mono">{money(exit, 6)}</td>
                          <td className="px-2 py-1.5 font-mono">{money(net, 2)}</td>
                          <td className="px-2 py-1.5 font-mono">{net == null ? "—" : pct(net / plan.bank)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="text-sm text-ink/60">{zh ? "填入场价之后才计算。止损要在入场价的亏损一侧。" : "Enter a price to calculate. The stop has to be on the losing side of the entry."}</p>}
        </div>
      ) : null}
    </article>
  );
}
