import { BSC_REBATE, KNOWN_PERP, KNOWN_XMARK, KNOWN_XPERP } from "@/lib/perp";
import { GATE } from "@/lib/gate-chain";
import { BSC, FEE_TO } from "@/lib/bsc";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

type Section = { h: string; ps: string[] };

const zh: Section[] = [
  {
    h: "摘要",
    ps: [
      "TAPELIQUID 是给 BEM 用的交易台。现货在 BNB Smart Chain 的 PancakeSwap 上真成交。模拟盘只活在这台浏览器里。永续有两本账，各锁一份合约：BSC 用 USDT，X Layer 用 USDT0。同一条链上的人能看见并吃彼此的单。两条链的单不能合成一笔。",
      "晶圆在 X Layer 上铸造和流片，地址和两本永续不是同一个。晶圆今天不参与盈亏。以后，晶圆上的晶体管和已流片电路会成为挖矿资格，挖出的是本站自己的平台币。矿池还没部署，现在流片不会发出任何平台币。",
      "钱不进这个网页。现货留在你的钱包，直到你签名。永续的保证金进你选的那一份合约。页面只负责读链、报价和让你签名。",
      "页首可以在白天和黑夜之间换。选择记在这台浏览器里，不写上链，也不改价格和订单。",
    ],
  },
  {
    h: "这几张桌子",
    ps: [
      "现货：买进或卖出 BEM。成交对手是 Pancake 的池子，不是另一个用户的挂单。",
      "模拟：用来看盘口、下纸单、试爆仓。重熔只清空这台设备上的模拟账，不动 USDT、USDT0，也不动永续合约。",
      "合约：先选 BSC 或 X Layer。挂单写进那一条链的固定合约。别人打开同一页，就能看见并吃单。吃到的是对手，不是池子。红的是空单，点整行或「开多吃」。绿的是多单，点整行或「开空吃」。和晶体管盘口同一套字。靠近现价的上下各留 5 张，其余折起来。",
      "对手昵称、链上返佣、自己的推荐码、填写别人的码、邀请名单，都在「我的订单」。市场页只留盘口、K 线和开仓。昵称和邀请人多了也可以展开。",
      "晶圆：处理器已经部署。铸造 NAND 可以在本页签，也可以去 TapeOut 官方的这台处理器。流片烧的是 OKB 和晶体管，不能撤回。电路不结算永续。",
    ],
  },
  {
    h: "现货",
    ps: [
      "交易对是 BEM / USDT，池子在 PancakeSwap V3。报价读链上 Quoter，成交走 SwapRouter。本台不托管，签名之前币在你的钱包里。",
      "本台另收成交金额的千分之二。买入从付出的 USDT 里扣，卖出从付出的 BEM 里扣，打进同一个收费地址。剩下的才进池子。池子自己的手续费留给流动性提供者，gas 付给链，这两笔不进收费地址。",
      "现货价每秒读这口池子，显示到小数点后 4 位。它只给永续当标记来源。永续的成交价仍是挂单上写的那个价。",
    ],
  },
  {
    h: "模拟",
    ps: [
      "模拟撮合跑在浏览器里。它用来熟悉开多、开空、杠杆和爆仓长什么样。记录存在这台设备上，换浏览器就没了。",
      "重熔的意思是把模拟账本烧掉重来。它不会去链上，不会转走真实的钱，也不会撤掉你已经挂在 BSC 或 X Layer 上的单。",
    ],
  },
  {
    h: "两张 K 线",
    ps: [
      "两张图看的是同一口 PancakeSwap V3 的 BEM / USDT 池，池子地址 0x3098d7a051045000d68ec0360753a40c8cabea31。柱子来自池子成交的开高低收，不是本站订单簿自己撮出来的价。模拟盘的盈亏不按这张图结算。真实合约的盈亏也不按最后一根柱子结算。图用来看价格走过哪里。",
      "模拟图在模拟页。周期是 1 分、5 分、10 分、1 时、4 时、1 日、1 周。1 分大约每 15 秒重读，其余大约每分钟重读。图上是最近约 100 根。阳线空心金边，阴线朱红实心。下面是成交量。金线是 MA7，灰线是 MA25。十字线跟着指针，右边标出价格，底边是新加坡时间。最右边那根的收盘会跟着池子现价走。换浏览器，模拟仓没了，这张图还在，因为它读的是池子，不是你的纸账。",
      "真实合约图和模拟图是同一套画法，放在盘口上面。短周期是 15 秒、1 分、5 分、15 分、1 时、4 时。长周期单独一排：一周、一月、三月、一年，按新加坡日历把日线并起来。最近约 100 根，带成交量、MA7 和 MA25。虚金线是已对上仓的开仓价，细线是标记价。十字线只用来读图。池子一时读不到时，若标记价还在，就用开仓价和标记价画一根，这根不是成交。",
      "看图和结算要分开。BSC 上，开仓价是挂单写的价。之后盈亏跟大约 10 分钟的池子均价，不跟图上最后一笔。X Layer 上没有这口 BEM 池，标记价是推进去的，图仍然画 BSC 池子，所以图可以比 X Layer 的结算价快。晶体管页用官网参考价，不用这两张 K 线。",
      "两张图都可以点「画线」或「区块」，点两次就落上一笔，存在这台浏览器里。图上空白处可以左右拖。滚轮或放大、缩小按钮改一根柱子的粗细。鼠标停在哪一根，左上角写出新加坡时间。真实合约短周期下面另有一排：一周、一月、三月、一年。拖到最右是最新。线下面是深度，买盘在左，卖盘在右，同样可以左右拖，放大缩小也用按钮。落上之后按住就能拖，拖圆点改端点，点色块换颜色，也可以删除、撤销或清空。旁边的看多或看空，是最近约 36 根 BEM/USDT K 线的倾向。下面的数字是猜的下一截 BEM 价格，不是 0 到 100 的强度，也不是标记价。带服务器的网页由大模型写三句解析。DEWEB 没有模型服务器，浏览器按同一段 K 线自己算出看多或看空，预测价同样离现价不超过 4%。可以隐藏。不保证下一根。",
    ],
  },
  {
    h: "BSC 永续",
    ps: [
      "全站只有一份 BSC 合约。开多、开空、吃单、撤单、平仓都打到这个地址，所以任何人、任何时候打开这一页，看到的是同一本账。",
      "保证金是 BSC 上的 USDT，从 1 到 500。杠杆从 1 倍到 1000 倍。新手可以用 1、5、10 USDT 和页面上的倍数。要自己写，就切到高级，手填倍数和开单价。",
      "你填写的价格就是成交价。不填，就用当时的标记价。成交之后，盈亏跟着 Pancake 池大约 10 分钟的标记价走。标记价轻轻动一下，1000 倍就会碰到强平线。亏到大约一半保证金，仓就可以被强平。",
      "自己的单不能自己吃。一边平仓或强平，两边一起结算。合约没有管理员，也不能升级。",
    ],
  },
  {
    h: "吃单、撤单、平仓",
    ps: [
      "市场页列出还没有人接的挂单，带地址、方向、保证金、倍数和开单价。点吃单，你成为对面。两笔保证金锁进同一份合约。",
      "个人订单页只看你自己的挂单和已经对上的仓。还没人接的单可以撤。撤单收这张保证金的千分之二，剩下的退回。对上之后不能撤，只能平仓或等强平。",
      "平仓不再另收一笔手续费。盈亏按平仓时的标记价，把两边的保证金重新切开。你可以给对手地址起一个只存在这台浏览器里的昵称，链上仍然是那个地址。",
      "三盏印鉴灯不会自动改这千分之二。减费在写死的领取合约里，不在收费地址。X Layer 是 0x62abA5CD9B6C371e7c443C79934B8644d60481d7，池子是 USDT0。BSC 是 0x0FcC922739a565804Ea57BDB44Bc2503E80Fce7A，池子是 USDT。页面不再部署新的一份，换浏览器地址也不变。X Layer 上要这个钱包自己持有三张印鉴，每张 4 个输入、1 个输出、3 个 NAND，点登记才算。BSC 读不到这台处理器，要由部署者把地址记上。登记之后，一个新加坡周只能领一次，从周一 0 点到下周一 0 点。页面按撮合日志把这一周里你做多或做空的已成交加起来，领回每笔保证金上手续费的一半。有推荐人时，按少付之后的手续费再减半。金额用代币小数换成 USDT 显示。同一笔只能进一次。这一周没领，过点作废，下周只算新的成交。晶体管那本账没有撮合时间，不算进这一周。池子显示 0 就是这份合约里现在没有币。充进别的地址的钱不会跟着页面搬过来。",
    ],
  },
  {
    h: "X Layer 永续",
    ps: [
      "X Layer 另有一份合约，不和 BSC 共用订单簿。保证金是这条链上的 USDT0，6 位小数，从 1 美元起。Gas 是 OKB。BSC 里的 USDT 和 BNB 在这一页扣不到。",
      "开多、开空、吃单、撤单、平仓都打到这一个地址。停在 X Layer 的人能看见并吃彼此的单。一条 X Layer 的单不能去填一条 BSC 的单。",
      "杠杆、费用、返佣档位和强平规则与 BSC 相同。两本账各自结算，返佣也不能跨链提。",
    ],
  },
  {
    h: "晶体管合约",
    ps: [
      "合约和晶圆中间这一页只做六个标：TapeOut、Behemoth、Genesis CPU，各有 NAND 和 LATCH。右上角是官网参考价，每秒更新。中间的盘口是本站自己的。开多、开空、吃单、撤单、平仓都要钱包签名，从钱包划走或退回 BSC 的 USDT，最少 1，最多 500。没有签名的单不算。",
      "下单、吃单、平仓之前，页面先看合约里的结算价。和官网价相差不超过 3% 才继续。差得更多就先把官网价推进去。推进不了，或者推进之后仍超过 3%，这一笔不做，避免按错价分钱。合约本身仍是第一次写入可以由任何人定，页面不跟那个错价。写进去之后，链上每 10 秒最多再动一半。成交按挂单价。",
      "手续费是用掉的保证金的千分之二。有推荐人时，交易者少付其中 4%，推荐人记其中 6%，剩下的进开发者地址。比例和 BEM 永续相同，但是推荐码要在这份晶体管合约上重新确认一次，不能拿 BEM 那份码直接用。提到的是 BSC 的 USDT，不能和 BEM 的返佣混提。门槛是 1、10、20、50、100、300、500。",
      "确认自己的码之后，页面生成邀请链接，形式是当前网址加 #gate=你的码。朋友打开会进晶体管页，码已经填好，仍要点绑定才写上链。只打开链接不会绑定。BEM 和 X Layer 的链接仍是 #ref=，两套码不要混用。",
      "全站只有这一份晶体管永续：0xc075443ab7ebef86fe044be2c93a4ff4376ffe0b。任何地址、任何时候挂的单都在这一本账上，别人随时可以吃。页面不再让用户另外部署。部署过的人不能改规则，也不能动别人还锁着的保证金。三个标的的现货合约仍是 TapeOut 0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087、Behemoth 0xE2DfD802081C7a05341E20b6582b04b908e8550c、Genesis CPU 0x1d23Bf70ec6bAAD95f396Ea38f8A8415119dFDE6。那是官网的现货，不是我们的永续。",
    ],
  },
  {
    h: "标记价",
    ps: [
      "BSC 的标记价直接读 BEM / USDT 池的大约 10 分钟均价。短线成交价和结算价会不一致，这是故意的，用来挡住瞬时插针。",
      "X Layer 上没有这份 BEM 池。标记价由一份单独的标记合约保存。页面从 BSC 的池子读出现价，再推进去。每 30 秒最多挪一点。盈亏按推进后的价结算。谁都可以付 OKB 把价格推进一次，推不推得动由合约里的时间限制决定。",
      "K 线的周期和读法写在上面「两张 K 线」。输赢以链上标记价为准，不以图上的最后一根为准。",
    ],
  },
  {
    h: "费用",
    ps: [
      "现货、永续撮合、撤单，本台费率都是千分之二，收款地址只有一个。",
      "现货在签名时从付出的币里划走千分之二。永续在撮合和撤单时，从已用保证金里收千分之二。平仓不再另收。",
      "有推荐人时，永续这笔手续费再拆开：交易者少付其中 4%，推荐人记其中 6%，剩下的进收费地址。比例写在合约里。现货不参与返佣。",
      "Pancake 池子自己的手续费，以及 BNB、OKB 的 gas，不进这个地址。",
    ],
  },
  {
    h: "返佣",
    ps: [
      "返佣在链上，不在客服手里。推荐码只登在你当前这条链的全站合约上。BSC 的登记、绑定和提现花 BNB，记的是 BSC 的 USDT。X Layer 花 OKB，记的是 USDT0。两条链的码不通用，也不能把一边的余额提到另一边。别人填你的码，要再确认一次。确认之后不能改。登在私人合约里的码，别人查不到。",
      "BSC 上能写推荐码的是带返佣的那一份新合约。更早那份合约没有返佣函数，码写不进去，但它里面已经挂出的单仍然可以吃。新开的 BSC 单进新合约，手续费和返佣都在新合约里结算。",
      "页面按成交和撤单当时的绑定关系，用合约同一套公式列出你邀请了谁、他们拿出的保证金、名义价值和记给你的返佣。可提余额以合约里的数字为准。提现只收整数。档位是 1、10、20、50、100、300、500 美元。",
    ],
  },
  {
    h: "晶圆",
    ps: [
      "页面上的处理器名字是 TAPELIQUID，没有标本编号。以前写过的 TAPELIQUID-7 和标本 07 已经拿掉。旁边的 CLK 是页面时钟，补零到 6 位，数字会往上走，不是型号。",
      "处理器已经在 X Layer 上，地址写在文末，不用再部署一台。铸造有两条路。本页一次铸造 16 颗 NAND，钱包要停在 X Layer，签名在 OKX 或币安钱包里完成，OKB 付给这台处理器。官方入口是 TapeOut 上的同一台处理器，在晶体管市场铸造，收款地址也是这台处理器，不进交易所。",
      "流片有两条路。本页的个人印鉴是 4 个输入、1 个输出、3 个 NAND，点一次烧掉 3 颗 NAND 并支付 0.0013 OKB，亮一盏灯，三盏颜色不同。也可以打开 TapeOut 画布，目标处理器选 TAPELIQUID，自己接线再流片上链。流片不能撤回。电路地址和两份永续不是同一个。",
      "三盏灯不会改永续里写死的千分之二。领取合约地址已经写死：X Layer 0x62abA5CD9B6C371e7c443C79934B8644d60481d7，BSC 0x0FcC922739a565804Ea57BDB44Bc2503E80Fce7A。池子要先充钱。X Layer 由持有人拿三张合格印鉴登记。BSC 由部署者记地址。一个新加坡周领一次。页面只加总本周撮合日志里的成交，按代币小数显示成 USDT，领的是手续费的一半。有推荐人时按少付后的手续费再减半。过了下周一 0 点没领就作废，下周重新计算。晶体管账没有撮合时间，不进这一周。晶圆上的电路今天不结算永续盈亏，也不增加保证金。",
    ],
  },
  {
    h: "以后的挖矿和平台币",
    ps: [
      "晶圆以后可以用来挖矿。挖出来的是本站自己的平台币，不是 BEM，也不是 USDT 或 USDT0。",
      "资格挂在晶圆上。处理器里的晶体管，和已经流片的电路，按届时写死的合约计算权重。没有晶圆的地址，不能因为在这里做了永续就自动有矿。",
      "现在还没有矿池合约，也没有平台币合约。打开这个页面、做现货、做永续、铸造或流片，都不会发出平台币。总量、释放、减半和领取，等合约部署并锁进这一页之后才算数。这一节不预先许诺数字，也不保证价格。",
    ],
  },
  {
    h: "要接上的生态",
    ps: [
      "已经在跑的是四块：BEM 现货、浏览器里的模拟、两本共享永续账、X Layer 上的晶圆。返佣和昵称已经接在永续旁边。",
      "后面按这个顺序长，每一块上线前都会先改这一页。现货从 BEM 扩到更多 TapeOut 资产。X Layer 的标记价可以从推进价换成这条链自己的池子。平台币上线之后，可以接手续费折扣和做市库存，不接对利润的保证。",
      "前端可以放到 TapeOut 的 DeWeb 上。网站文件写进一枚电路的容器，谁持有那枚电路，谁就能更新网站。卖掉电路，网站的管理权跟着走。订单簿不跟着走，订单簿在两份永续合约里。",
      "再往后是电路容器之间的消息，以及更多链上的同一本账。没写进合约之前，页面不会假装已经开通。",
    ],
  },
  {
    h: "已经锁死的地址",
    ps: [
      `BSC 旧永续 ${KNOWN_PERP}。不再收新单。`,
      `BSC 永续 ${BSC_REBATE}。新开的 BSC 单、推荐码和提现都锁在这里。保证金是 BSC 的 USDT，gas 是 BNB。`,
      `X Layer 永续 ${KNOWN_XPERP}。新开的 X Layer 单锁在这里。保证金是 USDT0，gas 是 OKB。标记价合约 ${KNOWN_XMARK}。`,
      `晶体管永续 ${GATE}。六个标的的多空锁在这里。保证金是 BSC 的 USDT。`,
      `晶圆电路 ${DEPLOYED.circuits}。晶体管 ${DEPLOYED.transistors}。这是 X Layer 上的处理器，不是永续。`,
      `收费地址 ${FEE_TO}。现货和三份永续的千分之二都进这里。它不能改合约，也不能动还锁着的保证金。`,
      "印鉴领取已经写死。X Layer 0x62abA5CD9B6C371e7c443C79934B8644d60481d7，池子是 USDT0。BSC 0x0FcC922739a565804Ea57BDB44Bc2503E80Fce7A，池子是 USDT。页面不再部署新地址。",
    ],
  },
  {
    h: "风险",
    ps: [
      "两份永续都没有管理员，也没有审计。1000 倍时，标记价轻轻一动就会强平。限价成交之后，结算仍看标记价，不看你填的那个价。",
      "BSC 的标记价是大约 10 分钟的均价。X Layer 的标记价是推进去的，可能落后于 BSC 上的最后一笔成交。节点失败时，页面可能暂时读不到挂单，链上的单还在。",
      "只使用你亏得起的钱。这不是招股，不是托管，也不保证成交、上线进度或盈利。挖矿和平台币在合约锁定之前都不存在。",
    ],
  },
];

const en: Section[] = [
  {
    h: "Abstract",
    ps: [
      "TAPELIQUID is a BEM desk. Spot fills on PancakeSwap on BNB Smart Chain. The paper book lives only in this browser. The perpetual has two ledgers, each locked to one contract: USDT on BSC, USDT0 on X Layer. People on the same chain can see and take each other's orders. An order on one chain cannot fill an order on the other.",
      "The wafer mints and tapes out on X Layer. Its address is not either perpetual. The wafer does not change PnL today. Later, transistors and taped circuits become mining weight for this desk's own platform token. No mining contract is deployed. Taping out now does not mint that token.",
      "Funds do not sit in the page. Spot stays in your wallet until you sign. Perp margin sits in the contract you picked. The page reads the chain, shows a price, and asks you to sign.",
      "The header switches day and night. The choice stays in this browser. It is not written on chain, and it does not change a price or an order.",
    ],
  },
  {
    h: "The desks",
    ps: [
      "Spot: buy or sell BEM. The counterparty is the Pancake pool, not another person's order.",
      "Paper: the book, paper tickets, and practice liquidations. Remelt clears only the paper book on this device. It does not move USDT, USDT0, or a live order.",
      "Perp: pick BSC or X Layer. The order is written to that chain's fixed contract. Anyone who opens the page can see it and take it. The counterparty is a person. A red row is a short: click the row or Open long. A green row is a long: click the row or Open short. The words match the transistor book. Five quotes stay on each side of the mark. The rest fold.",
      "Nicknames, on-chain rebates, your code, someone else's code, and the invite list live under My orders. The market page keeps the book, the chart, and the ticket. Long nickname and invite lists fold too.",
      "Wafer: the processor is already deployed. Mint NAND on this page, or on this same processor at official TapeOut. Tape-out spends OKB and transistors and cannot be undone. A circuit does not settle the perpetual.",
    ],
  },
  {
    h: "Spot",
    ps: [
      "The pair is BEM / USDT on PancakeSwap V3. Quotes come from the on-chain quoter. Swaps use the SwapRouter. This desk does not custody. Tokens stay in your wallet until you sign.",
      "This desk also takes 0.2% of the amount you pay. A buy takes it from USDT. A sell takes it from BEM. It is sent to the one fee address. The rest goes to the pool. The pool's own fee stays with liquidity providers. Gas stays with the chain. Neither of those goes to the fee address.",
      "The spot price is read from that pool every second and shown to four decimals. It only feeds the perpetual mark. A perpetual fill is still the price written on the order.",
    ],
  },
  {
    h: "Paper",
    ps: [
      "The paper matcher runs in the browser. It is there so a long, a short, leverage, and a liquidation have a shape before real money is used. The record stays on this device.",
      "Remelt burns the paper book and starts again. It does not go on chain, does not move real money, and does not cancel an order already posted on BSC or X Layer.",
    ],
  },
  {
    h: "Two charts",
    ps: [
      "Both charts read the same PancakeSwap V3 BEM / USDT pool, 0x3098d7a051045000d68ec0360753a40c8cabea31. A candle is the pool's open, high, low, and close. It is not a price invented by this desk's book. Paper PnL does not settle on the chart. The perpetual does not settle on the last candle either. The chart shows where price has been.",
      "The paper chart sits on the paper page. The frames are 1 minute, 5 minutes, 10 minutes, 1 hour, 4 hours, 1 day, and 1 week. The 1-minute frame is reread about every 15 seconds. The others about once a minute. About the last 100 candles are drawn. An up candle is hollow gold. A down candle is solid vermilion. Volume sits underneath. The gold line is MA7 and the grey line is MA25. The crosshair follows the pointer, the price sits on the right, and the clock is Singapore time. The last close follows the live pool quote. Change browsers and the paper position is gone. The chart remains, because it reads the pool, not your paper book.",
      "The perpetual chart uses the same drawing as the paper chart and sits above the book. Short frames are 15 seconds, 1 minute, 5 minutes, 15 minutes, 1 hour, and 4 hours. A second row is one week, one month, three months, and one year, folded from daily candles on the Singapore calendar. About the last 100 candles are drawn, with volume, MA7, and MA25. The dashed gold line is the entry of a matched position. The thin line is the mark. The crosshair is only for reading. If the pool cannot be read and a mark is still there, one candle is drawn from the entry to the mark. That candle is not a trade.",
      "Looking and settling are different. On BSC the fill is the price written on the order. After that, PnL follows about a 10-minute pool average, not the last print on the chart. X Layer has no BEM pool. Its mark is pushed. The chart still draws the BSC pool, so it can run ahead of the X Layer settlement price. The transistor page uses the official mark. It does not use these two charts.",
      "Either chart can take a line or a zone. Two taps place one, and it stays in this browser. Empty space drags the chart sideways. The wheel or the zoom buttons change how many candles fit. The cursor shows the Singapore time of that candle. The live perpetual has a second row: one week, one month, three months, and one year. The right edge is the latest. Under the candles is depth: bids on the left, asks on the right. That picture pans the same way, and its zoom is the buttons too. After it is placed, hold it to drag. Drag a dot to reshape it, and pick a color. Delete, undo, and clear remove marks. The long or short beside the chart is a lean on about the last 36 BEM/USDT candles. The figure under it is a guessed next BEM price, not a score from 0 to 100 and not the mark. The hosted site asks the model for three sentences. DEWEB has no model server, so the browser makes the same lean from those candles, and the guess still stays within 4% of the live price. It can be hidden. It does not promise the next candle.",
    ],
  },
  {
    h: "BSC perpetual",
    ps: [
      "There is one BSC contract. Longs, shorts, takes, cancels, and closes all use it, so anyone who opens the page sees the same book.",
      "Margin is BSC USDT, from 1 to 500. Leverage is 1x to 1000x. A new trader can use 1, 5, or 10 USDT and the levers on the page. The advanced ticket takes a typed leverage and a typed price.",
      "The price on the order is the fill. Leave it blank and the fill is the mark at that moment. After the fill, PnL follows the Pancake mark, about a 10-minute average. At 1000x a small mark move reaches liquidation. About half the margin lost and the position can be liquidated.",
      "You cannot take your own order. One close or liquidation settles both sides. The contract has no admin and cannot be upgraded.",
    ],
  },
  {
    h: "Take, cancel, close",
    ps: [
      "The market lists untaken quotes with the address, side, margin, leverage, and price. Taking one makes you the other side. Both margins lock in the same contract.",
      "The personal page shows only your quotes and your open deals. An untaken quote can be cancelled. A cancel costs 0.2% of that margin and returns the rest. A matched deal cannot be cancelled. It is closed or liquidated.",
      "Closing does not add another fee. PnL uses the mark at close and splits the two margins. You can nickname a counterparty on this browser. The chain still stores the address.",
      "Three seal lamps do not change the 0.2% by themselves. The rebate addresses are locked. X Layer is 0x62abA5CD9B6C371e7c443C79934B8644d60481d7 and holds USDT0. BSC is 0x0FcC922739a565804Ea57BDB44Bc2503E80Fce7A and holds USDT. The page does not deploy a new one, and another browser does not change the address. On X Layer the wallet must own three seals, each with 4 inputs, 1 output, and 3 NAND gates, and register them. BSC cannot read that processor, so the deployer marks the address. After that, one claim is allowed per Singapore week, Monday 00:00 to the next Monday 00:00. The page adds the matched fills in that week where you are long or short, using the match log, and pays half the fee on each margin. With a referrer, that half is of the already discounted fee. The number is shown in USDT after the token decimals. A deal is included once. Miss the week and it is gone. The next week counts only new fills. The transistor book stores no match time, so it is not in the week. A pool reading 0 means that contract holds nothing. Tokens sent to a different address stay there.",
    ],
  },
  {
    h: "X Layer perpetual",
    ps: [
      "X Layer has its own contract and does not share the BSC book. Margin is USDT0 on this chain, 6 decimals, from 1 USD. Gas is OKB. BSC USDT and BNB are not spent on this tab.",
      "Longs, shorts, takes, cancels, and closes all use this one address. People who stay on X Layer can see and take each other's orders. An X Layer order cannot fill a BSC order.",
      "Leverage, fees, rebate steps, and liquidation match BSC. The two books settle separately. A rebate cannot be claimed on the other chain.",
    ],
  },
  {
    h: "Transistor contracts",
    ps: [
      "The page between the perpetual and the wafer lists six markets only: TapeOut, Behemoth, and Genesis CPU, each with NAND and LATCH. The official mark sits at the top and updates every second. The book in the middle is ours. A long, short, take, cancel, or close asks the wallet to sign and moves BSC USDT, from 1 to 500. An order without a signature does not count.",
      "Before an open, a take, or a close, the page reads the mark stored in the contract. It continues only when that mark is within 3% of the official price. A wider gap is pushed toward the official price first. If the push cannot land inside 3%, the order does not go through, so money is not split at the wrong price. The contract still lets anyone write the first mark. This page will not follow a wrong one. After a mark is stored, the chain allows at most a 50% move every 10 seconds. A fill uses the resting price.",
      "The fee is 0.2% of the margin that was used. With a referrer, the trader pays 4% less of that fee and the referrer is credited 6%. The rest goes to the developer. The split matches the BEM perpetual, but the code has to be confirmed again on this transistor contract. A BEM code does not carry over. Claims are BSC USDT and cannot be mixed with a BEM rebate. The steps are 1, 10, 20, 50, 100, 300, and 500.",
      "After the code is confirmed, the page makes an invite link: the current address plus #gate= and the code. A friend who opens it lands on the transistor page with the code filled in, and still has to press bind. Opening the link does not bind by itself. BEM and X Layer links stay #ref=. The two codes are not interchangeable.",
      "There is one transistor perpetual for the whole desk: 0xc075443ab7ebef86fe044be2c93a4ff4376ffe0b. An order from any address, at any time, sits on that one book and can be taken. The page does not ask anyone to deploy another copy. The deployer cannot change the rules and cannot take margin that is still locked. The spot contracts remain TapeOut 0xCC42ba5De07f01B472a5b14cF45aBcCA79Eb8087, Behemoth 0xE2DfD802081C7a05341E20b6582b04b908e8550c, and Genesis CPU 0x1d23Bf70ec6bAAD95f396Ea38f8A8415119dFDE6. Those are the official spot tokens, not this perpetual.",
    ],
  },
  {
    h: "The mark",
    ps: [
      "The BSC mark is read from the BEM / USDT pool, about a 10-minute average. The last trade and the settlement price can differ. That is intentional. It is there to dull a one-block wick.",
      "X Layer has no BEM pool. The mark lives in a separate contract. The page reads the BSC pool and pushes that tick. It can move at most a small step every 30 seconds. PnL settles on the pushed price. Anyone can pay OKB to push. The contract decides whether the push is early.",
      "The chart has 15 seconds through 4 hours, and a second row for one week, one month, three months, and one year. The chart is for looking. The result uses the on-chain mark, not the last candle. How the two charts differ is written above, under Two charts.",
    ],
  },
  {
    h: "Fees",
    ps: [
      "Spot, a perp match, and a cancel all pay this desk 0.2%. There is one fee address.",
      "Spot takes 0.2% from the tokens you pay, when you sign. A perp takes 0.2% of the margin used, on a match and on a cancel. Closing does not add another fee.",
      "With a referrer, the perp fee splits again: the trader pays 4% less of it, the referrer is credited 6% of it, and the rest goes to the fee address. The split is in the contract. Spot does not pay a rebate.",
      "The Pancake pool's own fee, and gas in BNB or OKB, do not go to this address.",
    ],
  },
  {
    h: "Rebates",
    ps: [
      "Rebates are on chain. A code is registered only on the shared contract of the chain you are on. BSC registration, binding, and claims spend BNB and pay BSC USDT. X Layer spends OKB and pays USDT0. A code does not cross, and a balance cannot be claimed on the other chain. The other person confirms once. After that it cannot be changed. A code on a private contract cannot be found.",
      "The BSC contract that can store a code is the newer one. The older contract has no rebate functions. Orders already posted there can still be taken. A new BSC order goes to the new contract, and its fee and rebate settle there.",
      "The page lists who bound your code, the margin they posted, the notional, and the rebate credited to you, using the contract's own formula at the block of the fill or cancel. The claimable balance is the number stored in the contract. Claims are whole amounts of 1, 10, 20, 50, 100, 300, or 500 USD.",
    ],
  },
  {
    h: "Wafer",
    ps: [
      "The name on the page is TAPELIQUID. There is no specimen number. TAPELIQUID-7 and Specimen 07 are gone. CLK beside it is the page clock, padded to 6 digits. The number counts up. It is not a model number.",
      "The processor is already on X Layer. The address is at the end of this paper. Do not deploy another one. There are two ways to mint. This page mints 16 NAND at a time. The wallet stays on X Layer, you sign in OKX or Binance Wallet, and the OKB is paid to this processor. The official entrance is the same processor on TapeOut, in the transistor market. That payment also goes to the processor, not to an exchange.",
      "There are two ways to tape out. The seal on this page is four inputs, one output, and three NAND gates. One tap burns 3 NAND and pays 0.0013 OKB, and lights one lamp. The three lamps are different colors. Or open the TapeOut canvas, choose TAPELIQUID as the target processor, wire it yourself, and tape it on chain. Tape-out cannot be undone. The circuit address is not either perpetual.",
      "Three lamps do not change the 0.2% written into the perpetual. The rebate addresses are locked: X Layer 0x62abA5CD9B6C371e7c443C79934B8644d60481d7, BSC 0x0FcC922739a565804Ea57BDB44Bc2503E80Fce7A. The pool has to be funded. On X Layer the holder registers three qualifying seals. On BSC the deployer marks the address. One claim per Singapore week. The page totals only this week's match-log fills, shows the amount in USDT after the token decimals, and pays half the fee. With a referrer, half of the discounted fee. Unclaimed value is dropped at the next Monday 00:00 and the next week is counted again. The transistor book has no match time, so it is left out. A taped circuit does not settle perpetual PnL and does not add margin.",
    ],
  },
  {
    h: "Mining and the platform token, later",
    ps: [
      "Wafers will be usable for mining. The output is this desk's own platform token. It is not BEM, and it is not USDT or USDT0.",
      "Weight sits on the wafer. Transistors in the processor, and circuits already taped out, are counted by the contract that gets locked here. An address with no wafer does not earn a mine just by trading the perpetual.",
      "There is no mining contract and no platform-token contract now. Opening this page, trading spot, trading perp, minting, or taping out does not issue that token. Supply, release, halvings, and claims count only after that contract is deployed and written into this page. This section promises no number and no price.",
    ],
  },
  {
    h: "What gets connected next",
    ps: [
      "Four pieces are already running: BEM spot, the paper book, two shared perpetual books, and the wafer on X Layer. Rebates and nicknames sit beside the perpetual.",
      "The rest is added in this order, and this page changes before each piece opens. Spot can grow past BEM to other TapeOut assets. The X Layer mark can move from a pushed price to a pool on that chain. After the platform token exists it can pay a fee discount and sit in a market-making inventory. It does not guarantee a profit.",
      "The front end can be mirrored onto TapeOut DeWeb. The files live in one circuit's container. Whoever holds that circuit can update the site. Selling the circuit sells that right. The order books do not move with it. They stay in the two perpetual contracts.",
      "After that come messages between circuit containers, and the same book on more chains. Until it is in a contract, the page will not pretend it is open.",
    ],
  },
  {
    h: "Addresses already locked",
    ps: [
      `Older BSC perpetual ${KNOWN_PERP}. It takes no new orders.`,
      `BSC perpetual ${BSC_REBATE}. New BSC orders, codes, and claims are locked here. Margin is BSC USDT. Gas is BNB.`,
      `X Layer perpetual ${KNOWN_XPERP}. New X Layer orders are locked here. Margin is USDT0. Gas is OKB. Mark ${KNOWN_XMARK}.`,
      `Transistor perpetual ${GATE}. Longs and shorts in the six markets are locked here. Margin is BSC USDT.`,
      `Wafer circuits ${DEPLOYED.circuits}. Transistors ${DEPLOYED.transistors}. This processor is on X Layer. It is not the perpetual.`,
      `Fee address ${FEE_TO}. The 0.2% from spot and from the three perpetuals goes here. It cannot change a contract, and it cannot take margin that is still locked.`,
      "The seal rebate is locked. X Layer 0x62abA5CD9B6C371e7c443C79934B8644d60481d7 holds USDT0. BSC 0x0FcC922739a565804Ea57BDB44Bc2503E80Fce7A holds USDT. The page does not deploy a new address.",
    ],
  },
  {
    h: "Risk",
    ps: [
      "Neither perpetual has an admin, and neither has been audited. At 1000x a small mark move liquidates the position. After a limit fill, settlement still uses the mark, not the price you typed.",
      "The BSC mark is about a 10-minute average. The X Layer mark is pushed, so it can lag the last BSC trade. If a node fails, the page may hide orders that are still on chain.",
      "Use only money you can lose. This is not an offering, not custody, and not a promise of a fill, a roadmap date, or a profit. Mining and the platform token do not exist until their contract is locked.",
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
            ? "这一页只写已经锁上链的规则。现货在钱包里成交，永续的保证金进固定合约，晶圆在另一台处理器上。没写在这里的功能，页面不会假装已经开通。"
            : "This page only states rules that are already locked on chain. Spot fills from the wallet, perpetual margin sits in a fixed contract, and the wafer is another processor. If a feature is not written here, the page does not pretend it is live."}
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
              <p key={p.slice(0, 32)} className="mt-3 max-w-3xl text-sm leading-7">
                {p}
              </p>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}
