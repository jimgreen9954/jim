import { BSC_REBATE, KNOWN_XMARK, KNOWN_XPERP } from "@/lib/perp";
import { GATE } from "@/lib/gate-chain";
import { BSC, FEE_TO } from "@/lib/bsc";
import { LOCKED_REBATE } from "@/lib/seal-rebate";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

type Section = { h: string; ps: string[] };

const zh: Section[] = [
  {
    h: "交易台",
    ps: [
      "TAPELIQUID 做三件事：现货、永续、晶圆。现货是 BEM、BNB、BTC、黄金和 OKB 对稳定币。前四个在 BNB Smart Chain 的 PancakeSwap，OKB 在 X Layer 的 PotatoSwap。永续有三本账，各锁一份合约：BSC 的 BEM、X Layer 的 BEM、BSC 的六个晶体管。同一本账里的人能看见并吃彼此的单。不同的账不能合成一笔。",
      "模拟盘只在这台浏览器里，用来看盘，不碰真钱。晶圆在 X Layer 的处理器上铸造和流片，不结算盈亏。",
      "页面不托管。现货留在钱包里，直到你签名。永续的保证金进你选的那份合约。签名在 OKX 或币安钱包里完成。页面不收私钥。",
      "页首可以换白天和黑夜。选择记在这台浏览器里，不写上链，也不改价格和订单。",
    ],
  },
  {
    h: "现货",
    ps: [
      "两对都走 PancakeSwap V3。报价读链上 Quoter，成交走 SwapRouter。",
      `BEM / USDT 的池子是 ${BSC.pool}，池费率 1%。BNB / USDT 的池子是 ${BSC.bnbPool}，池费率 0.01%。买 BNB 到账的是钱包里的 BNB。卖 BNB 留下约 0.003 BNB 付 gas。`,
      "OKB 在 X Layer 的 PotatoSwap 上买卖，池子是 OKB / USDT。买到的是钱包里的 OKB。卖出留下约 0.002 OKB 付 gas。台费同样是千分之二。现货页有 K 线。K 线下面是池子里的真实成交，地址是签那笔交易的钱包，点得开浏览器。",
      "BTC 是 BSC 上的 BTCB，池子是 Pancake BTCB / USDT，池费率 0.01%。黄金是 Tether Gold（XAUt），池子是 Pancake XAUt / USDT，池费率 0.05%，一枚对应一盎司黄金。美股是币安 bStocks，在 Pancake 上对 USDT：标普 SPY、纳指 100 的 QQQ、苹果、英伟达、英特尔、微软、特斯拉、SpaceX、谷歌。一枚对一股，不是指数点位。没有纳斯达克 1000。现货页先选加密货币或美股，两边的按钮不排在一起。",
      "本台另收付出金额的千分之二。买入从 USDT 扣，卖 BEM 从 BEM 扣，卖 BNB 从 BNB 扣，打进同一个收费地址。剩下的才进池子。池子自己的手续费留给流动性提供者，gas 付给链，这两笔不进收费地址。现货没有返佣。",
      "下单前，页面写出这一单的台费，以及按 1% 滑点算出的最少到账。余额不够，按钮不会让你签。钱包会先签台费，再签兑换。买 BNB 时，兑换和解包写在同一笔里。",
      "现货价每秒从池子读出。BEM 的这个价也拿来做永续的标记来源。永续的成交价仍是挂单上写的那个价。",
    ],
  },
  {
    h: "模拟",
    ps: [
      "模拟撮合在这台浏览器里。可以开多、开空、试杠杆和爆仓。记录留在这台设备上，换浏览器就没了。",
      "重熔只清空这台设备上的模拟账。不转走 USDT、USDT0 或 BNB，也不撤链上已经挂出的单。",
      "模拟盘吃单收 0.08%，挂单收 0.02%。这张费用只显示在模拟盘上，不进收费地址。",
    ],
  },
  {
    h: "K 线",
    ps: [
      `两张 BEM 图读的是同一口池子 ${BSC.pool}。柱子是池子成交的开高低收。模拟盈亏不按这张图结算。永续盈亏也不按最后一根结算。`,
      "模拟图的周期是 1 分、5 分、10 分、1 时、4 时、1 日、1 周。真实合约的短周期是 15 秒、1 分、5 分、15 分、1 时、4 时、1 日，下面另有一周、一月、三月、一年。大约最近 100 根，带成交量、MA7 和 MA25。十字线标出价格和新加坡时间。滚轮或按钮可以放大缩小，空白处可以左右拖。",
      "画线和区块点两次就落下，存在这台浏览器里。落下之后可以拖动、改端点、换颜色、删除、撤销或清空。",
      "图旁边的看多或看空，读的是最近约 36 根 BEM / USDT。下面的数字是猜的下一截价格，离现价不超过 4%，不是 0 到 100 的强度，也不是标记价。可以隐藏。不保证下一根。",
      "BSC 永续的开仓价是挂单上的价。之后盈亏跟大约 10 分钟的池子均价。X Layer 没有这口 BEM 池，图仍画 BSC 的池子，所以图可以比 X Layer 的结算价快。晶体管页用链上参考价，不用这两张图。",
    ],
  },
  {
    h: "BEM 永续",
    ps: [
      `BSC 只有一份合约 ${BSC_REBATE}。开多、开空、吃单、撤单、平仓都打到这里。保证金是 BSC 的 USDT，从 1 到 500。Gas 是 BNB。`,
      `X Layer 只有一份合约 ${KNOWN_XPERP}。保证金是这条链上的 USDT0，6 位小数，从 1 美元起。Gas 是 OKB。标记价合约是 ${KNOWN_XMARK}。一条 X Layer 的单不能去填一条 BSC 的单。`,
      "杠杆从 1 倍到 1000 倍。新手用页面上的保证金和倍数。要自己写，切到高级，手填倍数和开单价。不填价格，就用当时的标记价。填写的价格就是成交价。",
      "下单前，页面写出可用余额、这一单的手续费，以及大约能开多少 BEM。100 倍及以上会写出：标记价反向大约多少，保证金会亏掉一半，仓可以被强平。开空是红色。",
      "市场页列出还没有人接的挂单。红的是空单，点整行或「开多吃」。绿的是多单，点整行或「开空吃」。靠近现价的上下各留 5 张，其余折起来。自己的单不能自己吃。",
      "没人接的单可以撤，收这张保证金的千分之二，剩下的退回。对上之后不能撤，只能平仓或等强平。平仓不再另收。一边平仓或强平，两边一起结算。",
      "止盈止损记在这台浏览器里。页面开着，价格碰到之后，会请你的钱包签一笔平仓。关掉页面，它不会自己平。链上不保存这条止盈止损。",
      "对手昵称、推荐码、邀请名单都在「我的订单」。昵称只存在这台浏览器里，链上仍是地址。",
    ],
  },
  {
    h: "晶体管永续",
    ps: [
      `这一页只做六个标：TapeOut、Behemoth、Genesis CPU，各有 NAND 和 LATCH。全站只有一份合约 ${GATE}。任何地址、任何时候的单都在这一本账上。保证金是 BSC 的 USDT，从 1 到 500。`,
      "角上的价是官网记录的链上最新一笔成交，单位是 OKB，大约每秒重读。不再用买卖中间价。订单簿暂时读不到时，六个价格仍然留着。下单、吃单、平仓之前，页面先看合约里的结算价。和这个最新价相差不超过 3% 才继续。差得更多就先把最新价推进去。推进之后仍超过 3%，这一笔不做。成交按挂单价。",
      "手续费是用掉的保证金的千分之二，比例和 BEM 永续相同。推荐码要在这份合约上单独确认，不能拿 BEM 的码直接用。邀请链接是当前网址加 #gate=你的码。BEM 和 X Layer 的链接是 #ref=。只打开链接不会绑定，仍要点确认。确认之后不能改。",
    ],
  },
  {
    h: "标记价",
    ps: [
      "BSC 的 BEM 标记价是池子大约 10 分钟的均价。成交价和结算价会分开，用来挡住瞬时插针。",
      "X Layer 没有这口池。标记价存在单独的合约里。页面从 BSC 读出现价再推进去，每 30 秒最多挪一点。盈亏按推进后的价结算。谁都可以付 OKB 推进一次，推不推得动由合约里的时间决定。",
      "输赢以链上标记价为准，不以图上的最后一根为准。",
    ],
  },
  {
    h: "费用和返佣",
    ps: [
      `现货、三本永续的撮合、以及撤单，本台都收千分之二。收款地址只有一个：${FEE_TO}。它不能改合约，也不能动还锁着的保证金。平仓不再另收。`,
      "有推荐人时，永续这笔手续费再拆开：交易者少付其中 4%，推荐人记其中 6%，剩下的进收费地址。比例写在合约里。现货不参与这套拆分。",
      "Pancake 池子自己的手续费，以及 BNB、OKB 的 gas，不进这个地址。",
      "返佣在链上。BSC 的登记、绑定和提现花 BNB，记的是 USDT。X Layer 花 OKB，记的是 USDT0。两条链的码不通用，也不能把一边的余额提到另一边。晶体管的码也不和这两条混用。",
      "页面按合约同一套公式列出你邀请了谁、他们的保证金、名义价值和记给你的返佣。可提余额以合约里的数字为准。提现只收整数：1、10、20、50、100、300、500 美元。",
    ],
  },
  {
    h: "印鉴减费",
    ps: [
      "三盏灯不会改永续里已经收走的千分之二。减的那一半从另一份领取合约里领，不从收费地址里扣。",
      `X Layer 的领取合约是 ${LOCKED_REBATE.xlayer}，池子是 USDT0。这个钱包要自己持有三张印鉴，每张 4 个输入、1 个输出、3 个 NAND，点登记才算。`,
      `BSC 的领取合约是 ${LOCKED_REBATE.bsc}，池子是 USDT。BSC 读不到那台处理器，要由部署者把地址记上。`,
      "登记之后，一个新加坡周只能领一次，从周一 0 点到下周一 0 点。页面按撮合日志把这一周里你做多或做空的已成交加起来，领回每笔保证金上手续费的一半。有推荐人时，按少付之后的手续费再减半。金额按代币小数显示成 USDT。同一笔只能进一次。这一周没领，过点作废，下周只算新的成交。晶体管那本账没有撮合时间，不算进这一周。池子是 0，就是这份合约里现在没有币。",
    ],
  },
  {
    h: "晶圆",
    ps: [
      `处理器在 X Layer 上，电路 ${DEPLOYED.circuits}，晶体管 ${DEPLOYED.transistors}。名字是 TAPELIQUID。旁边的 CLK 是页面时钟，不是型号。`,
      "本页一次铸造 16 颗 NAND。钱包停在 X Layer，OKB 付给这台处理器。也可以去 TapeOut 官方的同一台处理器铸造。",
      "个人印鉴是 4 个输入、1 个输出、3 个 NAND。点一次「一键流片」，烧掉 3 颗 NAND，支付 0.0013 OKB，亮一盏灯。三盏颜色不同。满三盏也不会改订单簿里的千分之二。流片不能撤回。",
    ],
  },
  {
    h: "做市和积分",
    ps: [
      "谁都可以挂单。价差、深度和库存没有平台下限。撤单交易失败时，单还在合约里。",
      "做市激励尚未开始。积分和空投尚未开始。这两项没有冻结规则之前，页面不记分，也不发奖励。",
    ],
  },
  {
    h: "风险",
    ps: [
      "三份永续都没有管理员，也没有审计。1000 倍时，标记价轻轻一动就会强平。限价成交之后，结算仍看标记价，不看你填的那个价。",
      "止盈止损只在这台浏览器开着的时候才会请你签名。BSC 的标记价是大约 10 分钟的均价。X Layer 的标记价是推进去的，可能落后于 BSC 上的最后一笔。节点失败时，页面可能暂时读不到挂单，链上的单还在。",
      "只使用你亏得起的钱。这不是招股，不是托管，也不保证成交或盈利。本站没有平台币，也没有挖矿。",
    ],
  },
];

const en: Section[] = [
  {
    h: "The desk",
    ps: [
      "TAPELIQUID does three things: spot, perpetuals, and a wafer. Spot is BEM, BNB, BTC, gold, and OKB against a stablecoin. The first four fill on PancakeSwap on BNB Smart Chain. OKB fills on PotatoSwap on X Layer. There are three perpetual books, each locked to one contract: BEM on BSC, BEM on X Layer, and six transistor markets on BSC. People on the same book can see and take each other's orders. An order on one book cannot fill an order on another.",
      "The paper book lives only in this browser. It is for looking, and it does not move real money. The wafer mints and tapes out on an X Layer processor. It does not settle PnL.",
      "The page does not custody funds. Spot stays in the wallet until you sign. Perpetual margin sits in the contract you picked. You sign in OKX or Binance Wallet. The page never asks for a private key.",
      "The header switches day and night. The choice stays in this browser. It is not written on chain, and it does not change a price or an order.",
    ],
  },
  {
    h: "Spot",
    ps: [
      "Both pairs use PancakeSwap V3. Quotes come from the on-chain quoter. Swaps use the SwapRouter.",
      `The BEM / USDT pool is ${BSC.pool}, pool fee 1%. The BNB / USDT pool is ${BSC.bnbPool}, pool fee 0.01%. A BNB buy lands in the wallet as BNB. A BNB sell leaves about 0.003 BNB for gas.`,
      "OKB trades on PotatoSwap on X Layer, OKB / USDT. A buy lands as OKB. A sell leaves about 0.002 OKB for gas. The desk fee is the same 0.2%. The spot page has a chart. Under it, each fill is a real pool trade, and the address is the wallet that signed it.",
      "BTC is BTCB on BSC, Pancake BTCB / USDT, pool fee 0.01%. Gold is Tether Gold (XAUt), Pancake XAUt / USDT, pool fee 0.05%, one token for one troy ounce. US stocks are Binance bStocks on Pancake against USDT: SPY, QQQ for the Nasdaq-100, Apple, Nvidia, Intel, Microsoft, Tesla, SpaceX, and Google. One token is one share, not the index level. There is no Nasdaq-1000. The spot page switches between crypto and US stocks. The two lists are not in one row.",
      "This desk also takes 0.2% of what you pay. A buy takes it from USDT. A BEM sell takes it from BEM. A BNB sell takes it from BNB. It goes to the one fee address. The rest goes to the pool. The pool's own fee stays with liquidity providers. Gas stays with the chain. Neither goes to the fee address. Spot pays no rebate.",
      "Before you sign, the page shows this order's fee and the least you can receive after 1% slippage. If the balance is short, the button will not ask you to sign. The wallet signs the fee first, then the swap. A BNB buy puts the swap and the unwrap in one transaction.",
      "The spot price is read from the pool every second. The BEM price also feeds the perpetual mark. A perpetual fill is still the price written on the order.",
    ],
  },
  {
    h: "Paper",
    ps: [
      "Paper matching runs in this browser. You can open long, open short, and see leverage and liquidation. The record stays on this device and disappears in another browser.",
      "Remelt clears only the paper book on this device. It does not move USDT, USDT0, or BNB, and it does not cancel an order already on chain.",
      "Paper charges 0.08% to take and 0.02% to make. That fee is only on the paper book. It does not go to the fee address.",
    ],
  },
  {
    h: "Charts",
    ps: [
      `Both BEM charts read the same pool, ${BSC.pool}. A candle is the pool's open, high, low, and close. Paper PnL does not settle on the chart. The perpetual does not settle on the last candle either.`,
      "The paper chart has 1 minute, 5 minutes, 10 minutes, 1 hour, 4 hours, 1 day, and 1 week. The live chart has 15 seconds, 1 minute, 5 minutes, 15 minutes, 1 hour, 4 hours, and 1 day, plus a second row for one week, one month, three months, and one year. About the last 100 candles, with volume, MA7, and MA25. The crosshair shows price and Singapore time. The wheel or the buttons zoom. Empty space pans.",
      "A line or a block is placed with two clicks and stays in this browser. After that it can be dragged, its ends moved, its color changed, deleted, undone, or cleared.",
      "The long or short note beside the chart reads about the last 36 BEM / USDT candles. The number under it is a guessed next price, within 4% of the last price. It is not a score from 0 to 100, and it is not the mark. It can be hidden. It does not promise the next candle.",
      "On the BSC perpetual, the fill is the price on the order. After that, PnL follows about a 10-minute pool average. X Layer has no BEM pool, and the chart still draws the BSC pool, so the chart can lead the X Layer settlement. The transistor page uses the on-chain reference price, not these two charts.",
    ],
  },
  {
    h: "BEM perpetuals",
    ps: [
      `BSC has one contract, ${BSC_REBATE}. Open, take, cancel, and close all go there. Margin is BSC USDT, from 1 to 500. Gas is BNB.`,
      `X Layer has one contract, ${KNOWN_XPERP}. Margin is USDT0 on that chain, 6 decimals, from 1 USD. Gas is OKB. The mark contract is ${KNOWN_XMARK}. An X Layer order cannot fill a BSC order.`,
      "Leverage runs from 1x to 1000x. A beginner uses the sizes and multiples on the page. Advanced mode types the multiple and the price. Leave the price blank and the fill is the mark. The price you type is the fill.",
      "Before you sign, the page shows available balance, this order's fee, and about how much BEM the order opens. From 100x it also says how far the mark has to move the wrong way before half the margin is gone and the position can be liquidated. A short is red.",
      "The market lists quotes nobody has taken. A red row is a short: click the row or Open long. A green row is a long: click the row or Open short. Five quotes stay on each side of the mark. The rest fold. You cannot take your own quote.",
      "An untaken quote can be cancelled. A cancel costs 0.2% of that margin and returns the rest. A matched deal cannot be cancelled. It is closed or liquidated. Closing adds no fee. One side closing or being liquidated settles both sides.",
      "A stop is stored in this browser. While the page is open and the price hits it, the page asks your wallet to sign a close. Close the page and it does not fire. The chain does not store the stop.",
      "Nicknames, your code, and the invite list live under My orders. A nickname stays in this browser. The chain still stores the address.",
    ],
  },
  {
    h: "Transistor perpetual",
    ps: [
      `This page lists six markets: TapeOut, Behemoth, and Genesis CPU, each as NAND and LATCH. There is one contract, ${GATE}. Every order, from any address, at any time, is on this book. Margin is BSC USDT, from 1 to 500.`,
      "The corner is the last on-chain trade recorded by the official feed, in OKB, read about once a second. It is not the mid. If the book read fails, the six prices stay. Before an open, a take, or a close, the page reads the settlement price in the contract. It continues only if that price is within 3% of this last trade. If it is wider, the page pushes the last trade first. If it is still wider than 3% after the push, the order is not sent. The fill is the price on the quote.",
      "The fee is 0.2% of the margin used, the same split as the BEM perpetual. The code has to be confirmed on this contract. A BEM code does not work here. The invite link is this URL plus #gate= and your code. BEM and X Layer use #ref=. Opening the link does not bind. Binding still needs a confirmation, and it cannot be changed after that.",
    ],
  },
  {
    h: "The mark",
    ps: [
      "The BSC BEM mark is about a 10-minute average of the pool. The fill and the settlement are allowed to differ. That is there to ignore a one-trade spike.",
      "X Layer has no such pool. The mark lives in its own contract. The page reads the BSC price and pushes it, at most a small step every 30 seconds. PnL settles on the pushed price. Anyone can pay OKB to push. The contract decides whether the push is early.",
      "The result uses the on-chain mark, not the last candle.",
    ],
  },
  {
    h: "Fees and rebates",
    ps: [
      `Spot, a match on any of the three perpetuals, and a cancel all pay this desk 0.2%. There is one fee address: ${FEE_TO}. It cannot change a contract, and it cannot take margin that is still locked. Closing adds no fee.`,
      "With a referrer, the perpetual fee splits again: the trader pays 4% less of it, the referrer is credited 6% of it, and the rest goes to the fee address. The split is in the contract. Spot is not part of this split.",
      "The Pancake pool's own fee, and gas in BNB or OKB, do not go to this address.",
      "Rebates are on chain. On BSC, registering, binding, and claiming spend BNB and the credit is USDT. On X Layer they spend OKB and the credit is USDT0. A code does not work on the other chain, and a balance cannot be claimed on the other chain. The transistor code is separate from both.",
      "The page lists who you invited, their margin, the notional, and the rebate credited to you, using the contract's own formula. The claimable balance is the number in the contract. Claims are whole amounts of 1, 10, 20, 50, 100, 300, or 500 USD.",
    ],
  },
  {
    h: "Seal rebate",
    ps: [
      "Three lamps do not change the 0.2% already taken by the perpetual. The half you get back is paid from a separate claim contract. It is not taken out of the fee address.",
      `The X Layer claim contract is ${LOCKED_REBATE.xlayer} and holds USDT0. The wallet must own three seals, each with 4 inputs, 1 output, and 3 NAND gates, and register them.`,
      `The BSC claim contract is ${LOCKED_REBATE.bsc} and holds USDT. BSC cannot read that processor, so the deployer marks the address.`,
      "After that, one claim is allowed per Singapore week, Monday 00:00 to the next Monday 00:00. The page adds the matched fills in that week where you are long or short, and pays half the fee on each margin. With a referrer, that half is of the already discounted fee. The number is shown in USDT after the token decimals. A deal is included once. Miss the week and it is gone. The next week counts only new fills. The transistor book stores no match time, so it is not in the week. A pool at 0 means that contract currently holds no tokens.",
    ],
  },
  {
    h: "Wafer",
    ps: [
      `The processor is on X Layer. Circuits ${DEPLOYED.circuits}. Transistors ${DEPLOYED.transistors}. The name is TAPELIQUID. The CLK beside it is a page clock, not a model number.`,
      "This page mints 16 NAND at a time. The wallet stays on X Layer, and the OKB is paid to this processor. The same processor can also be minted from official TapeOut.",
      "A personal seal is 4 inputs, 1 output, and 3 NAND gates. One tap of Tape out burns 3 NAND, pays 0.0013 OKB, and lights one lamp. The three lamps are different colors. Three lamps do not change the 0.2% on the book. A tape-out cannot be undone.",
    ],
  },
  {
    h: "Making and points",
    ps: [
      "Anyone can post a quote. There is no platform minimum for spread, depth, or inventory. If a cancel transaction fails, the quote stays in the contract.",
      "Maker rewards have not started. Points and airdrops have not started. Until those rules are frozen, the page keeps no score and pays no reward.",
    ],
  },
  {
    h: "Risk",
    ps: [
      "None of the three perpetuals has an admin, and none has been audited. At 1000x a small mark move liquidates the position. After a limit fill, settlement still uses the mark, not the price you typed.",
      "A stop asks for a signature only while this browser is open. The BSC mark is about a 10-minute average. The X Layer mark is pushed, so it can lag the last BSC trade. If a node fails, the page may hide orders that are still on chain.",
      "Use only money you can lose. This is not an offering, not custody, and not a promise of a fill or a profit. This desk has no platform token and no mining.",
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
            ? "这一页只写现在这一版交易台。现货、三本永续、返佣和晶圆，都按页面上真能签的那一套。"
            : "This page describes the desk as it trades now. Spot, the three perpetuals, rebates, and the wafer match what the page can actually sign."}
        </p>
      </header>
      <nav className="grid border-b border-gold sm:grid-cols-2" aria-label={lang === "zh" ? "目录" : "Contents"}>
        {sections.map((section, i) => (
          <a key={section.h} href={`#paper-${i}`} className="flex min-h-11 items-center gap-3 border-gold/40 px-4 py-2 text-sm hover:bg-paper sm:odd:border-r">
            <span className="font-mono text-xs text-gold">{String(i + 1).padStart(2, "0")}</span>
            {section.h}
          </a>
        ))}
      </nav>
      <div className="grid gap-3 border-b border-gold px-5 py-4 sm:grid-cols-2 sm:px-8">
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${BSC.explorer}/address/${BSC_REBATE}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">BSC · BscScan</span>
          <span className="mt-1 block break-all font-mono text-xs">{BSC_REBATE}</span>
        </a>
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${XLAYER.explorer}/address/${KNOWN_XPERP}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">X Layer · OKLink</span>
          <span className="mt-1 block break-all font-mono text-xs">{KNOWN_XPERP}</span>
        </a>
      </div>
      <div className="flex flex-col gap-8 px-5 py-7 sm:px-8">
        {sections.map((section, i) => (
          <section key={section.h} id={`paper-${i}`} className="scroll-mt-28 border-t border-gold/40 pt-4">
            <h3 className="font-display text-3xl italic">
              <span className="mr-3 font-mono text-sm not-italic text-gold">{String(i + 1).padStart(2, "0")}</span>
              {section.h}
            </h3>
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

