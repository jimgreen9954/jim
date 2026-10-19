import { useEffect, useState } from "react";

type Section = { h: string; ps: string[] };
type Lang = "zh" | "en";

const zh: Section[] = [
  {
    h: "摘要",
    ps: [
      "TAPELIQUID 是 TapeOut 的市场。已经能用的是三件事：创世电路在官方市场上买卖，BEM 和 OKB 在官方池子里兑换，钱包用 OKX 登录和退出。钱不进这个网页。签名之前，币留在你的钱包里。",
      "本站自己的发射规则只约束在这里创建的项目。tapeout.net 上已经铸出的晶体管和流片电路仍是协议原件，本站认同一份合约，不另铸，也不改官网的 BNB 或 OKB 铸造价。",
      "创建项目的按钮还没有接到链上。下面写的金库、销毁和线性释放是规则，点页面现在不会扣款。",
    ],
  },
  {
    h: "创世电路",
    ps: [
      "创世处理器是 BSC 上的 0x50A994E71615474b55559fF4F500928fbc339DD9。链上枚数以 nextId 为准，写这一页时是 12,454。买卖走 TapeOut 官方电路市场 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f。",
      "只有市场上的有效挂单能买。买家用 OKX 钱包按挂单价支付 BNB。市场手续费按合约里的 feeBps，目前是 1%，从成交价里扣。没有挂单的电路不能按一个假价格买。",
      "持有人挂单也走这份市场。第一次挂单要先授权。取消签名就等于没成交。收据上链之前，页面不改持有人。",
    ],
  },
  {
    h: "兑换",
    ps: [
      "点 BEM，打开 BSC 上的 BEM / USDT。报价来自链上报价合约，滑点 1%。点 OKX 兑换才会发交易。",
      "点 OKB，打开 X Layer 上的 BEM / OKB。报价是池子中间价，成交至少要到 95%。池子是 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A，路由是 0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca。",
      "BEM 可以走 TapeOut 官方桥，BSC 和 X Layer 一比一。桥合约在 BSC 是 0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72。OKB 和 TAPE 没有这条桥，页面不会假装跨过去。",
      "这两笔兑换付的是池子手续费和 gas。本站写在发射规则里的 0.2% 二级费，要等本站项目的二级市场接到链上才收。现在的 BEM、OKB 兑换不另收这一笔。",
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
      "铸造结束后代币这样分，分的是这次发射的那种代币。30% 项目方可以领取。40% 放进金库，谁也取不出来。金库里的代币每天回购价格低于铸造价 3 倍的 NFT，直到卖完。另外 30% 分 3 个月线性释放。价格低于铸造价 2 倍时，这部分不能领，并用金库里的发射代币自动买入 TAPE 和 BEM 各一半，然后销毁。",
      "金库地址任何人都取不出。平台二级交易手续费 0.2%，其中一半回购并销毁 TAPE，另一半归平台。这些条款只约束在本站创建、并且合约上线之后的项目。",
    ],
  },
  {
    h: "协议上已有的资产",
    ps: [
      "官网晶体管的最新价和最高买价来自 tapeout.net。挂买单、卖给买价，发到官网同一份 BSC 合约 0xA6a80C1919a8326022d7c601a488888C13aA16E4。",
      "在 tapeout.net 流片得到的电路本来就是 ERC-721。本站展示的是同一枚，不套用 1 TAPE 对 0.001 BEM。本站没有另做一份电路市场去代买这些协议电路。",
    ],
  },
  {
    h: "账户",
    ps: [
      "登录和创世、兑换的签名走 OKX 钱包。右上角可以连接，用户中心可以退出。退出只断开这个页面，不会转走资产。",
      "用户中心显示的是这个地址在 BSC 和 X Layer 上的 BNB、BEM、USDT、OKB。这是链上余额，不是欧易交易所账户。昵称和头像只存在这台浏览器。",
      "顶栏可以切换中文和英文。语言存在这台浏览器，不写上链。",
    ],
  },
  {
    h: "风险",
    ps: [
      "创世市场和兑换池都不是本站的托管。节点失败时，页面可能暂时读不到挂单或报价，链上的状态还在。",
      "TAP-721 还是草案。页面上的网表哈希是预览，不是已经流片的电路。发射金库、销毁和线性释放在创建合约部署之前都不执行。",
      "只使用你亏得起的钱。这不是招股，不是托管，也不保证成交、上线进度或价格。",
    ],
  },
];

const en: Section[] = [
  {
    h: "Abstract",
    ps: [
      "TAPELIQUID is a TapeOut market. Three things already work: genesis circuits trade on the official market, BEM and OKB swap in official pools, and login and logout use OKX Wallet. Funds do not sit in the page. Tokens stay in the wallet until you sign.",
      "The launch rules on this site bind only projects created here. Transistors and circuits already minted on tapeout.net stay the protocol originals. This site recognizes that contract, does not mint a second copy, and does not change the official BNB or OKB mint price.",
      "The create button is not wired to a contract yet. The vault, burn, and vesting below are the rules. Clicking the page does not charge you.",
    ],
  },
  {
    h: "Genesis circuits",
    ps: [
      "The genesis processor is 0x50A994E71615474b55559fF4F500928fbc339DD9 on BSC. Supply is nextId. When this page was written it was 12,454. Trades use the official TapeOut circuit market 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f.",
      "Only a live listing can be bought. The buyer pays the listed BNB price from OKX Wallet. The market fee is the contract feeBps, currently 1%, taken from the price. An unlisted circuit cannot be bought at an invented price.",
      "A holder lists on that same market. The first list needs an approval. Cancelling the signature means no trade. The page does not change the owner before the receipt.",
    ],
  },
  {
    h: "Swap",
    ps: [
      "BEM opens BEM / USDT on BSC. The quote comes from the on-chain quoter, with 1% slippage. The transaction is sent only when you tap Swap with OKX.",
      "OKB opens BEM / OKB on X Layer. The quote is the pool mid price, and a fill must clear at least 95%. The pool is 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A. The router is 0x4f0c28f5926afda16bf2506d5d9e57ea190f9bca.",
      "BEM can use the official TapeOut bridge, one for one, between BSC and X Layer. The BSC bridge is 0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72. OKB and TAPE have no such bridge. The page will not pretend they do.",
      "These swaps pay the pool fee and gas. The 0.2% secondary fee in the launch rules is collected only after this site's own secondary market is on chain. BEM and OKB swaps do not add that fee today.",
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
      "After the mint, that launch token splits three ways. 30% can be claimed by the project. 40% sits in the vault and nobody can withdraw it. Each day the vault buys NFTs priced under 3 times the mint price until they are gone. The other 30% vests to the project over 3 months. If the price is under 2 times the mint price, that slice cannot be claimed, and the vault spends the launch token half on TAPE and half on BEM, then burns both.",
      "Nobody can withdraw from the vault address. The secondary fee is 0.2%. Half buys and burns TAPE. Half goes to the platform. These terms bind only projects created here, and only after their contract is live.",
    ],
  },
  {
    h: "Assets already on the protocol",
    ps: [
      "Official transistor prices come from tapeout.net. Bids and sales go to the same BSC contract, 0xA6a80C1919a8326022d7c601a488888C13aA16E4.",
      "A circuit taped out on tapeout.net is already an ERC-721. This site shows that same token. It does not apply the 1 TAPE to 0.001 BEM price. This site does not run a second market that buys those protocol circuits for you.",
    ],
  },
  {
    h: "Account",
    ps: [
      "Login, genesis trades, and swaps sign in OKX Wallet. Connect from the top right. Log out from the account page. Logout only disconnects this page. It does not move assets.",
      "The account page shows this address's BNB, BEM, and USDT on BSC, and OKB and BEM on X Layer. Those are on-chain balances, not an OKX exchange account. The name and avatar stay in this browser.",
      "The top bar switches Chinese and English. The choice stays in this browser and is not written on chain.",
    ],
  },
  {
    h: "Risk",
    ps: [
      "The genesis market and the swap pools are not custodied here. If a node fails, the page may hide a listing or a quote that is still on chain.",
      "TAP-721 is still a draft. A netlist hash on this page is a preview, not a taped-out circuit. The launch vault, burn, and vesting do not run until the creation contract is deployed.",
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
