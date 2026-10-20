import { useEffect, useState } from "react";
import { setUiLang } from "@/lib/locale";

type Section = { h: string; ps: string[] };
type Lang = "zh" | "en";

const zh: Section[] = [
  {
    h: "摘要",
    ps: [
      "TAPELIQUID 是 TapeOut 的市场。已经能用的是四件事：Circuit Punk 在本站市场挂单成交，创世电路在官方市场上买卖，BEM、OKB 和 TAPE 在官方池子里兑换，右上角钱包可以登录、退出，并在 BSC 和 X Layer 之间切换。钱不进这个网页。签名之前，币留在你的钱包里。",
      "本站自己的发射规则只约束在这里创建的项目。tapeout.net 上已经铸出的晶体管和流片电路仍是协议原件，本站认同一份合约，不另铸，也不改官网的 BNB 或 OKB 铸造价。",
      "创建调用已部署的工厂 0x2872E6D6AB14C5Cdb08587b437Bd16248270A04d，部署交易 0x73ebdd1527e39065ba4da9f8869b5c06d8a3d5e62cbefe64ccddda24e94f5dd0。收费地址、0.026 OKB 进金库、回购开关都写死在这份合约里。没有管理员，不能升级，也不能把金库转走。页面不再另签一份工厂。",
    ],
  },
  {
    h: "Circuit Punk",
    ps: [
      "Circuit Punk，符号 CPUNK，是本市场的创始收藏。它是第一套 Circuit Punk，也是唯一一套。发行所依据的文本，是 TapeOut 的 Netlist-Bound NFT 草案，提案名称为 TAP-721。该草案于 2026 年 10 月 18 日提交至 TapeOutProtocol/TAPs，编号尚未由编辑正式分配，现以议题 66 与拉取请求 67 中的文本为准，公开副本在 github.com/BruceLanLan/TAP-721。",
      "TAP-721 扩展 ERC-721。每一枚代币除图像外，还绑定一份自包含的 tapnet/1 网表：TAP-02 所定义的 NAND 与 LATCH 记录，前置 16 字节文件头，不含 REF。该文件的 SHA-256 即网表哈希。一致性分为两级。L0 只要求元数据给出图像、网表与哈希，合约不必实现 ITapNetlistNFT。L1 才把网表接口写入合约。Circuit Punk 目前处于 L0。持有人可以核对网表与哈希，但不能据此主张已经流片，也不能把它视为协议上的创世电路。创世电路仍是 TAP-10 下的 ERC-721，交易继续在官网市场完成。",
      "创始收藏里的 OG，指的是名册，不是修饰。比特币一侧收入 Hal Finney、Adam Back 与 Jameson Lopp，分别对应第一个客户端、工作量证明的前身，以及节点与自托管的公开实践。BEM 一侧收入早期持有人，其中包括 TapeCode 一号、火星人 @bitcoin2themars，以及协议创始人 @Blonskr。2026 年 10 月 19 日，这些当时公开的头像被收成 24×24 的电路肖像，写入这一万枚的生成规则，供后来的读者辨认这条路是从哪里走来的。肖像仅为纪念。本文件不构成投资建议。本收藏不使用商标。被收入者可以要求撤下相应底样。版图仍由编号决定：极紫外晶粒 9 枚，键合巨像 24 尊，报废晶粒 88 片，其余为晶圆人像、吉祥晶粒、对准标记、缺陷图样与纪念版图。",
      "合约在 X Layer：0xB5ac1dddc158a639D4499aad2d8F393989D4bD34。总量一万。三千张公开铸造已经打开，价锁在 1 TAPE 加 0.001 BEM，一个钱包最多 10 次，编号从 7001 起。七千张是预留，不进公开价。图片地址 https://tapeliquid.net/api/circuit-punk/ 已经写死，不能改。页面上一律写作 Circuit Punk。链上名称已经固定，改名再创建的不是这一套图。工厂不按名字拦第二次创建。别人再调一次，链上拦不住，但那不是这一款。",
      "本站市场只做 Circuit Punk。铸造页只铸造，成交不在那里。挂单可以按 BEM 标价，也可以按 TAPE 标价。买家两边一起付，按 1 BEM 对 1000 TAPE。手续费 0.2%，从成交里扣。挂出后 NFT 进合约托管。卖家在市场的「我的挂单」里撤单，不用再翻整本图录。点开一张，看类型、衬底、金属层、对准、键合、封装，以及存世和稀有度。点旁边空白处收起。持有的张数、编号和图片只在资产页。",
      "预留是一份名册，不是一句谢辞。TapeCode-Test1 一号，火星人 @bitcoin2themars，地址 0xddb587D88C0AFa42317E033bDD11edC2462B873f，空投 100 张，编号 51–150。TapeCode #8855，TapeOut 协议创始人 @Blonskr，地址 0x571d447f4f24688eC35Ccf07f1D6993655F6aF15，空投 50 张，编号 1–50。TapeCode 持有地址一人一张，编号 1000–6019，共 5020 张。本站电路持有地址一人一张，编号 151–369，共 219 张。销毁地址里的 TapeCode 不在名册上。",
      "还没领出的是 1611 张：370–999，以及 6020–7000。这 1611 张留给基金会，不进公开价，仍要创建者一笔领一张。",
    ],
  },
  {
    h: "以后",
    ps: [
      "公开的三千张从 7001 起继续铸造，价锁在 1 TAPE 加 0.001 BEM。市场只做这一套：按属性筛，按稀有度排，挂单用 BEM 或 TAPE 标价，成交两边一起付。",
      "基金会那 1611 张不拿来凑公开盘。它们留给以后的纪念和新计划，编号已经划定，不另开第二套 Circuit Punk。",
      "TAPE 官方池要到报价一侧 5,000 USDT 才放行兑换。此前只报价。回购和最后 30% 不自己醒来，要等项目在这份工厂里收盘，再由任何人来调用。链上的账比页面上的句子硬。",
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
      "每枚收藏按 TAP-721 草案携带图像、tapnet/1 网表和 SHA-256。Circuit Punk 目前是 L0：哈希可以核对，标准仍在社区审核，这里不把它写成 L1，也不假装已经流片。草案在 github.com/BruceLanLan/TAP-721。",
    ],
  },
  {
    h: "金库和分配",
    ps: [
      "发射前，项目方放入当时价值 3 美元的 OKB，记为金库种子。已部署工厂的种子是 0.026 OKB。创建另付 1 TAPE，直接销毁。TAPE + BEM 与只用 BEM，再锁入 0.01 BEM。只用 OKB，再锁入 0.01 OKB。种子和这 0.01 不进入下面三份。",
      "公开铸造收到的，只是这次选择的代币。每一笔按整数分成三份，除不尽的余数留在第三份。30% 记在项目方可领账上。30% 记在释放账上，不按天发给项目方。40% 记在回购账上，没有提取函数。售罄后任何人可以收盘。未售罄时，只有项目方能在创建满 90 天后收盘。收盘后，项目方可领取那 30%，不看价格。",
      "倍数为 1、公开 3000 张时，三份正好落在整数上。TAPE + BEM 收进 3000 TAPE 与 3 BEM，分成 900 / 900 / 1200 TAPE，以及 0.9 / 0.9 / 1.2 BEM。只用 OKB 收进 3000 OKB，分成 900 / 900 / 1200 OKB。只用 BEM 收进 3 BEM，分成 0.9 / 0.9 / 1.2 BEM。",
      "回购花的是这 40%。收盘时把它记成基数。每天最多花基数的九十分之一，当日未用的部分不结转。单子必须低于铸造价两倍，并且已经挂满 1 天。项目方自己的地址不能卖给它。买下之后，NFT 转到销毁地址，款项付给卖家。TAPE + BEM 同时付 BEM 和 1000 倍的 TAPE。只用 BEM 只付 BEM。只用 OKB 只付 OKB。这 40% 不到市场上去买 TAPE 或 BEM。3000 张、倍数 1 时，一天的上限约为 0.0133 BEM 加 13.33 TAPE，或 13.33 OKB，低于两倍的一张单买得动。公开只铸出 1 张时，一天的上限小于最低挂单，回购买不了。",
      "释放账上的 30%，要收盘满 90 天，并且连续 3 个自然日都满足：至少有一张不低于两倍、已挂满 1 天的挂单，同时没有低于两倍的挂单。项目方一次领完。满 90 天之后连续 3 天做不到，这份永久不能领。此后任何人可以按天销毁，一天一份，90 天可以烧完。TAPE 与 BEM 直接打入销毁地址。只用 OKB 的这一份才会兑换：一半换成 BEM 销毁，一半再换成 TAPE 销毁，最少拿到池子中间价的 95%。今日 TAPE/BEM 池的两侧余额都是 0，这一跳会失败，OKB 留在合约里，直到池子有存货。",
      "两倍只看本合约的挂单，不看同一笔交易里的现货价。一枚 NFT 连续三天挂在两倍之下，价格又高于当日回购上限、因而买不掉，这 30% 会被判负。记日、烧掉当日一份，或买下一张低于两倍的单，调用者取得该笔支出的 5%，从当日的九十分之一里出。当日预算用完就不再付。这些函数都要有人调用。页面不保管私钥，链不会自己执行。已部署工厂的回购开关当前为开。项目合约不读取这个开关，因此无论真假，回购函数都可以被调用。",
      "二级费 0.2% 只在本合约的成交里收取。平台一半付给 0x7a2cC9b4dd8302FDD104159CeE97Be8a90BF772c。另一半留在项目合约里，没有提取函数，成交中也不拿去兑换。OKX 和官网市场不经过本合约。已经上链的永续、现货和预言机仍付给 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D。那些合约不能改收款地址。",
    ],
  },
  {
    h: "协议上已有的资产",
    ps: [
      "官网晶体管的最新价和最高买价来自 tapeout.net。挂买单、卖给买价，发到官网同一份 BSC 合约 0xA6a80C1919a8326022d7c601a488888C13aA16E4。",
      "在 tapeout.net 流片得到的电路本来就是 ERC-721。本站展示的是同一枚，不套用 1 TAPE 对 0.001 BEM，也不另开一份市场。有挂单的，购买是直接签官网市场 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f，一笔签名，不先扣本站手续费。没挂单的不能买。",
      "TapeCode-Test1 是 X Layer 合集，合约 0x0e91460d6823c711643e650a9a4c0cc21de41614。榜上它在前，Circuit Punk 在后。一号是火星人 @bitcoin2themars。8855 号是 TapeOut 协议创始人 @Blonskr。两人在 Circuit Punk 里的编号写在上一章。点开之后，挂单按 OKX 公开市场一页 20 条来读。OKX 没有给每一枚单独的图，本站只显示合集图，并且由本站转发，不把外链直接嵌进页面。OKX 的公开接口没有成交签名，所以 OKX 上的价格不能在这里吃。持有人可以在本站另挂一笔，买家付 OKB，经 X Layer 上的 Seaport 成交。创世电路、官方晶体管和协议电路收在 TapeOut 里，点开才展开。以太坊上的 OpenSea 系列只有地板价，没有签名，不能在这条链上成交，页面也不跳走。",
    ],
  },
  {
    h: "账户",
    ps: [
      "登录、创世买卖和兑换，用右上角连上的钱包签名。可以是浏览器钱包、OKX、币安，或页面认到的其他钱包。没连上时右上角是登录，连上之后旁边是退出，也可以切 BSC 和 X Layer。退出只断开这个页面，不会转走资产。本站不接收私钥，也不会把私钥写进页面或仓库。",
      "资产页主要看这个地址的链上资产。昵称、头像和背景点一下就改：点头像换头像，点背景换背景，点名字改名字。只存在这台浏览器，绑在当前钱包。",
      "用户中心显示的是这个地址在 BSC 和 X Layer 上的 BNB、BEM、USDT、OKB。这是链上余额，不是欧易交易所账户。昵称和头像只存在这台浏览器。",
      "顶栏的中文和英文，和这篇白皮书是同一份设置。存在这台浏览器，不写上链。兑换页显示这个钱包在 BSC 和 X Layer 上的 USDT、OKB、BEM、TAPE 可用余额。某一条读失败时，其余的仍显示，不整排留空。",
    ],
  },
  {
    h: "风险",
    ps: [
      "创世市场和兑换池都不是本站的托管。节点失败时，页面可能暂时读不到挂单或报价，链上的状态还在。",
      "TAP-721 仍是草案。页面上的网表哈希是预览，不是已经流片的电路。回购和最后 30% 只在项目于本工厂创建并收盘之后才会动，而且要有人调用。只用 OKB 且那 30% 被判负时，合约才会去买 BEM 和 TAPE。TAPE/BEM 池没有存货时，这一步失败，OKB 留在项目合约里。",
      "只使用你亏得起的钱。这不是招股，不是托管，也不保证成交、上线进度或价格。",
    ],
  },
];

const en: Section[] = [
  {
    h: "Abstract",
    ps: [
      "TAPELIQUID is a TapeOut market. Four things already work: Circuit Punk lists and trades on this site, genesis circuits trade on the official market, BEM, OKB and TAPE swap in official pools, and the top-right wallet can log in, log out, and switch BSC or X Layer. Funds do not sit in the page. Tokens stay in the wallet until you sign.",
      "The launch rules on this site bind only projects created here. Transistors and circuits already minted on tapeout.net stay the protocol originals. This site recognizes that contract, does not mint a second copy, and does not change the official BNB or OKB mint price.",
      "Create calls the deployed factory 0x2872E6D6AB14C5Cdb08587b437Bd16248270A04d, deployment 0x73ebdd1527e39065ba4da9f8869b5c06d8a3d5e62cbefe64ccddda24e94f5dd0. The fee address, the 0.026 OKB seed, and the buyback switch are fixed in that contract. It has no admin, no upgrade, and no way to pull the vault out. The page does not deploy a second factory.",
    ],
  },
  {
    h: "Circuit Punk",
    ps: [
      "Circuit Punk, symbol CPUNK, is the founding collection of this market. It is the first circuit-punk set, and the only one. The text it follows is TapeOut's Netlist-Bound NFT draft, proposed as TAP-721. The draft was submitted to TapeOutProtocol/TAPs on 18 October 2026. Editors have not yet assigned a number. Until they do, the text of record is issue 66 and pull request 67, with the public copy at github.com/BruceLanLan/TAP-721.",
      "TAP-721 extends ERC-721. Beside its image, each token carries a self-contained tapnet/1 netlist: NAND and LATCH records as defined by TAP-02, a 16-byte header, and no REF. The SHA-256 of that file is the netlist hash. Conformance has two levels. L0 requires only that metadata present the image, the netlist, and the hash. The contract need not implement ITapNetlistNFT. L1 places the netlist interface in the contract. Circuit Punk is at L0. A holder may check the netlist and the hash, and may not describe the token as taped out, or as a genesis circuit of the protocol. Genesis circuits remain ERC-721 tokens under TAP-10 and continue to trade on the official market.",
      "In this collection, OG names a roll, not a flourish. The Bitcoin side records Hal Finney, Adam Back, and Jameson Lopp: the first client, the predecessor of proof of work, and the public practice of nodes and self-custody. The BEM side records the early holders, including TapeCode number 1, the Martian @bitcoin2themars, and the founder of the protocol, @Blonskr. On 19 October 2026 the avatars they had made public were reduced to 24 by 24 circuit portraits and written into the rule that generates these ten thousand, so a later reader can see where the road began. A portrait is a memorial. This document is not investment advice. The collection does not use trademarks. Anyone included may ask that the corresponding base be retired. The layout is still determined by the number: nine extreme-ultraviolet dies, twenty-four bond colossi, eighty-eight scrap dies, and the rest wafer portraits, mascot dies, alignment marks, defect patterns, and memorial layouts.",
      "The contract on X Layer is 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34. Supply is 10,000. The public three thousand are open, locked at 1 TAPE plus 0.001 BEM, at most ten mints a wallet, numbered from 7001. Seven thousand were reserved and never entered the public price. The image address https://tapeliquid.net/api/circuit-punk/ is fixed. The page writes the collection as Circuit Punk. The name fixed on chain is what this set of pictures recognizes. A later create under another name is not this collection. The factory does not refuse that second create.",
      "This site's market trades Circuit Punk only. The mint page mints and does not settle sales. A listing can be quoted in BEM or in TAPE. The buyer pays both, at 1 BEM to 1000 TAPE. The fee is 0.2%, taken from the sale. Once listed, the NFT is held by the contract. The seller cancels from My listings on the market, without paging through the catalog. Open one to read type, substrate, metal, alignment, bond, package, supply, and rarity. Click the blank beside it to close. Count, numbers, and pictures of what you hold live only on the Assets page.",
      "The reserve is a roll, not a toast. TapeCode-Test1 number 1, the Martian @bitcoin2themars, at 0xddb587D88C0AFa42317E033bDD11edC2462B873f, was airdropped 100, numbers 51–150. TapeCode #8855, TapeOut founder @Blonskr, at 0x571d447f4f24688eC35Ccf07f1D6993655F6aF15, was airdropped 50, numbers 1–50. Each TapeCode holder address received one, 1000–6019, 5,020 in all. Each holder of this site's circuits received one, 151–369, 219 in all. TapeCode sitting in the burn address is not on the roll.",
      "Still unclaimed: 1,611, numbers 370–999 and 6020–7000. Those stay with the foundation. They do not enter the public price. The creator still claims them one by one.",
    ],
  },
  {
    h: "What comes after",
    ps: [
      "The public three thousand keep minting from 7001, locked at 1 TAPE plus 0.001 BEM. The market is this one set: filter by trait, sort by rarity, quote in BEM or TAPE, and pay both sides on a fill.",
      "The foundation's 1,611 are not filler for the public sale. They are kept for a later memorial and a later plan. The numbers are already drawn. There will not be a second Circuit Punk.",
      "The official TAPE pool does not swap until the quote side reaches 5,000 USDT. Until then it only quotes. Buyback and the last 30% do not wake themselves. They wait until a project on this factory has closed, and until someone calls. The ledger outranks the sentence on the page.",
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
      "Each collectible follows the TAP-721 draft: an image, a tapnet/1 netlist, and a SHA-256. Circuit Punk is at L0. The hash can be checked. The standard is still in community review. This site does not call it L1, and it does not claim a tape-out. The draft is at github.com/BruceLanLan/TAP-721.",
    ],
  },
  {
    h: "Vault and allocation",
    ps: [
      "Before a launch the creator deposits OKB then worth 3 dollars. That is the vault seed. The deployed factory's seed is 0.026 OKB. Creation also burns 1 TAPE. A TAPE pair or a BEM-only launch locks another 0.01 BEM. An OKB-only launch locks another 0.01 OKB. The seed and that 0.01 do not enter the three parts below.",
      "A public mint takes in only the token chosen for that launch. Each receipt is split by integer division into three parts. The remainder stays in the third. 30% is credited to the creator. 30% is credited to the release ledger and is not paid out by the day. 40% is credited to the buyback ledger and has no withdraw. Anyone may close a sold-out sale. If it is not sold out, only the creator may close it, and only 90 days after creation. After close, the creator may claim that 30% with no price test.",
      "At multiplier 1 and 3,000 public mints, the split lands on integers. A TAPE pair takes in 3,000 TAPE and 3 BEM, divided 900 / 900 / 1,200 TAPE and 0.9 / 0.9 / 1.2 BEM. OKB only takes in 3,000 OKB, divided 900 / 900 / 1,200 OKB. BEM only takes in 3 BEM, divided 0.9 / 0.9 / 1.2 BEM.",
      "Buyback spends that 40%. At close it is written down as the base. A day may spend at most one ninetieth of the base. The unused part of a day does not carry forward. A listing must be under twice the mint price and at least one day old. The creator's own address cannot sell into it. After the purchase, the NFT is sent to the burn address and the proceeds are paid to the seller. A TAPE pair pays BEM and 1,000 times that amount in TAPE. BEM only pays BEM. OKB only pays OKB. This 40% is not spent on the open market for TAPE or BEM. At 3,000 mints and multiplier 1, one day is about 0.0133 BEM plus 13.33 TAPE, or 13.33 OKB, enough for one listing just under twice mint. If only one public mint lands, the day's cap is below the minimum listing, and buyback cannot fill it.",
      "The 30% on the release ledger requires 90 days after close, and three consecutive days on which at least one listing is at or above twice mint and already a day old, and no listing is under twice. The creator then takes it in one claim. Three failing days after those 90 forfeit it forever. Anyone may then burn one day's slice, and ninety such days can finish it. TAPE and BEM are sent straight to the burn address. Only the forfeited OKB is swapped: half into BEM and burned, half onward into TAPE and burned, at no less than 95% of the pool mid. The TAPE/BEM pool's two sides are zero today, so that hop fails and the OKB stays in the contract until the pool has inventory.",
      "Twice mint is read from this contract's listings, not from a spot print in the same transaction. One NFT listed under twice for three days, at a price above that day's cap and therefore unbought, forfeits the 30%. A caller who records the day, burns that day's slice, or buys one listing under twice receives 5% of that spend, taken from the day's ninetieth. Once the day's budget is spent, the call is not paid. None of these functions run by themselves. This site holds no key. The deployed factory's buyback flag is currently on. The project contract does not read that flag, so the buyback functions can be called either way.",
      "The 0.2% secondary fee is charged only on sales inside this contract. The platform half is paid to 0x7a2cC9b4dd8302FDD104159CeE97Be8a90BF772c. The other half stays in the project contract. It has no withdraw, and a sale does not swap it. OKX and the official market do not pass through this contract. Spot, perpetuals, and the mark already on chain still pay 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D. Those contracts cannot change the payee.",
    ],
  },
  {
    h: "Assets already on the protocol",
    ps: [
      "Official transistor prices come from tapeout.net. Bids and sales go to the same BSC contract, 0xA6a80C1919a8326022d7c601a488888C13aA16E4.",
      "A circuit taped out on tapeout.net is already an ERC-721. This site shows that same token. It does not apply the 1 TAPE to 0.001 BEM price, and it does not run a second market. A listing is bought with one signature on the official market 0x6feEbbEbC07BcB90bd1Ac8b0CF9BaA4f0fF2B46f. Nothing is charged first. An unlisted circuit cannot be bought.",
      "TapeCode-Test1 is an X Layer collection, contract 0x0e91460d6823c711643e650a9a4c0cc21de41614. On the rank it comes first, and Circuit Punk second. Number 1 is the Martian, @bitcoin2themars. Number 8855 is @Blonskr, founder of the TapeOut protocol. Their Circuit Punk numbers are in the chapter above. Open it and the listings are read from OKX's public market, twenty at a time. OKX publishes no image per token, so this site shows the collection image, fetched through this site rather than embedded as a foreign link. OKX's public feed has no fill signature, so an OKX price cannot be taken here. A holder can list a new order on this site. The buyer pays OKB through Seaport on X Layer. Genesis circuits, official transistors, and protocol circuits stay inside TapeOut and open only when asked. OpenSea collections on Ethereum are floor prices only. There is no signature, they cannot settle on this chain, and the page does not leave.",
    ],
  },
  {
    h: "Account",
    ps: [
      "Login, genesis trades, and swaps sign with whichever wallet is connected from the top right: a browser wallet, OKX, Binance, or any other wallet the page detects. Logged out, the corner says Log in. Once connected, Log out sits beside the address, and BSC or X Layer can be switched. Logout only disconnects this page. It does not move assets. This site never asks for a private key, and a key is not written into the page or the repository.",
      "The assets page is mainly this address's balances. Click the avatar to change it, the banner to change the background, and the name to rename. Those stay in this browser, tied to the connected wallet.",
      "The account page shows this address's BNB, BEM, and USDT on BSC, and OKB and BEM on X Layer. Those are on-chain balances, not an OKX exchange account. The name and avatar stay in this browser.",
      "The top bar and this paper share one language setting. It stays in this browser and is not written on chain. The swap page shows this wallet's available USDT, OKB, BEM and TAPE on BSC and X Layer. If one read fails, the others still show.",
    ],
  },
  {
    h: "Risk",
    ps: [
      "The genesis market and the swap pools are not custodied here. If a node fails, the page may hide a listing or a quote that is still on chain.",
      "TAP-721 is still a draft. A netlist hash on this page is a preview, not a taped-out circuit. Buyback and the last 30% move only after a project on this factory has closed, and only when someone calls. Only a forfeited OKB balance is swapped into BEM and TAPE. While the TAPE/BEM pool is empty, that step fails and the OKB stays in the project.",
      "Use only money you can lose. This is not an offering, not custody, and not a promise of a fill, a date, or a price.",
    ],
  },
];

export function Whitepaper() {
  const [lang, setLang] = useState<Lang>("zh");
  useEffect(() => {
    const sync = () => {
      const next = window.localStorage.getItem("tape-lang") === "en" ? "en" : "zh";
      setUiLang(next);
      setLang(next);
    };
    sync();
    window.addEventListener("tape-lang", sync);
    return () => window.removeEventListener("tape-lang", sync);
  }, []);
  const sections = lang === "zh" ? zh : en;
  const flip = () => {
    const next = lang === "zh" ? "en" : "zh";
    setLang(next);
    setUiLang(next);
  };
  return (
    <article className="bg-[#fffdf8] text-[#1a140c] shadow-[0_0_0_1px_#1a140c]">
      <header className="border-b border-[#1a140c] px-5 py-6 sm:px-8 sm:py-8">
        <p className="text-[11px] font-semibold tracking-[0.22em] text-[#6d6256]">TAPELIQUID · 20 OCTOBER 2026</p>
        <h2 className="mt-3 font-serif text-[32px] leading-tight sm:text-4xl">{lang === "zh" ? "白皮书" : "White Paper"}</h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-[#3c3428]">
          {lang === "zh"
            ? "Circuit Punk · TAP-721 · X Layer。本文只记载已经部署的规则，不构成投资建议。"
            : "Circuit Punk · TAP-721 · X Layer. This paper records the rules already deployed. It is not investment advice."}
        </p>
        <button type="button" className="mt-4 h-9 rounded-full border border-[#1a140c] px-3 text-xs font-semibold" onClick={flip}>
          {lang === "zh" ? "English" : "中文"}
        </button>
      </header>
      <nav className="border-b border-[#e7dfd2] px-5 py-4 sm:px-8" aria-label={lang === "zh" ? "目录" : "Contents"}>
        <p className="text-[11px] font-semibold tracking-[0.18em] text-[#6d6256]">{lang === "zh" ? "目录" : "CONTENTS"}</p>
        <ol className="mt-2 grid gap-1 sm:grid-cols-2">
          {sections.map((section, index) => (
            <li key={section.h}>
              <a className="text-sm leading-6 text-[#1a140c] underline-offset-2 hover:underline" href={`#paper-${index + 1}`}>
                {String(index + 1).padStart(2, "0")} {section.h}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      {sections.map((section, index) => (
        <section key={section.h} id={`paper-${index + 1}`} className="scroll-mt-16 border-b border-[#e7dfd2] px-5 py-5 last:border-b-0 sm:px-8">
          <h3 className="font-serif text-xl leading-snug">
            <span className="mr-2 text-[#8a7a62]">{String(index + 1).padStart(2, "0")}</span>
            {section.h}
          </h3>
          {section.ps.map((p, i) => (
            <p key={p.slice(0, 40)} className="mt-3 text-[15px] leading-7 text-[#241c14]">
              <span className="mr-2 text-xs text-[#8a7a62]">{index + 1}.{i + 1}</span>
              {p}
            </p>
          ))}
        </section>
      ))}
    </article>
  );
}
