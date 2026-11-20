import { useState } from "react";
import { deployGuardedVault, deployTwapBook, deployUpCap } from "@/lib/perp";
import { connectAny } from "@/lib/wallet";

const books = ["btc", "eth", "zec", "bem"] as const;

export function ShipBar({ zh }: { zh: boolean }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const run = (id: string, work: (from: string) => Promise<string>) => {
    if (busy) return;
    setBusy(id);
    setNote(zh ? "请用多签签名。别人签会被拒绝。" : "Sign with the multisig. Any other wallet is rejected.");
    void (async () => {
      try {
        const from = await connectAny();
        setNote(await work(from));
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(code === "safe" ? (zh ? "这个钱包不是这条链的多签。" : "This wallet is not that chain's multisig.") : code === "price" ? (zh ? "部署了，但价格不在预期范围，先不要换页面。" : "Deployed, but the price is outside the expected range. Do not switch the page yet.") : zh ? "没有完成。等钱包弹出再确认。" : "It did not finish. Wait for the wallet, then confirm.");
      } finally {
        setBusy("");
      }
    })();
  };

  return (
    <section className="border border-gold bg-card px-3 py-3">
      <h2 className="font-display text-2xl italic">{zh ? "多签部署" : "Multisig deploy"}</h2>
      <p className="mt-1 text-xs leading-5 text-ink/70">
        {zh
          ? "还没换上的合约在这里部署。比特币、ETH、ZEC、BSC 的 BEM 会新建一个读 10 分钟均价的标记，并新建一本永续。UP 用官方池，每次报价最多走动 0.5%，杠杆上限 5 倍。金库跟现在正在用的 BEM 永续，申请退出之后不能再开新单。部署完把地址发我，我再撤掉这里，并改页面读的地址。现在下单仍走旧合约。UP 这本已经不能新开。"
          : "Contracts that are not live yet deploy here. Bitcoin, ETH, ZEC and BSC BEM each get a 10-minute mark and a new book. UP uses the official pool, moves at most 0.5 percent a quote, and caps leverage at 5x. The vault follows the BEM book already in use, and it refuses a new order after an exit request. Send me the addresses after you sign. I will remove this and point the page at them. Orders still use the current contracts. New UP orders are already stopped."}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {books.map((id) => (
          <button
            key={id}
            type="button"
            disabled={Boolean(busy)}
            className="min-h-10 border border-gold text-xs disabled:opacity-40"
            onClick={() =>
              run(id, async (from) => {
                const made = await deployTwapBook(from, id);
                return zh
                  ? `${id.toUpperCase()} 永续 ${made.book}，标记 ${made.mark}，价格 ${made.usd.toFixed(2)}`
                  : `${id.toUpperCase()} book ${made.book}, mark ${made.mark}, price ${made.usd.toFixed(2)}`;
              })
            }
          >
            {busy === id ? (zh ? "部署中" : "Deploying") : zh ? `部署 ${id.toUpperCase()} 标记和永续` : `Deploy the ${id.toUpperCase()} mark and book`}
          </button>
        ))}
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 border border-gold text-xs disabled:opacity-40"
          onClick={() =>
            run("up", async (from) => {
              const made = await deployUpCap(from);
              return zh
                ? `UP 永续 ${made.book}，标记 ${made.mark}，价格 ${made.usd.toFixed(4)}`
                : `UP book ${made.book}, mark ${made.mark}, price ${made.usd.toFixed(4)}`;
            })
          }
        >
          {busy === "up" ? (zh ? "部署中" : "Deploying") : zh ? "部署 UP 标记和永续" : "Deploy the UP mark and book"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 border border-gold text-xs disabled:opacity-40"
          onClick={() => run("vbsc", async (from) => (zh ? `BSC 金库 ${await deployGuardedVault(from, "bsc")}` : `BSC vault ${await deployGuardedVault(from, "bsc")}`))}
        >
          {busy === "vbsc" ? (zh ? "部署中" : "Deploying") : zh ? "部署 BSC 金库" : "Deploy the BSC vault"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 border border-gold text-xs disabled:opacity-40"
          onClick={() => run("vxl", async (from) => (zh ? `X Layer 金库 ${await deployGuardedVault(from, "xlayer")}` : `X Layer vault ${await deployGuardedVault(from, "xlayer")}`))}
        >
          {busy === "vxl" ? (zh ? "部署中" : "Deploying") : zh ? "部署 X Layer 金库" : "Deploy the X Layer vault"}
        </button>
      </div>
      {note ? <p className="mt-2 text-xs leading-5 text-ink/80">{note}</p> : null}
    </section>
  );
}
