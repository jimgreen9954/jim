import { useState } from "react";
import { deployGuardedVault, deployTapeCap, deployTierUp } from "@/lib/perp";
import { connectAny } from "@/lib/wallet";

export function ShipBar({ zh }: { zh: boolean }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");

  const run = (id: string, work: (from: string) => Promise<string>) => {
    if (busy) return;
    setBusy(id);
    setNote(zh ? "请用这条链的多签签名。别人签会被拒绝。签完把地址发来，页面先不换。" : "Sign with that chain's multisig. Any other wallet is rejected. Send the address back. The page does not switch yet.");
    void (async () => {
      try {
        const from = await connectAny();
        setNote(await work(from));
      } catch (err) {
        const code = err instanceof Error ? err.message : "";
        setNote(
          code === "safe"
            ? zh
              ? "这个钱包不是这条链的多签。"
              : "This wallet is not that chain's multisig."
            : code === "price"
              ? zh
                ? "部署了，但价格偏离现价超过 3%，先不要换页面。"
                : "Deployed, but the price is more than 3 percent from spot. Do not switch the page yet."
              : zh
                ? "没有完成。等钱包弹出再确认。"
                : "It did not finish. Wait for the wallet, then confirm.",
        );
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
          ? "在主页。现在下单仍走已经在用的合约。TAPE 和 FAB 先停新开仓。还要部署的只有这三笔。X Layer 多签 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c 部署 TAPE 限幅标记和分档永续，再部署一口申请退出后不能新开的金库，金库跟现在的 X Layer BEM 永续。BSC 多签 0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd 部署挂在现有 UP 标记上的分档永续。签完把地址发我，我再撤掉这里。比特币、ETH、ZEC、BEM 和 BSC 金库已经在用，不重部署。FAB 还没有限幅标记，所以没有按钮。"
          : "On the homepage. Orders still use the contracts already live. New TAPE and FAB opens are paused. Three deploys are left. The X Layer multisig 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c deploys the capped TAPE mark and tiered book, then a vault that refuses a new open after an exit request. That vault follows the X Layer BEM book already live. The BSC multisig 0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd deploys a tiered UP book on the mark already live. Send the addresses back and this comes off. Bitcoin, ETH, ZEC, BEM and the BSC vault are already live and are not redeployed. FAB has no capped mark, so it has no button."}
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 border border-gold text-xs disabled:opacity-40"
          onClick={() =>
            run("tape", async (from) => {
              const made = await deployTapeCap(from);
              return zh
                ? `TAPE 永续 ${made.book}，标记 ${made.mark}，价格 ${made.usd.toFixed(4)}`
                : `TAPE book ${made.book}, mark ${made.mark}, price ${made.usd.toFixed(4)}`;
            })
          }
        >
          {busy === "tape" ? (zh ? "部署中" : "Deploying") : zh ? "部署 TAPE 标记和分档永续" : "Deploy the TAPE mark and tiered book"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 border border-gold text-xs disabled:opacity-40"
          onClick={() =>
            run("up", async (from) => {
              const made = await deployTierUp(from);
              return zh
                ? `UP 分档永续 ${made.book}，价格 ${made.usd.toFixed(4)}。标记仍是现在这一份。`
                : `UP tiered book ${made.book}, price ${made.usd.toFixed(4)}. The mark stays the one already live.`;
            })
          }
        >
          {busy === "up" ? (zh ? "部署中" : "Deploying") : zh ? "部署 UP 分档永续" : "Deploy the tiered UP book"}
        </button>
        <button
          type="button"
          disabled={Boolean(busy)}
          className="min-h-10 border border-gold text-xs disabled:opacity-40"
          onClick={() =>
            run("vxl", async (from) =>
              zh
                ? `X Layer 金库 ${await deployGuardedVault(from, "xlayer")}。跟现有 BEM 永续。申请退出后不能新开。`
                : `X Layer vault ${await deployGuardedVault(from, "xlayer")}. It follows the live BEM book and refuses a new open after an exit request.`,
            )
          }
        >
          {busy === "vxl" ? (zh ? "部署中" : "Deploying") : zh ? "部署 X Layer 金库" : "Deploy the X Layer vault"}
        </button>
      </div>
      {note ? <p className="mt-2 text-xs leading-5 text-ink/80">{note}</p> : null}
    </section>
  );
}
