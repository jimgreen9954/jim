import { useState } from "react";
import { BSC_REBATE, BTC_COIN_BOOK, ETH_COIN_BOOK, FAB_COIN_BOOK, KNOWN_XPERP, PREV_XPERP, TAPE_COIN_BOOK, UP_COIN_BOOK, ZEC_COIN_BOOK } from "@/lib/perp";
import { BSC, BSC_SAFE, FEE_TO, XLAYER_SAFE } from "@/lib/bsc";
import { BSC_VAULT, XLAYER_VAULT } from "@/lib/chain-marks";
import { LOCKED_REBATE } from "@/lib/seal-rebate";
import { RED_STAMP } from "@/lib/red-packet";
import { TAPE_DESK } from "@/lib/tape-desk";
import { TAPE_LOCK, CIRCUIT_LOCK } from "@/lib/tape-lock";
import { TAPE, TAPE_MINE } from "@/lib/tape-mine";
import { TAPE_SPOT } from "@/lib/tape-spot";
import { TAPE_TERM } from "@/lib/tape-term";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

type Section = { h: string; ps: string[] };

const zhBody: Section[] = [
 {
 h: "产品",
 ps: [
 "TAPELIQUID 是以晶圆为记账单位的交易所。现货和永续在交易台。铸造和流片在工房。TAPE 是唯一平台币，只在 X Layer。BEM 属于 TapeOut。",
 "练习记录只在这台浏览器里。没有对应合约的事，页面不提供按钮。",
 ],
 },
 {
 h: "风险",
 ps: [
 "本页是规则，不是审计，也不是收益承诺。合约不能升级。没有管理员也不等于不能被攻击。浅池上的标记价仍可能被带动。",
 "不通过函数直接转进合约的资产，取不回。页面只授这一笔要用的数量。以前留下的无限授权不会自己消失。旧合约 0xC5A63E4c37c23F97558673731196abC30FBFa659 的 run 可以由调用者指定任意地址和数据，对它的授权请改成 0。新合约只能由该链多签部署。",
 "跟单金库存入后，对稳定币是无限授权。有挂单或仓位时不能存，也不能取。有份额的人可以申请退出，满 6 小时后任何人可以平掉这口金库自己的单。申请之后不能再开。",
 ],
 },
 {
 h: "现货",
 ps: [
 "BSC 现货走 PancakeSwap。X Layer 的 OKB 走 PotatoSwap，付的是 USDT0（0x779Ded0c9e1022225f8E0630b35a9b54bE713736）。台费是付出金额的 0.20%，在池子手续费之外，和兑换在同一次确认里。失败则两边都不发生。",
 "UP 只在 BSC，走 tapeup.io 官方池 0xDf40529fa3E797c992272e27B811E59E5f1827Ae。这个池是代理，实现由 tapeup.io 更换。",
 "官方 TAPE 池 0x58eaD5b41Cfd3627791D439402dd65571c286484：编号 0 付出 BEM，编号 1 付出 OKB，没有 USDT0。换成 USDT0 要先拿到 OKB 再换。兑换前对不上收到的币就不上链。手续费进 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D，不是多签。源码不在本仓库。旧池 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641 不再新加，到期才能取。",
 "工房订单簿按张卖电路，卖方实收 99.8%。日产能价是估算，没开工不是到账。",
 ],
 },
 {
 h: "永续",
 ps: [
 "保证金锁进所选链的合约。BSC 用 USDT，X Layer 用 USDT0。资金费每 8 小时结算，单次不超过 ±0.05%。亏到保证金大约一半可以强平。BEM 的强平剩余一半进保险、一半给调用的人，保险不能提取。UP、TAPE、FAB 的手续费和强平罚金留在保险金。",
 "比特币、ETH、ZEC 和 BSC 的 BEM 是 50 倍。UP、TAPE、FAB 按这一笔保证金：10 美元及以内 50 倍，100 美元及以内 20 倍，超过 100 美元 5 倍。自己的挂单自己不能吃。",
 "BSC 的 BEM、比特币、ETH、ZEC 读各自池子约 10 分钟均价。X Layer 的 BEM 用两口池的 10 分钟均价，现价和均价差过约 3% 不能新开，也不能强平。UP、TAPE、FAB 每 30 秒最多走动约 0.5%，再取 10 分钟均价，差过约 1% 只能平仓。谁都能调 sync()，只记价。仓位已经安全时，记价会清掉强平记录。",
 "全体可开名义取多签上限和保险金 × 20 里较小的。保险金现在约 1，全体大约只能开 20 美元名义。多签上限仍是 3000，高于池子库存的一半。调低立即生效，调高要等 1 天。一个人一个方向最多是上限的五分之一。",
 `旧 TapeMark 0xb4B2ee90D10ECfC7ed36A58e96e03074fA8731Eb 只挂在已停用的 ${PREV_XPERP}。那一本没有未平仓，也没有未撤挂单。`,
 ],
 },
 {
 h: "借贷和期贷",
 ps: [
 "借贷最多借到抵押的 50%，新借至少 10 美元。欠款超过抵押的 75% 可以代还，并多拿约 5%。利息的 10% 记成多签的存款份额。X Layer 的 TAPE 和 BEM 在价格没跟上时不能存、取、借。页面先记一次价，没跟上就等约 30 秒再记。",
 "期贷利率写死，按整天，不是日历月。利息按整点、按剩余本金计，逾期按两倍。要连续记满三次、每次隔 10 分钟，并且和池子价相差不超过 2%，才能新借。超过 30 分钟不能新借，也不能按 75% 强平。价格过期时，负债超过抵押的 90% 才能强平，而且没有奖励。",
 "旧池只留取出、解锁和还款。直接转进合约的取不回。",
 ],
 },
 {
 h: "奖励和回购",
 ps: [
 "返佣先到先得，不为每个人预留。多签取走返佣要先排队，满 24 小时才能取。",
 "合约任务红包只认发出之后才开的仓，同一张仓只能领一次。仓位还要再开着 5 分钟，而且同一个对手只能领一次。旧红包已停发。X Layer 志愿红包 0x1A0567219e796Df983Fe584d44E7245B69E72836 还有 3 USDT0，BSC 志愿红包 0x2F0E6F04E7ABeF8140f98c5d8cCDbdc47BA94cD2 还有 0.06 BEM，资助人可以取回。",
 "回购和销毁没有合约强制执行。每个自然月，用当月手续费的 50% 加上用户铸造收入买入 TAPE，再打进黑洞。以当月成交哈希为准。官方铸造不进回购。",
 ],
 },
 {
 h: "地址",
 ps: [
 "台费进该链多签。以前的池子和上一本永续仍进旧收费地址。活着的合约在下面的表。换下的本只平仓或只取款。",
 ],
 },
];

const en: Section[] = [
 {
 h: "Product",
 ps: [
 "TAPELIQUID is an exchange that accounts in wafers. Spot and perpetuals are on the desk. Minting and tape-out are in the workshop. TAPE is the only platform coin, and only on X Layer. BEM belongs to TapeOut.",
 "A practice book stays in this browser. If there is no contract, the page has no button.",
 ],
 },
 {
 h: "Risk",
 ps: [
 "This page is the rulebook. It is not an audit and it is not a promise of return. The contracts cannot be upgraded. No administrator does not mean they cannot be attacked. A mark that reads a thin pool can still be moved.",
 "A raw transfer into a contract cannot be withdrawn. The page approves only the amount of that action. An old unlimited allowance does not disappear. Contract 0xC5A63E4c37c23F97558673731196abC30FBFa659 lets its caller choose any call. Set every allowance for it to zero. A new contract can be deployed only by that chain's multisig.",
 "A copy-vault deposit leaves an unlimited stablecoin allowance. A deposit or a withdrawal needs the vault flat. A shareholder can ask to exit. Six hours later anyone can flatten that vault's own orders. After the request, the leader cannot open again.",
 ],
 },
 {
 h: "Spot",
 ps: [
 "BSC spot uses PancakeSwap. OKB on X Layer uses PotatoSwap and pays USDT0 (0x779Ded0c9e1022225f8E0630b35a9b54bE713736). The desk fee is 0.20% of the amount paid, on top of the pool fee, in the same confirmation. If it fails, neither side happens.",
 "UP spot is only on BSC, through the tapeup.io pool 0xDf40529fa3E797c992272e27B811E59E5f1827Ae. That pool is a proxy. tapeup.io can change the implementation.",
 "Official TAPE pool 0x58eaD5b41Cfd3627791D439402dd65571c286484: index 0 pays BEM, index 1 pays OKB. It does not pay USDT0. A sale into USDT0 takes OKB first, then converts it. The page does not send a swap whose received asset does not match. The fee goes to 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D, not the multisig. Its source is not in this repository. The earlier pool 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641 takes no new deposit.",
 "The workshop book sells a circuit whole. The seller receives 99.8%. A day-price is an estimate, not a receipt.",
 ],
 },
 {
 h: "Perpetuals",
 ps: [
 "Margin is locked in the contract on the chain you pick. BSC uses USDT. X Layer uses USDT0. Funding settles every 8 hours and is capped at ±0.05%. A position can be liquidated near half its margin. On BEM, half of what is left goes to insurance and half to the caller. Insurance cannot be withdrawn. On UP, TAPE and FAB, fees and the liquidation penalty stay in insurance.",
 "Bitcoin, ETH, ZEC and BSC BEM are 50×. UP, TAPE and FAB follow the margin of that call: 50× at 10 dollars and under, 20× at 100 dollars and under, 5× above 100. An order cannot fill itself.",
 "BSC BEM, Bitcoin, ETH and ZEC read about a 10-minute pool average. X Layer BEM averages two pools for 10 minutes. A gap past about 3% blocks a new open and a liquidation. UP, TAPE and FAB move at most about 0.5% every 30 seconds, then take a 10-minute average. A gap past about 1% blocks a new open and a liquidation. Anyone can call sync(). It only records a price. A safe position clears its liquidation mark.",
 "Open notional is the smaller of the multisig cap and insurance × 20. Insurance is about 1, so the whole book can open about 20 dollars. The multisig cap is still 3000, above half the pool. A cut applies now. A raise waits one day. One address on one side stops at one fifth of the cap.",
 `The old TapeMark 0xb4B2ee90D10ECfC7ed36A58e96e03074fA8731Eb is used only by the retired book ${PREV_XPERP}. That book has no open position and no open order.`,
 ],
 },
 {
 h: "Lending and term loans",
 ps: [
 "A loan stops at 50% of collateral. A new borrow is at least 10 dollars. Above 75%, someone may repay and take about 5% extra collateral. Ten percent of interest is credited to that chain's multisig. On X Layer, TAPE and BEM cannot be supplied, withdrawn or borrowed while the price has not caught up. The page posts one sample first. If it is still stale, wait about 30 seconds and post again.",
 "Term rates are fixed, in exact days. Interest ticks on the hour, on the remaining principal, and doubles after the due hour. A new loan needs three posts, 10 minutes apart, within 2% of the pool. After 30 minutes a new loan stops, and so does a liquidation at 75%. When the price is stale, a loan can be closed only if debt is over 90% of collateral, and there is no bonus.",
 "An old pool only withdraws, unlocks and repays. A raw transfer is lost.",
 ],
 },
 {
 h: "Rewards and buyback",
 ps: [
 "The rebate is first come, first served. Nothing is reserved per user. The multisig queues a withdrawal and waits 24 hours.",
 "A perpetual task packet counts only a position opened after the packet, and that position can be claimed once. It must stay open for 5 minutes, and the same counterparty can be paid only once. Old packets are closed. The X Layer volunteer packet 0x1A0567219e796Df983Fe584d44E7245B69E72836 still holds 3 USDT0. The BSC volunteer packet 0x2F0E6F04E7ABeF8140f98c5d8cCDbdc47BA94cD2 still holds 0.06 BEM. The funder can take the rest back.",
 "There is no forced buyback or burn in a contract. Each month, half of that month's fees plus user mint income is used to buy TAPE and send it to the burn address. The month's transaction hash is the record. Official mints are not included.",
 ],
 },
 {
 h: "Addresses",
 ps: [
 "Desk fees go to that chain's multisig. Older pools and the previous perpetual still pay the old fee address. Live contracts are in the table below. A replaced book only closes or only withdraws.",
 ],
 },
];

const specZh = [
 ["硬顶", "21,000,000 TAPE，8 位小数，无预挖，无团队份额"],
 ["日排放", "每天 7,200。合约里没有改档入口"],
 ["减半", "210,000 × 600 秒，约 4 年。销毁不改变日排放"],
 ["权重", "H = b* × P × q。q 最高 4。引用其他电路则 H = 0"],
 ["分配", "已验证 99%，未验证 1%。开排第一周未验证为 0"],
 ["台费", "付出金额的 0.20%，在池子手续费之外"],
 ["现货", "工房订单簿已上线。不再接受新的 TAPE 池加仓"],
 ["加池锁定期", "已有仓：三个月、六个月、一年、两年、三年。到期才能撤。页面不再新加"],
 ["分红锁仓", "三个月、六个月、九个月、一年、两年、三年。到期才能取本金"],
 ["晶圆与电路锁仓", "半年、一年、三年、四年、五年"],
 ["一张流片", "18,000 NAND，或 30,000 LATCH。更大写不进链"],
 ["电路何时在", "回执成功就在链上。页面名单稍后才显示"],
 ["电路现货", "按张。卖方实收 99.8%。日产能价是估算，没开工不是到账"],
 [
 "Circuit Punk 合成卡",
 "先在 nft.tapeliquid.net 确定。再去 app.tapeliquid.net 交易。每月领一次，次月 7 天内，先到先得。铜片 0.16/0.14，银盖 0.12/0.10，金线 0.08/0.06，极紫外 0.06/0.04，仿极紫外 0.08",
 ],
];

const specEn = [
 ["Cap", "21,000,000 TAPE, 8 decimals, no premine, no team share"],
 ["Daily emission", "7,200 a day. The contract has no switch"],
 ["Halving", "210,000 × 600 seconds, about four years. Burns do not change the daily amount"],
 ["Weight", "H = b* × P × q. q stops at 4. A netlist that calls another circuit has H = 0"],
 ["Split", "Verified 99%, unverified 1%. Unverified is 0 in the first week"],
 ["Desk fee", "0.20% of what is paid, on top of the pool fee"],
 ["Spot", "The workshop book is live. New TAPE pool deposits are closed"],
 [
 "Pool lock",
 "Existing positions: 3 months, 6 months, 1 year, 2 years, 3 years. Withdraw only at expiry. No new deposits",
 ],
 [
 "Dividend lock",
 "3 months, 6 months, 9 months, 1 year, 2 years, 3 years. Principal only at expiry",
 ],
 ["Wafer and circuit lock", "6 months, 1 year, 3 years, 4 years, 5 years"],
 ["One tape-out", "18,000 NAND, or 30,000 LATCH. Larger than that does not fit"],
 ["When the circuit exists", "On chain when the receipt succeeds. The page list shows it later"],
 [
 "Circuit spot",
 "Sold whole. The seller receives 99.8 percent. The day price is an estimate, not a receipt",
 ],
 [
 "Circuit Punk card",
 "Confirm at nft.tapeliquid.net first, then trade at app.tapeliquid.net. Claim once a month, within the first 7 days, first come first served. Copper 0.16/0.14, silver 0.12/0.10, gold 0.08/0.06, EUV 0.06/0.04, faux 0.08",
 ],
];

const nowZh = [
 ["TAPE", TAPE],
 ["挖矿", TAPE_MINE],
 ["排放", "每天 7,200，从部署起。没有改率入口"],
 ["权重", "现在按门数。P = 1。q 不能大于 1"],
 ["总供应", "只随领取增加"],
 ["TAPE 池", "0x58eaD5b41Cfd3627791D439402dd65571c286484"],
 ["旧 TAPE 池", "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641，只取"],
 ["锁仓", TAPE_LOCK],
 ["电路锁仓", CIRCUIT_LOCK],
 ["期限质押", `${TAPE_TERM}。0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A 只取`],
 ["工房现货", TAPE_SPOT],
 ["0.1 回购", TAPE_DESK],
 ["电路", DEPLOYED.circuits],
 ["晶体管", DEPLOYED.transistors],
 ["BSC BEM 永续", BSC_REBATE],
 ["BSC 比特币", BTC_COIN_BOOK],
 ["BSC ETH", ETH_COIN_BOOK],
 ["BSC ZEC", ZEC_COIN_BOOK],
 ["BSC UP", `${UP_COIN_BOOK}，标记 0x4ae9c52a00f5911dc2e792d6761e289a6daf3aec`],
 ["X Layer BEM 永续", KNOWN_XPERP],
 ["X Layer TAPE", `${TAPE_COIN_BOOK}，标记 0x6a813faacf11bcbdcb0c13f83a19ba68dd7d85a7`],
 ["X Layer FAB", `${FAB_COIN_BOOK}，标记 0xa6e9f2d6e69ed49c038d120f7c407321951a495b`],
 ["已停用 X Layer BEM", PREV_XPERP],
 ["BSC 跟单", BSC_VAULT],
 ["X Layer 跟单", XLAYER_VAULT],
 ["BSC 借贷 BNB", "0xE81441A86Ef21EBbB48d7aB6F4882781d37275E7"],
 ["BSC 借贷 BEM", "0xadF37625fd37BD64d9064ed3341a31cD23AE635B"],
 ["X Layer 借贷 OKB", "0xB5bBa7ad9dD9e8F8Ab8B339cA0C7660244816114"],
 ["X Layer 借贷 TAPE", "0xd37B08cA41B86F020b63b98126A5Bdd2e92d7Db9"],
 ["X Layer 借贷 BEM", "0x31022B88215D1731C70f3b6eb96bc21764dE83e3"],
 ["BSC 期贷", "0x0e8C5Dc56BeB4b0D1209d9F5CbEc91BBa95764A4"],
 ["X Layer 期贷", "0x0b545E7589A46c9BA6e922C183C681b6EEaeeB9f"],
 ["BSC 返佣", LOCKED_REBATE.bsc],
 ["X Layer 返佣", LOCKED_REBATE.xlayer],
 ["红包章", RED_STAMP],
 ["不要授权", "0xC5A63E4c37c23F97558673731196abC30FBFa659"],
 ["还不能签", "TAPE 跨链"],
];

const nowEn = [
 ["TAPE", TAPE],
 ["Mine", TAPE_MINE],
 ["Emission", "7,200 a day from deployment. No rate switch"],
 ["Weight", "Gate count now. P = 1. q cannot be above 1"],
 ["Supply", "Grows only when claimed"],
 ["TAPE pool", "0x58eaD5b41Cfd3627791D439402dd65571c286484"],
 ["Earlier TAPE pool", "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641, withdraw only"],
 ["Lock", TAPE_LOCK],
 ["Circuit lock", CIRCUIT_LOCK],
 ["Timed stake", `${TAPE_TERM}. 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A withdraws only`],
 ["Workshop spot", TAPE_SPOT],
 ["0.1 buyback", TAPE_DESK],
 ["Circuits", DEPLOYED.circuits],
 ["Transistors", DEPLOYED.transistors],
 ["BSC BEM perpetual", BSC_REBATE],
 ["BSC Bitcoin", BTC_COIN_BOOK],
 ["BSC ETH", ETH_COIN_BOOK],
 ["BSC ZEC", ZEC_COIN_BOOK],
 ["BSC UP", `${UP_COIN_BOOK}, mark 0x4ae9c52a00f5911dc2e792d6761e289a6daf3aec`],
 ["X Layer BEM perpetual", KNOWN_XPERP],
 ["X Layer TAPE", `${TAPE_COIN_BOOK}, mark 0x6a813faacf11bcbdcb0c13f83a19ba68dd7d85a7`],
 ["X Layer FAB", `${FAB_COIN_BOOK}, mark 0xa6e9f2d6e69ed49c038d120f7c407321951a495b`],
 ["Retired X Layer BEM", PREV_XPERP],
 ["BSC copy vault", BSC_VAULT],
 ["X Layer copy vault", XLAYER_VAULT],
 ["BSC lend BNB", "0xE81441A86Ef21EBbB48d7aB6F4882781d37275E7"],
 ["BSC lend BEM", "0xadF37625fd37BD64d9064ed3341a31cD23AE635B"],
 ["X Layer lend OKB", "0xB5bBa7ad9dD9e8F8Ab8B339cA0C7660244816114"],
 ["X Layer lend TAPE", "0xd37B08cA41B86F020b63b98126A5Bdd2e92d7Db9"],
 ["X Layer lend BEM", "0x31022B88215D1731C70f3b6eb96bc21764dE83e3"],
 ["BSC term book", "0x0e8C5Dc56BeB4b0D1209d9F5CbEc91BBa95764A4"],
 ["X Layer term book", "0x0b545E7589A46c9BA6e922C183C681b6EEaeeB9f"],
 ["BSC rebate", LOCKED_REBATE.bsc],
 ["X Layer rebate", LOCKED_REBATE.xlayer],
 ["Red-packet stamp", RED_STAMP],
 ["Do not approve", "0xC5A63E4c37c23F97558673731196abC30FBFa659"],
 ["Not signable yet", "A TAPE bridge"],
];
export function Whitepaper() {
 const lang = useExchange((s) => s.lang);
 const zh = lang === "zh";
 const sections = zh ? zhBody : en;
 const [on, setOn] = useState(0);
 const jump = (i: number) => {
 setOn(i);
 const node = document.getElementById(`paper-${i}`);
 if (node instanceof HTMLDetailsElement) node.open = true;
 node?.scrollIntoView({ behavior: "smooth", block: "start" });
 };
 return (
 <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] lg:items-start">
 <aside className="border-b border-gold/40 bg-paper lg:sticky lg:top-14 lg:max-h-[calc(100dvh-4rem)] lg:overflow-y-auto lg:border-b-0 lg:border-r">
 <p className="px-3 pt-3 text-sm font-medium sm:px-4 sm:pt-4">
 {zh ? "TAPELIQUID 说明" : "TAPELIQUID guide"}
 </p>
 <nav
 className="mt-2 flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-6"
 aria-label={zh ? "目录" : "Contents"}
 >
 {sections.map((section, i) => (
 <button
 key={section.h}
 type="button"
 onClick={() => jump(i)}
 className={`shrink-0 border-b-2 px-2 py-2 text-left text-[13px] lg:border-b-0 lg:border-l-2 lg:px-4 ${on === i ? "border-ink bg-card font-medium" : "border-transparent text-ink/60"}`}
 >
 <span className="mr-1 font-mono text-[11px] text-ink/40">
 {String(i + 1).padStart(2, "0")}
 </span>
 {section.h}
 </button>
 ))}
 </nav>
 </aside>
 <article className="min-w-0 overflow-x-hidden px-3 py-5 sm:px-6 lg:px-10">
 <p className="text-[11px] tracking-[0.22em] text-gold">TAPELIQUID</p>
 <h2 className="mt-2 max-w-3xl font-display text-3xl leading-tight sm:text-5xl">
 {zh ? "从这里开始使用 TAPELIQUID" : "Start here with TAPELIQUID"}
 </h2>
 <details className="mt-4 max-w-2xl">
 <summary className="cursor-pointer text-sm font-medium">{zh ? "说明" : "Guide"}</summary>
 <p className="mt-3 text-sm leading-7 text-ink/75">
 {zh
 ? "先看清平台币、晶体管和电路，再做第一笔。说明只写已经能签名的规则。页面和合约不一致时，以这一页和链上合约为准。"
 : "Read the platform coin, the transistors, and the circuits before the first order. This page only states rules you can sign. If a screen disagrees with a contract, this page and the contract win."}
 </p>
 </details>
 <div className="mt-6 grid border border-gold/40 sm:grid-cols-3">
 {[
 [
 "01",
 zh ? "第一次使用" : "First visit",
 zh ? "TAPE、NAND、LATCH 和电路各是什么" : "What TAPE, NAND, LATCH, and a circuit are",
 0,
 ],
 [
 "02",
 zh ? "开始交易" : "Trade",
 zh ? "现货盘口、永续和电路按张定价" : "The spot book, perpetuals, and circuit prices",
 sections.findIndex((section) => section.h === (zh ? "现货" : "Spot")),
 ],
 [
 "03",
 zh ? "地址与参数" : "Addresses",
 zh
 ? "多签、排放和现在链上的合约"
 : "The multisigs, emission, and live contracts",
 sections.length,
 ],
 ].map(([n, title, line, target]) => (
 <button
 key={String(n)}
 type="button"
 onClick={() =>
 typeof target === "number" && target >= 0 && target < sections.length
 ? jump(target)
 : document.getElementById("paper-now")?.scrollIntoView({ behavior: "smooth" })
 }
 className="border-gold/40 px-4 py-4 text-left not-last:border-b sm:not-last:border-b-0 sm:[&:not(:last-child)]:border-r"
 >
 <span className="font-mono text-[11px] text-gold">{n}</span>
 <span className="mt-2 block text-base font-medium">{title}</span>
 <span className="mt-1 block text-xs leading-5 text-ink/60">{line}</span>
 </button>
 ))}
 </div>
 <details className="mt-4">
 <summary className="cursor-pointer text-sm font-medium">{zh ? "介绍" : "About"}</summary>
 <p className="mt-3 border border-gold/30 bg-card px-4 py-3 text-sm leading-6">
 {zh
 ? "TAPE 是唯一平台币，只在 X Layer。NAND 与 LATCH 是晶体管。电路按张交易，写明输入、输出和门数。BEM 属于 TapeOut 协议官方代表。"
 : "TAPE is the only platform coin, and only on X Layer. NAND and LATCH are the transistors. A circuit trades as one piece, with its inputs, outputs, and gates. BEM is the official representative of the TapeOut protocol."}
 </p>
 </details>
 <div id="paper-now" className="mt-8 grid scroll-mt-24 gap-4">
 <div className="overflow-x-auto border border-gold/30">
 <table className="w-full text-left text-sm">
 <caption className="px-3 py-3 text-left text-xs tracking-widest text-gold">
 {zh ? "参数" : "Parameters"}
 </caption>
 <tbody>
 {(zh ? specZh : specEn).map(([k, v]) => (
 <tr key={k} className="border-t border-gold/20">
 <th className="w-28 min-w-24 px-3 py-2 align-top font-normal text-ink/55 sm:w-36">
 {k}
 </th>
 <td className="break-words px-3 py-2">{v}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 <div className="overflow-x-auto border border-gold/30">
 <table className="w-full text-left text-sm">
 <caption className="px-3 py-3 text-left text-xs tracking-widest text-gold">
 {zh ? "现在链上" : "On chain now"}
 </caption>
 <tbody>
 {(zh ? nowZh : nowEn).map(([k, v]) => (
 <tr key={k} className="border-t border-gold/20">
 <th className="w-28 min-w-24 px-3 py-2 align-top font-normal text-ink/55 sm:w-36">
 {k}
 </th>
 <td className="break-all px-3 py-2 font-mono text-[12px] leading-5 sm:text-sm">
 {v}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </div>
 <div className="mt-6 grid gap-3 sm:grid-cols-3">
 <a
 className="border border-gold/40 px-3 py-3"
 href={`${BSC.explorer}/address/${BSC_SAFE}`}
 target="_blank"
 rel="noreferrer"
 >
 <span className="block text-[11px] tracking-widest text-gold">
 {zh ? "BSC 多签" : "BSC multisig"}
 </span>
 <span className="mt-1 block break-all font-mono text-xs">{BSC_SAFE}</span>
 </a>
 <a
 className="border border-gold/40 px-3 py-3"
 href={`${XLAYER.explorer}/address/${XLAYER_SAFE}`}
 target="_blank"
 rel="noreferrer"
 >
 <span className="block text-[11px] tracking-widest text-gold">
 {zh ? "X Layer 多签" : "X Layer multisig"}
 </span>
 <span className="mt-1 block break-all font-mono text-xs">{XLAYER_SAFE}</span>
 </a>
 <a
 className="border border-gold/40 px-3 py-3"
 href={`${BSC.explorer}/address/${FEE_TO}`}
 target="_blank"
 rel="noreferrer"
 >
 <span className="block text-[11px] tracking-widest text-gold">
 {zh ? "旧合约仍进" : "Older contracts"}
 </span>
 <span className="mt-1 block break-all font-mono text-xs">{FEE_TO}</span>
 </a>
 <a
 className="border border-gold/40 px-3 py-3"
 href={`${XLAYER.explorer}/address/${TAPE}`}
 target="_blank"
 rel="noreferrer"
 >
 <span className="block text-[11px] tracking-widest text-gold">TAPE</span>
 <span className="mt-1 block break-all font-mono text-xs">{TAPE}</span>
 </a>
 <a
 className="border border-gold/40 px-3 py-3"
 href={`${XLAYER.explorer}/address/${TAPE_MINE}`}
 target="_blank"
 rel="noreferrer"
 >
 <span className="block text-[11px] tracking-widest text-gold">
 {zh ? "挖矿" : "Mine"}
 </span>
 <span className="mt-1 block break-all font-mono text-xs">{TAPE_MINE}</span>
 </a>
 </div>
 <div className="mt-10 flex flex-col gap-3">
 {sections.map((section, i) => (
 <details
 key={section.h}
 id={`paper-${i}`}
 className="scroll-mt-24 border-t border-gold/30 pt-3"
 >
 <summary className="cursor-pointer">
 <span className="font-mono text-[11px] text-gold">
 {String(i + 1).padStart(2, "0")} / {section.h}
 </span>
 <span className="mt-2 block font-display text-2xl leading-none sm:text-3xl">
 {section.h}
 </span>
 </summary>
 {section.ps.map((p) => (
 <p key={p.slice(0, 48)} className="mt-3 max-w-3xl text-sm leading-7 text-ink/85">
 {p}
 </p>
 ))}
 </details>
 ))}
 </div>
 </article>
 </div>
 );
}
