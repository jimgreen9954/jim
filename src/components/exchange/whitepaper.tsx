import { useEffect, useState } from "react";

type Section = { h: string; ps: string[] };
type Lang = "zh" | "en";

const zh: Section[] = [
  {
    h: "摘要",
    ps: [
      "TAPELIQUID 是 TapeOut 的市场。已经能用的是三件事：创世电路在官方市场上买卖，BEM 和 OKB 在官方池子里兑换，右上角钱包可以登录、退出，并在 BSC 和 X Layer 之间切换。钱不进这个网页。签名之前，币留在你的钱包里。",
      "本站自己的发射规则只约束在这里创建的项目。tapeout.net 上已经铸出的晶体管和流片电路仍是协议原件，本站认同一份合约，不另铸，也不改官网的 BNB 或 OKB 铸造价。",
      "创建调用已部署的工厂 0x2872E6D6AB14C5Cdb08587b437Bd16248270A04d，部署交易 0x73ebdd1527e39065ba4da9f8869b5c06d8a3d5e62cbefe64ccddda24e94f5dd0。收费地址、0.026 OKB 进金库、回购开关都写死在这份合约里。没有管理员，不能升级，也不能把金库转走。页面不再另签一份工厂。",
    ],
  },
  {
    h: "电路朋克",
    ps: [
      "电路朋克，符号 CPUNK，是本站的创世 NFT。它是第一款电路朋克，也是唯一一款。TapeOut 上已经流片的创世电路仍是协议原件，买卖走官网市场。电路朋克不是那一批的复制，本站也不再另开第二套。",
      "总量一万。七千张预留，不进公开铸造，预留要一笔领一张。三千张公开铸造，价锁在 1 TAPE 加 0.001 BEM，单人最多 10 次。只有名称正好是「电路朋克」时，创建才会把本站图片地址写进合约。改了名称，图片地址留空，那就不是电路朋克。工厂合约不按名字拒绝第二次创建。别人若用同一名字再调工厂，链上拦不住，但那不是这一款，本站也不会再发一套图。",
      "每一张按编号现算，24×24 像素，不上传原图，也不临摹商标和真人。种类是极紫外晶粒 9、键合巨像 24、报废晶粒 88，其余按晶圆人像、吉祥晶粒、对准标记、缺陷图样、纪念版图的比例排开。衬底、金属层、对准、键合、封装跟编号走。创建签名上链之后，图片地址写死，不能改。在那之前，图只在本站。",
    ],
  },
  {
    h: "创世电路",
    ps: [
      "创世处理器是 BSC 上的 0x50A994E71615474b55559fF4F500928fbc339DD9。链上枚数以 nextId 为准，写这一页时是 12,454。买卖走 TapeOut 官方电路市场 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f。",
      "只有市场上的有效挂单能买。买家用已连接的钱包按挂单价支付 BNB。市场手续费按合约里的 feeBps，目前是 1%，从成交价里扣。没有挂单的电路不能按一个假价格买。",
      "持有人挂单也走这份市场。第一次挂单要先授权。取消签名就等于没成交。收据上链之前，页面不改持有人。",
    ],
  },
  {
    h: "兑换",
    ps: [
      "点 BEM，打开 BSC 上的 BEM / USDT。报价来自链上报价合约，滑点 1%。点兑换才会发交易，钱包会自己切到 BSC。",
      "点 OKB，打开 X Layer 上的 BEM / OKB。报价是池子中间价，成交至少要到 95%。池子是 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A，路由是 0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca。",
      "BEM 可以走 TapeOut 官方桥，BSC 和 X Layer 一比一。桥合约在 BSC 是 0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72。OKB 和 TAPE 没有这条桥，页面不会假装跨过去。",
      "点 TAPE，打开 X Layer 官方池 TAPE / USDT，合约 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641。池子要报价一侧到 5,000 USDT 才放行。没到之前页面只给报价，不发交易。现在的存量远小于这个数，流动性很小。",
      "BEM、OKB 兑换付的是池子手续费和 gas。本站写在发射规则里的 0.2% 二级费，要等本站项目的二级市场接到链上才收。现在的 BEM、OKB、TAPE 兑换不另收这一笔。",
    ],
  },
  {
    h: "本站发射",
    ps: [
      "公开价锁定 1 TAPE 对 0.001 BEM。倍数只能是整数，两边一起放大，不能只改一边。也可以改用 OKB，或只用 BEM。用哪种代币发射，公开铸造和二级交易就只用哪种。OKB 的单位是 1，BEM 的单位是 0.001，同样只能按整数倍放大。",
      "预留从总量里划出，不参与公开铸造，不能超过总量。单人最多铸造 10 次。总量由项目方自定。创建时按总量生成芯片属性和稀有度，同一项目里属性组合不重复。图片可以自己上传，也可以用自己的 Key 或平台默认生成，风格分朋克和真实。",
      "每枚 NFT 按 TAP-721 草案，除图片外还带一份 tapnet 网表和 SHA-256。标准还在社区审核，这里只出可核验的预览，标的是 L0、未流片，不假装已经铸上链。草案在 github.com/BruceLanLan/TAP-721。",
    ],
  },
  {
    h: "金库和分配",
    ps: [
      "发射前，项目方必须先放入价值 3 美元的 OKB，这笔进金库。创建另付 1 TAPE + 0.01 枚发射代币。1 TAPE 直接销毁。OKB 发射锁进 0.01 OKB，BEM 或 TAPE 对发射锁进 0.01 BEM。",
      "铸造收进来的，是这次发射的那种代币。创建时就分成三份，放在项目合约的两个账本里，之后不用项目方再签名。30% 在售罄收盘后，项目方可以领取。40% 没有提取函数。收盘后，本合约里低于铸造价 2 倍、并且已经挂满 1 天的 NFT，任何人可以叫合约用这 40% 买下，NFT 打进销毁地址。收盘时把这 40% 记成基数。每天最多花掉基数的九十分之一，当天没花完也不结转。90 天都有人来买，这 40% 可以花完，一天花不空。一天的上限小于一张合格挂单时，这张单就买不了。项目方自己的地址不能卖给这份钱。进金库的 OKB 种子，以及锁进去的 0.01，不参与回购。另一个地址仍可能挂低价慢慢卖，所以有每天的上限，一天抽不空。",
      "最后 30% 不是按天线性释放。售罄满 90 天，并且连续 3 个自然日都满足：至少有一笔挂单不低于铸造价 2 倍、而且挂满了 1 天，同时没有任何低于 2 倍的挂单，项目方可以一次领完。满 90 天之后如果连续 3 天做不到，这 30% 永久不能领。之后任何人可以调用 tick。记成一天、烧掉当天那一份，或买下一张低于两倍的单，调用者拿这次支出的 5%，从当天的九十分之一里出，不是另加。当天这份预算用完就不再付。网页不保管私钥，链也不会自己醒。账上如果是 BEM 或 TAPE，直接销毁，不拿去卖。如果是 OKB，一半买 BEM、一半买 TAPE，买到就销毁，直到这份钱花完。",
      "两倍看的是本合约自己的挂单，不是同一笔交易里的现货价。现货价可以在一笔里被打低，拿它当开关，金库会被抽走，所以没有这条路径。别人如果拿一枚 NFT 连续三天挂在两倍下面，而这张单又贵过当天的回购上限、买不掉，最后这 30% 会被判负。OKB 去买 BEM 和 TAPE 时，最少要拿到池子中间价的 95%。搜索者仍可能把这一天买差，但一天最多动九十分之一。",
      "二级手续费 0.2% 只在这份合约自己的成交里收。平台那一半给 0x7a2cC9b4dd8302FDD104159CeE97Be8a90BF772c。TAPE、BEM 或 OKB 的另一半留在项目合约里，没有提取函数，这份字节码也不会把 TAPE 那一半转进销毁地址。成交当中不会拿它去买别的币。OKX 和官网市场不经过这里。已经上链的永续、现货和预言机仍付给 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D，那些合约改不了。",
    ],
  },
  {
    h: "协议上已有的资产",
    ps: [
      "官网晶体管的最新价和最高买价来自 tapeout.net。挂买单、卖给买价，发到官网同一份 BSC 合约 0xA6a80C1919a8326022d7c601a488888C13aA16E4。",
      "在 tapeout.net 流片得到的电路本来就是 ERC-721。本站展示的是同一枚，不套用 1 TAPE 对 0.001 BEM，也不另开一份市场。有挂单的，购买是直接签官网市场 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f，一笔签名，不先扣本站手续费。没挂单的不能买。",
      "TapeCode-Test1 是 X Layer 合集，合约 0x0e91460d6823c711643e650a9a4c0cc21de41614。OKX 的公开接口没有成交签名，所以 OKX 上的价格不能在这里吃。持有人可以在本站另挂一笔，买家付 OKB，经 X Layer 上的 Seaport 成交。以太坊上的 OpenSea 系列只有地板价，没有签名，不能在这条链上成交，页面也不跳走。",
    ],
  },
  {
    h: "账户",
    ps: [
      "登录、创世买卖和兑换，用右上角连上的钱包签名。可以是浏览器钱包、OKX、币安，或页面认到的其他钱包。没连上时右上角是登录，连上之后旁边是退出，也可以切 BSC 和 X Layer。退出只断开这个页面，不会转走资产。本站不接收私钥，也不会把私钥写进页面或仓库。",
      "资产页主要看这个地址的链上资产。昵称、头像和背景点一下就改：点头像换头像，点背景换背景，点名字改名字。只存在这台浏览器，绑在当前钱包。",
      "用户中心显示的是这个地址在 BSC 和 X Layer 上的 BNB、BEM、USDT、OKB。这是链上余额，不是欧易交易所账户。昵称和头像只存在这台浏览器。",
      "顶栏可以切换中文和英文。语言存在这台浏览器，不写上链。",
    ],
  },
  {
    h: "风险",
    ps: [
      "创世市场和兑换池都不是本站的托管。节点失败时，页面可能暂时读不到挂单或报价，链上的状态还在。",
      "TAP-721 还是草案。页面上的网表哈希是预览，不是已经流片的电路。回购和满 90 天的那 30% 要等项目在这份工厂里创建并收盘之后才跑。只用 OKB 发射时，判负后的 OKB 要先去买 BEM 和 TAPE；TAPE 官方池没开到 5,000 USDT 之前，这一步会失败，钱留在项目合约里。",
      "只使用你亏得起的钱。这不是招股，不是托管，也不保证成交、上线进度或价格。",
    ],
  },
];

const en: Section[] = [
  {
    h: "Abstract",
    ps: [
      "TAPELIQUID is a TapeOut market. Three things already work: genesis circuits trade on the official market, BEM and OKB swap in official pools, and the top-right wallet can log in, log out, and switch BSC or X Layer. Funds do not sit in the page. Tokens stay in the wallet until you sign.",
      "The launch rules on this site bind only projects created here. Transistors and circuits already minted on tapeout.net stay the protocol originals. This site recognizes that contract, does not mint a second copy, and does not change the official BNB or OKB mint price.",
      "Create calls the deployed factory 0x2872E6D6AB14C5Cdb08587b437Bd16248270A04d, deployment 0x73ebdd1527e39065ba4da9f8869b5c06d8a3d5e62cbefe64ccddda24e94f5dd0. The fee address, the 0.026 OKB seed, and the buyback switch are fixed in that contract. It has no admin, no upgrade, and no way to pull the vault out. The page does not deploy a second factory.",
    ],
  },
  {
    h: "Circuit Punk",
    ps: [
      "Circuit Punk, symbol CPUNK, is this site's genesis NFT. It is the first circuit-punk collection, and the only one. Genesis circuits already taped out on TapeOut stay the protocol originals and still trade on the official market. Circuit Punk is not a copy of that set, and this site will not open a second one.",
      "Supply is 10,000. 7,000 are reserved and skip the public mint. Each reserved token is claimed with its own signature. 3,000 are public, locked at 1 TAPE plus 0.001 BEM, at most 10 mints a wallet. The image address is written into the contract only when the name is exactly 电路朋克. Any other name leaves that address empty, and that project is not Circuit Punk. The factory does not refuse a second create that reuses the name. Such a call is not this collection, and this site will not publish a second set of pictures.",
      "Each token is drawn from its number, 24 by 24 pixels. No source file is uploaded. Trademarks and real people are not copied. The census is 9 extreme-ultraviolet dies, 24 bond colossi, and 88 scrap dies. The rest follow the split of wafer portraits, mascot dies, alignment marks, defect patterns, and memorial layouts. Substrate, metal, alignment, bond, and package follow the number. After the create receipt the image address is fixed. Before that, the pictures live only on this site.",
    ],
  },
  {
    h: "Genesis circuits",
    ps: [
      "The genesis processor is 0x50A994E71615474b55559fF4F500928fbc339DD9 on BSC. Supply is nextId. When this page was written it was 12,454. Trades use the official TapeOut circuit market 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f.",
      "Only a live listing can be bought. The connected wallet pays the listed BNB price. The market fee is the contract feeBps, currently 1%, taken from the price. An unlisted circuit cannot be bought at an invented price.",
      "A holder lists on that same market. The first list needs an approval. Cancelling the signature means no trade. The page does not change the owner before the receipt.",
    ],
  },
  {
    h: "Swap",
    ps: [
      "BEM opens BEM / USDT on BSC. The quote comes from the on-chain quoter, with 1% slippage. The transaction is sent only when you tap Swap. The wallet switches to BSC.",
      "OKB opens BEM / OKB on X Layer. The quote is the pool mid price, and a fill must clear at least 95%. The pool is 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A. The router is 0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca.",
      "BEM can use the official TapeOut bridge, one for one, between BSC and X Layer. The BSC bridge is 0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72. OKB and TAPE have no such bridge. The page will not pretend they do.",
      "TAPE opens the official X Layer pool TAPE / USDT, contract 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641. The pool does not accept swaps until the quote side reaches 5,000 USDT. Before that the page shows a quote and does not send a transaction. The current reserve is far below that, so liquidity is thin.",
      "BEM and OKB swaps pay the pool fee and gas. The 0.2% secondary fee in the launch rules is collected only after this site's own secondary market is on chain. BEM, OKB and TAPE swaps do not add that fee today.",
    ],
  },
  {
    h: "Launches on this site",
    ps: [
      "The public price is locked at 1 TAPE to 0.001 BEM. The multiplier is an integer and scales both sides. One side cannot be edited alone. A project can instead launch in OKB only, or in BEM only. The token you launch with is the token used for the public mint and for secondary trades. OKB steps by 1. BEM steps by 0.001.",
      "A reserve is carved from supply, skips the public mint, and cannot exceed supply. One wallet can mint at most 10 times. The creator sets the supply. Creation assigns chip traits and rarity across the supply. Combinations do not repeat inside one project. Art can be uploaded, generated with your own key, or generated by the platform, in punk or realistic style.",
      "Each NFT follows the TAP-721 draft. Besides the image it carries a tapnet netlist and a SHA-256. The standard is still in community review. This site shows a checkable preview, marked L0 and not taped out. It does not pretend the circuit is on chain. The draft is at github.com/BruceLanLan/TAP-721.",
    ],
  },
  {
    h: "Vault and allocation",
    ps: [
      "Before launch the creator deposits 3 dollars of OKB into the vault. Creation also pays 1 TAPE plus 0.01 of the launch token. The 1 TAPE is burned. An OKB launch locks 0.01 OKB. A BEM launch or a TAPE pair locks 0.01 BEM.",
      "What the mint takes in is the launch token. It is split into three parts as it arrives, and the two ledgers inside the project spend themselves. The creator does not sign again. 30% can be claimed once the sale closes. 40% has no withdraw. After close, a listing on this contract under twice the mint price, already a day old, can be bought with that 40%. The NFT is burned. At close that 40% is written down as the base. Each day can spend at most one ninetieth of that base. What is left that day does not roll forward. Ninety called days can spend the whole 40%, but one day cannot. A listing priced above that day's slice is never bought. The creator's own address cannot sell into it. The OKB seed and the locked 0.01 are not part of the buyback. A second wallet can still sell in slowly, which is why the day is capped.",
      "The last 30% is not a linear vest. Ninety days after the close, the creator can take all of it only if three consecutive days each had a listing at or above twice the mint price that was already a day old, and no listing under twice. After those ninety days, three cheap or missing days forfeit it forever. Anyone may then call tick. Recording the day, burning that day's slice, or buying one listing under twice mint pays the caller 5% of that spend, taken out of the day's ninetieth, not added on top. When the day's budget is used up, the call is not paid. This site holds no key, and the chain does not wake itself. BEM or TAPE already held is burned, not sold. OKB is spent half on BEM and half on TAPE, and both are burned, until that ledger is empty.",
      "Twice mint is this contract's own listings, not a spot price printed in the same transaction. A spot print can be pushed under twice inside one transaction and would drain a vault that bought on it. That path is not in the bytecode. One NFT listed under twice for three days, at a price the daily cap cannot pay, forfeits the last 30%. The OKB buy must receive at least 95% of the pool mid. A searcher can still worsen that one day. One day is at most one ninetieth.",
      "The 0.2% secondary fee is charged only on sales inside this contract. The platform half goes to 0x7a2cC9b4dd8302FDD104159CeE97Be8a90BF772c. The other half of a TAPE, BEM, or OKB payment stays in the project contract. This bytecode has no withdraw for it, and it does not transfer the TAPE half to the burn address. The sale does not swap that half. OKX and the official market do not pass through here. Spot, perpetuals, and the mark that are already on chain still pay 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D. Those contracts cannot be retargeted.",
    ],
  },
  {
    h: "Assets already on the protocol",
    ps: [
      "Official transistor prices come from tapeout.net. Bids and sales go to the same BSC contract, 0xA6a80C1919a8326022d7c601a488888C13aA16E4.",
      "A circuit taped out on tapeout.net is already an ERC-721. This site shows that same token. It does not apply the 1 TAPE to 0.001 BEM price, and it does not run a second market. A listing is bought with one signature on the official market 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f. Nothing is charged first. An unlisted circuit cannot be bought.",
      "TapeCode-Test1 is an X Layer collection, contract 0x0e91460d6823c711643e650a9a4c0cc21de41614. OKX's public feed has no fill signature, so an OKX price cannot be taken here. A holder can list a new order on this site. The buyer pays OKB through Seaport on X Layer. OpenSea collections on Ethereum are floor prices only. There is no signature, they cannot settle on this chain, and the page does not leave.",
    ],
  },
  {
    h: "Account",
    ps: [
      "Login, genesis trades, and swaps sign with whichever wallet is connected from the top right: a browser wallet, OKX, Binance, or any other wallet the page detects. Logged out, the corner says Log in. Once connected, Log out sits beside the address, and BSC or X Layer can be switched. Logout only disconnects this page. It does not move assets. This site never asks for a private key, and a key is not written into the page or the repository.",
      "The assets page is mainly this address's balances. Click the avatar to change it, the banner to change the background, and the name to rename. Those stay in this browser, tied to the connected wallet.",
      "The account page shows this address's BNB, BEM, and USDT on BSC, and OKB and BEM on X Layer. Those are on-chain balances, not an OKX exchange account. The name and avatar stay in this browser.",
      "The top bar switches Chinese and English. The choice stays in this browser and is not written on chain.",
    ],
  },
  {
    h: "Risk",
    ps: [
      "The genesis market and the swap pools are not custodied here. If a node fails, the page may hide a listing or a quote that is still on chain.",
      "TAP-721 is still a draft. A netlist hash on this page is a preview, not a taped-out circuit. Buyback and the last 30% run only after a project is created on this factory and the sale closes. An OKB-only forfeit tries to buy BEM and TAPE. Until the official TAPE pool reaches 5,000 USDT, that step fails and the OKB stays in the project.",
      "Use only money you can lose. This is not an offering, not custody, and not a promise of a fill, a date, or a price.",
    ],
  },
];

export function Whitepaper() {
  const [lang, setLang] = useState<Lang>("zh");
  useEffect(() => {
    const stored = window.localStorage.getItem("tape-lang") === "en" ? "en" : "zh";
    setLang(stored);
  }, []);
  const sections = lang === "zh" ? zh : en;
  const flip = () => {
    const next = lang === "zh" ? "en" : "zh";
    window.localStorage.setItem("tape-lang", next);
    setLang(next);
  };
  return (
    <article className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 text-zinc-900">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-widest text-zinc-500">TAPELIQUID</p>
          <h2 className="text-4xl font-semibold leading-none">{lang === "zh" ? "白皮书" : "White paper"}</h2>
        </div>
        <button type="button" className="rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold" onClick={flip}>
          {lang === "zh" ? "EN" : "中文"}
        </button>
      </header>
      {sections.map((section) => (
        <section key={section.h} className="border-t border-zinc-200 pt-3">
          <h3 className="text-xl font-semibold">{section.h}</h3>
          {section.ps.map((p) => (
            <p key={p.slice(0, 32)} className="mt-2 text-sm leading-relaxed text-zinc-600">
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
