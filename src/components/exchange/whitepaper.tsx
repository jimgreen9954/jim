import { BSC_REBATE, KNOWN_XMARK, KNOWN_XPERP } from "@/lib/perp";
import { GATE } from "@/lib/gate-chain";
import { BSC, FEE_TO } from "@/lib/bsc";
import { LOCKED_REBATE } from "@/lib/seal-rebate";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

type Section = { h: string; ps: string[] };

const zh: Section[] = [
  {
    h: "这笔钱去哪",
    ps: [
      "页面不托管，也不收私钥。签名在 OKX 或币安钱包里完成。",
      "现货成交留在钱包。台费是付出金额的 0.20%，先打进收费地址，剩下的才进池子。池子自己的手续费留给流动性提供者，gas 付给链，这两笔不进收费地址。",
      "永续的保证金锁进你选的那一条链上的那一份合约。平台不经手。平仓不再另收。撤单收这张保证金的 0.20%，剩下的退回。",
    ],
  },
  {
    h: "两本永续为什么不能并成一笔",
    ps: [
      `BSC 的 BEM 永续只有一份合约 ${BSC_REBATE}。保证金是 BSC 的 USDT，从 1 到 500。Gas 是 BNB。`,
      `X Layer 的 BEM 永续只有一份合约 ${KNOWN_XPERP}。保证金是这条链上的 USDT0，6 位小数，从 1 美元起。Gas 是 OKB。标记价合约是 ${KNOWN_XMARK}。`,
      "两条链各有自己的账。一条 X Layer 的单不能去填一条 BSC 的单。钱包不在这条链时，签名前会切过去，不会让你自己试错。",
    ],
  },
  {
    h: "强平、标记价、没有保险基金",
    ps: [
      "亏到保证金大约一半，仓就可以被强平。没有保险基金，也没有自动减仓。一边平仓或强平，两边一起结算。",
      `BSC 的 BEM 标记价是池子大约 10 分钟的均价，池子是 ${BSC.pool}。不用最后一笔。成交价是挂单上写的价。之后盈亏按标记价，不按图上最后一根。`,
      "X Layer 没有这口 BEM 池。标记价存在单独的合约里，由页面从 BSC 推进，每 30 秒最多挪一点。图仍画 BSC 的池子，所以图可以比 X Layer 的结算价快。",
      "开仓前，页面先写这四句，不能跳过：保证金进哪份合约、大约亏一半就能强平、标记价怎么来、两链不能并成一笔。",
      "新手默认 3 倍，上限 20 倍。高级才打开更高倍数和指定价格。超过 20 倍要再确认一次。1000 倍不在默认档。指定价格只在高级里出现。",
      "偏离标记价超过 15% 的单收在「远离标记价」，默认不进五档。标题写出标记价和买一卖一价差。价差大时写「这本合约现在很薄」。",
      "红的是空单，按钮是「吃单开多」。绿的是多单，按钮是「吃单开空」。自己的单标「我的」，不能自己吃。没有仓时写「本地址在这条链上没有未平仓」。有仓先看方向和倍数、保证金、强平价、开仓价。",
      "撤单没有确认时，原位写「撤单未确认，单仍在合约里。可再试一次。」单不会因为失败提示就消失。",
      "止盈止损记在这台浏览器里。页面开着，价格碰到之后，才请钱包签平仓。关掉页面，它不会自己平。链上不保存这条止盈止损。",
    ],
  },
  {
    h: "费用",
    ps: [
      `现货、三本永续的撮合、以及撤单，本台都收 0.20%。收款地址只有一个：${FEE_TO}。它不能改合约，也不能动还锁着的保证金。`,
      "现货这 0.20% 加在池子手续费之外。签名前必须先算完：付出多少、池子约得多少、台费多少、1% 滑点内最少到账多少。算不出来，按钮不会让你签。",
      "有推荐人时，永续这笔手续费再拆开：交易者少付其中 4%，推荐人记其中 6%，剩下的进收费地址。比例写在合约里。现货不参与。",
      "印鉴不会自动减费。灯亮了也不改订单簿里已经收走的 0.20%。登记之后，已撮合的成交可以从另一份领取合约领回一半，不从收费地址扣。一个新加坡周只能领一次，周一 0 点到下周一 0 点。这一周没领，过点作废。同一笔只进一次。有推荐人时，按少付之后的手续费再减半。晶体管那本账没有撮合时间，不算进这一周。",
    ],
  },
  {
    h: "地址",
    ps: [
      `收费地址 ${FEE_TO}。现货票里那一行和这一页是同一个地址。对不上时，下单停掉。`,
      `BSC 永续 ${BSC_REBATE}。X Layer 永续 ${KNOWN_XPERP}。X Layer 标记价 ${KNOWN_XMARK}。晶体管 ${GATE}。`,
      `BEM / USDT 池 ${BSC.pool}。BNB / USDT 池 ${BSC.bnbPool}。X Layer 印鉴领取 ${LOCKED_REBATE.xlayer}。BSC 印鉴领取 ${LOCKED_REBATE.bsc}。处理器电路 ${DEPLOYED.circuits}，晶体管 ${DEPLOYED.transistors}。`,
      "旧的收费地址已停用，不出现在下单、签名和页脚里。",
    ],
  },
  {
    h: "现货",
    ps: [
      "交易台里的现货是钱包里的真买卖。先选加密货币或美股，两边的按钮不排在一起。",
      "加密货币是 BEM、BNB、OKB、BTC、黄金。BEM、BNB、BTC、黄金在 BSC 的 PancakeSwap V3。OKB 在 X Layer 的 PotatoSwap，买到的是钱包里的 OKB。卖 BNB 留下约 0.003 BNB 付 gas，卖 OKB 留下约 0.002 OKB。",
      "BTC 是 BTCB，池费率 0.01%。黄金是 Tether Gold（XAUt），池费率 0.05%，一枚对一盎司。美股是币安 bStocks，对 USDT：标普 SPY、纳指 100 的 QQQ、苹果、英伟达、英特尔、微软、特斯拉、SpaceX、谷歌。一枚对一股，不是指数点位。没有纳斯达克 1000。",
      "左图右票。票钉在屏幕里。未连接时，票上是「用 OKX 连接」和「用币安连接」。图下只放最近成交，地址是签那笔交易的钱包。这根周期没有池子成交时，写明报价仍在读。",
      "图上的看多或看空是形态备注，不是报价，也不是建议。离现价超过 4% 不显示，不用红字。可以关掉。",
    ],
  },
  {
    h: "练习",
    ps: [
      "练习和实盘分开。页上有「练习 · 本地」水印。这里的成交不进现货或永续的成交列表。",
      "余额叫练习金，不叫钱包余额。页头的清除只清这台浏览器里的练习记录，不动任何合约，也不转走 USDT、USDT0 或 BNB。",
      "探针、成交灯和个人印鉴的电路只出现在练习页，不放在实盘下单票旁边。练习吃单 0.08%，挂单 0.02%，这笔费用不进收费地址。",
    ],
  },
  {
    h: "工房",
    ps: [
      "工房和交易台分开。入口只有一句：先铸造 NAND，再流片。流片烧掉晶体管，不能撤回。交易台不再放一键流片。",
      `晶体管只做六个标：TapeOut、Behemoth、Genesis CPU，各有 NAND 和 LATCH。全站一份合约 ${GATE}。保证金是 BSC 的 USDT。角上的价是官网记录的链上最新一笔，单位是 OKB。下单前对照合约里的结算价，相差不超过 3% 才继续。`,
      "这本还没有对手单时，页面写明：你挂出的价会成为第一档。",
      "推荐码按链分开。BSC 花 BNB，记 USDT。X Layer 花 OKB，记 USDT0。晶体管的码单独确认。确认之后不能改。邀请名单和可提金额以合约里的数字为准。提现只收整数：1、10、20、50、100、300、500 美元。减的是永续手续费，不是现货。规则只在工房出现一次。",
      "个人印鉴是 4 个输入、1 个输出、3 个 NAND。一次流片烧掉 3 颗 NAND，支付 0.0013 OKB，亮一盏灯。满三盏也不改订单簿里的 0.20%。登记按钮上写着：灯不自动减费。",
    ],
  },
  {
    h: "尚未开放",
    ps: [
      "谁都可以在高级档里挂单。价差、深度和库存没有平台下限。撤单未确认时，单仍在合约里。",
      "做市激励尚未开始。积分和空投尚未开始。规则没冻结之前，页面不记分，也不发奖励。",
      "三份永续没有管理员，也没有审计。只使用你亏得起的钱。这不是招股，不是托管，也不保证成交或盈利。本站没有平台币，也没有挖矿。",
    ],
  },
  {
    h: "这份文件",
    ps: [
      "以这一页为准。交易台、练习、工房、规则四处的地址和费率，改的当天同时改这一页。",
      "页首的白天和黑夜只记在这台浏览器里，不写上链，也不改价格和订单。",
    ],
  },
];

const en: Section[] = [
  {
    h: "Where the money goes",
    ps: [
      "The page does not custody funds and does not ask for a private key. You sign in OKX or Binance Wallet.",
      "A spot fill stays in the wallet. The desk fee is 0.20% of what you pay. It goes to the fee address first. The rest goes to the pool. The pool's own fee stays with liquidity providers. Gas stays with the chain. Neither goes to the fee address.",
      "Perpetual margin is locked in the one contract on the chain you picked. The desk does not hold it. Closing adds no fee. A cancel costs 0.20% of that margin and returns the rest.",
    ],
  },
  {
    h: "Why the two books do not net",
    ps: [
      `BSC has one BEM perpetual, ${BSC_REBATE}. Margin is BSC USDT, from 1 to 500. Gas is BNB.`,
      `X Layer has one BEM perpetual, ${KNOWN_XPERP}. Margin is USDT0 on that chain, 6 decimals, from 1 USD. Gas is OKB. The mark contract is ${KNOWN_XMARK}.`,
      "Each chain has its own book. An X Layer order cannot fill a BSC order. If the wallet is on the other chain, it switches before the signature.",
    ],
  },
  {
    h: "Liquidation, the mark, no insurance fund",
    ps: [
      "A position can be liquidated when about half the margin is gone. There is no insurance fund and no auto-deleveraging. One side closing or being liquidated settles both.",
      `The BSC BEM mark is about a 10-minute average of pool ${BSC.pool}. It is not the last trade. The fill is the price on the order. After that, PnL uses the mark, not the last candle.`,
      "X Layer has no BEM pool. The mark lives in its own contract and is pushed from BSC, at most a small step every 30 seconds. The chart still draws the BSC pool, so it can lead the X Layer settlement.",
      "Before an open, the page shows four lines that cannot be skipped: which contract holds the margin, that about half the margin lost can liquidate, how the mark is made, and that the two chains do not net.",
      "A beginner starts at 3x and stops at 20x. Advanced unlocks higher multiples and a chosen price. Anything over 20x asks again. 1000x is not on the default row. A chosen price appears only in Advanced.",
      "Quotes more than 15% from the mark sit under Far from the mark and are not in the top five. The title shows the mark and the bid-ask spread. A wide book says the contract is thin.",
      "A red row is a short. The button says Take long. A green row is a long. The button says Take short. Yours says Mine, and you cannot take it. With no position the page says this address has none open on this chain. An open position shows side and leverage, margin, liquidation, then entry.",
      "If a cancel is not confirmed, the page says so on that order: it is still in the contract, and you can try again. A failed note does not remove it.",
      "A stop stays in this browser. While the page is open and the price hits it, the wallet is asked to sign a close. A closed page does not close the trade. The chain does not store the stop.",
    ],
  },
  {
    h: "Fees",
    ps: [
      `Spot, a match on any of the three perpetuals, and a cancel all pay 0.20%. There is one fee address, ${FEE_TO}. It cannot change a contract, and it cannot take margin that is still locked.`,
      "On spot, the 0.20% sits on top of the pool fee. Before you sign, the page has to finish the numbers: what you pay, what the pool estimates, the fee, and the minimum within 1% slippage. If those numbers are missing, the button will not ask you to sign.",
      "With a referrer, the perpetual fee splits again: the trader pays 4% less of it, the referrer is credited 6% of it, and the rest goes to the fee address. The split is in the contract. Spot is not part of it.",
      "A seal does not cut the fee by itself. A lit lamp does not change the 0.20% already taken on the book. After you register, half the fee on a matched fill can be claimed from a separate contract. It is not taken from the fee address. One claim per Singapore week, Monday 00:00 to the next Monday 00:00. Miss the week and it is gone. A deal is included once. With a referrer, the half is of the already discounted fee. The transistor book stores no match time, so it is not in the week.",
    ],
  },
  {
    h: "Addresses",
    ps: [
      `Fee address ${FEE_TO}. The line on the spot ticket is this same address. If it does not match, orders stop.`,
      `BSC perpetual ${BSC_REBATE}. X Layer perpetual ${KNOWN_XPERP}. X Layer mark ${KNOWN_XMARK}. Transistors ${GATE}.`,
      `BEM / USDT pool ${BSC.pool}. BNB / USDT pool ${BSC.bnbPool}. X Layer seal claim ${LOCKED_REBATE.xlayer}. BSC seal claim ${LOCKED_REBATE.bsc}. Processor circuits ${DEPLOYED.circuits}, transistors ${DEPLOYED.transistors}.`,
      "Older fee addresses are retired. They do not appear on an order, a signature, or the footer.",
    ],
  },
  {
    h: "Spot",
    ps: [
      "Spot on the desk is a real trade in the wallet. Crypto and US stocks are separate lists.",
      "Crypto is BEM, BNB, OKB, BTC, and gold. BEM, BNB, BTC, and gold fill on PancakeSwap V3 on BSC. OKB fills on PotatoSwap on X Layer and lands in the wallet as OKB. A BNB sell leaves about 0.003 BNB for gas. An OKB sell leaves about 0.002 OKB.",
      "BTC is BTCB, pool fee 0.01%. Gold is Tether Gold (XAUt), pool fee 0.05%, one token for one troy ounce. US stocks are Binance bStocks against USDT: SPY, QQQ for the Nasdaq-100, Apple, Nvidia, Intel, Microsoft, Tesla, SpaceX, and Google. One token is one share, not the index level. There is no Nasdaq-1000.",
      "The chart is on the left and the ticket stays on the right. Before a wallet is connected, the ticket says Connect OKX and Connect Binance. Under the chart are recent pool fills. The address is the wallet that signed. If this candle has no pool trade, the page says the quote is still being read.",
      "A long or short note on the chart is a shape note. It is not a quote and not advice. It hides when it is more than 4% from the live price. It is not in red. It can be turned off.",
    ],
  },
  {
    h: "Practice",
    ps: [
      "Practice is separate from the live desk. The page is watermarked Practice · local. These fills do not appear on the spot or perpetual tape.",
      "The balance is practice cash, not a wallet balance. The header clear removes only the practice record in this browser. It does not touch a contract, and it does not move USDT, USDT0, or BNB.",
      "The probe, the match lamp, and the seal circuit appear only on the practice page, not beside a live ticket. Practice charges 0.08% to take and 0.02% to make. That fee does not go to the fee address.",
    ],
  },
  {
    h: "Workshop",
    ps: [
      "The workshop is not the trading desk. The only line at the door is: mint NAND, then tape out. A tape-out burns transistors and cannot be undone. The desk has no tape-out button.",
      `The transistor book lists six markets: TapeOut, Behemoth, and Genesis CPU, each as NAND and LATCH. One contract, ${GATE}. Margin is BSC USDT. The corner price is the last on-chain trade from the official feed, in OKB. Before an order, the page checks the settlement price in the contract and continues only within 3%.`,
      "If the book has no counterparty, the page says the price you post becomes the first level.",
      "A referral code is per chain. BSC spends BNB and credits USDT. X Layer spends OKB and credits USDT0. The transistor code is confirmed on its own contract. After confirmation it cannot be changed. The invite list and the claimable amount are the numbers in the contract. Claims are whole amounts of 1, 10, 20, 50, 100, 300, or 500 USD. The discount is on the perpetual fee, not on spot. The rule is written once, in the workshop.",
      "A personal seal is 4 inputs, 1 output, and 3 NAND gates. One tape-out burns 3 NAND, pays 0.0013 OKB, and lights one lamp. Three lamps do not change the 0.20% on the book. The register button says a lamp does not cut the fee by itself.",
    ],
  },
  {
    h: "Not open",
    ps: [
      "Anyone can quote from Advanced. There is no platform minimum for spread, depth, or inventory. If a cancel is not confirmed, the quote stays in the contract.",
      "Maker rewards have not started. Points and airdrops have not started. Until those rules are frozen, the page keeps no score and pays no reward.",
      "None of the three perpetuals has an admin, and none has been audited. Use only money you can lose. This is not an offering, not custody, and not a promise of a fill or a profit. This desk has no platform token and no mining.",
    ],
  },
  {
    h: "This page",
    ps: [
      "This page is the source. When an address or a fee changes on the desk, in practice, in the workshop, or in the rules, it changes here the same day.",
      "Day and night in the header stay in this browser. They are not written on chain, and they do not change a price or an order.",
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
            ? "按签字顺序写。只写现在这一版页面上真能签的那一套。"
            : "Written in the order you sign. Only what this version of the page can actually sign."}
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
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${BSC.explorer}/address/${BSC_REBATE}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">BSC</span>
          <span className="mt-1 block break-all font-mono text-xs">{BSC_REBATE}</span>
        </a>
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${XLAYER.explorer}/address/${KNOWN_XPERP}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">X Layer</span>
          <span className="mt-1 block break-all font-mono text-xs">{KNOWN_XPERP}</span>
        </a>
      </div>
      <div className="flex flex-col gap-8 px-5 py-7 sm:px-8">
        {sections.map((section, i) => (
          <section key={section.h} id={`paper-${i}`} className="scroll-mt-28 border-t border-gold/40 pt-4">
            <h3 className="font-display text-3xl italic">{section.h}</h3>
            {section.ps.map((p) => (
              <p key={p.slice(0, 48)} className="mt-3 max-w-3xl text-sm leading-7">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

