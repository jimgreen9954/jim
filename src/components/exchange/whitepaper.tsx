import { BSC_REBATE, KNOWN_XMARK, KNOWN_XPERP } from "@/lib/perp";
import { GATE } from "@/lib/gate-chain";
import { BSC, FEE_TO } from "@/lib/bsc";
import { NPM } from "@/lib/lp";
import { OFFICIAL } from "@/lib/official-books";
import { LOCKED_REBATE } from "@/lib/seal-rebate";
import { TAPE, TAPE_MINE } from "@/lib/tape-mine";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

const BEM_BRIDGE = "0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72";
const X_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952";

type Section = { h: string; ps: string[] };

const zh: Section[] = [
  {
    h: "规则怎么读",
    ps: [
      "TAPELIQUID 以晶圆为工本，以 TAPE 为唯一产出，以台费和用户铸造收入为回购来源。回购买入的 TAPE 全部销毁。官方电路挖出的 TAPE 不进入市场。开盘按已经锁进池子的资金写定。",
      "下面先写规则。最后一节写现在链上已经有的，和还不能签名的。没有合约的步骤，页面上没有按钮。",
    ],
  },
  {
    h: "晶圆",
    ps: [
      "NAND 和 LATCH 在 X Layer 铸造，共用额度 2,100,000。铸哪一种都从已铸之和外面扣。剩余按种类分开：已铸减去流片烧掉的。流片烧掉网表里的 NAND 和 LATCH，不能撤回，也不能再铸回来。",
      "未流片的库存可以转让，不算算力。额度用完后只剩二级转让，流片继续销毁。",
      "个人持有的未流片额度，锁在榜一地址，锁到第一个减半，不参与排放。已经流片的电路保留，权重和别的矿工同一套规则。榜一地址和到期日登记之前，这一行不写一个空地址。",
      "用户铸造收入进入回购余额。官方地址铸造的金额留在原账户，不进入回购。",
      "流片是一笔交易。节点交出成功回执时，电路编号已经在那一笔里，不是再铸第二笔。画布名单大约 8 秒重读一次，只显示最新的几张。个人中心从较小的编号往后查，所以更晚。以浏览器里那笔交易为准。",
    ],
  },
  {
    h: "TAPE",
    ps: [
      "TAPE 是 TAPELIQUID 的唯一平台币，只此一份，在 X Layer。没有第二枚。硬顶 21,000,000。无预挖，无团队份额，无私募。只发给已流片并且已验证的电路。未锁仓电路的领取，100% 进入该电路登记的矿工地址。销毁从已流通的币里发生，不从排放里预扣。",
      "排放不回溯。从第一笔已验证流片的那一天开始计日。晶圆不必铸完才开始。之后新的铸造和流片提高全网算力，已有电路的占比下降。",
      "日排放和减半周期写在合约里，不设改率权限。减半周期 210,000×600 秒，约 4 年。每过一个周期，当日排放减半。各期累加不超过 21,000,000。销毁不改变日排放，只减少已流通数量。",
      "开盘阶段日排放为 1,000。收费地址连续 30 日有台费入账后，日排放调整为 7,200，此后按减半周期执行。调整只做这一次。",
    ],
  },
  {
    h: "权重",
    ps: [
      "单电路权重 H = b* × P × q。b* 是这张电路流片时真实烧掉的 NAND 与 LATCH 之和，每颗记 1。P 是这张电路所属处理器的倍率，开排前写死。q 是该题、该处理器上的设计质量。",
      "成本低于参考实现时 q 大于 1。等于参考实现，或使用官方模板时，q = 1。只有该题、该处理器上成本最低的那一份拿质量溢价。被更低成本替换后，溢价转走。q 上限为 4。网表引用其他电路的，H = 0。",
      "当日这张电路所得 = 当日排放 × H / 全部 H。已验证池 99%，未验证池 1%。开排第一周未验证池为 0。同一成本下，先比较有效承诺时间，再比较流片时间。",
      "领取按电路结算。一笔领取只对应一张电路、一个登记地址、一段已结算且已可领取的排放。页面同时显示晶圆剩余、当日排放、累计销毁、这张电路的 b*、P、q、已记未领和可领取数量。",
    ],
  },
  {
    h: "官方电路和榜一",
    ps: [
      "官方已流片电路的地址在登记后列在这一页。这些电路挖出的 TAPE 不卖出。用途只有两类：空投，或社区奖励。每一笔写出数量、接收地址和用途。接收地址可以自行转让。",
      "官方未流片额度不新增流片，直到第一个减半。",
      "榜一地址流片出来的电路和晶圆，质押四年。锁定期内按原规则记权重，可以挖矿。四年到期、取回电路之后，才能领取锁定期内记下的 TAPE。到期日、电路编号和地址一并公开。",
    ],
  },
  {
    h: "自愿锁仓",
    ps: [
      "晶圆锁在晶圆锁仓里。电路锁在电路锁仓 0x06c877cc158d9ca3547220f9fc156f39bce7013c。两份都没有管理员。期限是五档：180 天、365 天、3 年、4 年、5 年。锁着的晶圆不能流片，不算算力。锁着的电路，算力记在电路锁仓上，继续占全网权重，继续挖 TAPE。到期前不能领。到期后可以只领 TAPE，电路还在，算力还在。领电路时，还没领的 TAPE 在同一笔里打进钱包，矿池席位也在这一笔里关掉。",
      "锁仓不增加 H，不另发 TAPE。规则页列出锁仓地址、对象是电路还是晶圆、档位、到期日，以及电路上尚未领取的数量。榜一地址的官方未流片额度同样走这五档，登记后写明地址与到期日。",
    ],
  },
  {
    h: "开盘池和现货",
    ps: [
      "开盘对手可以是 USDT，也可以是 BEM。计划中的开盘池放入 100,000 枚 TAPE 与 1,000 USDT，单价 0.01 USDT。这 100,000 枚不从矿工排放预支，锁至第一个减半，不能单方抽走。",
      "现货买卖要等用户自己加池，并且池子价值达到 10,000 美元之后才开启。吃进池子的 TAPE 只来自用户已经领取、自己加进去的部分，对手是 USDT 或 BEM。矿工加池使用已领取的 TAPE 和自己的对手币。加池算流动性，不算额外算力。",
      "用户加池时选定锁定期，只有五档：三个月、六个月、一年、两年、三年。池子凭证锁死。到期才能一键撤回。到期前不能拆。",
      "个人中心的资产表列出这个钱包还拿着的 TAPE，价格用 TAPE/USDT0 池子价。已经加进池子的 TAPE 另起一行，写成质押，不从钱包余额里消失。到期日用新加坡时间，写在同一页的质押名单里。",
      "自愿销毁没有单独的 burn 函数。TAPE、NAND、LATCH 和电路打进黑洞 0x000000000000000000000000000000000000dEaD，不能取回。TAPE 占比是黑洞余额除以已领出。电路占比是黑洞里的片数除以已流片。NAND 和 LATCH 把流片烧掉的和黑洞里的加在一起，再除以该种类已铸。",
      "开盘时若只有那 100,000 枚锁在池里，流通数量只计这 100,000。在两边都锁入、并且池子价值到 10,000 美元之前，现货按钮不开。",
    ],
  },
  {
    h: "台费",
    ps: [
      "现货买卖、永续撮合、撤单、添加流动性、撤回流动性，台费都是付出金额的 0.20%。此费用在池子手续费之外。平仓不再另收。添加流动性时两边各扣 0.20%，撤回时拿回的两边再各扣 0.20%。已转出的台费不退。现货的台费是单独一笔，先付。后面的兑换拒签或回滚，这一笔不退。回执还没读到时，页面留下哈希，同一金额不会再收一次。",
      "现货买到的币留在签名钱包。永续保证金进入用户所选链上的那一份合约。BSC 与 X Layer 不能并成一笔。",
      `台费进入收费地址 ${FEE_TO}。`,
      "推荐只作用于永续。有推荐人时，交易者少付永续台费的 4%，推荐人记 6%，其余进入收费地址。现货和流动性不参与。印鉴不自动减费。登记后，已撮合的永续成交可按新加坡周领回一半，周一 0 点至下周一 0 点，过点作废，同一笔只进一次，从领取合约出。",
      "池子自身的手续费留给流动性提供者。Gas 付给链。",
    ],
  },
  {
    h: "永续",
    ps: [
      "现在交易的 X Layer 永续是 0x3dfde13ef89f49575e73e91d3cd11127557f4d60，标记是 0xb623ee0ef23d8ea61f93cca373a4a4b27cf32fe1。晶体管永续是 0xb4b2ee90d10ecfc7ed36a58e96e03074fa8731eb。三份都没有管理员。写价地址是收费地址，写死。每次最多挪 0.5%，至少隔 30 秒。结算用过去 10 分钟均价。均价不满 10 分钟，或超过 30 分钟没有新写入，不能开仓，也不能结算。",
      "同一份标记只挂这一本 X Layer 永续。BSC 上的 BEM 永续读 Pancake 池子的均价，不读这份标记。浅池仍可能在短时间里影响那条均价。",
      "TAPE 是 TAPELIQUID 的唯一平台币。只有这一枚，没有第二枚。矿池没有管理员，也不能改排放。",
      "返佣合约有 clerk。clerk 可以提取返佣池里的余额。不是每一份合约都没有管理员。",
    ],
  },
  {
    h: "新手礼包",
    ps: [
      "个人中心有一份新手礼包。X Layer 上充的是 TAPELIQUID 的 NAND。BSC 上充的是 BEM。充进去的记在你的份额上。只有这个地址能取回自己还没被领走的那一份。别人不能把你的充值整笔转走。",
      "有人按规则领取时，池子变少，每个充值地址能取回的份额一起变少。池子空了就停。再充进去，就继续发。",
      "NAND 每次领 10 个，一个地址最多 5 次。要先有一笔已记的 X Layer 永续成交，你这一边的保证金不少于 5 USDT0。BEM 领一次 0.1 个。要先记满超过 10 笔 BSC 成交，每笔你这一边的保证金不少于 5 USDT。BSC 只认 BEM 永续和晶体管永续。同一笔成交只能记一次。现货不记进这个次数。",
      "NAND 礼包在 X Layer，地址 0xfb05bf0472ab9c27b063b314a704516b086ea7d3。BEM 礼包在 BSC，地址 0xcac69f02c06bfca3bfdb1eaf1f4a60e17e718081。两份都没有管理员。",
    ],
  },
  {
    h: "回购销毁",
    ps: [
      "每个自然月，当月手续费收入的 50%，加上回购余额中的用户铸造收入，用于在市场上买入 TAPE。官方地址铸造金额不进入回购余额。没有入账的月份不买。",
      "用户铸造收入的当月买入量按市场定。规则页在月初写明本月使用这笔余额的比例。池中 USDT 低于 1,000、或近七日领取卖出量高于近七日成交买量时，本月比例不低于 50%。其余月份可低于 50%，未使用部分留在回购余额。",
      "买进的 TAPE 全部销毁。手续费其余 50% 留在收费地址，按运营 50%、做市返还 30%、公开金库 20% 使用。做市返还按有效挂单时间、报价价差和成交量分配，用完即止。",
      "规则页按月记录六行：当月手续费、当月用户铸造收入、当月官方铸造金额、回购余额、本月买入比例、实际销毁的 TAPE 数量与成交哈希。官方铸造金额只作对照，不计入回购余额。",
    ],
  },
  {
    h: "跨链",
    ps: [
      "电路和 TAPE 都在 X Layer。BEM 的 BSC 与 X Layer 互转，用 TapeOut 已经上线的桥：BNB Chain 锁仓，X Layer 铸造等量；回来则在 X Layer 销毁，BSC 释放。1:1，走 LayerZero。本站不经手，不收第二笔手续费。",
      `BSC 上的 BEM 是 ${BSC.bem}。BSC 桥是 ${BEM_BRIDGE}。X Layer 上的 BEM 是 ${X_BEM}。入口是 tapeout.net/bridge。`,
      "TAPE 不走 BEM 的桥。TAPE 自己的 1:1 跨链合约还没有。没有合约之前，页面不提供 TAPE 跨链按钮。",
    ],
  },
  {
    h: "现在链上有的",
    ps: [
      `TAPE 代币 ${TAPE}。挖矿合约 ${TAPE_MINE}。都在 X Layer。硬顶 21,000,000，8 位小数，没有管理员，也没有改率入口。只有挖矿合约能铸。总供应只随领取增加。`,
      "这份挖矿合约现在的日排放是 7,200，从部署时开始，不是先 1,000 再切换。它也没有「收费地址签一次改成 7,200」的入口。权重按电路门数，也就是 b*，处理器倍率按 1。q 还没有题目验证，页面不能显示大于 1。",
      "挖矿、TAPE 池、晶圆和电路锁仓，三份都没有管理员，不能升级，不能改期限，不能改费率，也没有救援入口。误转到合约、又没有对应仓位的资产，谁都取不回，页面不会这么转。加池时和池子比例对不上的部分退回给签名的人，不会进别人的份额。",
      "开盘池的 100,000 枚没有另铸。TAPE 池没有管理员，加池即质押，90 天到 3 年，到期才能撤。晶圆锁仓没有管理员，期限是 180 天、365 天、3 年、4 年、5 年。锁着的晶圆不能流片，不算算力。电路锁仓是 0x06c877cc158d9ca3547220f9fc156f39bce7013c。同一片电路不能锁两次。回购和 TAPE 跨链还没有合约。",
      "个人中心转出晶体管可以选一对一或一对多。一对多每一行一个地址，这一行的 NAND 和 LATCH 只进这个地址，按行签名，不经过锁仓合约。电路在名单里上下滑动勾选，每一片填一个地址，勾几片签几笔。官网合约如果不提供逐个编号，这一页不能代填。",
    ],
  },
  {
    h: "地址",
    ps: [
      `收费 ${FEE_TO}。TAPE ${TAPE}。TAPE 挖矿 ${TAPE_MINE}。TAPE 池 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641。晶圆锁仓 0xA28390924607F08aaD8d03F512B41b6a1c012Ace。电路锁仓 0x06c877cc158d9ca3547220f9fc156f39bce7013c。TAPELIQUID 电路 ${DEPLOYED.circuits}。TAPELIQUID 晶体管 ${DEPLOYED.transistors}。`,
      `BSC 永续 ${BSC_REBATE}。X Layer 永续 ${KNOWN_XPERP}。标记 ${KNOWN_XMARK}。晶体管永续 ${GATE}。流动性仓位 ${NPM}。`,
      `BSC BEM ${BSC.bem}。BSC 桥 ${BEM_BRIDGE}。X Layer BEM ${X_BEM}。官网 BEM 挖矿 0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46。`,
      `官网晶体管市场 ${OFFICIAL.transistorMarket}。官网电路市场 ${OFFICIAL.circuitMarket}。BEM 池 ${BSC.pool}。`,
      `X Layer 印鉴领取 ${LOCKED_REBATE.xlayer}。BSC 印鉴领取 ${LOCKED_REBATE.bsc}。`,
      "改规则的当天改这一页。链上合约没有改率入口的，不能用这一页把已经部署的排放改掉。",
    ],
  },
];

const en: Section[] = [
  {
    h: "How to read this",
    ps: [
      "Wafers are the cost. TAPE is the only output. Desk fees and user mint proceeds are the buyback. Bought TAPE is burned. TAPE mined by official circuits does not enter the market. The open is fixed by funds already locked in the pool.",
      "The rules come first. The last sections say what is already on chain, and what cannot be signed yet. A step without a contract has no button.",
    ],
  },
  {
    h: "Wafers",
    ps: [
      "NAND and LATCH mint on X Layer under one cap of 2,100,000. Either kind is taken from what has not been minted. What remains is per kind: minted minus burned by tape-out. Tape-out burns the NAND and LATCH in the netlist. It cannot be undone or minted back.",
      "Untaped stock can be transferred and is not hashrate. After the cap, only secondary transfers remain. Tape-out still destroys.",
      "Untaped stock held personally stays locked at the lead address until the first halving and does not earn. Circuits already taped keep their weight under the same rule as every other miner. No address is printed here until that lead address and its expiry are registered.",
      "User mint proceeds go to the buyback balance. Amounts minted by an official address stay in that account and do not enter the buyback.",
      "A tape-out is one transaction. When the node returns a successful receipt, the circuit id is already in that transaction. It is not a second mint. The canvas list rereads about every 8 seconds and shows only the latest few. The account page walks older ids first, so it is later. The transaction in the explorer is the record.",
    ],
  },
  {
    h: "TAPE",
    ps: [
      "TAPE is the only platform token of TAPELIQUID. There is one token, on X Layer, and there is not a second. The hard cap is 21,000,000. No premine, no team allocation, no private sale. It is paid only to a taped and verified circuit. A claim on an unlocked circuit goes entirely to the miner address registered on that circuit. Burns come out of coins already circulating. They are not withheld from emission.",
      "Emission does not backfill. The day count starts on the day of the first verified tape-out. The wafers do not have to be fully minted first. Later mints and tape-outs raise network hashrate, so an existing circuit's share falls.",
      "The daily amount and the halving are in the contract. There is no permission to edit the rate. A halving is 210,000 × 600 seconds, about four years. Each period, that day's emission is cut in half. The periods together do not exceed 21,000,000. A burn does not change the daily emission. It only reduces what is circulating.",
      "The opening daily emission is 1,000. After the fee address has received desk fees for 30 consecutive days, the daily emission becomes 7,200, and halvings apply from there. That change happens once.",
    ],
  },
  {
    h: "Weight",
    ps: [
      "A circuit's weight is H = b* × P × q. b* is the NAND plus LATCH that tape-out actually burned, one point each. P is that processor's multiplier, fixed before mining opens. q is the design quality for that task on that processor.",
      "q is above 1 when the cost is below the reference. q is 1 when it matches the reference or uses an official template. Only the lowest cost on that task and processor keeps the quality premium. A lower cost takes the premium away. q stops at 4. A netlist that references another circuit has H = 0.",
      "That circuit's day is the day's emission times H over the sum of H. The verified pool takes 99 percent. The unverified pool takes 1 percent. In the first week the unverified pool is 0. At the same cost, the earlier valid commitment wins, then the earlier tape-out.",
      "A claim settles one circuit, one registered address, and one period that is already due. The page shows wafers left, the day's emission, cumulative burn, and that circuit's b*, P, q, accrued unpaid amount, and the amount that can be claimed.",
    ],
  },
  {
    h: "Official circuits and the lead address",
    ps: [
      "Official taped circuits are listed here after they are registered. TAPE they mine is not sold. It is used only as an airdrop or a community reward. Each transfer states the amount, the recipient, and the purpose. The recipient may transfer it.",
      "Official untaped quota adds no new tape-out until the first halving.",
      "Circuits and wafers taped by the lead address are staked for four years. Weight still accrues during the lock. The TAPE recorded in those four years can be claimed only after the circuits are retrieved at expiry. The address, the circuit ids, and the expiry are published together.",
    ],
  },
  {
    h: "Voluntary locks",
    ps: [
      "Wafers lock in the wafer lock. Circuits lock in the circuit lock at 0x06c877cc158d9ca3547220f9fc156f39bce7013c. Neither contract has an admin. The terms are 180 days, 365 days, 3 years, 4 years, and 5 years. A locked wafer cannot be taped and is not hashrate. A locked circuit keeps its weight on the circuit lock, keeps its share of the network, and keeps mining TAPE. Nothing can be claimed early. After unlock, TAPE can be claimed alone and the circuit keeps mining. Claiming the circuit sends any unclaimed TAPE in the same transaction and closes the mine seat.",
      "A locked wafer cannot be transferred or taped before expiry. It is not hashrate. After expiry it can be taped. Unlock charges nothing. A lock does not raise H and does not mint extra TAPE.",
      "A lock does not raise H and does not mint extra TAPE. This page lists the address, whether it is a circuit or wafers, the term, the expiry, and the unclaimed amount on the circuit. The lead address's official untaped quota uses the same five terms. The address and expiry are written here after registration.",
    ],
  },
  {
    h: "The opening pool and spot",
    ps: [
      "The counter asset may be USDT or BEM. The planned opening pool is 100,000 TAPE and 1,000 USDT, at 0.01 USDT. Those 100,000 are not taken in advance from miner emission. They stay locked until the first halving and cannot be pulled by one side.",
      "Spot turns on only after users have added their own liquidity and the pool is worth 10,000 dollars. TAPE that the pool takes comes only from TAPE a user already claimed and added. The other side is USDT or BEM. A miner adds claimed TAPE and their own counter asset. Liquidity is not extra hashrate.",
      "Adding a pool picks a lock. The only terms are three months, six months, one year, two years, and three years. The position is locked. It can be removed in one action at expiry, and not before.",
      "The account page lists TAPE still in the wallet, priced from the TAPE/USDT0 pool. TAPE already added to a pool is a separate stake row, so it does not vanish from the total. The expiry is Singapore time, on the same page.",
      "There is no burn function. TAPE, NAND, LATCH and a circuit sent to 0x000000000000000000000000000000000000dEaD cannot be taken back. TAPE's share is the dead balance divided by claimed supply. A circuit's share is dead holdings divided by taped circuits. NAND and LATCH add tape-out burns to the dead balance, then divide by that kind's minted amount.",
      "If only those 100,000 sit in the pool at the open, circulating TAPE is those 100,000. The spot button stays off until both sides are locked and the pool is worth 10,000 dollars.",
    ],
  },
  {
    h: "Desk fee",
    ps: [
      "Spot, a perpetual match, a cancel, adding liquidity, and removing liquidity all pay 0.20 percent of what is paid. That is on top of the pool fee. Closing adds nothing. Adding takes 0.20 percent from each side. Removing takes 0.20 percent from both sides that come back. A fee already sent is not returned. The spot fee is its own transaction and is paid first. If the swap is rejected or reverts, that fee stays. If the receipt has not come back, the page keeps the hash and does not charge the same amount again.",
      "A spot fill stays in the wallet that signed. Perpetual margin enters the one contract on the chain the user picked. BSC and X Layer do not net.",
      `The desk fee goes to ${FEE_TO}.`,
      "Referrals apply only to perpetuals. With a referrer, the trader pays 4 percent less of the perpetual desk fee, the referrer is credited 6 percent, and the rest goes to the fee address. Spot and liquidity are outside that split. A seal does not cut a fee by itself. After registration, half the fee on a matched perpetual fill can be claimed once per Singapore week, Monday 00:00 to the next Monday 00:00. A missed week is gone. One fill is counted once. The claim is paid by the claim contract.",
      "The pool's own fee stays with liquidity providers. Gas is paid to the chain.",
    ],
  },
  {
    h: "Perpetuals",
    ps: [
      "The live X Layer perpetual is 0x3dfde13ef89f49575e73e91d3cd11127557f4d60. Its mark is 0xb623ee0ef23d8ea61f93cca373a4a4b27cf32fe1. The transistor perpetual is 0xb4b2ee90d10ecfc7ed36a58e96e03074fa8731eb. None of the three has an admin. The posting address is the fee address, and it is fixed. Each post moves at most 0.5 percent, and at least 30 seconds must pass. Settlement uses the last 10 minutes. If that average is shorter than 10 minutes, or nothing has been posted for 30 minutes, a new order cannot open and a position cannot settle.",
      "This mark has one X Layer perpetual. The BEM perpetual on BSC reads the Pancake pool average. It does not read this mark. A thin pool can still move that average for a short time.",
      "TAPE is the only platform token of TAPELIQUID. There is one token, not a second. The mine has no admin, and the emission cannot be changed.",
      "The rebate contract has a clerk. The clerk can withdraw the rebate pool. Not every contract is without an admin.",
    ],
  },
  {
    h: "Starter gift",
    ps: [
      "The account page has a starter gift. NAND deposited on X Layer is TAPELIQUID NAND. BEM deposited on BSC is BEM. A deposit is your share. Only that address can withdraw what has not yet been paid out. Nobody can take your whole deposit.",
      "When someone claims under the rule, the pool shrinks, and every depositor's remaining share shrinks with it. An empty pool stops. A new deposit starts it again.",
      "NAND pays 10 each time, at most 5 times per address. That requires a counted X Layer perpetual fill, and your side's margin must be at least 5 USDT0. BEM pays 0.1 once. That requires more than 10 counted BSC fills, each with your side's margin at least 5 USDT. BSC counts the BEM perpetual and the transistor perpetual. One fill counts once. Spot is not counted.",
      "The NAND gift is on X Layer at 0xfb05bf0472ab9c27b063b314a704516b086ea7d3. The BEM gift is on BSC at 0xcac69f02c06bfca3bfdb1eaf1f4a60e17e718081. Neither has an admin.",
    ],
  },
  {
    h: "Buyback and burn",
    ps: [
      "Each calendar month, 50 percent of that month's fee income, plus user mint proceeds sitting in the buyback balance, is used to buy TAPE. Official mint amounts do not enter the buyback balance. A month with no income does not buy.",
      "How much of the user-mint balance is used that month depends on the market. This page states the ratio at the start of the month. If USDT in the pool is under 1,000, or claim-side sells over the last seven days exceed buys, the ratio is at least 50 percent. In other months it may be lower. What is unused stays in the buyback balance.",
      "TAPE that is bought is burned. The other 50 percent of fees stays at the fee address and is used as operations 50 percent, maker rebate 30 percent, and a public treasury 20 percent. The maker rebate is paid by time on the book, spread, and volume, and stops when it is used up.",
      "Each month this page records six lines: fees, user mint income, official mint amount, buyback balance, the month's buy ratio, and the TAPE burned with the transaction hashes. The official mint amount is a comparison. It is not added to the buyback balance.",
    ],
  },
  {
    h: "Bridge",
    ps: [
      "Circuits and TAPE are on X Layer. BEM moves between BSC and X Layer on the bridge TapeOut already runs: lock on BNB Chain and mint the same amount on X Layer, or burn on X Layer and release on BSC. It is 1:1, over LayerZero. This site does not custody it and does not add a second fee.",
      `BEM on BSC is ${BSC.bem}. The BSC bridge is ${BEM_BRIDGE}. BEM on X Layer is ${X_BEM}. The page is tapeout.net/bridge.`,
      "TAPE does not use the BEM bridge. TAPE has no 1:1 bridge contract yet. Until that contract exists, there is no TAPE bridge button.",
    ],
  },
  {
    h: "What is on chain now",
    ps: [
      `TAPE is ${TAPE}. The mine is ${TAPE_MINE}. Both are on X Layer. The cap is 21,000,000 with 8 decimals. There is no admin and no way to change the rate. Only the mine can mint. Supply grows only when someone claims.`,
      "That mine contract emits 7,200 a day from the moment it was deployed. It does not start at 1,000, and it has no one-time switch to 7,200. Weight is the gate count, which is b*, and the processor multiplier is 1. There is no task score yet, so q is not shown above 1.",
      "The mine, the TAPE pool, and the wafer and circuit lock have no admin. They cannot be upgraded, and the terms and the fee cannot be changed. There is no rescue function. Assets sent to a contract without a matching position cannot be taken back by anyone, and the page does not send them that way. Liquidity that does not match the pool ratio is returned to the signer. It is not added to anyone else's share.",
      "The 100,000 opening allocation was not minted. The TAPE pool has no admin. Adding liquidity stakes it for 90 days to 3 years. The wafer lock has no admin. Terms are 180 days, 365 days, 3 years, 4 years, or 5 years. Locked wafers cannot be taped and do not count as weight. The circuit lock is 0x06c877cc158d9ca3547220f9fc156f39bce7013c. The same circuit cannot be locked twice. Buyback and a TAPE bridge are not contracts yet.",
      "Official BEM is still claimed from the TapeOut mine. It is not the same signature as TAPE. A large tape-out does not mint official BEM.",
      "The account page can send transistors to one address or to many. Many means one address per row, and that row's NAND and LATCH go only to that address. Each transfer is its own signature, and none of them go through the lock. Circuits are ticked in a scrolling list. Each ticked circuit has one address. One signature per circuit. If an official contract does not list token ids, this page does not invent them.",
    ],
  },
  {
    h: "Addresses",
    ps: [
      `Fee ${FEE_TO}. TAPE ${TAPE}. TAPE mine ${TAPE_MINE}. TAPE pool 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641. Wafer lock 0xA28390924607F08aaD8d03F512B41b6a1c012Ace. Circuit lock 0x06c877cc158d9ca3547220f9fc156f39bce7013c. TAPELIQUID circuits ${DEPLOYED.circuits}. TAPELIQUID transistors ${DEPLOYED.transistors}.`,
      `BSC perpetual ${BSC_REBATE}. X Layer perpetual ${KNOWN_XPERP}. Mark ${KNOWN_XMARK}. Transistor perpetual ${GATE}. Liquidity positions ${NPM}.`,
      `BSC BEM ${BSC.bem}. BSC bridge ${BEM_BRIDGE}. X Layer BEM ${X_BEM}. Official BEM mine 0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46.`,
      `Official transistor market ${OFFICIAL.transistorMarket}. Official circuit market ${OFFICIAL.circuitMarket}. BEM pool ${BSC.pool}.`,
      `X Layer seal claim ${LOCKED_REBATE.xlayer}. BSC seal claim ${LOCKED_REBATE.bsc}.`,
      "When a rule changes, this page changes the same day. A sentence here cannot change an emission that the deployed contract has no function to edit.",
    ],
  },
];

const specZh = [
  ["硬顶", "21,000,000 TAPE，8 位小数，无预挖，无团队份额"],
  ["日排放", "开盘 1,000。收费地址连续 30 日有台费后，改为 7,200，只此一次"],
  ["减半", "210,000 × 600 秒，约 4 年。销毁不改变日排放"],
  ["权重", "H = b* × P × q。q 最高 4。引用其他电路则 H = 0"],
  ["分配", "已验证 99%，未验证 1%。开排第一周未验证为 0"],
  ["台费", "付出金额的 0.20%，在池子手续费之外"],
  ["现货", "TAPE/USDT、TAPE/BEM。池子价值到 10,000 美元才开"],
  ["加池锁定期", "三个月、六个月、一年、两年、三年。到期才能撤"],
  ["晶圆与电路锁仓", "半年、一年、三年、四年、五年"],
  ["一张流片", "18,000 NAND，或 30,000 LATCH。更大写不进链"],
  ["电路何时在", "回执成功就在链上。页面名单稍后才显示"],
];

const specEn = [
  ["Cap", "21,000,000 TAPE, 8 decimals, no premine, no team share"],
  ["Daily emission", "1,000 at the open. One change to 7,200 after 30 days of desk fees"],
  ["Halving", "210,000 × 600 seconds, about four years. Burns do not change the daily amount"],
  ["Weight", "H = b* × P × q. q stops at 4. A netlist that calls another circuit has H = 0"],
  ["Split", "Verified 99%, unverified 1%. Unverified is 0 in the first week"],
  ["Desk fee", "0.20% of what is paid, on top of the pool fee"],
  ["Spot", "TAPE/USDT and TAPE/BEM. Off until the pool is worth 10,000 dollars"],
  ["Pool lock", "3 months, 6 months, 1 year, 2 years, 3 years. Withdraw only at expiry"],
  ["Wafer and circuit lock", "6 months, 1 year, 3 years, 4 years, 5 years"],
  ["One tape-out", "18,000 NAND, or 30,000 LATCH. Larger than that does not fit"],
  ["When the circuit exists", "On chain when the receipt succeeds. The page list shows it later"],
];

const nowZh = [
  ["TAPE", TAPE],
  ["挖矿合约", TAPE_MINE],
  ["现在的日排放", "7,200，从部署时起。没有 1,000 档，也没有改率入口"],
  ["现在的权重", "门数，也就是 b*。P = 1。q 不能大于 1"],
  ["总供应", "只随领取增加。10 万枚开盘种子没有另铸"],
  ["TAPE 池", "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641，没有管理员"],
  ["锁仓", "0xA28390924607F08aaD8d03F512B41b6a1c012Ace，没有管理员"],
  ["还不能签", "回购、TAPE 跨链"],
];

const nowEn = [
  ["TAPE", TAPE],
  ["Mine", TAPE_MINE],
  ["Emission today", "7,200 from deployment. There is no 1,000 tier and no switch"],
  ["Weight today", "Gate count, which is b*. P = 1. q cannot be above 1"],
  ["Supply", "Grows only when claimed. The 100,000 seed was not minted"],
  ["TAPE pool", "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641, no admin"],
  ["Lock", "0xA28390924607F08aaD8d03F512B41b6a1c012Ace, no admin"],
  ["Not signable yet", "Buyback, a TAPE bridge"],
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
            ? "规则写在这里。链上还没有的，不写成已经能签。"
            : "The rules are here. What is not on chain yet is not written as something you can sign."}
        </p>
      </header>
      <div className="grid gap-px border-b border-gold bg-gold/40 sm:grid-cols-2">
        <table className="bg-card text-left text-sm">
          <caption className="border-b border-gold/40 px-4 py-3 text-left text-xs tracking-widest text-gold">{lang === "zh" ? "参数" : "Parameters"}</caption>
          <tbody>
            {(lang === "zh" ? specZh : specEn).map(([k, v]) => (
              <tr key={k} className="border-b border-gold/30">
                <th className="w-36 px-4 py-2 align-top font-normal text-ink/60">{k}</th>
                <td className="px-4 py-2">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <table className="bg-card text-left text-sm">
          <caption className="border-b border-gold/40 px-4 py-3 text-left text-xs tracking-widest text-gold">{lang === "zh" ? "现在链上" : "On chain now"}</caption>
          <tbody>
            {(lang === "zh" ? nowZh : nowEn).map(([k, v]) => (
              <tr key={k} className="border-b border-gold/30">
                <th className="w-36 px-4 py-2 align-top font-normal text-ink/60">{k}</th>
                <td className="break-all px-4 py-2 font-mono text-xs sm:text-sm">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${XLAYER.explorer}/address/${TAPE}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">TAPE</span>
          <span className="mt-1 block break-all font-mono text-xs">{TAPE}</span>
        </a>
        <a className="border border-gold/50 p-3 hover:border-gold" href={`${XLAYER.explorer}/address/${TAPE_MINE}`} target="_blank" rel="noreferrer">
          <span className="block text-xs tracking-widest text-gold">{lang === "zh" ? "挖矿" : "Mine"}</span>
          <span className="mt-1 block break-all font-mono text-xs">{TAPE_MINE}</span>
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
