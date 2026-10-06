import { BSC_REBATE, KNOWN_XMARK, KNOWN_XPERP } from "@/lib/perp";
import { GATE } from "@/lib/gate-chain";
import { BSC, FEE_TO } from "@/lib/bsc";
import { NPM } from "@/lib/lp";
import { LOCKED_REBATE } from "@/lib/seal-rebate";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

type Section = { h: string; ps: string[] };

const zh: Section[] = [
  {
    h: "先看这一页怎么用",
    ps: [
      "页头第一颗按钮是铸造。点进去，钱包停在 X Layer，一次铸 16 颗 NAND。这是进门的动作。交易在下面的交易台，不和铸造混在一张票上。",
      "交易台只有现货和永续。现货再分买卖和流动性。练习页不进实盘成交。工房放晶体管、流片和印鉴。规则就是这一页。",
      "签名在 OKX 或币安钱包里。页面不收私钥，也不保管你的币。",
    ],
  },
  {
    h: "钱去哪",
    ps: [
      "现货买到的币留在钱包。台费是付出金额的 0.20%，进收费地址。池子自己的手续费留给流动性提供者。Gas 付给链。",
      "永续保证金锁进你选的那一条链上的那一份合约。平台不经手。",
      "流动性凭证是你钱包里的一张仓位。添加时，你放入的两边各扣 0.20%。撤回时，拿回来的两边再各扣 0.20%。",
      `收费地址只有 ${FEE_TO}。对不上，下单停掉。`,
    ],
  },
  {
    h: "现货买卖",
    ps: [
      "先选加密货币或美股。加密货币是 BEM、BNB、OKB、BTC、黄金。美股是标普、纳指 100、苹果、英伟达、英特尔、微软、特斯拉、SpaceX、谷歌。一枚美股对一股，不是指数点位。",
      "除了 OKB，都在 BSC 的 PancakeSwap。OKB 在 X Layer 的 PotatoSwap。两条链不能并成一笔。",
      "签名前必须算完四行：付出多少、池子约得多少、台费多少、1% 滑点内最少到账多少。算不出来不能签。卖 BNB 留下约 0.003 付 gas，卖 OKB 留下约 0.002。",
    ],
  },
  {
    h: "流动性",
    ps: [
      "在现货里切到流动性。对 USDT 的是现货里的 BSC 池。对 BEM 的是 BNB、BTC、黄金。只填一边，另一边按现价配上，全区间。BNB / BEM 已有池。BTC / BEM 和黄金 / BEM 还没有池时，第一笔按两边对 USDT 的现价建池。随时可以一键撤回。OKB 在 X Layer，不能和 BEM 组在同一个池。",
      "能做的 USDT 池是 BEM、BNB、BTC、黄金，以及上面的美股。对 BEM 的是 BNB、BTC、黄金。",
      `凭证由 PancakeSwap V3 的仓位合约 ${NPM} 铸给钱包。撤回一次退出全部。BNB 池拿回的是 BNB。已经转出的台费，中途取消不退。`,
    ],
  },
  {
    h: "永续",
    ps: [
      "开仓前先看四行：保证金进哪份合约、大约亏一半就能强平、标记价是池子约 10 分钟均价、BSC 的 USDT 和 X Layer 的 USDT0 不能并成一笔。没有保险基金，也没有自动减仓。",
      "新手默认 3 倍，最高 20 倍。更高倍数和指定价格在高级里，超过 20 倍要再确认一次。",
      "偏离标记价 15% 以外的单默认收起。按钮写吃单开多、吃单开空。自己的单标我的，不能自己吃。撤单没确认，单还在合约里。",
      `BSC 合约 ${BSC_REBATE}。X Layer 合约 ${KNOWN_XPERP}，标记价 ${KNOWN_XMARK}。止盈止损只在这台浏览器开着的时候才会请你签名。`,
    ],
  },
  {
    h: "费用就这一条",
    ps: [
      "现货、永续撮合、撤单、添加流动性、撤回流动性，本台都是 0.20%。这是加在池子手续费之外的。平仓不再另收。",
      "有推荐人时，永续手续费里交易者少付 4%，推荐人记 6%，剩下的进收费地址。现货和流动性不参与这套拆分。",
      "印鉴不会自动减费。登记之后，已撮合的永续成交可以按新加坡周领回一半，周一 0 点到下周一 0 点，过点作废，同一笔只进一次。钱从领取合约出，不从收费地址扣。",
    ],
  },
  {
    h: "练习、工房、还没做的",
    ps: [
      "练习余额叫练习金。清除只清这台浏览器，不动合约。探针和印鉴电路只在练习页。",
      `工房的晶体管是六个标的，一份合约 ${GATE}。流片烧掉 NAND，不能撤回。先铸造，再流片。`,
      "做市激励和积分还没开始。没开始就不记分。三份永续没有管理员，也没有审计。只放你亏得起的钱。",
    ],
  },
  {
    h: "地址",
    ps: [
      `收费 ${FEE_TO}。BSC 永续 ${BSC_REBATE}。X Layer 永续 ${KNOWN_XPERP}。标记价 ${KNOWN_XMARK}。晶体管 ${GATE}。流动性仓位 ${NPM}。`,
      `BEM 池 ${BSC.pool}。BNB 池 ${BSC.bnbPool}。X Layer 印鉴领取 ${LOCKED_REBATE.xlayer}。BSC 印鉴领取 ${LOCKED_REBATE.bsc}。处理器 ${DEPLOYED.circuits}。`,
      "旧收费地址停用，不出现在下单里。改规则的当天，改这一页。",
    ],
  },
];

const en: Section[] = [
  {
    h: "How to use this page",
    ps: [
      "The first button is mint. It opens the wafer, the wallet stays on X Layer, and one tap mints 16 NAND. That is the front door. Trading is on the desk below, not on the same ticket.",
      "The desk is spot and perpetuals. Spot splits into trade and liquidity. Practice fills stay off the live tape. The workshop holds transistors, tape-out, and the seal. These rules are this page.",
      "You sign in OKX or Binance Wallet. The page does not take a private key and does not hold your tokens.",
    ],
  },
  {
    h: "Where the money goes",
    ps: [
      "A spot fill stays in the wallet. The desk fee is 0.20% of what you pay, and it goes to the fee address. The pool fee stays with liquidity providers. Gas stays with the chain.",
      "Perpetual margin is locked in the one contract on the chain you picked. The desk does not hold it.",
      "A liquidity position is a receipt in your wallet. Adding takes 0.20% from each token you deposit. Removing takes 0.20% from both tokens that come back.",
      `There is one fee address, ${FEE_TO}. If it does not match, orders stop.`,
    ],
  },
  {
    h: "Spot",
    ps: [
      "Pick crypto or US stocks. Crypto is BEM, BNB, OKB, BTC, and gold. Stocks are the S&P, the Nasdaq-100, Apple, Nvidia, Intel, Microsoft, Tesla, SpaceX, and Google. One stock token is one share, not the index level.",
      "Everything except OKB fills on PancakeSwap on BSC. OKB fills on PotatoSwap on X Layer. The two chains do not net.",
      "Before you sign, four numbers have to be filled in: what you pay, the pool estimate, the fee, and the minimum within 1% slippage. A BNB sell leaves about 0.003 for gas. An OKB sell leaves about 0.002.",
    ],
  },
  {
    h: "Liquidity",
    ps: [
      "On spot, switch to liquidity. USDT pairs are the BSC spot pools. BEM pairs are BNB, BTC, and gold. Type one side. The other matches the live price, full range. BNB / BEM already has a pool. BTC / BEM and gold / BEM are created by the first deposit, at the two USDT prices. You can remove any time. OKB is on X Layer and cannot share a pool with BEM.",
      "USDT pairs are BEM, BNB, BTC, gold, and the stocks above. BEM pairs are BNB, BTC, and gold.",
      `The receipt is minted to your wallet by the PancakeSwap V3 position contract ${NPM}. Remove exits the whole position. A BNB pool returns BNB. A fee already sent is not returned if you cancel halfway.`,
    ],
  },
  {
    h: "Perpetuals",
    ps: [
      "Before an open, four lines: which contract holds the margin, that about half the margin lost can liquidate, that the mark is about a 10-minute pool average, and that BSC USDT and X Layer USDT0 do not net. There is no insurance fund and no auto-deleveraging.",
      "A beginner starts at 3x and stops at 20x. Higher multiples and a chosen price are in Advanced. Anything over 20x asks again.",
      "Quotes more than 15% from the mark stay folded. The buttons say Take long and Take short. Yours says Mine. If a cancel is not confirmed, the order is still in the contract.",
      `BSC contract ${BSC_REBATE}. X Layer contract ${KNOWN_XPERP}, mark ${KNOWN_XMARK}. A stop asks for a signature only while this browser is open.`,
    ],
  },
  {
    h: "One fee",
    ps: [
      "Spot, a perpetual match, a cancel, adding liquidity, and removing liquidity all pay this desk 0.20%. That is on top of the pool fee. Closing adds nothing.",
      "With a referrer, the perpetual fee splits: the trader pays 4% less of it, the referrer is credited 6%, and the rest goes to the fee address. Spot and liquidity are not part of that split.",
      "A seal does not cut the fee by itself. After you register, half the fee on a matched perpetual fill can be claimed once per Singapore week, Monday 00:00 to the next Monday 00:00. Miss it and it is gone. The claim is paid from the claim contract, not from the fee address.",
    ],
  },
  {
    h: "Practice, workshop, not open",
    ps: [
      "Practice cash is not a wallet balance. Clear removes only this browser. The probe and the seal circuit stay on the practice page.",
      `The workshop lists six transistor markets on one contract, ${GATE}. A tape-out burns NAND and cannot be undone. Mint first, then tape out.`,
      "Maker rewards and points have not started. Nothing is scored until they do. None of the three perpetuals has an admin or an audit. Use only money you can lose.",
    ],
  },
  {
    h: "Addresses",
    ps: [
      `Fee ${FEE_TO}. BSC perpetual ${BSC_REBATE}. X Layer perpetual ${KNOWN_XPERP}. Mark ${KNOWN_XMARK}. Transistors ${GATE}. Liquidity positions ${NPM}.`,
      `BEM pool ${BSC.pool}. BNB pool ${BSC.bnbPool}. X Layer seal claim ${LOCKED_REBATE.xlayer}. BSC seal claim ${LOCKED_REBATE.bsc}. Processor ${DEPLOYED.circuits}.`,
      "Older fee addresses are retired. When a rule changes, this page changes the same day.",
    ],
  },
];

export function Whitepaper() {
  const lang = useExchange((s) => s.lang);
  const sections = lang === "zh" ? zh : en;
  return (
    <article className="border border-gold bg-card shadow-plate">
      <header className="border-b border-gold px-5 py-7 sm:px-8">
        <p className="text-xs tracking-[0.35em] text-gold">TAPELIQUID</p>
        <h2 className="mt-3 font-display text-5xl italic leading-none">{lang === "zh" ? "白皮书" : "White paper"}</h2>
        <p className="mt-4 max-w-2xl text-sm leading-7">
          {lang === "zh"
            ? "按动手的顺序写。先铸造，再看钱去哪，再下单。不写还没上线的功能。"
            : "Written in the order you act. Mint, then see where the money goes, then place an order. Nothing here is unshipped."}
        </p>
      </header>
      <nav className="grid border-b border-gold sm:grid-cols-2" aria-label={lang === "zh" ? "目录" : "Contents"}>
        {sections.map((section, i) => (
          <a key={section.h} href={`#paper-${i}`} className="flex min-h-11 items-center border-gold/40 px-4 py-2 text-sm hover:bg-paper sm:odd:border-r">
            {section.h}
          </a>
        ))}
      </nav>
      <div className="grid gap-3 border-b border-gold px-5 py-4 sm:grid-cols-2 sm:px-8">
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${BSC.explorer}/address/${FEE_TO}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "收费地址" : "Fee address"}</span>
          <span className="mt-1 block break-all font-mono text-xs">{FEE_TO}</span>
        </a>
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${XLAYER.explorer}/address/${DEPLOYED.transistors}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "铸造" : "Mint"}</span>
          <span className="mt-1 block break-all font-mono text-xs">{DEPLOYED.transistors}</span>
        </a>
      </div>
      <div className="flex flex-col gap-8 px-5 py-7 sm:px-8">
        {sections.map((section, i) => (
          <section key={section.h} id={`paper-${i}`} className="scroll-mt-28 border-t border-gold/40 pt-4">
            <h3 className="font-display text-3xl italic">{section.h}</h3>
            {section.ps.map((p) => (
              <p key={p.slice(0, 40)} className="mt-3 max-w-3xl text-sm leading-7">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
