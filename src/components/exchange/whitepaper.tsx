import { useState } from "react";
import { BSC_REBATE, KNOWN_XMARK, KNOWN_XPERP, PREV_BSC, PREV_XMARK, PREV_XPERP } from "@/lib/perp";
import { GATE } from "@/lib/gate-chain";
import { BSC, BSC_SAFE, FEE_TO, XLAYER_SAFE } from "@/lib/bsc";
import { NPM } from "@/lib/lp";
import { OFFICIAL } from "@/lib/official-books";
import { LOCKED_REBATE } from "@/lib/seal-rebate";
import { TAPE, TAPE_MINE } from "@/lib/tape-mine";
import { TAPE_SPOT } from "@/lib/tape-spot";
import { DEPLOYED, XLAYER } from "@/lib/xlayer";
import { useExchange } from "@/lib/exchange-store";

const BEM_BRIDGE = "0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72";
const X_BEM = "0x60e62Efa9405d6873C5deaBD4E6CC91c25363952";

type Section = { h: string; ps: string[] };

const zhBody: Section[] = [
  {
    h: "产品",
    ps: [
      "TAPELIQUID 是以晶圆为记账单位的交易所。现货与永续在交易台。铸造、流片与晶体管合约在工房。TAPE 是唯一平台币，仅发行于 X Layer，没有第二枚。BEM 属于 TapeOut 协议官方代表。",
      "练习记录只存在于本机浏览器，不进入任何合约。个人中心仅展示当前钱包的资产与转出。红包锦囊是网页最前面的一枚小红包，个人中心里同一份，默认收着。",
      "没有对应合约的事项，页面不提供按钮。能够签名的规则写在前面。尚未上链的安排写在后面。",
    ],
  },
  {
    h: "风险",
    ps: [
      "本页是产品规则，不是审计报告，也不是收益承诺。下列合约没有升级入口。已经锁入永续的保证金，不能通过修改网页取回。没有管理员也不等于不能被攻击：合约没有经过独立审计。浅池上的标记价仍可能被带动。返佣合约的 clerk 只能取走返佣池里还没领的余额，不能动用户锁着的保证金。不通过下单函数直接转进合约的资产，谁都取不回。",
      "现货台费先付，是付出金额的 0.20%，在池子手续费之外。后面的兑换拒签或回滚，这一笔不退。回执还没读到时，同一金额不会再收一次。",
      "现在交易的 BEM 永续有资金费、保险基金和自动减仓。资金费每 8 小时在这一对的保证金里结算，封顶 ±0.05%。强平剩余一半进保险基金、一半给强平的人，保险不能提取。保险不够时只减这一对的盈利方。台费进对应链的多签。比特币、ETH、ZEC 的结算本没接上时，确认不签名。",
      "BSC 标记价取 PancakeSwap 池约 10 分钟的时间加权均价。流动性不足时，该均价仍可能在短时间内被带动。新的 X Layer 永续不再采用收费地址写入的 BSC 价格。标记价由 Uniswap v4 的 OKB/BEM 与 Uniswap v3 的 USDT0/WOKB 合成。任何地址均可提交推进。连续推进时，单次变动不超过 0.5%，间隔不少于 30 秒。中断超过 30 分钟后，下一次推进可以采用池子即时价格。晶体管永续的标记仍仅接受收费地址写入。",
      "下单所用合约地址写死在页面中，不随本机缓存更换。保证金只进入地址一节列出的合约。",
      "练习只存在于本机浏览器，不进入上述合约。止盈与止损要求本页保持打开，并由钱包完成签名。拒签之后不会自动再次请求，需要再次提交。",
      "代码仓库公开，不等于已经通过独立审计。开仓前应以本页与钱包中的合约地址核对。",
    ],
  },
  {
    h: "交易台",
    ps: [
      "现货在签名的钱包里成交。BSC 上的交易对走 PancakeSwap。OKB 走 X Layer 的 PotatoSwap。买到的币留在这个钱包。台费是付出金额的 0.20%，在池子手续费之外，单独付一笔，先付。后面的兑换拒签或回滚，这一笔不退。回执还没读到时，同一金额不会再收一次。",
      "永续有两本，不能并成一笔。BSC 的保证金是 USDT。X Layer 的保证金是 USDT0。保证金锁进你所选链上的那一份合约，平台不经手。现在交易的 BEM 永续有资金费、保险基金和自动减仓。资金费每 8 小时在这一对的保证金里结算，单次不超过 ±0.05%。强平剩下一半进保险基金，一半给调用的人，保险基金不能提取。保险不够时，只减这一对赢家的浮盈，不平别人。亏到保证金大约一半，任何人都可以强平。比特币、ETH、ZEC 仍是和 BEM 同一类的保证金单。这三口的结算本没接上时，确认不签名。",
      `BSC 的 BEM 永续以 PancakeSwap 池约 10 分钟均价为标记，不以最后一笔成交强平。流动性不足时，该均价仍可能在短时间内被带动。新的 X Layer 永续读取 X Layer 上的 OKB/BEM 与 USDT0/WOKB，不再引用 BSC 价格。任何地址均可调用推进。连续推进时，单次不超过 0.5%，间隔不少于 30 秒。页面现在使用 ${KNOWN_XPERP}，标记是 ${KNOWN_XMARK}。旧合约 ${PREV_XPERP} 仍保留既有仓位，标记仍是 ${PREV_XMARK}。`,
      "推荐只作用于永续。有推荐人时，交易者少付永续台费的 4%，推荐人记 6%，其余进入收费地址。现货和流动性不参与。",
    ],
  },
  {
    h: "工房",
    ps: [
      "先铸造 NAND 或 LATCH，再流片。流片烧掉网表里的晶体管，不能撤回，也不能再铸回来。一张最多 18,000 个 NAND，或 30,000 个 LATCH。更大的网表会失败，晶体管还在钱包里。",
      "NAND 和 LATCH 在 X Layer 铸造，共用额度 2,100,000。未流片的库存可以转让，不算算力。额度用完后只剩转让。",
      "晶体管合约在工房里，不在交易台。保证金是 BSC 的 USDT。结算参照收费地址写下的 10 分钟均价，不是 TapeOut 页面上的另一口价。六个标的各自一本。",
      "TapeOut 的晶体管现货只同步买单。卖出就是吃其中一档，写明买价、剩余和总额。TapeOut 的电路页读公开盘口。官方盘和已经签名的卖单都能买。日产能价是卖价除以预计 24 小时 BEM。算力是计入挖矿的权重。带虚线的字，鼠标停上出说明，移开消失。本站另收 0.20%，先付。后面那笔没有成交，这一笔不退。",
    ],
  },
  {
    h: "晶圆",
    ps: [
      "NAND 和 LATCH 在 X Layer 铸造，共用额度 2,100,000。铸哪一种都从已铸之和外面扣。剩余按种类分开：已铸减去流片烧掉的。流片烧掉网表里的 NAND 和 LATCH，不能撤回，也不能再铸回来。",
      "未流片的库存可以转让，不算算力。额度用完后只剩二级转让，流片继续销毁。",
      "个人持有的未流片额度，锁在榜一地址，锁到第一个减半，不参与排放。已经流片的电路保留，权重和别的矿工同一套规则。榜一地址和到期日登记之前，这一行不写一个空地址。",
      "用户铸造收入进入回购余额。官方地址铸造的金额留在原账户，不进入回购。",
      "流片是一笔交易。节点交出成功回执时，电路编号已经在那一笔里，不是再铸第二笔。这张电路不会自动变成矿机。挖 TAPE 要到挖矿页再签一笔开工，不签就没有权重，也没有待领。开工不再付 0.0013 OKB。",
    ],
  },
  {
    h: "TAPE",
    ps: [
      "TAPE 是 TAPELIQUID 的唯一平台币，只此一份，在 X Layer。没有第二枚。硬顶 21,000,000。无预挖，无团队份额，无私募。只发给已流片并且已开工的电路。未锁仓电路的领取进入该电路登记的矿工地址。实时流通等于已领出减去黑洞、TAPE 池、电路锁仓、晶圆锁仓、期限质押本金，以及还没领走的 TAPE 奖励。期限质押本金包括还在锁的，和到期还没取回的。这两样都还在期限合约里。已挖还没领的还没有铸出来，不算进流通。销毁占比是黑洞余额除以已领出。",
      "挖矿页的「全网 TAPE」默认收着。打开之后按账本列。流通一行一行减：已领出、黑洞、TAPE 池、电路锁仓、晶圆锁仓，然后是期限合约里的三笔：本金、还没分完的奖励、已经可以领还没领走的。本金同时包括还在锁的和到期还没取回的，合约把这两笔记在同一个数里。已挖未领再拆成普通矿机和质押矿机。矿机名单大约五分钟重读一次。减半时间用新加坡时间。",
      "排放不回溯。从第一笔已验证流片的那一天开始计日。晶圆不必铸完才开始。之后新的铸造和流片提高全网算力，已有电路的占比下降。",
      "日排放写在挖矿合约里，没有改率入口。现在这一份从部署时起每天排放 7,200。不是先 1,000 再改成 7,200。计划里的那一次调整没有函数，不能靠这一页改掉。减半周期按 210,000×600 秒写在规则里，约 4 年。销毁不改变当日排放，只减少已流通数量。各期累加不超过 21,000,000。",
    ],
  },
  {
    h: "库藏",
    ps: [
      "库藏在挖矿页，不在交易台。这一格上面是回购，下面是期限质押。回收价为 1 枚整数 TAPE 结算 0.1 USDT0，写在合约中，不随现货变动。不足 1 枚不予接受。只有买方地址 0x585d2DF4B8fDDA783B074555e6F3787e3fCB39D7 可以充入 X Layer 的 USDT0，也只有这个地址可以取回还没花掉的 USDT0 和已经买到的 TAPE。其他地址不能在这里充 USDT0。用户只能卖出整数枚 TAPE，卖出当时收到 USDT0，不能把已卖出的 TAPE 取回。池子不够则整笔失败，不会先收 TAPE。这份合约不加池。旧回购 0x72e28d564A90eF3E76f599bC210454f5360E200C 不再使用。现在这一份是 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF。",
      "分红不在这份回购合约里。回购合约里原先的质押没有期限，页面已经不再往那里存。期限质押是另一份 X Layer 合约，六档写死：90 天、180 天、270 天、365 天、730 天、1095 天，也就是三个月、六个月、九个月、一年、两年、三年。到期之前本金取不出。奖励可以先领。同一个池子，一个人最多同时有 16 笔没到期的。",
      "质押 TAPE，奖励是 X Layer 的 BEM。质押 X Layer 的 BEM，奖励是 TAPE。页面上「可质押」是这个钱包里还能锁的数量，「已质押」是这个地址已经锁上的本金，下面另写全池。每一笔锁仓写数量、期限和新加坡时间的到期日。没到期不能取本金。到期后同一行签一笔，本金回到钱包。领取只领奖励，不退本金。奖励谁都可以充。还没按 365 天分出去的，只有充入的地址能取回。已经分给质押的不能再取。年化用还没分完的奖励和池子现价来算。有人再质押，或取走还没分完的奖励，年化就变。价格读不到写成 —，不写成 0。这份期限合约没有管理员，不能升级。地址是 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A。直接把币转到合约、不走质押函数的，取不回来。",
      "BSC 的 BEM 不进这份合约。一份合约读不到另一条链。X Layer 上的 BEM 是 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952。BSC 上的 BEM 是另一份。要质押 BEM 领取 TAPE，先用 TapeOut 桥转入 X Layer。本站不经手资产。跨出去之前先收付出金额的 0.20%。桥自己的费另计。TAPE 不能走这座桥。新回购只允许买方地址充入和取回 USDT0，没有管理员，不能升级。0.1 USDT0 和两个代币写在合约里。直接把币转到合约、不走充入或卖出函数的，取不回来。",
    ],
  },
  {
    h: "现货",
    ps: [
      `工房现货是 X Layer 上的订单簿，不属于交易台。一份合约分四本账：TAPE、NAND、LATCH 以 USDT0 报价，电路按张定价。同一价格并为一档，先挂的订单在前。买方按该档价格支付。卖方实收 99.8%，千分之二进入收费地址。可成交部分即时成交，剩余部分继续挂单。页面列出卖盘可买、买盘可卖、已读成交与手续费，并按所填价格给出可成交数量与剩余挂出数量。NAND 和 LATCH 只收整数。切换市场时先清空上一本，空的市场不写成 0，也不把别的币的挂单留在这一本上。费率、两个代币、晶体管、电路与收费地址均写在合约中。没有管理员，不能改费率，不能升级。未通过挂单函数直接转入的资产无法取回。地址是 ${TAPE_SPOT}，已经部署。每台设备都读这一份。`,
      "电路和 TAPE、NAND、LATCH 分开。在售只列已经挂出的电路。钱包里没挂的，和锁仓里的，在「我的」，不写进盘口。在「我的」点一行，再填 USDT0 挂出。买方付挂出价。卖方实收 99.8%。每一行写结构、算力、卖价、千分之二、卖方实收、估算日产、日产能价和卖家。算力是门数。估算日产等于当日排放乘以这张门数，再除以全网权重，并且假设这张已经开工。没开工不是实际到账。日产能价等于挂出价除以估算日产，单位是 USDT0 / 每日 1 TAPE，只用来比较。占全网是门数除以当前全网权重。带虚线的字，鼠标停上出说明，移开消失。成交不满两笔不画 K 线。这份电路合约只记录输入、输出、状态和门数，不记录每张用了多少 NAND 和 LATCH，所以这一页不写晶体均价。",
      "点一行弹出这张电路。电脑是中间一窗，左边是规格和估值，右边是卖价和下单。手机是一整页，规格在上面，买入或挂出钉在底部。点窗外、点关闭，或按 Esc，窗口收起。规格写结构、算力、卖家和状态。估值写估算日产、日产能价、算力均价、卖价产出比和按年回看。算力均价是卖价除以门数。卖价产出比是卖价除以估算日产，再按现在的 TAPE/USDT0 池子价换成天数。按年回看是 365 除以这个天数。池子价变了，这两个数就变，不是承诺。晶体均价没有。最高出价没有，电路只有卖单。数量是 1，不能拆。在售的可以买入。自己挂的可以撤下。钱包里的填价格再挂出。锁着的要先领回。",
      "挖矿页只做领取、质押、销毁和库藏。NAND、LATCH 与电路在顶栏的 TAPELIQUID。晶体管合约在顶栏的 TapeOut。铸造已经结束，页面不再提供铸造入口。钱包中既有的 NAND 与 LATCH 仍可流片，也可在 TAPELIQUID 卖出。",
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
      "晶圆锁在晶圆锁仓里。电路锁在电路锁仓 0x06c877cc158d9ca3547220f9fc156f39bce7013c。两份都没有管理员。期限是五档：180 天、365 天、3 年、4 年、5 年。锁着的晶圆不能流片，不算算力。锁着的电路，算力记在电路锁仓上，继续占全网权重，继续挖 TAPE。到期前，电路和还没领的 TAPE 都不能领出来。到期后两样都能领。可以只领 TAPE，电路继续留着挖。也可以领电路，没领的 TAPE 在同一笔里打进钱包，矿池席位也在这一笔里关掉。",
      "锁仓不增加 H，不另发 TAPE。规则页列出锁仓地址、对象是电路还是晶圆、档位、到期日，以及电路上尚未领取的数量。榜一地址的官方未流片额度同样走这五档，登记后写明地址与到期日。",
    ],
  },
  {
    h: "开盘池和现货",
    ps: [
      "工房现货已经上线。TAPE 在工房订单簿买卖。页面不再接受新的 TAPE 池加仓。合约还在，没有管理员。已经加进去的仓位，到期后仍可在质押页撤回。到期前不能提前撤。",
      "开盘对手可以是 USDT，也可以是 BEM。计划中的开盘池放入 100,000 枚 TAPE 与 1,000 USDT，单价 0.01 USDT。这 100,000 枚不从矿工排放预支，锁至第一个减半，不能单方抽走。流通账本仍减去池中余额。池里的 TAPE 不算已经流通。",
      "已经在池里的仓位，锁定期只有五档：三个月、六个月、一年、两年、三年。池子凭证锁死。到期才能一键撤回。到期前不能拆。页面不再开新仓。",
      "个人中心的持仓默认收着。打开之后，钱包余额大约 8 秒重读一次，不等电路名单。顺序是 TAPE、BSC 的 BEM，其余按金额从高到低。没有价格的写成 —，不写成 0。TAPE 用 TAPE/USDT0 池子价。已经加进池子的 TAPE 另起一行，写成质押，不从钱包余额里消失。到期日用新加坡时间，写在同一页的质押名单里。",
      "持仓里的转出分一对一和一对多。先填地址和数量，再勾确认，不勾不能签。一对多每一行一个地址，最多 20 行，按行签名。加起来不能超过余额。BNB 和 OKB 要留下 gas。签完留在这一页，不打开新窗口。质押和永续保证金锁在合约里，不能在这里转。",
      "自愿销毁没有单独的 burn 函数。TAPE、NAND、LATCH 和电路打进黑洞 0x000000000000000000000000000000000000dEaD，不能取回。TAPE 占比是黑洞余额除以已领出。电路占比是黑洞里的片数除以已流片。NAND 和 LATCH 把流片烧掉的和黑洞里的加在一起，再除以该种类已铸。",
      "开盘时若只有那 100,000 枚锁在池里，流通数量只计这 100,000。工房现货不看这口池有没有到 10,000 美元。",
    ],
  },
  {
    h: "台费",
    ps: [
      "现货买卖、永续撮合、撤单、添加流动性、撤回流动性，台费都是付出金额的 0.20%。此费用在池子手续费之外。平仓不再另收。添加流动性时两边各扣 0.20%，撤回时拿回的两边再各扣 0.20%。已转出的台费不退。现货的台费是单独一笔，先付。后面的兑换拒签或回滚，这一笔不退。回执还没读到时，页面留下哈希，同一金额不会再收一次。",
      "现货买到的币留在签名钱包。永续保证金进入用户所选链上的那一份合约。BSC 与 X Layer 不能并成一笔。",
      `没绑邀请人时，页面先收的千分之二整笔进入该链多签。BSC 是 ${BSC_SAFE}。X Layer 是 ${XLAYER_SAFE}。绑了邀请人之后，这笔的 6% 付给邀请人，4% 少收交易的人，90% 进入该链多签。现在的现货订单簿和两本永续，合约里的千分之二进该链多签。以前的订单簿、TAPE 池和上一本永续仍进 ${FEE_TO}。印鉴减费仍认上一本永续和上一本晶体管，新本的成交还领不了。电路容器的开通费是协议的 BNB，不走这笔台费。比特币、ETH、ZEC 在永续页和 BEM 是同一类保证金合约，不是现货买入。这三口的结算本没接上时，开仓不会发出。`,
      "池子自身的手续费留给流动性提供者。Gas 付给链。",
    ],
  },
  {
    h: "Circuit Punk 合成卡",
    ps: [
      "Circuit Punk 只在 nft.tapeliquid.net 合成，不在交易所合成。先在市场页凑齐并点确定，然后才去 app.tapeliquid.net 确认身份，确认之后才开始交易。合成把材料锁进合约，不销毁，锁着不能转。拆开之后有 48 小时解冻期，这 48 小时不能转。拆出来的编号 30 天内不能再拿去合成，别的编号不受影响。锁卡合约上线前，页面上的确定只记在这台浏览器，不能领取。一个钱包只认最高的一张，不能叠加。",
      "铜片：2 张普通，类型不同。全场台费 0.16%，主属性 0.14%。银盖：3 张，至少 1 张少见，至少 2 种衬底。全场 0.12%，主属性 0.10%。金线：3 张，至少 1 张稀有，类型各不相同。全场 0.08%，主属性 0.06%。极紫外：1 张传说加任意 2 张，或 1 张史诗加 3 张少见及以上。全场 0.06%，主属性 0.04%，带绿边。仿极紫外：20 张普通，类型不能完全相同，全站最多 50 张。全场 0.08%，没有主属性再减。",
      "主属性按材料算。衬底加成现货，金属层加成永续，键合成加成电路，对准加成发射。分数最高的一项是主属性，只有这一边走到更低的费率。基准仍是付出金额的 0.20%。池子手续费不动。nft.tapeliquid.net 上买卖 Circuit Punk 仍只收合约里写死的 0.2%，不加版权费，合成卡也不减这笔。",
      "交易之后，台费减免每个自然月领一次。新加坡时间，次月 1 日 0 点起到 8 日 0 点止，共 7 天。过了 8 日 0 点，这一月不能再领，也不能补。同一钱包同一月只领一次。奖金池先到先得，池子空了就停。任何地址都可以往奖金池充，项目方也可以充。",
      "个人中心只做确认身份和领取，不在交易所合成，也不改下单。下单仍收 0.20%。用户签 tapeliquid-fee-pass。页面读 X Layer 上 Circuit Punk 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34 里这个钱包持有的编号，只认最高的一张。浏览器里的确定跨站读不到，不能当作凭证。锁卡合约上线后只认锁住的那一组。返还等于该月已付台费乘以（20 减这张卡的基点）再除以 20。主属性那一台用更低的基点，其他台用全场基点。池子手续费、Gas 和 NFT 市场的 0.2% 不算。奖金池合约上线前只显示应返还，领取不能转出。",
    ],
  },
  {
    h: "永续",
    ps: [
      `现在交易的 X Layer 永续是 ${KNOWN_XPERP}。标记读池子，约能读出。旧合约 ${PREV_XPERP} 的仓位还在，不再接受新开仓。BSC 永续是 ${BSC_REBATE}，上一本是 ${PREV_BSC}。晶体管永续是 ${GATE}。标记从空开始，第一笔要 BSC 多签写入。三本新合约的千分之二进该链多签。没有管理员。`,
      "同一份标记只挂这一本 X Layer 永续。BSC 上的 BEM 永续读 Pancake 池子的均价，不读这份标记。浅池仍可能在短时间里影响那条均价。",
      "BSC 永续页上，BEM、比特币、ETH、ZEC 是同一张合约台，四张都标 BSC · 永续，不是现货买入。K 线同一套：15 秒、1 分、5 分、15 分、1 小时、4 小时、1 日、1 周、1 月、3 月、一年，带成交量和 RSI。下单也同一张：开多、开空、保证金、杠杆、止盈止损。标记各读自己那口 Pancake 池大约 10 分钟均价，不是最后一笔。比特币、ETH、ZEC 的结算本还没接上。确认不会签名，USDT 不会扣，也不会去买现货，更不会把这三口的价格写进 BEM 那一本。",
      "TAPE 是 TAPELIQUID 的唯一平台币。只有这一枚，没有第二枚。矿池没有管理员，也不能改排放。",
      "返佣合约有 clerk。clerk 可以提取返佣池里的余额。不是每一份合约都没有管理员。",
    ],
  },
  {
    h: "奖励",
    ps: [
      "每一份新红包都是一份新合约。官方创建只有该链的部署地址能看见、能开。其他人只看见个人创建，任何人都能开。链的切换只在红包里。发出时选定可领时间：24 小时、一星期或一个月。创建时把奖金打进这一份。卡片写明已领多少、还剩多少。已领按链上计算：读到入账时，用入账减去池中余额；读不到入账时，把这一份的领取记录加总。同一份里，一个地址每个新加坡日只能领一次。另一份新红包不受这一次影响，可以再参加。时间过了就不能再领，没领完的由放钱的人取回自己的那一份。",
      "任务是一笔兑换，不是把钱划走。买入写成用多少 OKB 或 BNB 换回约多少这一枚币，数量按当时池子报价。卖出写成卖出约多少这一枚币、换回多少 OKB 或 BNB。点参与后先看清这笔兑换，可以同意，也可以拒绝。同意之后才去交易。交易成功再点验证。验证通过才打开红包，再点领取，资产才进这个钱包。兑换还没完成、或者还没验证通过，不能领取。每一次点击最多弹出一次钱包。需要换链或授权时，先完成那一步，再点一次，才做下一笔。X Layer 用 OKB 计价，BSC 用 BNB 计价。必须是普通钱包自己签。合约、代付和没做这笔交易的地址都不能领。以前的红包合约不再使用。",
      "以前的 NAND 礼包仍在 X Layer 0x5374DFfD3186FfEDAC46Cc6c9545B9e9e2CEF45b，BEM 礼包仍在 BSC 0xa29f86319E66DAdF1e30548bcC593fa91CBB7278。这一页不再代领，也不再往那两份里放。",
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
      "电路和 TAPE 都在 X Layer。BEM 的 BSC 与 X Layer 互转，用 TapeOut 已经上线的桥：BNB Chain 锁仓，X Layer 铸造等量；回来则在 X Layer 销毁，BSC 释放。1:1，走 LayerZero。本站不经手资产。跨出去之前先收付出金额的 0.20%，和现货同一套邀请分成。桥自己的费另计。已转出的台费不退。",
      `BSC 上的 BEM 是 ${BSC.bem}。BSC 桥是 ${BEM_BRIDGE}。X Layer 上的 BEM 是 ${X_BEM}。入口是 tapeout.net/bridge。`,
      "TAPE 不走 BEM 的桥。TAPE 自己的 1:1 跨链合约还没有。没有合约之前，页面不提供 TAPE 跨链按钮。OKB 与 BNB 的库存合约也还没有。页面不签名，不会在一条链收币、到另一条链凭空打出。",
    ],
  },
  {
    h: "现在链上有的",
    ps: [
      `TAPE 代币 ${TAPE}。挖矿合约 ${TAPE_MINE}。都在 X Layer。硬顶 21,000,000，8 位小数，没有管理员，也没有改率入口。只有挖矿合约能铸。总供应只随领取增加。`,
      "这份挖矿合约现在的日排放是 7,200，从部署时开始，不是先 1,000 再切换。它也没有「收费地址签一次改成 7,200」的入口。权重按电路门数，也就是 b*，处理器倍率按 1。q 还没有题目验证，页面不能显示大于 1。挖矿页和电路页的「一键验证」只读电路合约的 eval，不签名，不花 OKB。显示已核对只说明这张电路的门能跑完给出的输入。它不把权重移进 TapeOut 已验证的 99% 池。矿合约没有 verify 入口，页面改不了这个位。",
      "挖矿、TAPE 池、晶圆和电路锁仓，三份都没有管理员，不能升级，不能改期限，不能改费率，也没有救援入口。误转到合约、又没有对应仓位的资产，谁都取不回，页面不会这么转。加池时和池子比例对不上的部分退回给签名的人，不会进别人的份额。",
      "开盘池的 100,000 枚没有另铸。TAPE 池没有管理员。页面不再接受新的加池。已经在池里的仓位，90 天到 3 年，到期才能在质押页撤。加池没有九个月这一档。晶圆锁仓没有管理员，期限是 180 天、365 天、3 年、4 年、5 年。锁着的晶圆不能流片，不算算力。电路锁仓是 0x06c877cc158d9ca3547220f9fc156f39bce7013c。同一片电路不能锁两次。回购合约旧地址 0x72e28d564A90eF3E76f599bC210454f5360E200C 不再使用。现在的回购是 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF，买方写死。期限质押是 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A。两份都没有管理员。TAPE 跨链还没有合约。",
      "个人中心的持仓可以转出这个钱包还拿着的币、NAND 和 LATCH。一对一是一个地址。一对多每一行一个地址，这一行的数量只进这个地址，按行签名，不经过锁仓合约。先勾确认才能签。页面不跳走。电路在名单里上下滑动勾选，每一片填一个地址，勾几片签几笔。TapeOut 合约如果不提供逐个编号，这一页不能代填。",
    ],
  },
  {
    h: "地址",
    ps: [
      `页面先收的台费，以及现在的现货和永续合约里的千分之二：BSC 多签 ${BSC_SAFE}，X Layer 多签 ${XLAYER_SAFE}。以前的池子和上一本永续仍进 ${FEE_TO}。TAPE ${TAPE}。TAPE 挖矿 ${TAPE_MINE}。TAPE 池 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641。晶圆锁仓 0xA28390924607F08aaD8d03F512B41b6a1c012Ace。电路锁仓 0x06c877cc158d9ca3547220f9fc156f39bce7013c。回购 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF。期限质押 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833。以前的锁仓 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A。现货 ${TAPE_SPOT}。上一本现货 0x154E82c6a2ac121906D29af0EE81131E93B57860 不再挂新单。TAPELIQUID 电路 ${DEPLOYED.circuits}。TAPELIQUID 晶体管 ${DEPLOYED.transistors}。`,
      `BSC 永续 ${BSC_REBATE}。X Layer 永续 ${KNOWN_XPERP}。标记 ${KNOWN_XMARK}。晶体管永续 ${GATE}。流动性仓位 ${NPM}。`,
      `BSC BEM ${BSC.bem}。BSC 桥 ${BEM_BRIDGE}。X Layer BEM ${X_BEM}。TapeOut BEM 挖矿 0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46。`,
      `TapeOut 晶体管市场 ${OFFICIAL.transistorMarket}。TapeOut 电路市场 ${OFFICIAL.circuitMarket}。BEM 池 ${BSC.pool}。`,
      `X Layer 印鉴领取 ${LOCKED_REBATE.xlayer}。BSC 印鉴领取 ${LOCKED_REBATE.bsc}。红包发布台 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d。X Layer 已经在用，每一份从这里新开。BSC 使用同一个地址，第一次发布时放上。TAPE 走能成交的自有池。其他现货走能成交的兑换。合约只在本所。以前的红包不再使用。`,
      "改规则的当天改这一页。链上合约没有改率入口的，不能用这一页把已经部署的排放改掉。",
    ],
  },
];

const en: Section[] = [
  {
    h: "Product",
    ps: [
      "TAPELIQUID is an exchange that accounts in wafers. Spot and perpetuals are on the desk. Minting, tape-out and the transistor book are in the workshop. TAPE is the only platform token. It is issued only on X Layer. BEM is the official representative of the TapeOut protocol.",
      "Practice records remain in this browser and never enter a contract. The account page shows only the connected wallet's balances and transfers. The red packet is a small mark in front of the site. The same gift on the account page stays closed until opened.",
      "An action without a contract has no button. Rules that can be signed are stated first. Arrangements that are not yet on chain follow.",
    ],
  },
  {
    h: "Risk",
    ps: [
      "This page is the product rulebook. It is not an audit and it is not a statement of expected return. The contracts below have no upgrade path. Margin already locked in a perpetual cannot be recovered by editing the website. No administrator does not mean the contracts cannot be attacked. They have not had an independent audit. A mark that reads a thin pool can still be moved. The rebate contract's clerk can take only the unclaimed balance in the rebate pool, not margin locked by users. Assets sent straight to a contract, outside an order, cannot be recovered.",
      "The spot desk fee is paid first. It is 0.20% of the amount paid, on top of the pool fee. If the later swap is rejected or reverts, that fee is not returned. While a receipt is still missing, the same amount is not charged again.",
      "The BEM perpetuals trading now charge funding, keep an insurance fund, and can auto-delever one pair. Funding settles every 8 hours inside that pair's margin, capped at ±0.05 percent. Half of a liquidation remainder is kept as insurance and cannot be withdrawn. The other half is paid to the caller. Only if insurance is short, that pair's winner is haircut. It does not close other users. Anyone can liquidate a position after about half the margin is lost. BSC and X Layer do not net into one trade. Fees on these books go to the multisig of that chain. Bitcoin, ETH and ZEC still do not sign until a settlement book is attached.",
      "The BSC mark is a roughly 10-minute time-weighted average of the PancakeSwap pool. Thin liquidity can still move that average for a short interval. The new X Layer perpetual does not accept a BSC price posted by the fee address. Its mark is composed from the Uniswap v4 OKB/BEM pool and the Uniswap v3 USDT0/WOKB pool. Any address may submit an update. Consecutive updates move the mark by at most 0.5 percent and must be at least 30 seconds apart. After 30 minutes without an update, the next update may adopt the spot price of the pools. The transistor perpetual still accepts a mark only from the fee address.",
      "Order contracts are fixed in the page. They are not replaced from this browser's cache. Margin is sent only to the contracts named in the address section.",
      "Practice remains in this browser and does not enter those contracts. A take-profit or stop-loss requires this page to stay open and a wallet signature. After a rejection, the wallet is not prompted again until the order is submitted again.",
      "A public repository is not an independent audit. Before opening a position, match this page with the contract address shown in the wallet.",
    ],
  },
  {
    h: "Desk",
    ps: [
      "Spot settles in the wallet that signed. BSC pairs use PancakeSwap. OKB uses PotatoSwap on X Layer. The coins you buy stay in that wallet. The desk fee is 0.20% of what you pay, on top of the pool fee, and it is a separate payment made first. If the swap is rejected or reverts, that fee stays. If the receipt has not come back, the same amount is not charged again.",
      "There are two perpetual books. They do not net. BSC margin is USDT. X Layer margin is USDT0. Margin is locked in the one contract on the chain you picked. The platform does not hold it. The live BEM books charge funding, keep insurance, and can haircut one pair. At about half the margin lost, anyone can liquidate. Bitcoin, ETH and ZEC stay the same kind of margin ticket as BEM. Until a settlement book is attached, confirm does not sign.",
      `The BSC BEM perpetual uses a roughly 10-minute PancakeSwap average as its mark. The last trade is not used for liquidation. Thin liquidity can still move that average for a short interval. The new X Layer perpetual reads the OKB/BEM and USDT0/WOKB pools on X Layer. It does not reference the BSC price. Any address may submit an update. Each consecutive update is at most 0.5 percent and at least 30 seconds apart. The page now uses ${KNOWN_XPERP}. Its mark is ${KNOWN_XMARK}. The previous contract ${PREV_XPERP} keeps existing positions, and its mark remains ${PREV_XMARK}.`,
      "Referrals apply to every site fee this page sends, not only perpetuals. The site fee is 0.20% of the amount paid. With a referrer, 6% of that fee goes to the referrer, the trader pays 4% less, and 90% goes to the fee address. Perpetuals record the 6% on the contract. Spot, including BSC bitcoin, ETH and ZEC, liquidity, official transistors, and official circuits split the same way when paid. The workshop book and the TAPE pools send their 0.20% entirely to the fee address. Those deployed contracts have no referrer field. A circuit container's open fee is protocol BNB, not this site fee. The BSC perpetual is BEM / USDT. Bitcoin, ETH and ZEC on the perpetual page are the same kind of margin contract as BEM, not a spot buy. Their desk and chart are the same as BEM: the same timeframes from 15 seconds through one year, volume and RSI, and the same ticket for long, short, margin, leverage and stops. Until that pair's settlement book is attached, confirm does not sign, does not take USDT, and does not buy spot. Their prices are not written into the BEM book.",
    ],
  },
  {
    h: "Workshop",
    ps: [
      "Mint NAND or LATCH, then tape out. Tape-out burns the transistors in the netlist. It cannot be undone or minted back. One sheet holds at most 18,000 NAND or 30,000 LATCH. A larger netlist fails, and the transistors stay in the wallet.",
      "NAND and LATCH mint on X Layer under one cap of 2,100,000. Untaped stock can be transferred and is not hashrate. After the cap, only transfers remain.",
      "Transistor perps live in the workshop, not on the desk. Margin is BSC USDT. Settlement uses the 10-minute average posted by the fee address, not a second price from the TapeOut page. There are six markets.",
      "The TapeOut transistor book lists bids only. Selling fills one of them, with the bid, the size left, and the total. The TapeOut circuit page reads the public book. An official listing and a signed ask can both be bought. The day-output price is the ask divided by estimated BEM over 24 hours. Hash is the weight counted for mining. A dotted word shows a note while the pointer is on it, and the note hides when the pointer leaves. This site charges an extra 0.20%, paid first. If the later fill does not happen, that fee is not returned.",
    ],
  },
  {
    h: "Wafers",
    ps: [
      "NAND and LATCH mint on X Layer under one cap of 2,100,000. Either kind is taken from what has not been minted. What remains is per kind: minted minus burned by tape-out. Tape-out burns the NAND and LATCH in the netlist. It cannot be undone or minted back.",
      "Untaped stock can be transferred and is not hashrate. After the cap, only secondary transfers remain. Tape-out still destroys.",
      "Untaped stock held personally stays locked at the lead address until the first halving and does not earn. Circuits already taped keep their weight under the same rule as every other miner. No address is printed here until that lead address and its expiry are registered.",
      "User mint proceeds go to the buyback balance. Amounts minted by an official address stay in that account and do not enter the buyback.",
      "A tape-out is one transaction. When the node returns a successful receipt, the circuit id is already in that transaction. It is not a second mint. The circuit does not start mining by itself. TAPE starts only after a second signature on the mine page. That signature does not pay another 0.0013 OKB.",
    ],
  },
  {
    h: "TAPE",
    ps: [
      "TAPE is the only platform token of TAPELIQUID. There is one token, on X Layer, and there is not a second. The hard cap is 21,000,000. No premine, no team allocation, no private sale. It is paid only to a taped circuit that has been opened. A claim on an unlocked circuit goes to the miner address registered on that circuit. Circulating supply is claimed TAPE minus the dead address, the TAPE pool, the circuit lock, the wafer lock, timed-stake principal, and TAPE rewards that have not been claimed. Timed-stake principal includes coins still locked and coins that matured but were not withdrawn. Both are still in the term contract. Mined TAPE that has not been claimed is not minted yet, so it is not circulating. The burn share is the dead balance divided by claimed supply.",
      "The mine page keeps Network TAPE closed until it is opened. The opened ledger subtracts line by line: claimed, burned, the pool, the circuit lock, and the wafer lock. Unclaimed TAPE is split between ordinary miners and staked miners. Miner counts, weight, and unclaimed amounts are summed about every 45 seconds and are not shown as zero before the sum finishes. Halving times are Singapore time.",
      "Emission does not backfill. The day count starts on the day of the first verified tape-out. The wafers do not have to be fully minted first. Later mints and tape-outs raise network hashrate, so an existing circuit's share falls.",
      "The daily amount is in the mine contract, and there is no function to change it. This contract emits 7,200 a day from deployment. It does not start at 1,000 and then switch. The planned switch has no function, and this page cannot create one. The halving interval in the rules is 210,000 × 600 seconds, about four years. A burn does not change the day's emission. It only reduces what is circulating. The periods together do not exceed 21,000,000.",
    ],
  },
  {
    h: "Reserve",
    ps: [
      "The reserve is on the mine page, not on the desk. The top of that tab is the buyback. Timed stake is below it. The price is one whole TAPE for 0.1 USDT0. It is written in the contract and does not follow the spot market. Less than one TAPE is not accepted. Only the buyer address 0x585d2DF4B8fDDA783B074555e6F3787e3fCB39D7 can deposit X Layer USDT0, and only that address can withdraw USDT0 that has not been spent and the TAPE it has bought. No other address can deposit USDT0 here. A user can only sell whole TAPE, is paid USDT0 in that transaction, and cannot take the sold TAPE back. If the pool cannot cover the order, the whole order fails and no TAPE is taken. This contract does not add liquidity. The old buyback 0x72e28d564A90eF3E76f599bC210454f5360E200C is no longer used. This one is 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF.",
      "Two dividend pools are not inside the buyback contract. The old stake on that contract had no lock, and the page no longer deposits there. Timed stake is a separate X Layer contract. The six terms are fixed at 90, 180, 270, 365, 730 and 1,095 days: 3 months, 6 months, 9 months, 1 year, 2 years and 3 years. Principal cannot leave before expiry. Rewards can be claimed earlier. One person can have 16 open locks in a pool.",
      "Staked TAPE earns X Layer BEM. Staked X Layer BEM earns TAPE. On the page, Available is what this wallet can still lock. Staked is the principal this address has already locked, with the pool total written under it. Each lock shows the amount, the term, and the Singapore expiry. Principal cannot be taken before that time. After expiry, one signature on that row returns the principal. Claim pays rewards only, not principal. Anyone can add rewards. Only the address that added a reward can take back the part that has not vested over 365 days. What has already vested to stakers cannot be taken back. APY uses the unvested pot and the current pool price. It changes when someone stakes or withdraws unvested rewards. A missing price is shown as —, not zero. This timed contract has no admin and cannot be upgraded. The address is 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A. Tokens sent to the contract without the stake function cannot be taken back.",
      "BSC BEM does not enter this contract. One contract cannot read the other chain. BEM on X Layer is 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952. BEM on BSC is a different contract. To stake BEM for TAPE, open the TapeOut bridge and move it to X Layer. That button calls the TapeOut bridge. This site does not custody the assets. It charges 0.20% of the amount before the bridge, with the same referral split as spot. The bridge's own fee is separate. A fee already sent is not returned. TAPE cannot use that bridge.",
    ],
  },
  {
    h: "Spot",
    ps: [
      `Workshop spot is an X Layer order book. It is not the desk. One contract holds four books. TAPE, NAND and LATCH are quoted in USDT0. Each circuit is priced on its own. One price is one level, and the earlier order stands in front. The buyer pays that level. The seller receives 99.8 percent. The 0.2 percent is paid to the fee address. Size that can cross fills at once. The remainder rests. The page states the size offered by asks, the size bid, the prints read, the fees collected, and, at the price entered, how much would fill and how much would rest. NAND and LATCH are whole numbers. Switching markets clears the previous book. An empty market is not shown as zero, and another coin's orders are not left on it. The fee, both tokens, the transistors, the circuits and the fee address are written in the contract. There is no administrator. The fee cannot be changed and the contract cannot be upgraded. Assets sent to the contract outside an order cannot be recovered. The address is ${TAPE_SPOT}, and it is deployed. Every device reads this contract.`,
      "Circuits are separate from TAPE, NAND and LATCH. The book lists only circuits that are already offered. Circuits still in the wallet, and circuits still locked, are under Mine. They are not written into the book. Pick a row under Mine, then enter a USDT0 ask. The buyer pays that ask. The seller receives 99.8 percent. Each row shows shape, hash, ask, the 0.2 percent, what the seller receives, estimated daily output, the day-output price, and the seller. Hash is the gate count. Estimated daily output is today's emission times that gate count, divided by network weight, and it assumes the circuit is already mining. If it has not been started, that figure is not a receipt. The day-output price is the ask divided by that estimate. The unit is USDT0 per 1 TAPE per day. It is for comparison. Share of the network is the gate count divided by the current network weight. A dotted word shows a note while the pointer is on it, and the note hides when the pointer leaves. Fewer than two prints do not draw a chart. This circuit contract records inputs, outputs, state and gates. It does not record how many NAND and LATCH one circuit used, so this page does not show a crystal average.",
      "A row opens that circuit. On a desktop it is a window in the middle: spec and value on the left, the ask and the order on the right. On a phone it is a full page: the spec scrolls, and buy or list stays at the bottom. Click outside, click close, or press Esc, and it goes away. The spec shows shape, hash, seller and state. The value shows estimated daily output, the day-output price, the price per gate, the payback and the year look-back. The price per gate is the ask divided by the gate count. Payback is the ask divided by estimated daily output, turned into days at the current TAPE/USDT0 pool price. The year look-back is 365 divided by those days. Both change when the pool price changes. They are not a promise. There is no crystal average. There is no best bid, because a circuit book has only asks. The size is one, and it cannot be split. A listed circuit can be bought. Your own listing can be cancelled. A circuit in the wallet takes a price and is then listed. A locked one has to be claimed first.",
      "The mine page is claims, staking, burns, and the reserve. NAND, LATCH, and circuits are under TAPELIQUID in the top bar. Transistor contracts are under TapeOut. Minting has ended and the mint control is no longer shown. NAND and LATCH already held in a wallet may still be taped out, or sold on TAPELIQUID.",
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
      "Wafers lock in the wafer lock. Circuits lock in the circuit lock at 0x06c877cc158d9ca3547220f9fc156f39bce7013c. Neither contract has an admin. The terms are 180 days, 365 days, 3 years, 4 years, and 5 years. A locked wafer cannot be taped and is not hashrate. A locked circuit keeps its weight on the circuit lock, keeps its share of the network, and keeps mining TAPE. Before the date, neither the circuit nor unclaimed TAPE can leave. After the date, both can. TAPE can be claimed alone and the circuit keeps mining. Claiming the circuit sends any unclaimed TAPE in the same transaction and closes the mine seat.",
      "A locked wafer cannot be transferred or taped before expiry. It is not hashrate. After expiry it can be taped. Unlock charges nothing. A lock does not raise H and does not mint extra TAPE.",
      "A lock does not raise H and does not mint extra TAPE. This page lists the address, whether it is a circuit or wafers, the term, the expiry, and the unclaimed amount on the circuit. The lead address's official untaped quota uses the same five terms. The address and expiry are written here after registration.",
    ],
  },
  {
    h: "The opening pool and spot",
    ps: [
      "The workshop order book is live. TAPE trades there. This site no longer accepts new TAPE pool deposits. The contract is still there and has no admin. A position already in the pool can still be withdrawn on the stake page after it expires, and not before.",
      "The counter asset may be USDT or BEM. The planned opening pool is 100,000 TAPE and 1,000 USDT, at 0.01 USDT. Those 100,000 are not taken in advance from miner emission. They stay locked until the first halving and cannot be pulled by one side. Circulating supply still subtracts the balance sitting in the pool.",
      "A position already in the pool has one of five terms: three months, six months, one year, two years, or three years. It can be removed in one action at expiry, and not before. The page does not open a new position.",
      "Holdings on the account page stay closed until opened. Wallet balances are reread about every 8 seconds and do not wait for the circuit list. TAPE is first, BSC BEM is second, and the rest follow by value. A missing price is a dash, not zero. Wallet TAPE uses the TAPE/USDT0 pool. TAPE already added to a pool is a separate stake row, so it does not vanish from the total. The expiry is Singapore time, on the same page.",
      "A holding can be sent to one address or to many. The address and amount are entered first, then a confirmation is ticked. It cannot be signed before that tick. Many means one address per row, at most 20, and one signature per row. The rows cannot add up to more than the balance. BNB and OKB leave gas behind. The page does not open a new window. A stake and perpetual margin stay in their contracts and cannot be sent from here.",
      "There is no burn function. TAPE, NAND, LATCH and a circuit sent to 0x000000000000000000000000000000000000dEaD cannot be taken back. TAPE's share is the dead balance divided by claimed supply. A circuit's share is dead holdings divided by taped circuits. NAND and LATCH add tape-out burns to the dead balance, then divide by that kind's minted amount.",
      "If only those 100,000 sit in the pool at the open, circulating TAPE is those 100,000. The workshop book does not wait for that pool to reach 10,000 dollars.",
    ],
  },
  {
    h: "Desk fee",
    ps: [
      "Spot, a perpetual match, a cancel, adding liquidity, and removing liquidity all pay 0.20 percent of what is paid. That is on top of the pool fee. Closing adds nothing. Adding takes 0.20 percent from each side. Removing takes 0.20 percent from both sides that come back. A fee already sent is not returned. The spot fee is its own transaction and is paid first. If the swap is rejected or reverts, that fee stays. If the receipt has not come back, the page keeps the hash and does not charge the same amount again.",
      "A spot fill stays in the wallet that signed. Perpetual margin enters the one contract on the chain the user picked. BSC and X Layer do not net.",
      `The fee this page collects first goes to that chain's multisig. BSC is ${BSC_SAFE}. X Layer is ${XLAYER_SAFE}.`,
      "With a referrer, 6 percent of the site fee goes to the referrer, the trader pays 4 percent less, and 90 percent goes to the fee address. This split covers perpetuals, spot desk fees, and the site fee on official transistors and circuits. The workshop book and the TAPE pools still send their whole 0.20 percent to the fee address. A seal does not cut a fee by itself. After registration, half the fee on a matched perpetual fill can be claimed once per Singapore week, Monday 00:00 to the next Monday 00:00. A missed week is gone. One fill is counted once. The claim contract reads only the current BSC perpetual, the current X Layer perpetual, and the transistor perpetual. The pool is funded separately. Only the wallet that deployed it can withdraw.",
      "The pool's own fee stays with liquidity providers. Gas is paid to the chain.",
    ],
  },
  {
    h: "Circuit Punk card",
    ps: [
      "Circuit Punk cards are crafted only at nft.tapeliquid.net, not on the exchange. Finish the craft there and confirm it before the same wallet confirms identity at app.tapeliquid.net and starts trading. Crafting locks the pieces in a contract. They are not burned, and they cannot be transferred while locked. After a split there is a 48-hour thaw, and those pieces cannot be transferred during it. The split ids cannot be crafted again for 30 days. Other ids are not affected. Until that lock is deployed, the confirm button is stored only in this browser and nothing can be claimed. One wallet is recognized for its highest card, and cards do not stack.",
      "Copper is two commons of different types: 0.16 percent on every desk, or 0.14 percent on the card's main desk. Silver is three pieces, at least one uncommon, and at least two substrates: 0.12 percent, or 0.10 on the main desk. Gold is three pieces, at least one rare, each a different type: 0.08 percent, or 0.06 on the main desk. Extreme ultraviolet is one legend plus any two, or one epic plus three pieces that are uncommon or better: 0.06 percent, or 0.04 on the main desk, with a green edge. Faux extreme ultraviolet is twenty commons that are not all the same type, capped at fifty cards: 0.08 percent, with no further main-desk cut.",
      "The main desk is the highest of the four scores. Substrate lifts spot, metal lifts perpetuals, bond lifts circuits, and alignment lifts launch. The desk fee starts at 0.20 percent of what is paid. The pool fee does not move. Buying or selling a Circuit Punk at nft.tapeliquid.net still pays only the 0.2 percent written in that contract. There is no extra royalty, and the card does not cut that sale.",
      "After trading, the desk-fee rebate is claimed once each calendar month. The window is the first seven days of the next month, Singapore time, from 00:00 on the 1st until 00:00 on the 8th. After that the month is gone and cannot be claimed later. One wallet claims a month once. The pool pays first come, first served, and stops when it is empty. Any address can fund the pool, including the project.",
      "The account page only confirms identity and shows the claim. It does not craft, and it does not change an order. Orders still pay 0.20 percent. The wallet signs tapeliquid-fee-pass. The page reads the Circuit Punk ids held by that wallet at 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34 on X Layer and keeps only the highest card. A confirm stored in the NFT site's browser cannot be read here and is not proof. After the lock contract is deployed, only the locked set counts. The rebate is the desk fee paid that month times (20 minus the card's basis points) divided by 20. The main desk uses the lower basis points. Other desks use the card-wide basis points. Pool fees, gas, and the NFT market's 0.2 percent do not count. Until the pool contract is deployed, the account page shows the amount and must not send it.",
    ],
  },
  {
    h: "Perpetuals",
    ps: [
      `The live X Layer perpetual is ${KNOWN_XPERP}. Positions on ${PREV_XPERP} remain there and that book takes no new positions. The BSC perpetual is ${BSC_REBATE}. The previous one is ${PREV_BSC}. The transistor perpetual is ${GATE}. Its marks start empty. The BSC multisig posts the first price. The 0.20 percent on these three goes to the multisig of that chain. None has an admin.`,
      "This mark has one X Layer perpetual. The BEM perpetual on BSC reads the Pancake pool average. It does not read this mark. A thin pool can still move that average for a short time.",
      "TAPE is the only platform token of TAPELIQUID. There is one token, not a second. The mine has no admin, and the emission cannot be changed.",
      "The rebate contract has a clerk. The clerk can withdraw the rebate pool. Not every contract is without an admin.",
    ],
  },
  {
    h: "Rewards",
    ps: [
      "Each new red packet is its own contract. Only that chain's deployer can see and open an official round. Everyone else sees personal rounds, and anyone can open one. The chain switch stays inside the packet. The sender chooses 24 hours, one week, or one month. The creator puts the prize into that round. The card shows how much has been claimed and how much remains. Claimed is funded minus the balance still in the pool when the funding event is found. Otherwise it is the sum of claim records on that round. On the same round, one address can claim once per Singapore day. A later round is not blocked by that claim. After the window ends, claims stop, and each depositor takes back only their own remainder.",
      "The task is a swap, not a transfer that merely leaves the wallet. A buy states how much OKB or BNB is swapped for about how much of that coin, using the pool quote. A sell states about how much of that coin is sold for how much OKB or BNB. Joining shows that swap first. The user can agree or refuse. The trade starts only after they agree. After the trade, they check it. The packet opens only when the check passes, and the asset is paid only when they claim. The packet cannot be claimed before the swap is finished and checked. Each tap opens the wallet at most once. A chain switch or an approval finishes first. The next tap does the next step. X Layer is priced in OKB and BSC in BNB. The signer has to be an ordinary wallet. A contract, a relayer, or an address that did not make the trade cannot claim. The earlier red packet contracts are no longer used.",
      "The old NAND gift remains on X Layer at 0x5374DFfD3186FfEDAC46Cc6c9545B9e9e2CEF45b. The old BEM gift remains on BSC at 0xa29f86319E66DAdF1e30548bcC593fa91CBB7278. This page no longer claims from them or adds to them.",
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
      "Circuits and TAPE are on X Layer. BEM moves between BSC and X Layer on the bridge TapeOut already runs: lock on BNB Chain and mint the same amount on X Layer, or burn on X Layer and release on BSC. It is 1:1, over LayerZero. This site does not custody the assets. It charges 0.20% of the amount before the bridge. The bridge's own fee is separate. A fee already sent is not returned.",
      `BEM on BSC is ${BSC.bem}. The BSC bridge is ${BEM_BRIDGE}. BEM on X Layer is ${X_BEM}. The page is tapeout.net/bridge.`,
      "TAPE does not use the BEM bridge. TAPE has no 1:1 bridge contract yet. Until that contract exists, there is no TAPE bridge button. There is also no OKB and BNB inventory contract. The page does not sign that, and it does not take a coin on one chain and mint it on the other.",
    ],
  },
  {
    h: "What is on chain now",
    ps: [
      `TAPE is ${TAPE}. The mine is ${TAPE_MINE}. Both are on X Layer. The cap is 21,000,000 with 8 decimals. There is no admin and no way to change the rate. Only the mine can mint. Supply grows only when someone claims.`,
      "That mine contract emits 7,200 a day from the moment it was deployed. It does not start at 1,000, and it has no one-time switch to 7,200. Weight is the gate count, which is b*, and the processor multiplier is 1. There is no task score yet, so q is not shown above 1. One-click check on the mine page and the circuit page only reads eval on the circuit contract. It does not sign and it does not spend OKB. A passed check means the gates ran the inputs that were given. It does not move weight into TapeOut's verified 99 percent pool. The mine contract has no verify entry, and this page cannot set that bit.",
      "The mine, the TAPE pool, and the wafer and circuit lock have no admin. They cannot be upgraded, and the terms and the fee cannot be changed. There is no rescue function. Assets sent to a contract without a matching position cannot be taken back by anyone, and the page does not send them that way. Liquidity that does not match the pool ratio is returned to the signer. It is not added to anyone else's share.",
      "The 100,000 opening allocation was not minted. The TAPE pool has no admin. This site no longer accepts a new deposit. A position already in the pool stays for 90 days to 3 years and can be withdrawn on the stake page only at expiry. That pool has no 9-month term. The wafer lock has no admin. Terms are 180 days, 365 days, 3 years, 4 years, or 5 years. Locked wafers cannot be taped and do not count as weight. The circuit lock is 0x06c877cc158d9ca3547220f9fc156f39bce7013c. The same circuit cannot be locked twice. The old buyback 0x72e28d564A90eF3E76f599bC210454f5360E200C is no longer used. The current one is 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF, with the buyer fixed. Timed stake is 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A. Neither has an admin. TAPE still has no bridge contract.",
      "TapeOut BEM is still claimed from the TapeOut mine. It is not the same signature as TAPE. A large tape-out does not mint TapeOut BEM.",
      "Holdings on the account page can send coins, NAND, and LATCH still in the wallet. One means one address. Many means one address per row, and that row's amount goes only to that address. Each transfer is its own signature, and none of them go through the lock. The confirmation has to be ticked first. The page does not leave. Circuits are ticked in a scrolling list. Each ticked circuit has one address. One signature per circuit. If an official contract does not list token ids, this page does not invent them.",
    ],
  },
  {
    h: "Addresses",
    ps: [
      `The fee this page collects, and the 0.20 percent inside the live spot and perpetual contracts: BSC multisig ${BSC_SAFE}, X Layer multisig ${XLAYER_SAFE}. The previous pool and the previous perpetual still pay ${FEE_TO}. TAPE ${TAPE}. TAPE mine ${TAPE_MINE}. TAPE pool 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641. Wafer lock 0xA28390924607F08aaD8d03F512B41b6a1c012Ace. Circuit lock 0x06c877cc158d9ca3547220f9fc156f39bce7013c. Buyback 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF. Timed stake 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833. Earlier locks 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A. Spot ${TAPE_SPOT}. The previous spot 0x154E82c6a2ac121906D29af0EE81131E93B57860 takes no new orders. TAPELIQUID circuits ${DEPLOYED.circuits}. TAPELIQUID transistors ${DEPLOYED.transistors}.`,
      `BSC perpetual ${BSC_REBATE}. X Layer perpetual ${KNOWN_XPERP}. Mark ${KNOWN_XMARK}. Transistor perpetual ${GATE}. Liquidity positions ${NPM}.`,
      `BSC BEM ${BSC.bem}. BSC bridge ${BEM_BRIDGE}. X Layer BEM ${X_BEM}. TapeOut BEM mine 0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46.`,
      `TapeOut transistor market ${OFFICIAL.transistorMarket}. TapeOut circuit market ${OFFICIAL.circuitMarket}. BEM pool ${BSC.pool}.`,
      `X Layer seal claim ${LOCKED_REBATE.xlayer}. BSC seal claim ${LOCKED_REBATE.bsc}. Red packet desk 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d. X Layer already uses it, and each round is a new contract there. BSC uses the same address and places it on the first publish. TAPE uses the pool that can fill. Other spot assets use a market that can fill. Perpetuals stay on this exchange. The earlier packets are no longer used.`,
      "When a rule changes, this page changes the same day. A sentence here cannot change an emission that the deployed contract has no function to edit.",
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
  ["挖矿合约", TAPE_MINE],
  ["现在的日排放", "7,200，从部署时起。没有 1,000 档，也没有改率入口"],
  ["现在的权重", "门数，也就是 b*。P = 1。q 不能大于 1"],
  ["总供应", "只随领取增加。10 万枚开盘种子没有另铸"],
  [
    "TAPE 池",
    "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641，没有管理员。不再新加。已有仓到期可撤。流通仍减池中余额",
  ],
  ["锁仓", "0xA28390924607F08aaD8d03F512B41b6a1c012Ace，没有管理员"],
  [
    "期限质押",
    "0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833。以前的锁仓 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A，只取不存",
  ],
  ["还不能签", "TAPE 跨链"],
];

const nowEn = [
  ["TAPE", TAPE],
  ["Mine", TAPE_MINE],
  ["Emission today", "7,200 from deployment. There is no 1,000 tier and no switch"],
  ["Weight today", "Gate count, which is b*. P = 1. q cannot be above 1"],
  ["Supply", "Grows only when claimed. The 100,000 seed was not minted"],
  [
    "TAPE pool",
    "0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641, no admin. No new deposits. Existing positions withdraw at expiry. Circulating supply still subtracts the pool",
  ],
  ["Lock", "0xA28390924607F08aaD8d03F512B41b6a1c012Ace, no admin"],
  [
    "Timed stake",
    "0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833. Earlier locks stay at 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A and can only be withdrawn",
  ],
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
                ? "收费地址、排放和现在链上的合约"
                : "The fee address, emission, and live contracts",
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
