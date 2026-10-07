import { BSC_REBATE, KNOWN_XMARK, KNOWN_XPERP } from "@/lib/perp";
import { GATE } from "@/lib/gate-chain";
import { BSC, FEE_TO } from "@/lib/bsc";
import { NPM } from "@/lib/lp";
import { OFFICIAL } from "@/lib/official-books";
import { LOCKED_REBATE } from "@/lib/seal-rebate";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

type Section = { h: string; ps: string[] };

const zh: Section[] = [
  {
    h: "先看这一页怎么用",
    ps: [
      "交易台只有现货和永续。练习不进实盘成交。工房放晶体管合约、晶圆、官网晶体管现货和官网电路现货。规则就是这一页。顶上另外有个人中心、晶圆和流片，不和交易台平级。",
      "签名在 OKX 或币安钱包里。页面不收私钥，也不保管你的币。切错链时，这一笔停在票上，不会替你换链再签。",
    ],
  },
  {
    h: "钱去哪",
    ps: [
      "现货买到的币留在钱包。台费是付出金额的 0.20%，进收费地址。池子自己的手续费留给流动性提供者。Gas 付给链。",
      "永续保证金锁进你选的那一条链上的那一份合约。平台不经手。BSC 用 USDT，X Layer 用 USDT0。两本不能并成一笔。",
      "流动性凭证在钱包里。添加时，放入的两边各扣 0.20%。撤回时，拿回来的两边再各扣 0.20%。",
      "流片费是协议的，现在是 0.0013 OKB，加上 X Layer 的 gas。它不进本站收费地址。OKB 不够，交易发不出去，NAND 和 LATCH 不动。",
      "吃官网买单或买官网电路时，本站另收名义金额的 0.20%，先打进收费地址。官网自己的费留在官网合约里。官网那一笔没成交，先付的 0.20% 不退。",
      `收费地址只有 ${FEE_TO}。对不上，下单停掉。`,
    ],
  },
  {
    h: "现货买卖",
    ps: [
      "先选加密货币或美股。加密货币是 BEM、BNB、OKB、BTC、黄金。美股是标普、纳指 100、苹果、英伟达、英特尔、微软、特斯拉、SpaceX、谷歌。一枚美股对一股，不是指数点位。",
      "除了 OKB，都在 BSC 的 PancakeSwap。OKB 在 X Layer 的 PotatoSwap。两条链不能并成一笔。",
      "签名前必须算完四行：付出多少、池子约得多少、台费多少、1% 滑点内最少到账多少。算不出来不能签。卖 BNB 留下约 0.003 付 gas，卖 OKB 留下约 0.002。",
      "图下面的成交是池子里的真实交易，地址是签过名的钱包。这根周期没有成交时，页面写明，不留空白。报价仍每秒从池子读。",
    ],
  },
  {
    h: "流动性",
    ps: [
      "在现货里切到流动性。对 USDT 的是现货里的 BSC 池。对 BEM 的是 BNB、BTC、黄金，以及标普、纳指、苹果、英伟达、英特尔、微软、特斯拉、SpaceX、谷歌。只填一边，另一边按现价配上，全区间。还没有池时，第一笔按两边对 USDT 的现价建池。随时可以撤回。年化按这口池近几个小时的真实手续费除以池子金额来算，不算币价涨跌。池子不到 20 USDT 不报年化。OKB 在 X Layer，不能和 BEM 组在同一个池。",
      `凭证由 PancakeSwap V3 的仓位合约 ${NPM} 铸给钱包。撤回一次退出全部。BNB 池拿回的是 BNB。已经转出的台费，中途取消不退。`,
    ],
  },
  {
    h: "永续",
    ps: [
      "开仓前先看四行：保证金进哪份合约、大约亏一半就能强平、标记价是池子约 10 分钟均价、BSC 的 USDT 和 X Layer 的 USDT0 不能并成一笔。没有保险基金，也没有自动减仓。",
      "新手默认 3 倍，最高 20 倍。更高倍数和指定价格在高级里，超过 20 倍要再确认一次。1000 倍不在默认档。",
      "偏离标记价 15% 以外的单默认收起。按钮写吃单开多、吃单开空。自己的单标我的，不能自己吃。撤单没确认，单还在合约里，可以再试一次。",
      `BSC 合约 ${BSC_REBATE}。X Layer 合约 ${KNOWN_XPERP}，标记价 ${KNOWN_XMARK}。止盈止损只在这台浏览器开着的时候才会请你签名。关了页面，链上的仓还在，止盈止损不会自己执行。`,
    ],
  },
  {
    h: "个人中心",
    ps: [
      "登入之后，个人中心读这个地址自己的余额。它不保管资产。转出要另签一笔。",
      "晶体管按处理器分行。TAPELIQUID 标成「本站」，在 X Layer。Genesis、Blonskr 这类是官网 BSC 上的处理器，名字、晶体管合约、电路合约分开写。余额是 0 的官网处理器不列出。第一次会扫官网全部处理器，可能要几秒。",
      "官网没有单独的卖单托管合约，所以「挂单中」按 0，可转等于总数。转账跟在那一行下面，NAND 和 LATCH 分开签，不会把 TAPELIQUID 转进另一台的合约。",
      "电路也分开。本站电路有编号，可以转。官网只报出「这台持有几片」而没有逐个编号的，不能盲转。正在官网挂单的先别转。",
      "资产统计的合计是 USDT。USDT 和 X Layer USDT 按 1 枚 = 1 USDT。BNB、BEM、OKB 和钱包里有余额的美股代币用池子现价。晶体管用这台处理器当前最高买单，再乘 BNB 现价。没有买单的列出数量，折合留空，不加进合计。电路和未实现盈亏不算。永续只算锁在合约里的保证金。",
    ],
  },
  {
    h: "工房里的晶体管合约",
    ps: [
      `六个标的在同一份合约 ${GATE} 里互相成交。这是合约，不是现货。保证金、标记和强平以这本合约读到的为准。它和下面的官网现货不是同一份订单簿。`,
    ],
  },
  {
    h: "晶圆",
    ps: [
      `铸造停在 X Layer，晶体管合约 ${DEPLOYED.transistors}。NAND 或 LATCH 都可以铸，可选 100、1000、10000，也可以自己填。单价以链上读到的为准。`,
      "页面上的剩余是分开的。NAND 剩余是已铸 NAND 减去流片烧掉的，LATCH 一样。新铸造不是两份额度。2,100,000 是总额度，铸哪一种都从还没铸出的部分扣。",
    ],
  },
  {
    h: "流片",
    ps: [
      `点「流片」进画布。接线和真值表先在这台浏览器里跑，不写链。确认之后，签名才烧掉这台处理器上的 NAND 和 LATCH。电路合约是 ${DEPLOYED.circuits}，和官网打开的是同一份。官网的电路列表会跟着变。`,
      "票上写这张烧掉几个 NAND、几个 LATCH，以及按链上余额还能流几次。次数按这张图算，不是整台处理器还剩多少。",
      "流片费现在是 0.0013 OKB，另付 gas。票上同时写这个地址的 OKB。不够就停，按钮写明，不会签出去。烧掉的晶体管不能撤回，也不是官网 BEM 算力。",
    ],
  },
  {
    h: "官网的晶体管和电路",
    ps: [
      "工房里的晶体管现货和电路现货跟 tapeout.net 的快照，大约 15 秒重读一次，不是每个新区块。签名前再读一次链上那张单。价格或剩余变了就停。",
      `晶体管走官网买单合约 ${OFFICIAL.transistorMarket}。官网卖单合约没有开放，所以不能挂卖单。卖出就是吃一张买单，或者自己挂买单。能选的处理器是快照里已经有买单、并且在官网处理器名册上的。`,
      `电路走官网挂单合约 ${OFFICIAL.circuitMarket}。按快照上的 BNB 价格买，电路进你的 BSC 钱包。`,
      "这两笔都在 BSC。本站服务费是名义金额的 0.20%，先付到收费地址。官网没成交，这笔不退。",
    ],
  },
  {
    h: "费用、推荐、印鉴",
    ps: [
      "现货、永续撮合、撤单、添加流动性、撤回流动性，本台都是 0.20%。这是加在池子手续费之外的。平仓不再另收。",
      "有推荐人时，永续手续费里交易者少付 4%，推荐人记 6%，剩下的进收费地址。现货、流动性和官网那两本现货不参与这套拆分。推荐码确认之后不能改。返佣按整数门槛领取。",
      "印鉴不会自动减费。X Layer 要自己持有三张印鉴再登记。BSC 要部署者把地址记上。登记之后，已撮合的永续成交可以按新加坡周领回一半，周一 0 点到下周一 0 点。过点作废，同一笔只进一次。钱从领取合约出，不从收费地址扣。",
    ],
  },
  {
    h: "练习，以及还没做的",
    ps: [
      "练习余额叫练习金。清除只清这台浏览器，不动合约。探针和印鉴电路只在练习页，不出现在实盘下单票旁边。",
      "做市激励和积分还没开始。没开始就不记分。永续没有管理员，也没有审计，没有保险基金。只放你亏得起的钱。",
    ],
  },
  {
    h: "地址只此一套",
    ps: [
      `收费 ${FEE_TO}。BSC 永续 ${BSC_REBATE}。X Layer 永续 ${KNOWN_XPERP}。标记价 ${KNOWN_XMARK}。晶体管合约 ${GATE}。`,
      `TAPELIQUID 电路 ${DEPLOYED.circuits}。TAPELIQUID 晶体管 ${DEPLOYED.transistors}。流动性仓位 ${NPM}。`,
      `官网晶体管市场 ${OFFICIAL.transistorMarket}。官网电路市场 ${OFFICIAL.circuitMarket}。BEM 池 ${BSC.pool}。BNB 池 ${BSC.bnbPool}。`,
      `X Layer 印鉴领取 ${LOCKED_REBATE.xlayer}。BSC 印鉴领取 ${LOCKED_REBATE.bsc}。`,
      "旧收费地址停用，不出现在下单里。改规则的当天，改这一页，同时改仓库说明。",
    ],
  },
];

const en: Section[] = [
  {
    h: "How to read this page",
    ps: [
      "The desk is spot and perpetuals. Practice fills stay off the live tape. The workshop holds the transistor book, the wafer, official transistor spot, and official circuit spot. These rules are this page. Account, wafer, and tape-out sit above the desk. They are not a fifth product next to it.",
      "You sign in OKX or Binance Wallet. The page does not take a private key and does not hold your tokens. A wrong chain stops the ticket. It does not switch the chain and sign for you.",
    ],
  },
  {
    h: "Where the money goes",
    ps: [
      "A spot fill stays in the wallet. The desk fee is 0.20% of what you pay, and it goes to the fee address. The pool fee stays with liquidity providers. Gas stays with the chain.",
      "Perpetual margin is locked in the one contract on the chain you picked. The desk does not hold it. BSC uses USDT. X Layer uses USDT0. The two books do not net.",
      "A liquidity position is a receipt in your wallet. Adding takes 0.20% from each token you deposit. Removing takes 0.20% from both tokens that come back.",
      "The tape-out fee is the protocol's, currently 0.0013 OKB, plus X Layer gas. It does not go to this site's fee address. If the OKB is short, the transaction is not sent and the NAND and LATCH stay.",
      "Filling an official bid or buying an official circuit pays this site an extra 0.20% of the notional first, to the fee address. The official fee stays in their contract. If their fill does not land, the 0.20% is not returned.",
      `There is one fee address, ${FEE_TO}. If it does not match, orders stop.`,
    ],
  },
  {
    h: "Spot",
    ps: [
      "Pick crypto or US stocks. Crypto is BEM, BNB, OKB, BTC, and gold. Stocks are the S&P, the Nasdaq-100, Apple, Nvidia, Intel, Microsoft, Tesla, SpaceX, and Google. One stock token is one share, not the index level.",
      "Everything except OKB fills on PancakeSwap on BSC. OKB fills on PotatoSwap on X Layer. The two chains do not net.",
      "Before you sign, four numbers have to be filled in: what you pay, the pool estimate, the fee, and the minimum within 1% slippage. A BNB sell leaves about 0.003 for gas. An OKB sell leaves about 0.002.",
      "The prints under the chart are pool trades. The address is the wallet that signed. If this candle has none, the page says so. The quote is still read from the pool every second.",
    ],
  },
  {
    h: "Liquidity",
    ps: [
      "On spot, switch to liquidity. USDT pairs are the BSC spot pools. BEM pairs are BNB, BTC, gold, and the same stocks. Type one side. The other matches the live price, full range. A missing pool is created by the first deposit, at the two USDT prices. You can remove any time. The annualized figure is this pool's real fees over the last few hours, divided by the pool, and does not include price change. Under 20 USDT in the pool, no annualized figure is shown. OKB is on X Layer and cannot share a pool with BEM.",
      `The receipt is minted to your wallet by the PancakeSwap V3 position contract ${NPM}. Remove exits the whole position. A BNB pool returns BNB. A fee already sent is not returned if you cancel halfway.`,
    ],
  },
  {
    h: "Perpetuals",
    ps: [
      "Before an open, four lines: which contract holds the margin, that about half the margin lost can liquidate, that the mark is about a 10-minute pool average, and that BSC USDT and X Layer USDT0 do not net. There is no insurance fund and no auto-deleveraging.",
      "A beginner starts at 3x and stops at 20x. Higher multiples and a chosen price are in Advanced. Anything over 20x asks again. 1000x is not a default.",
      "Quotes more than 15% from the mark stay folded. The buttons say Take long and Take short. Yours says Mine. You cannot take your own quote. If a cancel is not confirmed, the order is still in the contract. Try again.",
      `BSC contract ${BSC_REBATE}. X Layer contract ${KNOWN_XPERP}, mark ${KNOWN_XMARK}. A stop asks for a signature only while this browser is open. Closing the page leaves the position on chain. The stop does not fire by itself.`,
    ],
  },
  {
    h: "Account",
    ps: [
      "After you sign in, Account reads this address. It does not custody anything. Sending takes another signature.",
      "Transistors are one row per processor. TAPELIQUID is marked as this site and lives on X Layer. Genesis, Blonskr, and the rest are official processors on BSC. The name, the transistor contract, and the circuit contract are separate lines. Official processors with a zero balance are left out. The first read scans the official processor list and can take a few seconds.",
      "There is no official escrow for asks, so listed is shown as 0 and transferable equals the balance. Send sits on that row. NAND and LATCH are separate signatures. A TAPELIQUID balance cannot be sent through another processor's contract.",
      "Circuits are split the same way. A circuit on this site has an id and can be sent. An official processor that only reports a count, without ids, cannot be sent blindly. A circuit that is listed stays listed until you delist it.",
      "The account total is in USDT. USDT and X Layer USDT count at 1. BNB, BEM, OKB, and stock tokens you hold use the pool price. A transistor uses that processor's best bid times the BNB price. With no bid, the amount is shown and the USDT cell stays empty. Circuits and unrealized PnL are not included. Perpetuals count only margin locked in the contract.",
    ],
  },
  {
    h: "Transistor perps in the workshop",
    ps: [
      `Six markets share one contract, ${GATE}. This is a perpetual book, not spot. Margin, mark, and liquidation are whatever that contract reads. It is not the official spot book below it.`,
    ],
  },
  {
    h: "Wafer",
    ps: [
      `Minting stays on X Layer, transistor contract ${DEPLOYED.transistors}. Mint NAND or LATCH, in 100, 1,000, 10,000, or any amount you type. The price is the one read from the chain.`,
      "The two figures left are separate. NAND left is NAND minted minus NAND burned by tape-out, and the same for LATCH. A new mint is not a second cap. 2,100,000 is one cap. Either kind is taken from whatever has not been minted yet.",
    ],
  },
  {
    h: "Tape-out",
    ps: [
      `Tape opens the canvas. Wires and the truth table run in this browser and do not write the chain. After you confirm, the signature burns NAND and LATCH on this processor. The circuit contract is ${DEPLOYED.circuits}, the same one the official site reads, so its circuit list moves with it.`,
      "The ticket states how many NAND and LATCH this sheet burns, and how many times the on-chain balance can still pay for this sheet. That count is for this sheet, not the processor's remaining supply.",
      "The tape fee is currently 0.0013 OKB, plus gas. The ticket also shows the OKB on this address. If it is short, the button stops and nothing is signed. Burned transistors cannot be undone, and they are not official BEM hashrate.",
    ],
  },
  {
    h: "Official transistors and circuits",
    ps: [
      "Transistor spot and circuit spot in the workshop follow the tapeout.net snapshot, about every 15 seconds, not every new block. Before you sign, the ticket reads that order on chain again. If the price or the remaining size moved, it stops.",
      `Transistors use the official bid contract ${OFFICIAL.transistorMarket}. The official ask contract is not open, so you cannot list a sell. Selling means filling a bid, or placing a bid of your own. The processors you can pick are the ones that already have a bid and appear on the official processor list.`,
      `Circuits use the official listing contract ${OFFICIAL.circuitMarket}. You buy at the BNB price on the snapshot. The circuit arrives in your BSC wallet.`,
      "Both settle on BSC. This site's fee is 0.20% of the notional, paid to the fee address first. If the official fill does not land, that fee is not returned.",
    ],
  },
  {
    h: "Fees, referrals, and the seal",
    ps: [
      "Spot, a perpetual match, a cancel, adding liquidity, and removing liquidity all pay this desk 0.20%. That is on top of the pool fee. Closing adds nothing.",
      "With a referrer, the perpetual fee splits: the trader pays 4% less of it, the referrer is credited 6%, and the rest goes to the fee address. Spot, liquidity, and the two official spot books are not part of that split. A referral code cannot be changed after you confirm it. A claim is an integer threshold.",
      "A seal does not cut the fee by itself. On X Layer you hold three seals and then register. On BSC the deployer records the address. After that, half the fee on a matched perpetual fill can be claimed once per Singapore week, Monday 00:00 to the next Monday 00:00. Miss it and it is gone. One fill is counted once. The claim is paid from the claim contract, not from the fee address.",
    ],
  },
  {
    h: "Practice, and what is not open",
    ps: [
      "Practice cash is not a wallet balance. Clear removes only this browser. The probe and the seal circuit stay on the practice page. They do not sit next to a live ticket.",
      "Maker rewards and points have not started. Nothing is scored until they do. The perpetuals have no admin, no audit, and no insurance fund. Use only money you can lose.",
    ],
  },
  {
    h: "One set of addresses",
    ps: [
      `Fee ${FEE_TO}. BSC perpetual ${BSC_REBATE}. X Layer perpetual ${KNOWN_XPERP}. Mark ${KNOWN_XMARK}. Transistor perpetual ${GATE}.`,
      `TAPELIQUID circuits ${DEPLOYED.circuits}. TAPELIQUID transistors ${DEPLOYED.transistors}. Liquidity positions ${NPM}.`,
      `Official transistor market ${OFFICIAL.transistorMarket}. Official circuit market ${OFFICIAL.circuitMarket}. BEM pool ${BSC.pool}. BNB pool ${BSC.bnbPool}.`,
      `X Layer seal claim ${LOCKED_REBATE.xlayer}. BSC seal claim ${LOCKED_REBATE.bsc}.`,
      "Older fee addresses are retired and do not appear in an order. When a rule changes, this page and the repository note change the same day.",
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
        <h2 className="mt-3 font-display text-4xl italic leading-none sm:text-5xl">{lang === "zh" ? "白皮书" : "White paper"}</h2>
        <p className="mt-4 max-w-2xl text-sm leading-7">
          {lang === "zh"
            ? "只写站上已经能签的事。先看钱去哪，再下单。没上线的不写进来。"
            : "Only what you can already sign. See where the money goes, then place the order. Nothing unshipped is written here."}
        </p>
      </header>
      <nav className="grid border-b border-gold sm:grid-cols-2" aria-label={lang === "zh" ? "目录" : "Contents"}>
        {sections.map((section, i) => (
          <a key={section.h} href={`#paper-${i}`} className="flex min-h-11 items-center border-b border-gold/40 px-4 py-2 text-sm hover:bg-paper sm:odd:border-r">
            {section.h}
          </a>
        ))}
      </nav>
      <div className="grid gap-3 border-b border-gold px-5 py-4 sm:grid-cols-3 sm:px-8">
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${BSC.explorer}/address/${FEE_TO}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "收费地址" : "Fee address"}</span>
          <span className="mt-1 block break-all font-mono text-xs">{FEE_TO}</span>
        </a>
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${XLAYER.explorer}/address/${DEPLOYED.transistors}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "铸造" : "Mint"}</span>
          <span className="mt-1 block break-all font-mono text-xs">{DEPLOYED.transistors}</span>
        </a>
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${XLAYER.explorer}/address/${DEPLOYED.circuits}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "流片" : "Tape-out"}</span>
          <span className="mt-1 block break-all font-mono text-xs">{DEPLOYED.circuits}</span>
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
