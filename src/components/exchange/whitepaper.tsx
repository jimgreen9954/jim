import { useState } from "react";
import { BSC_REBATE, BTC_COIN_BOOK, ETH_COIN_BOOK, FAB_COIN_BOOK, KNOWN_XMARK, KNOWN_XPERP, LAST_BSC, PREV_BSC, TAPE_COIN_BOOK, UP_COIN_BOOK, ZEC_COIN_BOOK } from "@/lib/perp";
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
    h: "核对",
    ps: [
      "X Layer 的 BEM 永续已经换成 0x46cBAfCA59873E7115dF7825fdBF659BafAc3a51，可以新开。标记 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC 把 BEM/WOKB 池 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A 和 OKB/USDT0 池 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082 各自的 10 分钟均价合成美元，不读现货。核对时均价约 11.10 美元，现货约 11.25 美元。仍是 50 倍。现价和这份均价差过约 1% 时不能新开，也不能强平，平仓可以。主页部署按钮已经撤掉。刚换下的 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2 读现货标记 0x706c4AB8B20f4045623fcC91b24e4746f9776e01，没有未平仓，只平仓。跟单金库仍绑着这一本。部署交易 0x794b5a83cefbda273b5babf5f4f6c1124165676750bcc120455676442c37edbe。",
      "UP、TAPE、FAB 已由多签换成这一版，主页部署按钮已经撤掉。UP 永续 0xe9B1fe713FcE9E4670c610cCc5bf2F2decDCcA4A，标记 0xEf744901777f6CDD3C27D20380eC2E7c6740326C，部署交易 0x58d7ddd4a137868031339e5622ddf77494c50b74430b69ae8f9f4872723673f5。TAPE 永续 0xC74795Aac0FE2E0Db36beeF422504f464c3083f1，标记 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7，部署交易 0x3134a283ce0dae566d905f578ceae5fd048c274d04e1b2b9a49f929757d1efa4。FAB 永续 0xa03525d6C0367E6589Af4cc93b5aA16C4F280411，标记 0xe6F8419FE6F22d19933Ec6028366fc698709e73F，部署交易 0xf7f7bc1f2af8c1a82da19d6a371a79b398a4d25e54fdaf111aadd655073d037f。只有交易合约能记价。每次记价最多约 0.5%，不再随安静时间放大。订单读最多 10 分钟均价。现价和这份均价差过约 1%，或者钉住的池子代码变了，不能新开，也不能强平，平仓可以。保证金 10 及以内 50 倍，100 及以内 20 倍，超过 100 是 5 倍。整本上限 3000。一个人一个方向最多 600。实际能开的是这个上限和保险金 20 倍里较小的那个。核对时三本保险金都是 0，所以还开不了，要先存保险金。一笔 10 美元的 50 倍，名义是 500，保险金至少要有 25。强平要连续两次都低于强平线，而且至少隔 2 分钟。强平罚金进保险金，不给发起的人。手续费也留在保险金，不打给多签。多签把上限调大要等 24 小时，调小马上生效。这 3000 大于把池子价格压住的实测成本，尤其是 TAPE。刚换下的 UP 0x277689ab82b04aE8100683B155CE2e2E12C82b30、TAPE 0x5C9F44A4D1f5F9082D3Cb02d11d717DE9563251A、FAB 0x03A1B0e5E225855905a63BD2a5A3Eb3A366A3caA 只平仓。",
      "已经换下的永续，页面不再新开，平仓仍可以签。核对时这些本都没有未平的仓。BSC 跟单金库仍绑着 0x89b2f4a2e0C07864172fB47fbDEa14411AF2e0E0，所以这一本还留着平仓路径。X Layer 金库 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe 和 BSC 金库 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5 的代码长度都是 8345。申请退出之后这两口都拒绝新开。0xe895122Ba5aF841704730B999a73F9562F5bd46E 短 14 字节，退出之后仍能开，页面不读。",
      "页面新设红包规则只接受固定金额。随机区间不再从页面写上。已经部署的红包合约改不了，直接调用仍可能走旧的随机金额。不另部署一份还没核对的开奖合约，避免把已经核对过的运行码换掉。",
      "SealRebate 的 clerk 是 0x585d2DF4B8fDDA783B074555e6F3787e3fCB39D7，不是多签。这份合约的构造参数里没有 clerk，部署时写死。主页不另放一份重写的领取合约，避免领错金额。",
    ],
  },
  {
    h: "风险",
    ps: [
      "本页是产品规则，不是审计报告，也不是收益承诺。下列合约没有升级入口。已经锁入永续的保证金，不能通过修改网页取回。没有管理员也不等于不能被攻击：合约没有经过独立审计。浅池上的标记价仍可能被带动。比特币、ETH、ZEC、UP 和 TAPE，标记合约记下的是 poke 那一刻的现货。现在的 X Layer BEM 用两口池各自的 10 分钟均价，不靠 poke。同一笔里可以先把池子砸偏再 poke。TapeMark 只接受 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D 提交价格，每次最多变 50 个 tick，约 0.5%。UP 永续现在这本的标记读 tapeup.io 官方池 0xDf40529fa3E797c992272e27B811E59E5f1827Ae。这个官方池是代理合约，实现由 tapeup.io 更换。实现地址一变就停止新报价，不能开仓也不能强平，平仓仍用最后一次均价。每次 poke 最多走动 50 个 tick，约 0.5%，两次至少隔 30 秒，再取 10 分钟均价。BEM 换成 USDT 读池子自己的 10 分钟均价。官方池现价和这份均价相差超过约 1% 时不能开仓，也不能强平。这一本按保证金分档：10 美元及以内最高 50 倍，100 美元及以内最高 20 倍，超过 100 美元最高 5 倍。页面不每 30 秒自动 poke。刚换下的一本仍是整本最高 5 倍，不再开新仓。再上一本读的是官方池即时价，也不再开新仓。返佣合约的 clerk 只能取走返佣池里还没领的余额，不能动用户锁着的保证金。不通过下单函数直接转进合约的资产，谁都取不回。",
      "现货台费是付出金额的 0.20%，和兑换在同一次钱包确认里。拒绝或失败，两边都不发生。",
      "现在交易的 BEM 永续有资金费、保险基金和自动减仓。资金费每 8 小时在这一对的保证金里结算，封顶 ±0.05%。强平剩余一半进保险基金、一半给强平的人，保险不能提取。保险不够时只减这一对的盈利方。台费进对应链的多签。比特币、ETH、ZEC、UP、TAPE、FAB 列在合约名单里，点进去是各自的结算本，不再改成 BEM。晶体管永续仍不在交易台，不能新开。只有旧借贷池还留着，而且只能还款、取出和取回抵押。BSC 的 BEM 永续已经换成新本，可以新开。X Layer 的 BEM 永续已经换成 10 分钟均价的新本，可以新开。刚换下的现货标记那一本只平仓。千分之二进该链多签。",
      "BSC 标记价取 PancakeSwap 池约 10 分钟的时间加权均价。流动性不足时，该均价仍可能在短时间内被带动。X Layer 的页面报价读 Uniswap v3 的 BEM/WOKB 1% 池 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A。页面上的 X Layer 永续用标记 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC，读两口池各自的 10 分钟均价，核对时约 11.10 美元，可以新开。刚换下的现货标记 0x706c4AB8B20f4045623fcC91b24e4746f9776e01 不再用于这一本。旧的 v4 标记不再用于这一本。晶体管永续的标记仍仅接受收费地址写入。",
      "下单所用合约地址写死在页面中，不随本机缓存更换。保证金只进入地址一节列出的合约。",
      "练习只存在于本机浏览器，不进入上述合约。止盈与止损要求本页保持打开，并由钱包完成签名。拒签之后不会自动再次请求，需要再次提交。",
      "代码仓库公开，不等于已经通过独立审计。开仓前应以本页与钱包中的合约地址核对。",
      "旧合约 0xC5A63E4c37c23F97558673731196abC30FBFa659 不再使用。网站不再部署它，也不再授权给它。这份合约的 run 可以由调用者指定任意地址和调用数据，留在这个地址上的授权可以被别人转走，不只是 BEM。账户页会检查已知代币的额度，并可以撤销。请把对这个地址的授权改成 0。新合约只能由该链多签部署。现货路由、永续、借贷、期贷和红包只授这一笔要用的数量。以前留下的无限授权不会自己消失。永续下次开仓先把它改成 0，再只授这一笔保证金，然后才开仓，所以可能要签三次。官方路由在同一笔里改成这一笔的数量；有的稳定币要先改成 0 再授这笔。这些合约只扣签名的那个钱包，别人拿不到额度去转走余额。额度还在时，如果那份合约以后出问题，留下的额度就有用，不是零风险。跟单金库仍是无限授权。页面已关闭跟单新存入。页面现在读金库 BSC 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5、X Layer 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe。BSC 这一口跟刚换下的 BEM 永续 0x89b2f4a2e0C07864172fB47fbDEa14411AF2e0E0，没有跟着交易台换。X Layer 这一口仍跟刚换下的 BEM 永续 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2，没有跟着交易台换。还有挂单、仓位或未结保证金时不能存也不能取，结清后才按现金净值。有份额的人可以申请退出，满 6 小时后任何人可以强制平掉这口金库自己的挂单和仓位。这两口在已申请退出时都拒绝新开单。刚换下的 X Layer 0xe895122Ba5aF841704730B999a73F9562F5bd46E 跟同一本 X Layer BEM，但申请退出之后仍能开新单，页面不再读。上一口 BSC 0xdB9B6B6180480869DC2183C289480261F8E9Cd5A 申请退出之后仍能开新单，页面不再读。再上一口 BSC 0x138524b76E10b1c60060CD11e8946d24D861Fe23、X Layer 0x721f32Efae0276B3C77652a192A14c3a5Da20aCd 没有这道超时，页面不再读。更早的 BSC 0x731a2572b1cf56cfb804c74555715c8c8b5e980b、X Layer 0xb0e31149c03f1300bd9ff8c165b1fa38fda2f0bb 没有升级。页面存款按钮仍然关着。比特币、ETH、ZEC、UP、TAPE、FAB 页面只签新本。浏览器里如果还记着上一本地址，也不再用。换的时候旧本没有未平仓位，也没有未撤挂单。旧本没有升级，页面不再调用。BEM 对照不是这个缺陷。借贷和期贷不为此重部署。成交已经上链而手续费还没扣时，用单独的补费，不要再点成交。同一个浏览器里，另一个页面还停在钱包确认时，不会因为等了两分钟就再付一次。那个页面没有应答，这一页也不会自动补。只有你确认那个页面已经关掉，才会接手；它若仍有应答，确认也不补。手续费从记账合约付出，同一个编号再付会失败。BSC 0x6E7B7145c10AA01C63918F201Fb4d73f8aeCfF9a，X Layer 0x5a76855251Fa311001319D5f59D7dA9A4c6e87c5。同一编号通过该合约再付一次会被拒绝，不区分设备。直接转入收费地址的资产不构成该笔手续费，编号仍为未付，页面不会据此免收。无关转账不能把一笔手续费记成已付。每笔仍要钱包确认。跨链补 gas 只接受源链、目标链、金额、已核对的路由和收款人都对得上的报价。认不出的调用不交给钱包。这些都是页面规则，不改变已经部署的合约。",
      "BSC 和 X Layer 的 BEM 永续都已经换成新本，可以新开。多签已经部署。主页按钮和页面里换下来的部署代码都已删掉，只能签已经写上的这一本。TAPE 标记 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7，永续 0xC74795Aac0FE2E0Db36beeF422504f464c3083f1。UP 永续 0xe9B1fe713FcE9E4670c610cCc5bf2F2decDCcA4A，标记 0xEf744901777f6CDD3C27D20380eC2E7c6740326C。刚换下的 0x277689ab82b04aE8100683B155CE2e2E12C82b30 和 0x5C9F44A4D1f5F9082D3Cb02d11d717DE9563251A 只平仓。X Layer 金库换成 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe，申请退出后不能新开。比特币、ETH、ZEC 换成读 10 分钟均价的新本。UP 换成新本，标记读 tapeup.io 官方池 0xDf40529fa3E797c992272e27B811E59E5f1827Ae。这份池是代理合约，实现一换，新标记就停止报价。UP/BEM 每次 poke 最多变 50 个 tick，约 0.5%，两次至少隔 30 秒，再取 10 分钟均价。BEM/USDT 读池子自己的 10 分钟均价。现价和均价差过 3% 时，新开仓和强平会拒绝，平仓不受这一条限制。这一本按保证金分档，不再整本锁死 5 倍。刚换下的 0xceC1334Bc30D05e3ceab6bA19a5C0915df075552 仍是整本最高 5 倍，不再新开。再上一本读的是官方池现价，也不再开新仓。交易台的 BSC BEM 已换成 10 分钟均价永续 0x070c66555535e1145275df54f4eEBBfd28d98581，核对时标记约 11.37 美元。刚换下的 0x89b2f4a2e0C07864172fB47fbDEa14411AF2e0E0 不再新开。跟单金库 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5 的 book 仍写死在这一本，不会跟着交易台换。比特币、ETH、ZEC、UP、TAPE、FAB 列在合约名单里。晶体管永续仍不在交易台。旧借贷池只留还款、取出和取回抵押。",
      "UP、TAPE、FAB 的新本按这一笔保证金分档：10 美元及以内最高 50 倍，100 美元及以内最高 20 倍，超过 100 美元最高 5 倍。同一笔里拆开也按总保证金封顶。比特币、ETH、ZEC 和 BSC 的 BEM 仍是 50 倍。UP 和 TAPE 已经换成这一档。核对时三本保护都开着，可以新开。价差没过约 3% 就不必等满 10 分钟。现价和均价差过约 1%，或者钉住的代码变了，不能新开，也不能强平，平仓可以。TAPE 新标记卖 1 枚到官方池 0x58eaD5b41Cfd3627791D439402dd65571c286484 的 OKB 一边。这一边每次 poke 最多 50 个 tick，约 0.5%，两次至少隔 30 秒，再取 10 分钟。换成美元用 OKB/USDT0 池 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082 的 10 分钟均价，不读现价。现价和这份均价差过约 1% 时不能新开，也不能强平，平仓可以。50 倍大约在标记走 1% 时会被强平，所以至少要隔开的两次 poke，不是同一笔成交。核对时把官方池现价推大约 1% 要卖出约 149 枚 TAPE。连续 20 次顶格推动大约 10%，5 倍会被强平，3 倍还不会。页面不自己连着记价格。差过约 1% 时，按钮只记一次，不开仓。官方池 0x58eaD5b41Cfd3627791D439402dd65571c286484 的运行码哈希是 0xf5e304a7d79711bb3c77a1380a0e2898ee40621ff46a14ad3456e205096f9fa9。哈希变了，页面停 TAPE 新开。FAB 已经换成 0xa03525d6C0367E6589Af4cc93b5aA16C4F280411，标记 0xe6F8419FE6F22d19933Ec6028366fc698709e73F。分档和上面一样。现价和均价差过约 1% 不能新开，也不能强平，平仓可以。刚换下的 0x03A1B0e5E225855905a63BD2a5A3Eb3A366A3caA 只平仓。上一本 0x61eb43aa602554324701cd2b551adff5b850d9cd 只平仓。再上一本 0x80318c852eE7fBDe52cE439deC3AE022Ba39A536 只平仓。页面不自己连着记价格。",
    ],
  },
  {
    h: "交易台",
    ps: [
      "现货在签名的钱包里成交。BSC 上的交易对走 PancakeSwap。OKB 走 X Layer 的 PotatoSwap，付的是 USDT0（0x779Ded0c9e1022225f8E0630b35a9b54bE713736），不是另一张名叫 USDT 的币。买到的币留在这个钱包。台费是付出金额的 0.20%，在池子手续费之外，和兑换在同一次确认里。拒绝或失败，两边都不发生。热门是 BEM/USDT、UP/USDT、UP/BEM、FAB/BEM、TAPE/USDT0、TAPE 算力，以及 BTC、ETH、BNB、OKB、ZEC。",
      "UP 现货只在 BSC。代币是官网 TapeUP 0xEd99445d72787Adb627cD8588586984DF548CD2F。UP/BNB、UP/BEM、UP/USDT 的买入和卖出都走 tapeup.io 官方池 0xDf40529fa3E797c992272e27B811E59E5f1827Ae，不走 Pancake 的 UP 池。买入先在这个池里换成记在池账上的 UP，同一笔里再提出来，打进签名钱包。卖出先把 UP 存进这个池，再在这个池换成 BEM。UP/BNB 接着把 BEM 换成 BNB，UP/USDT 接着把 BEM 换成 USDT。这个池是代理合约，实现由 tapeup.io 更换，页面不能阻止。钱包能合并时，台费和这一笔是一次确认。",
      "永续有两本，不能并成一笔。BSC 的保证金是 USDT。X Layer 的保证金是 USDT0。保证金锁进你所选链上的那一份合约，平台不经手。现在交易的 BEM 永续有资金费、保险基金和自动减仓。资金费每 8 小时在这一对的保证金里结算，单次不超过 ±0.05%。强平剩下一半进保险基金，一半给调用的人，保险基金不能提取。保险不够时，只减这一对赢家的浮盈，不平别人。亏到保证金大约一半，任何人都可以强平。比特币、ETH、ZEC、UP 在 BSC，TAPE 和 FAB 在 X Layer，各自一本。合约名单里点进去就是这一本。换到另一条链时落到那条链的 BEM，因为这六本不能跨链。千分之二进该链多签。",
      `BSC 的 BEM 永续以 PancakeSwap 池约 10 分钟均价为标记，不以最后一笔成交强平。流动性不足时，该均价仍可能在短时间内被带动。页面上的 X Layer 报价读 BEM/WOKB 1% 池，不在行情上另写两口价。已经部署的标记 ${KNOWN_XMARK} 仍读旧的 v4 池，链上那个数高于现货，不再用于这一本，强平也不用它。页面上的 ${KNOWN_XPERP} 读 10 分钟均价标记 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC，可以新开。刚换下的 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2 只平仓。旧标记 ${KNOWN_XMARK} 不再用于这一本。挂单只有下单的那个钱包能撤，撤单收保证金的 0.20%，余款退回。已经成交的仓位不能撤，只能平仓。没人接的单停在当前委托，订单簿上标「我」，这时没有盈亏。有人接了才变成仓位。仓位写出数量、开仓价、标记价、保证金、盈亏金额和盈亏比。`,
      "电脑页眉右上角在 BSC 和 X Layer 之间切换，旁边是登录。点登录才进去：可以用浏览器里的钱包，也可以用 OKX、小狐狸或币安扫码。连上之后，BSC 和 X Layer 的签名和交易都发到那部手机。手机没自动弹出时，页眉写着打开钱包点确认。网页自己签不了。进去之后才显示地址和退出。手机页眉右上角只留这两条链。语言、主题、手续费、OTC、红包和其余入口收在左上角菜单里，点开才出现。English、Français、简体中文、한국어、Español 都收在「语言」里，点开才出现。手机底部是市场、交易、账户。手机上连接和退出在账户页。收付款在账户页收成一行，点开才收款或付款。可以收付 TAPE、FAB、两条链的 BEM、UP、OKB 和 BNB。FAB 在 X Layer。UP 在 BSC，是官网代币 0xEd99445d72787Adb627cD8588586984DF548CD2F。两本账不合并，也不另收一笔。BEM 永续留在 BEM，只换链。BSC 上的比特币、ETH、ZEC、UP 切到 X Layer，打开的是 X Layer 的 BEM 永续。X Layer 的 TAPE 永续切到 BSC，打开的是 BSC 的 BEM 永续。BSC 的 BEM 或 BEM/BNB 现货切到 X Layer 的 BEM/OKB，BNB 现货切到 OKB，其余 BSC 现货切到 TAPE/USDT0 池。X Layer 的 BEM/OKB 切回 BSC 的 BEM，OKB 切回 BNB，其余 X Layer 现货切回 BSC 的 BEM。钱包已经连接时，请钱包换到那一条链。没连接时只换交易台，不弹出钱包。",
      "永续开仓先挂一张报价，自己不会把自己吃掉。对手价穿过时，后开的那一边用吃单把两边撮上，千分之二在这一笔撮合里扣。没穿过就停在当前委托，不扣台费。同一个钱包不能吃自己的单。两边都只点开仓、没有人再吃，就只是两张挂单，谁也没有仓位。杠杆是页面上的 1 到 50，可以输入。合约仍接受直到 1000，直接调用可以更高。1000 倍时价格反向约 0.05% 就接近强平。锁定的保证金是名义价值除以这个杠杆，单笔不超过 500，全仓不把倍数改掉。小白止盈止损按方向算，不是只算做多：做多止盈是开仓价乘以（1 加 1/杠杆），止损是开仓价乘以（1 减 0.5/杠杆）；做空止盈在下方，止损在上方。这一档写在本页，要本页开着并由钱包签名。市场名单跟着页面语言。英文是 Spot、Perp、Stock，池子、订单簿、工房挂单写成 Pool、Book、Workshop。",
      "有推荐人时，页面先收的千分之二里，6% 付给推荐人，交易者少付 4%，90% 进入该链多签。现货、永续和流动性按这个分。工房订单簿和 TAPE 池的合约没有推荐人字段，千分之二整笔进收费地址。",
    ],
  },
  {
    h: "工房",
    ps: [
      "先铸造 NAND 或 LATCH，再流片。流片页标题下写 TAPELIQUID 的晶体管总量、已铸造，以及已经流片烧掉的颗数。NAND 和 LATCH 共用这一个总量。烧掉的按种类分开，不算另外打进黑洞的。流片烧掉网表里的晶体管，不能撤回，也不能再铸回来。一张最多 18,000 个 NAND，或 30,000 个 LATCH。更大的网表会失败，晶体管还在钱包里。",
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
      "TAPE 是 TAPELIQUID 的唯一平台币，只此一份，在 X Layer。没有第二枚。硬顶 21,000,000。无预挖，无团队份额，无私募。只发给已流片并且已开工的电路。未锁仓电路的领取进入该电路登记的矿工地址。实时流通等于已领出减去黑洞、两口 TAPE 池、现货账本、回购里还没销毁的、借贷抵押、电路锁仓、晶圆锁仓，以及期限合约里的 TAPE。期限本金包括还在锁的，和到期还没取回的。已挖还没领的还没有铸出来，不算进流通。销毁占比是黑洞余额除以已领出。已流片按电路下一号减一。质押电路是电路锁仓里还锁着的片数，不是期限里的 TAPE。",
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
      "质押 TAPE，奖励是 X Layer 的 BEM。质押 X Layer 的 BEM，奖励是 TAPE。页面上「可质押」是这个钱包里还能锁的数量，「已质押」是这个地址已经锁上的本金，下面另写全池。每一笔锁仓写数量、期限和新加坡时间的到期日。没到期不能取本金。到期后同一行签一笔，本金回到钱包。领取只领奖励，不退本金。奖励谁都可以充。还没按 365 天分出去的，只有充入的地址能取回。已经分给质押的不能再取。年化用还没分完的奖励和池子现价来算。有人再质押，或取走还没分完的奖励，年化就变。价格读不到写成 —，不写成 0。这份期限合约没有管理员，不能升级。现在用的是 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833。以前的 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A 只取不存。直接把币转到合约、不走质押函数的，取不回来。",
      "BSC 的 BEM 不进这份合约。一份合约读不到另一条链。X Layer 上的 BEM 是 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952。BSC 上的 BEM 是另一份。要质押 BEM 领取 TAPE，先用 TapeOut 桥转入 X Layer。本站不经手资产。这一跳只签桥自己的那一笔，不另收台费。桥自己的费另计。TAPE 不能走这座桥。新回购只允许买方地址充入和取回 USDT0，没有管理员，不能升级。0.1 USDT0 和两个代币写在合约里。直接把币转到合约、不走充入或卖出函数的，取不回来。",
    ],
  },
  {
    h: "现货",
    ps: [
      `工房现货是 X Layer 上的订单簿，不属于交易台。一份合约分四本账：TAPE、NAND、LATCH 以 USDT0 报价，电路按张定价。同一价格并为一档，先挂的订单在前。买方按该档价格支付。卖方实收 99.8%，千分之二进入收费地址。可成交部分即时成交，剩余部分继续挂单。页面列出卖盘可买、买盘可卖、已读成交与手续费，并按所填价格给出可成交数量与剩余挂出数量。NAND 和 LATCH 只收整数。切换市场时先清空上一本，空的市场不写成 0，也不把别的币的挂单留在这一本上。费率、两个代币、晶体管、电路与收费地址均写在合约中。没有管理员，不能改费率，不能升级。未通过挂单函数直接转入的资产无法取回。地址是 ${TAPE_SPOT}，已经部署。每台设备都读这一份。`,
      "电路和 TAPE、NAND、LATCH 分开。在售只列已经挂出的电路。钱包里没挂的，和锁仓里的，在「我的」，不写进盘口。在「我的」点一行，再填 USDT0 挂出。买方付挂出价。卖方实收 99.8%。每一行写结构、算力、卖价、千分之二、卖方实收、估算日产、日产能价和卖家。算力是门数。估算日产等于当日排放乘以这张门数，再除以全网权重，并且假设这张已经开工。没开工不是实际到账。日产能价等于挂出价除以估算日产，单位是 USDT0 / 每日 1 TAPE，只用来比较。占全网是门数除以当前全网权重。带虚线的字，鼠标停上出说明，移开消失。成交不满两笔不画 K 线。这份电路合约只记录输入、输出、状态和门数，不记录每张用了多少 NAND 和 LATCH，所以这一页不写晶体均价。",
      "点一行弹出这张电路。电脑是中间一窗，左边是规格和估值，右边是卖价和下单。手机是一整页，规格在上面，买入或挂出钉在底部。点窗外、点关闭，或按 Esc，窗口收起。规格写结构、算力、卖家和状态。估值写估算日产、日产能价、算力均价、卖价产出比和按年回看。算力均价是卖价除以门数。卖价产出比是卖价除以估算日产，再按现在的 TAPE/USDT0 池子价换成天数。按年回看是 365 除以这个天数。池子价变了，这两个数就变，不是承诺。晶体均价没有。最高出价没有，电路只有卖单。数量是 1，不能拆。在售的可以买入。自己挂的可以撤下。钱包里的填价格再挂出。锁着的要先领回。",
      "挖矿页只做领取、质押、销毁和库藏。赚取页写这个地址的算力点，以及它占全网算力的比例。算力是已开工电路的门数，加上拆开后记在这个地址上的份额。NAND、LATCH 与电路在顶栏的 TAPELIQUID。晶体管合约在顶栏的 TapeOut。铸造已经结束，页面不再提供铸造入口。钱包中既有的 NAND 与 LATCH 仍可流片，也可在 TAPELIQUID 卖出。",
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
      "现货买卖、永续撮合、撤单、添加流动性、撤回流动性，台费都是付出金额的 0.20%。此费用在池子手续费之外。平仓不再另收。添加流动性时两边各扣 0.20%，撤回时拿回的两边再各扣 0.20%。已转出的台费不退。现货台费和兑换在同一次确认里。拒绝或失败，两边都不发生。永续开仓先把保证金锁进合约，0.20% 在撮合的同一笔里扣，没人吃的挂单不扣。撤单退回时扣 0.20%。额度已经等于这一笔保证金时，开仓只要一次确认。",
      "现货买到的币留在签名钱包。永续保证金进入用户所选链上的那一份合约。BSC 与 X Layer 不能并成一笔。",
      `没绑邀请人时，页面先收的千分之二整笔进入该链多签。BSC 是 ${BSC_SAFE}。X Layer 是 ${XLAYER_SAFE}。绑了邀请人之后，这笔的 6% 付给邀请人，4% 少收交易的人，90% 进入该链多签。现在的现货订单簿和两本永续，合约里的千分之二进该链多签。以前的订单簿、TAPE 池和上一本永续仍进 ${FEE_TO}。印鉴减费仍认上一本永续和上一本晶体管，新本的成交还领不了。电路容器的开通费是协议的 BNB，不走这笔台费。比特币、ETH、ZEC、UP、TAPE、FAB 在永续页和 BEM 是同一类保证金合约，不是现货买入。点进去签的是各自那一本。`,
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
      `X Layer 永续是 ${KNOWN_XPERP}，可以新开。标记 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC 读 BEM/WOKB 和 OKB/USDT0 各自的 10 分钟均价，核对时约 11.10 美元。刚换下的 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2 只平仓。BSC 永续是 ${BSC_REBATE}，这一本可以新开，读 Pancake BEM/USDT 约 10 分钟均价。刚换下的 ${LAST_BSC} 只平仓。上一本 ${PREV_BSC} 只平仓。晶体管永续仍是 ${GATE}，是旧本，不能新开。标记从空开始，第一笔要 BSC 多签写入。千分之二进该链多签。没有管理员。`,
      "同一份标记只挂这一本 X Layer 永续。BSC 上的 BEM 永续读 Pancake 池子的均价，不读这份标记。浅池仍可能在短时间里影响那条均价。",
      "BSC 永续页上，BEM、比特币、ETH、ZEC、UP 是同一张合约台。比特币和 ETH 各有自己的永续，标记读各自的 Pancake 池约 10 分钟均价，不写进 BEM 那一本。ZEC 读 Pancake 的 ZEC/USDT 池 0x6701B287c8170D6c290C6f4Ef426782bD61Ae310。UP 读官方池 0xDf40529fa3E797c992272e27B811E59E5f1827Ae，标记 0x11dCaA2ee4A6F4c437B9B6B304FFBc09B768845B，再换成 USDT。上一本 0xB3cdB968580cE0121f613886E8f86EFFcC514d70 读官方池现价，不再开新仓。再上一本 0x5f913f7AFa71c51d69F472b0fE4c3EC74b1132F8 也不再开新仓。TAPE 永续在 X Layer，结算本是 " +
        TAPE_COIN_BOOK +
        "，标记 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7，千分之二进 X Layer 多签，没有管理员。FAB 永续在 X Layer，结算本是 " +
        FAB_COIN_BOOK +
        "，标记 0xe6F8419FE6F22d19933Ec6028366fc698709e73F。BEM/FAB 现货一次最多约 0.5%，安静越久可以走得越多，单次最多约 10%，再取最多 10 分钟。美元用 BEM 和 OKB 的 10 分钟均价。价差没过约 3% 就可以新开。刚换下的 0x80318c852eE7fBDe52cE439deC3AE022Ba39A536 只平仓。千分之二进 X Layer 多签，没有管理员。合约名单列出这六本，下单签到上面这些地址。换链落到该链的 BEM。千分之二进 BSC 多签。开仓价不能超过 100000。",
      "TAPE 是 TAPELIQUID 的唯一平台币。只有这一枚，没有第二枚。矿池没有管理员，也不能改排放。",
      "SealRebate 的 clerk 可以取走返佣池里还没领的余额。circuits 为 0 的版本里，clerk 还可以直接给地址开领取资格。这个 clerk 不是多签。RedDesk、RedNext、RedPerp、RedPacketOpen 的创建人可以改那一份的规则，并取走那一份的余额。TapeBid 只有写死的 BUYER 能存取。不是每一份合约都没有管理员。",
    ],
  },
  {
    h: "借贷",
    ps: [
      "借贷利息的 10% 记成多签的存款份额，90% 留给存款人。本金不另收费。清算多拿的 5% 给代还的人。没有管理员。",
      "X Layer 抵押 OKB：0x98814252d0BacaD3FddF4433F3BF388686F26F97，借 USDT0。X Layer 抵押 TAPE：0xB6d0fE8552f1F14E4F282DEcb137645E3c988D11。X Layer 抵押 BEM：0x07d25044cBE0524c0617267d6BFAf2Fa6A0A0eFe。TAPE 和 BEM 会挡住还没走到市场价的价格。刚换下的 OKB 0x62f9016C97eF9255C8Ba16DDa7F531656015DAeA、TAPE 0x8674351Fae2781c077977aE589F2FA71a1bb4992 和 BEM 0x741331f4c8e4D6937FB92eC88ceE27c9e0AC3062 只出不进。再上一口 OKB 0x6135b562c5d46595b044519e787FE396830C5C83、TAPE 0xF2925A78AdaC85cA330643bc5584A694199AfB76 和 BEM 0x77F01670F70A13299531906e54D45c4247d0E3bf 只出不进。上一口 OKB 0xc417780f4e1F9385BE1ba4cbDe7b40860B2aA8b0、TAPE 0x99CA040580837a2158Bfd0c8d84fcD4B85b6393b 和 BEM 0xfA211308F9583bEB9aaF724044863b78BfD7B9C1 只出不进。上一口 OKB 0x57228158cba08c61710ab2644e583c328ec86ea7、上一口 TAPE 0x8d06D78bd5eC97104cE3c7F10A73516fE1Ab4525、上一口 BEM 0x01264DBDEC9Be07c7C1E942D8C4dcfC72A7691b2，以及更早的 TAPE 0x586B7992A8467290C5a1857FcE7EC8AF72be9445、BEM 0xeC55C19F6b0E08FbAd7DECD54bf8c892230fD353、TAPE 0xa49970ffafa28a0e596745e08993df611170f96f、BEM 0x8d3074bdf9412d77269f59cc506e318e5da27914、TAPE 0x425285da21ed3eabe64550d1be7dcabcf6f9e851 和 BEM 0x5ed8551f90acc6395810d8274b019bf13ef1f696，只留取出、取回抵押和还款。BSC 抵押 BNB：0xd80B34d487CeC5F8F4966B65517Ba0b0CB2E9c31，借 USDT。BSC 抵押 BEM：0x03e2fed201edeF0f70789A79c6D59BeEbc05fB41。刚换下的 BNB 0xC4bA21b1566Aee4b1113f166C5f496275E51A65E 和 BEM 0xEF9d226254b7Ce8CdCD5b1170d70518AfDC3e05A 只出不进。再上一口 BNB 0xd66C0EA7acCC3D4e8E82a999e7345404803643BC 和 BEM 0x0A0C3D5A8D20468fea019590Bd3FC11623260223 只出不进。上一口 BNB 0x0712cCa64B91Ec87cc175aa46cC38b54c8D3Bff3 和 BEM 0x4127ddA5153042B6E6aFC02316587ab85D985B3A 只出不进。上一口 BNB 0xd8d981d32b12ea85b739bb667946975d25b0ab53 和上一口 BSC BEM 0xD71C270DFf9DF25245B367489D338629059E5014 只留取出、取回和还款。更早的 BSC BEM 0xd2c7150f7779ded403c3f81a68dab5164b54df28 也只出不进。更早的 0x51a1f26d6e8142513ab6c5d1f8fa993683dd1212 和 0x58d980f548c150be59819cdbfe46b8a14ef4fe56 页面不读。",
      "存入是把稳定币借出去。别人还没还的部分取不出。借入先抵押，最多借到抵押品价值的 50%。欠款按借款年化增加，从 2% 起，最高 50%。还清才能取回抵押。欠款超过抵押品价值的 75%，别人可以代还，并从抵押里多拿 5%。OKB 和 BNB 用池子约 30 分钟均价。TAPE 和 BEM 的价格每 30 秒最多走动 0.5%。价格还没走到市场价时，不能新借，也不能在有欠款时取回抵押或清算。走到了，超过 30 分钟没有再记账，同样不能。没欠款的取回不受这一条限制。现在 X Layer 的 TAPE 和 BEM 有这一条。BSC 的 BEM 用池子现价，没有这一条。更早的池没有，只能取出、取回和还款。直接转进合约、不走存入或抵押的，取不回。页面现在读的五口已经核对过运行码。领走一部分或全部救助后，后来追回仍按原来的比例分。有欠款的人最多 32 个。这两条在这五口上。X Layer 的 TAPE 和 BEM 在价格还没走到、或超过 30 分钟没有再记账时，不能存入或取出。OKB、BNB 和 BSC 的 BEM 没有这道开关。更早的口没有。抵押盖不住的缺口，在有人清算之前就从存取款计价里减掉。借款人仍然欠这笔。后来追回只冲掉这笔减值，不记成新的收益。上一口只留取出、取回和还款。查过上一口，除上一口 BNB 里不到 1 USDT 的尘以外，存款和欠款都是 0。页面把接近全额的还款按当时欠款再加千分之一再加 1 个最小单位发出。余额不够这一点就整笔失败，不会按较小的显示金额只还一部分。净资产为零时，已减值债务的利息不再铸手续费份额，也不能靠分母里的 1000 继续铸。没有欠款时新借至少 10 个稳定币单位，X Layer 是 10 USDT0，BSC 是 10 USDT。还款或清算后剩下不到这个数又不是零，就必须一次还清。还清、清算和取出仍然可以。这两条已经在上面五口的运行码里。掩掉不可变参数后，运行码和这份源码一致。这五口不能升级。刚换下的五口没有这两条，只出不进。期贷两本没有这两条改动。地址已换，旧本只留取出、解锁和还款。BSC 以 BNB 为抵押的一口，已在链上完成一笔本金 10 USDT 的存入、借入、清偿、取回抵押与取出。结束后欠款、抵押与存款份额均为零。X Layer 以 OKB 为抵押的一口，已在链上完成一笔本金 10 USDT0 的存入、借入、清偿、取回抵押与取出。结束后欠款、抵押、存款份额与授权均为零。BSC 以 BEM 为抵押的一口，已在链上完成一笔本金 10 USDT 的存入、借入、清偿、取回抵押与取出。结束后欠款、抵押、存款份额与授权均为零。取出后池内残留 21131405340 wei，为份额取整。X Layer 以 TAPE 为抵押的一口，与以 BEM 为抵押的一口，各完成一笔本金 10 USDT0 的同样循环。结束后欠款、抵押、存款份额与授权均为零，池内现金为零。两口价格当时已超过 30 分钟未记账。TAPE 记账一次后即可借入。BEM 须按每次最多 0.5%、间隔 30 秒连记，直至与市场价相符，方可借入。",
    ],
  },
  {
    h: "期贷",
    ps: [
      "期贷是另一本账，不是上面的借贷，也不是期限质押。一条链一本，BSC 和 X Layer 各一份，同一份代码。没有管理员，不能升级。利率写死，不跟资金使用率变。",
      "期限八档，按整天，不是日历月：24 小时、3 天、7 天、30 天、90 天、180 天、270 天、365 天。利息每个整点按剩余本金计一次，不满一小时不计。提前还清只收已经走完的小时。到期不还，从到期之后的小时起按两倍计，直到还清或被平仓。没还的利息不滚进本金。",
      "BSC 可以抵押和借出 USDT、BNB、BEM、UP。X Layer 可以抵押和借出 USDT0、OKB、BEM、TAPE、FAB。同一枚不能既当抵押又当借出的资产。USDT 和 USDT0 不是同一枚。基础年化：USDT、USDT0 是 8%，BNB、OKB 是 12%，BEM、UP、TAPE、FAB 是 18%。八档再乘 1、1.05、1.10、1.20、1.35、1.50、1.65、1.80。逾期在这之上再乘 2。这是单利。",
      "新开仓最多借到抵押品价值的 50%，单笔至少 10 美元。负债率过 75%，别人可以代还，并按当时记下的价格多拿走大约 5% 的抵押。页面现在读的两本已经核对过运行码。领走一部分或全部救助后，后来追回仍按原来的比例分。这一本没还的单最多 32 笔。有人欠这一口时，过期价格不能存取。这三条在这两本上。抵押盖不住的本金，在有人平仓之前就从存取款计价里减掉。借款人仍然欠这笔。后来追回只冲掉这笔减值，不记成新的收益。不还的话，这笔本金存款人仍取不出。刚换下的两本和再上一本都是空的，没有未还的单，页面不再读。接近全额的还款按当时欠款再加千分之一再加 1 个最小单位发出，余额不够就整笔失败。一个人最多同时 16 笔没还的。",
      "利息的 10% 记成该链多签的存款份额，90% 留给存款人。本金不另收费。别人还没还的利息还不在可取余额里，等还款或平仓才进来。已经借出的本金，在现金不够时取不出。借款人的盈亏等于现在的净值减去开仓时的净值。净值等于抵押市值减去欠款。存款人的盈亏等于现在能取回的数量减去还记着的成本。页面按秒刷新倒计时。利息只在整点增加。",
      "价格谁都可以记账。稳定币记成 1 美元。其余每 10 分钟最多走动 0.5%。还没记满三次时，记账按钮写着还要多少分钟才能再记一次。连续记账，而且当时池子价和记下的价相差不超过 2%，这笔价格才算可用。可用的价格超过 30 分钟，不能新借，也不能平仓。还款和加抵押不受影响。UP 用官方池换成 BEM，再乘已经可用的 BEM 价。FAB 用 BEM/FAB 池换成 BEM。X Layer 的 BEM 用已经可用的 OKB 价。TAPE 用开盘池换成 BEM，再乘已经可用的 BEM 价。开盘池这一边是 BEM，不是 USDT0。OKB 用 WOKB 到 USDT0。BNB 和 BSC 的 BEM 用 Pancake 报价。",
      "直接把币转到合约、不走存入、抵押、还款或平仓的，取不回。合约不收裸转。期贷页面现在读新的两本。X Layer 是 0x536327976231cf4c12759D81C99b12bD40aF0DD6。BSC 是 0x92E44Ba44b2b3CC3E5C823d9dF5b571C7338f2c3。每条链页面只读这一份，旧本只留取出、解锁和还款。刚换下的两本：X Layer 0xC4fA8f4cE83ce03A0264D76ebdA8903FABb947d5，BSC 0x073452aD271ad5D511295aEB7706D4742dD1a75E。再上一本是空的：X Layer 0x29a08A0a0619Fd60a8131477859615F8AD438b58，BSC 0xf52a684531f8387e5383771887FF5b9FBa116b98。再上一本是空的：X Layer 0x087E68a1C6c5978Aab73056f7DCd69fc55d72839，BSC 0x285e93b48e80A7d22CdE47056579074A3842fBcD。更早的 X Layer 0x683fb58ee77172626D5B49087DdAc71eF7825d20 和 BSC 0xBa427D94b001FA1cf0f85E1E54c1E392e9a07610 也是空的。BSC 这一本的 BNB 价格须连续记账三次，相邻两次间隔 10 分钟，第三次后方可用于开立。其后以 BNB 为抵押开立一笔期限 24 小时、本金 10 USDT 的贷款，编号 1，并于同一时段清偿。抵押已退回，存款已取出，池内现金为零，无未偿贷款。X Layer 这一本以 OKB 为抵押开立一笔期限 24 小时、本金 10 USDT0 的贷款，编号 1，并于同一时段清偿。抵押已退回，存款已取出，池内现金为零，无未偿贷款。两笔结束后，相应授权均为零。",
    ],
  },
  {
    h: "奖励",
    ps: [
      "每一份新红包都是一份新合约。官方创建只有该链的部署地址能看见、能开。其他人只看见个人创建，任何人都能开。交易台页眉切换 BSC 和 X Layer。手机上红包在左上角菜单里，链仍用右上角切换。红包另选自己的链。发出时选定可领时间：24 小时、一星期或一个月。创建时把奖金打进这一份。卡片写明已领多少、还剩多少。已领按链上计算：读到入账时，用入账减去池中余额；读不到入账时，把这一份的领取记录加总。同一份里，一个地址每个新加坡日只能领一次。另一份新红包不受这一次影响，可以再参加。时间过了就不能再领，没领完的由放钱的人取回自己的那一份。",
      "任务是一笔兑换，不是把钱划走。买入写成用多少 OKB 或 BNB 换回约多少这一枚币，数量按当时池子报价。卖出写成卖出约多少这一枚币、换回多少 OKB 或 BNB。点参与后先看清这笔兑换，可以同意，也可以拒绝。同意之后才去交易。交易成功再点验证。验证通过才打开红包，再点领取，资产才进这个钱包。兑换还没完成、或者还没验证通过，不能领取。换链仍要再点一次。授权如果还剩着别的额度，同一次会先改成 0，再只授这一笔，然后接着做这一步，不会因为授权停下来再要求点一次。X Layer 用 OKB 计价，BSC 用 BNB 计价。必须是普通钱包自己签。合约、代付和没做这笔交易的地址都不能领。金额由上一个区块的 prevrandao、领取地址和余额算出，领取前就可以预先算出。可以先模拟，金额小就可以不领。已经部署的 RedPacket 和 RedPacketOpen 没有改成先登记、下一块再用区块哈希开奖，也没有改成均分。用现货瞬时价判断达标的旧红包，同一笔里可以先把价格拉高，再用更少的金额通过。新开的 X Layer TAPE 买入，买到的 TAPE 转给做任务的人，不会留在红包里。领完的奖金离开红包，回到领取的钱包。红包里已经有余额时，不能把奖金币改成另一种。发布台上最早那一份仍是旧代码。页面不再认 edition() 等于 2。只放行运行码已经核对过的那一份。标明版本 2、但运行码对不上的合约过不了。核对过的卖出必须真的换回页面上写的 OKB 或 BNB，不能只填一个很小的最低收到。已经核对的那一份买入会把 TAPE 转给做任务的人，但卖出门槛还没写进那一份合约。直接调用仍可能用很少的换回记成完成。期限过了不能再领。更早的红包合约不再使用。",
      "现货任务之外还有合约任务。X Layer 可以发 FAB 现货、TAPE 算力，以及 BEM、FAB、TAPE 合约。BSC 可以发 UP 现货，以及 BEM、UP 合约。BEM 合约两条链都能发。合约任务认的是这一本永续上当天的成交，方向和保证金都要够，不是现货兑换。UP 现货和 UP 合约都走官方池 0xDf40529fa3E797c992272e27B811E59E5f1827Ae。新发的 UP 现货在这个池买入后，当场把记在池账上的 UP 提出来交给做任务的人。只记账、不提出来的，或者还在交易里向这个池要报价的，交易完成不了，奖金领不了。那些已经发出的不能改，等倒计时结束由创建人取回。按旧 Pancake UP/WBNB 盖章的那一份认不了这个池，不再新开。",
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
      "电路和 TAPE 都在 X Layer。BEM 的 BSC 与 X Layer 互转，用 TapeOut 已经上线的桥：BNB Chain 锁仓，X Layer 铸造等量；回来则在 X Layer 销毁，BSC 释放。1:1，走 LayerZero。本站不经手资产。这一跳只签桥自己的那一笔，不另收台费。桥自己的费另计。",
      `BSC 上的 BEM 是 ${BSC.bem}。BSC 桥是 ${BEM_BRIDGE}。X Layer 上的 BEM 是 ${X_BEM}。入口是 tapeout.net/bridge。`,
      "TAPE 不走 BEM 的桥。TAPE 自己的 1:1 跨链合约还没有，页面不提供 TAPE 跨链按钮。OKB 与 BNB 走现货池：X Layer 上先换成稳定币，BSC 上换成 BNB，或反过来，由 Symbiosis 串起来。BSC 上把 BNB 换成稳定币，只接受四步且顺序固定：核对原生币数量、把 BNB 包成 WBNB、按写死的 Pancake 路径换成 USDC、再记正滑点。这条路径不能改池子，也不能改费率。结算合约要求拿到的 USDC 不得低于该池现价的 99%。最终 OKB 的下限不得低于同一笔 BNB 按池子价格折出的 OKB 的 98%。读不到这两个池子的价格，就不交给钱包。钱包能合并时，台费和这一笔在同一次确认里。不能合并时，先签兑换，成功后再扣 0.20%。兑换没发出去，不扣。到账按池子现价，最少到账写在按钮上面。2026 年 11 月 19 日，按该校验从 0x7fa7193115a481067af731499c551c5571071528 付出 0.002 BNB，交易 0xeee2faafd71945707440817b69a9171c6e10907e4ce28493bffb52c207edf455，X Layer 到账约 0.007803 OKB。",
    ],
  },
  {
    h: "现在链上有的",
    ps: [
      `TAPE 代币 ${TAPE}。挖矿合约 ${TAPE_MINE}。都在 X Layer。硬顶 21,000,000，8 位小数，没有管理员，也没有改率入口。只有挖矿合约能铸。总供应只随领取增加。代币运行码已在 Sourcify 对上源码，编译器 0.8.37，优化 200 次。`,
      "这份挖矿合约现在的日排放是 7,200，从部署时开始，不是先 1,000 再切换。它也没有「收费地址签一次改成 7,200」的入口。权重按电路门数，也就是 b*，处理器倍率按 1。q 还没有题目验证，页面不能显示大于 1。挖矿页和电路页的「一键验证」只读电路合约的 eval，不签名，不花 OKB。显示已核对只说明这张电路的门能跑完给出的输入。它不把权重移进 TapeOut 已验证的 99% 池。矿合约没有 verify 入口，页面改不了这个位。",
      "挖矿、TAPE 池、晶圆和电路锁仓，三份都没有管理员，不能升级，不能改期限，不能改费率，也没有救援入口。误转到合约、又没有对应仓位的资产，谁都取不回，页面不会这么转。加池时和池子比例对不上的部分退回给签名的人，不会进别人的份额。",
      "开盘池的 100,000 枚没有另铸。TAPE 池没有管理员。旧池不再新加。已经在旧池里的仓位，90 天到 3 年，到期才能在质押页撤。加池没有九个月这一档。官方池 0x58eaD5b41Cfd3627791D439402dd65571c286484 的 BEM/TAPE 和 OKB/TAPE 都可以在质押页按池子比例新加。这份合约的源码不在本仓库。四档：三个月、六个月、一年、两年。合约里还有三年，页面不开放。加进去先扣千分之二。到期前不能取。晶圆锁仓没有管理员，期限是 180 天、365 天、3 年、4 年、5 年。锁着的晶圆不能流片，不算算力。电路锁仓是 0x06c877cc158d9ca3547220f9fc156f39bce7013c。同一片电路不能锁两次。回购合约旧地址 0x72e28d564A90eF3E76f599bC210454f5360E200C 不再使用。现在的回购是 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF，买方写死。期限质押是 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833。以前的 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A 只取不存。两份都没有管理员。TAPE 跨链还没有合约。",
      "个人中心的持仓可以转出这个钱包还拿着的币、NAND 和 LATCH。一对一是一个地址。一对多每一行一个地址，这一行的数量只进这个地址，按行签名，不经过锁仓合约。先勾确认才能签。页面不跳走。电路在名单里上下滑动勾选，每一片填一个地址，勾几片签几笔。TapeOut 合约如果不提供逐个编号，这一页不能代填。",
    ],
  },
  {
    h: "地址",
    ps: [
      `页面先收的台费，以及现在的现货和永续合约里的千分之二：BSC 多签 ${BSC_SAFE}，X Layer 多签 ${XLAYER_SAFE}。以前的池子和上一本永续仍进 ${FEE_TO}。TAPE ${TAPE}。TAPE 挖矿 ${TAPE_MINE}。TAPE 池 0x58eaD5b41Cfd3627791D439402dd65571c286484。旧池 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641。流通减去这两口的余额。晶圆锁仓 0xA28390924607F08aaD8d03F512B41b6a1c012Ace。电路锁仓 0x06c877cc158d9ca3547220f9fc156f39bce7013c。回购 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF。期限质押 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833。以前的锁仓 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A。现货 ${TAPE_SPOT}。上一本现货 0xd398691dff583788e6e2d02dd33b1ffd9fa6b8bd 只撤单，不再挂新单。更早的 0x154E82c6a2ac121906D29af0EE81131E93B57860 也不再挂新单。TAPELIQUID 电路 ${DEPLOYED.circuits}。TAPELIQUID 晶体管 ${DEPLOYED.transistors}。`,
      `BSC 永续 ${BSC_REBATE}，可以新开，读 Pancake BEM/USDT 约 10 分钟均价。刚换下的 ${LAST_BSC} 只平仓。上一本 ${PREV_BSC} 只平仓。X Layer 永续 ${KNOWN_XPERP}，可以新开。比特币 ${BTC_COIN_BOOK}。ETH ${ETH_COIN_BOOK}。ZEC ${ZEC_COIN_BOOK}。UP ${UP_COIN_BOOK}，按保证金分档，可以新开，标记 0xEf744901777f6CDD3C27D20380eC2E7c6740326C，读官方池 0xDf40529fa3E797c992272e27B811E59E5f1827Ae。整本上限 3000 USDT，一个人一个方向最多 600，保险金为 0 时开不了。刚换下的 0x277689ab82b04aE8100683B155CE2e2E12C82b30 只平仓。再上一本 0x53610279d1fFaF4D211E4c3988c964A9E870007F 只平仓。再上一本 0xceC1334Bc30D05e3ceab6bA19a5C0915df075552 整本最高 5 倍，只平仓。上一本 UP 0xB3cdB968580cE0121f613886E8f86EFFcC514d70 读官方池现价，不再开新仓。再上一本 0x5f913f7AFa71c51d69F472b0fE4c3EC74b1132F8 也不再开新仓。TAPE ${TAPE_COIN_BOOK}，可以新开，标记 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7。整本上限 3000 USDT0，一个人一个方向最多 600，保险金为 0 时开不了。刚换下的 TAPE 0x5C9F44A4D1f5F9082D3Cb02d11d717DE9563251A 只平仓。上一本 0x76FF80D56E1be05BabeD1C4ef31fb9dEfa941d22 只平仓。再上一本 0xd5CaE88012A443449BE3d6efCf86A245A6972a86 只平仓。FAB ${FAB_COIN_BOOK}，按保证金分档，可以新开，标记 0xe6F8419FE6F22d19933Ec6028366fc698709e73F。整本上限 3000 USDT，一个人一个方向最多 600，保险金为 0 时开不了。刚换下的 0x03A1B0e5E225855905a63BD2a5A3Eb3A366A3caA 只平仓。上一本 0x61eb43aa602554324701cd2b551adff5b850d9cd 只平仓。再上一本 0x80318c852eE7fBDe52cE439deC3AE022Ba39A536 只平仓。这六本列在合约名单里。比特币、ETH、ZEC、UP、TAPE、FAB 点进去签最新这一本。换链落到该链的 BEM。晶体管永续仍不在名单里，不能新开。UP、TAPE、FAB 的手续费留在保险金。其余千分之二进该链多签。没有管理员。X Layer BEM 标记 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC。旧的 v4 标记 ${KNOWN_XMARK} 不再用于这一本。晶体管永续 ${GATE}，旧本，不能新开。流动性仓位 ${NPM}。X Layer 借贷：OKB 0x98814252d0BacaD3FddF4433F3BF388686F26F97，TAPE 0xB6d0fE8552f1F14E4F282DEcb137645E3c988D11，BEM 0x07d25044cBE0524c0617267d6BFAf2Fa6A0A0eFe。刚换下的 OKB 0x62f9016C97eF9255C8Ba16DDa7F531656015DAeA、TAPE 0x8674351Fae2781c077977aE589F2FA71a1bb4992 和 BEM 0x741331f4c8e4D6937FB92eC88ceE27c9e0AC3062 只出不进。再上一口 OKB 0x6135b562c5d46595b044519e787FE396830C5C83、TAPE 0xF2925A78AdaC85cA330643bc5584A694199AfB76 和 BEM 0x77F01670F70A13299531906e54D45c4247d0E3bf 只出不进。上一口 OKB 0xc417780f4e1F9385BE1ba4cbDe7b40860B2aA8b0、TAPE 0x99CA040580837a2158Bfd0c8d84fcD4B85b6393b 和 BEM 0xfA211308F9583bEB9aaF724044863b78BfD7B9C1 只出不进。上一口 OKB 0x57228158cba08c61710ab2644e583c328ec86ea7、上一口 TAPE 0x8d06D78bd5eC97104cE3c7F10A73516fE1Ab4525 和上一口 BEM 0x01264DBDEC9Be07c7C1E942D8C4dcfC72A7691b2 只出不进。更早的 TAPE 0x586B7992A8467290C5a1857FcE7EC8AF72be9445 和更早的 BEM 0xeC55C19F6b0E08FbAd7DECD54bf8c892230fD353 只出不进。更早的 TAPE 0xa49970ffafa28a0e596745e08993df611170f96f、BEM 0x8d3074bdf9412d77269f59cc506e318e5da27914、TAPE 0x425285da21ed3eabe64550d1be7dcabcf6f9e851 和 BEM 0x5ed8551f90acc6395810d8274b019bf13ef1f696 也只出不进。BSC 借贷：BNB 0xd80B34d487CeC5F8F4966B65517Ba0b0CB2E9c31，BEM 0x03e2fed201edeF0f70789A79c6D59BeEbc05fB41。刚换下的 BNB 0xC4bA21b1566Aee4b1113f166C5f496275E51A65E 和 BEM 0xEF9d226254b7Ce8CdCD5b1170d70518AfDC3e05A 只出不进。再上一口 BNB 0xd66C0EA7acCC3D4e8E82a999e7345404803643BC 和 BEM 0x0A0C3D5A8D20468fea019590Bd3FC11623260223 只出不进。上一口 BNB 0x0712cCa64B91Ec87cc175aa46cC38b54c8D3Bff3 和 BEM 0x4127ddA5153042B6E6aFC02316587ab85D985B3A 只出不进。上一口 BNB 0xd8d981d32b12ea85b739bb667946975d25b0ab53 和上一口 BSC BEM 0xD71C270DFf9DF25245B367489D338629059E5014 只出不进。更早的 BSC BEM 0xd2c7150f7779ded403c3f81a68dab5164b54df28 只出不进。X Layer 期贷 0x536327976231cf4c12759D81C99b12bD40aF0DD6。BSC 期贷 0x92E44Ba44b2b3CC3E5C823d9dF5b571C7338f2c3。刚换下的期贷只留取出、解锁和还款：X Layer 0xC4fA8f4cE83ce03A0264D76ebdA8903FABb947d5，BSC 0x073452aD271ad5D511295aEB7706D4742dD1a75E。再上一本是空的：X Layer 0x29a08A0a0619Fd60a8131477859615F8AD438b58，BSC 0xf52a684531f8387e5383771887FF5b9FBa116b98。上一本期贷是空的：X Layer 0x087E68a1C6c5978Aab73056f7DCd69fc55d72839，BSC 0x285e93b48e80A7d22CdE47056579074A3842fBcD。更早的空本：X Layer 0x683fb58ee77172626D5B49087DdAc71eF7825d20，BSC 0xBa427D94b001FA1cf0f85E1E54c1E392e9a07610。`,
      `BSC BEM ${BSC.bem}。BSC UP ${BSC.up}。BSC 桥 ${BEM_BRIDGE}。X Layer BEM ${X_BEM}。TapeOut BEM 挖矿 0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46。`,
      `TapeOut 晶体管市场 ${OFFICIAL.transistorMarket}。TapeOut 电路市场 ${OFFICIAL.circuitMarket}。BEM 池 ${BSC.pool}。`,
      `X Layer 印鉴领取 ${LOCKED_REBATE.xlayer}。BSC 印鉴领取 ${LOCKED_REBATE.bsc}。红包发布台 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d。X Layer 已经在用，每一份从这里新开。已核过的一份是 0xbF8c2d49faC5D66E85A4a228f64e93960F4823eE：奖金发出、买到的 TAPE 进钱包、领取后奖金回到原地址。BSC 使用同一个地址，第一次发布时放上。TAPE 走能成交的自有池。其他现货走能成交的兑换。合约只在本所。以前的红包不再使用。`,
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
    h: "Checked",
    ps: [
      "The X Layer BEM perpetual is now 0x46cBAfCA59873E7115dF7825fdBF659BafAc3a51 and can be opened. Mark 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC turns the 10-minute average of BEM/WOKB pool 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A and of OKB/USDT0 pool 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082 into dollars. It does not read spot. When checked, the average was about 11.10 dollars and spot about 11.25. The book stays at 50×. A new open or a liquidation is refused when spot and that average differ by about 3 percent. Closing is not. The homepage button is gone. The book just replaced, 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2, reads spot mark 0x706c4AB8B20f4045623fcC91b24e4746f9776e01, had no open position, and only closes. The copy vault is still bound to that book. Deploy transaction 0x794b5a83cefbda273b5babf5f4f6c1124165676750bcc120455676442c37edbe.",
      "The multisig has replaced UP, TAPE and FAB. The homepage deploy buttons are gone. UP is 0xe9B1fe713FcE9E4670c610cCc5bf2F2decDCcA4A, mark 0xEf744901777f6CDD3C27D20380eC2E7c6740326C, deploy transaction 0x58d7ddd4a137868031339e5622ddf77494c50b74430b69ae8f9f4872723673f5. TAPE is 0xC74795Aac0FE2E0Db36beeF422504f464c3083f1, mark 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7, deploy transaction 0x3134a283ce0dae566d905f578ceae5fd048c274d04e1b2b9a49f929757d1efa4. FAB is 0xa03525d6C0367E6589Af4cc93b5aA16C4F280411, mark 0xe6F8419FE6F22d19933Ec6028366fc698709e73F, deploy transaction 0xf7f7bc1f2af8c1a82da19d6a371a79b398a4d25e54fdaf111aadd655073d037f. Only the trading book can record the price. Each record moves at most about 0.5 percent, and a quiet market does not widen that step. Orders read at most a 10-minute average. If spot and that average differ by about 1 percent, or the pinned pool code changes, new opens and liquidations stop. A close still works. Margin of 10 or less can use 50×, 100 or less can use 20×, and anything above that is 5×. Each book is capped at 3000. One address on one side can use at most 600. The live room is the smaller of that cap and 20 times the insurance. When checked, insurance on all three was zero, so a new open is refused until insurance is funded. A 50× position on 10 needs 25 in insurance. Liquidation needs two readings below the line, at least 2 minutes apart. The liquidation fee stays in insurance and is not paid to the caller. Trading fees stay in insurance too, not the multisig. Raising the cap waits 24 hours. A cut applies immediately. 3000 is larger than the measured cost of holding the pool price down, especially on TAPE. The books just replaced, UP 0x277689ab82b04aE8100683B155CE2e2E12C82b30, TAPE 0x5C9F44A4D1f5F9082D3Cb02d11d717DE9563251A and FAB 0x03A1B0e5E225855905a63BD2a5A3Eb3A366A3caA, only close.",
      "The page will not open a book that has been replaced. Closing can still be signed. When checked, those books had no open position. The BSC copy vault is still bound to 0x89b2f4a2e0C07864172fB47fbDEa14411AF2e0E0, so that book stays on the close path. X Layer vault 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe and BSC vault 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5 are both 8345 bytes. Both refuse a new open after an exit request. 0xe895122Ba5aF841704730B999a73F9562F5bd46E is 14 bytes shorter and can still open after an exit. The page does not read it.",
      "A new red-packet rule from the page has to be a fixed amount. A random range is no longer written from the page. A packet already deployed cannot be changed, and a direct call can still use the old random amount. A new draw contract is not deployed here, so the checked bytecode is not replaced.",
      "The SealRebate clerk is 0x585d2DF4B8fDDA783B074555e6F3787e3fCB39D7, not the multisig. That contract's constructor arguments do not include the clerk. It was fixed at deploy. The homepage does not ship a rewritten claim contract, because a rewrite could pay the wrong amount.",
    ],
  },
  {
    h: "Risk",
    ps: [
      "This page is the product rulebook. It is not an audit and it is not a statement of expected return. The contracts below have no upgrade path. Margin already locked in a perpetual cannot be recovered by editing the website. No administrator does not mean the contracts cannot be attacked. They have not had an independent audit. A mark that reads a thin pool can still be moved. The marks for Bitcoin, ETH, ZEC, UP and TAPE store the spot at the moment anyone calls poke. The live X Layer BEM mark uses each pool's own 10-minute average and does not rely on poke. One transaction can move the pool and then poke. TapeMark accepts a price only from 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D, and moves at most 50 ticks, about 0.5 percent. The live UP perpetual reads the tapeup.io official pool 0xDf40529fa3E797c992272e27B811E59E5f1827Ae. That pool is a proxy. If the implementation changes, new quotes stop, and a new open or a liquidation is refused. A close still uses the last average. Each poke moves at most 50 ticks, about 0.5 percent, waits at least 30 seconds, and is then averaged for 10 minutes. BEM to USDT uses that pool's own 10-minute average. If the official spot and that average differ by more than 3 percent, a new open and a liquidation are refused. A new open or a liquidation is refused when the spot and the average differ by more than 3 percent. This book is tiered by margin: 50× at 20 dollars and under, 20× at 100 dollars and under, and 5× above 100. The book just replaced is still a flat 5× and takes no new position. The book before that read the official spot and also takes no new position. The FAB mark 0x358A948C454B350d54261AfE93616194fbB467C4 is kind 3 and reads 0xaAA5E75713F187f95da2BfAeb19A86D256c6C219. Its source is not in this repository. This page does not poke every 30 seconds. The rebate contract's clerk can take only the unclaimed balance in the rebate pool, not margin locked by users. Assets sent straight to a contract, outside an order, cannot be recovered.",
      "The spot desk fee is 0.20% of the amount paid, on top of the pool fee, and it is in the same confirmation as the swap. Rejecting it or a revert does neither.",
      "The BEM perpetuals trading now charge funding, keep an insurance fund, and can auto-delever one pair. Funding settles every 8 hours inside that pair's margin, capped at ±0.05 percent. Half of a liquidation remainder is kept as insurance and cannot be withdrawn. The other half is paid to the caller. Only if insurance is short, that pair's winner is haircut. It does not close other users. Anyone can liquidate a position after about half the margin is lost. BSC and X Layer do not net into one trade. Fees on these books go to the multisig of that chain. Bitcoin, ETH, ZEC, UP, TAPE and FAB are on the contract list. Opening one shows that coin's own book, not BEM. The transistor perpetual stays off the desk and takes no new position. Only the previous lending pools remain, and they only repay, withdraw and unlock. The BSC BEM perpetual is the new book and can be opened. The X Layer BEM perpetual is the 10-minute book and a new open is allowed. The book just replaced only closes. The 0.20 percent goes to that chain's multisig.",
      "The BSC mark is a roughly 10-minute time-weighted average of the PancakeSwap pool. Thin liquidity can still move that average for a short interval. The X Layer page quotes the Uniswap v3 BEM/WOKB 1% pool 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A. The live X Layer perpetual uses mark 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC. It averages BEM/WOKB and OKB/USDT0 for 10 minutes. When checked it was about 11.10 dollars. A new open is allowed. Spot mark 0x706c4AB8B20f4045623fcC91b24e4746f9776e01 is not used by this book. The old v4 mark is not used by this book. The transistor perpetual still accepts a mark only from the fee address.",
      "Order contracts are fixed in the page. They are not replaced from this browser's cache. Margin is sent only to the contracts named in the address section.",
      "Practice remains in this browser and does not enter those contracts. A take-profit or stop-loss requires this page to stay open and a wallet signature. After a rejection, the wallet is not prompted again until the order is submitted again.",
      "A public repository is not an independent audit. Before opening a position, match this page with the contract address shown in the wallet.",
      "Contract 0xC5A63E4c37c23F97558673731196abC30FBFa659 is no longer used. The site does not deploy it and does not approve it. Its run call lets the caller choose the target and the calldata, so an allowance left on that address can be moved by someone else, and not only BEM. The account page checks known tokens and can set that allowance to zero. Set every allowance for that address to zero. A new contract can be deployed only by that chain's multisig. Spot routers, perpetuals, lending, term loans and red packets approve only the amount of that action. An unlimited allowance already on chain does not disappear by itself. The next perpetual open sets it to zero, then approves only that margin, then opens, so it can take three signatures. An official router sets the allowance to that swap in the same action. Some stablecoins must be set to zero first. These contracts pull only the signing wallet. Someone else cannot use the allowance to move the balance. While an old unlimited allowance remains, a later fault in that contract can spend it. That is not zero risk. The copy vault still approves an unlimited amount. The page no longer sends a new copy-vault deposit. A shareholder can ask to exit. After 6 hours anyone can force that vault's own quotes and positions flat, and a withdrawal can then pass. The vaults this page reads now reject a new open after an exit request. The page now reads the vaults BSC 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5 and X Layer 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe. The BSC vault still follows the BEM perpetual just replaced, 0x89b2f4a2e0C07864172fB47fbDEa14411AF2e0E0, and did not follow the trading desk. The X Layer vault still follows the replaced X Layer BEM 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2 and did not move with the desk. They reject deposit and withdraw while a quote, a position, or unsettled margin remains, and price shares on cash only after they are flat. A shareholder can ask to exit. After 6 hours anyone can force that vault's quotes and positions flat. Both refuse a new open after the exit request. The X Layer vault just replaced, 0xe895122Ba5aF841704730B999a73F9562F5bd46E, follows the same X Layer BEM book but still allows a new open after an exit request, and the page no longer reads it. The previous BSC vault 0xdB9B6B6180480869DC2183C289480261F8E9Cd5A still allows a new open after an exit request, and the page no longer reads it. The vaults before those, BSC 0x138524b76E10b1c60060CD11e8946d24D861Fe23 and X Layer 0x721f32Efae0276B3C77652a192A14c3a5Da20aCd, have no such timeout, and the page no longer reads them. The older vaults, BSC 0x731a2572b1cf56cfb804c74555715c8c8b5e980b and X Layer 0xb0e31149c03f1300bd9ff8c165b1fa38fda2f0bb, were not upgraded. The deposit button stays closed. BTC, ETH, ZEC, UP, TAPE, and FAB sign only the new books. A previous address saved in the browser is not used. When the page switched, those old books had no open position and no open quote. The old books were not upgraded, and the page no longer calls them. The BEM book is not that defect. Lending and term books are not redeployed for this. If a fill is already on chain and the fee is still open, use the separate fee control. Do not tap the trade again. While another tab in the same browser is still waiting on the wallet, a second fee is not sent just because two minutes passed. Silence is not treated as that tab being closed. This tab pays only after you confirm that tab is closed, and still does not pay if that tab answers. Another device does not have this unpaid-fee record, so its fee button cannot replay it. The fee is paid through a record contract, and the same id cannot be paid twice. BSC 0x6E7B7145c10AA01C63918F201Fb4d73f8aeCfF9a. X Layer 0x5a76855251Fa311001319D5f59D7dA9A4c6e87c5. A second payment of the same id through this contract is rejected on any device. Assets sent directly to the fee address are not that fee. The id stays unpaid, and the page does not waive it. An unrelated transfer cannot mark a fee paid. Each fee still needs the wallet. A gas bridge is handed to the wallet only when the source chain, target chain, amount, checked router, and recipient all match. A call the page cannot read is not sent. These are page rules. They do not change a deployed contract.",
      "The BSC and X Layer BEM perpetuals are the new contracts, and a new order can be signed. The multisig has deployed these. The homepage buttons and the replaced deploy code are gone, so the page can sign only the book already written in. The TAPE mark is 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7 and its book is 0xC74795Aac0FE2E0Db36beeF422504f464c3083f1. The UP book is 0xe9B1fe713FcE9E4670c610cCc5bf2F2decDCcA4A, mark 0xEf744901777f6CDD3C27D20380eC2E7c6740326C. The books just replaced, 0x277689ab82b04aE8100683B155CE2e2E12C82b30 and 0x5C9F44A4D1f5F9082D3Cb02d11d717DE9563251A, only close. The X Layer vault is now 0x5d6eF9E36B591b50069DA8C535FB56dE73ad8EEe and refuses a new open after an exit request. Bitcoin, ETH and ZEC now read a 10-minute mark. UP reads the tapeup.io official pool 0xDf40529fa3E797c992272e27B811E59E5f1827Ae. That pool is a proxy, and the mark stops quoting if the implementation changes. The UP/BEM leg moves at most 50 ticks, about 0.5 percent, per poke, waits at least 30 seconds, and is then averaged for 10 minutes. BEM/USDT uses that pool's own 10-minute average. A new open or a liquidation is rejected when the spot and the average differ by more than 3 percent. Closing is not. This book is tiered by margin, not a flat 5×. The book just replaced, 0xceC1334Bc30D05e3ceab6bA19a5C0915df075552, is still a flat 5× and takes no new position. The book before that read the official spot and also takes no new position. The BSC BEM desk now reads the 10-minute book 0x070c66555535e1145275df54f4eEBBfd28d98581. When checked, the mark was about 11.37 dollars. The book just replaced, 0x89b2f4a2e0C07864172fB47fbDEa14411AF2e0E0, takes no new position. Copy vault 0xe9Ef9C5031015fA626eCE1cC8Dc8e5d213F591F5 still has that old book stored and does not follow the desk. Bitcoin, ETH, ZEC, UP, TAPE and FAB are on the contract list. The transistor perpetual stays off the desk. Previous lending pools only repay, withdraw and unlock.",
      "The next UP, TAPE and FAB books cap leverage by the margin of that call: 50× at 20 dollars and under, 20× at 100 dollars and under, and 5× above 100. Splitting one call still uses the total margin. Bitcoin, ETH, ZEC and BSC BEM stay at 50×. UP, TAPE and FAB now use this tier. A check found all three guards on, so a new open can be signed. A gap inside about 3 percent does not wait out the 10 minutes. If spot and the average differ by about 3 percent, or the pinned code changes, a new open and a liquidation stop. Closing does not. A position can still be closed and an order cancelled. The new TAPE mark sells one TAPE into the OKB side of 0x58eaD5b41Cfd3627791D439402dd65571c286484. That leg moves at most 50 ticks, about 0.5 percent, per poke, waits at least 30 seconds, and is then averaged for 10 minutes. The dollar leg is the 10-minute average of OKB/USDT0 pool 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082, not its spot. A new open or a liquidation is rejected when spot and that average differ by about 3 percent. Closing is not. A 50× position can be liquidated once the mark has walked about 1 percent, so that takes at least two separate pokes, not one trade. When checked, moving the official spot about 1 percent meant selling about 149 TAPE. Twenty capped pushes are about 10 percent. That can liquidate 5×. It does not liquidate 3×. The page does not keep recording the price. When the gap is past about 3 percent, the button records it once and does not open. The official pool bytecode hash is 0xf5e304a7d79711bb3c77a1380a0e2898ee40621ff46a14ad3456e205096f9fa9. If that hash changes, the page pauses new TAPE opens. FAB is now 0x03A1B0e5E225855905a63BD2a5A3Eb3A366A3caA, mark 0xe6F8419FE6F22d19933Ec6028366fc698709e73F, on the same tiers. A new open or a liquidation is refused when spot and the average differ by about 3 percent. Closing is not. The book just replaced, 0x61eb43aa602554324701cd2b551adff5b850d9cd, only closes. The book before that, 0x80318c852eE7fBDe52cE439deC3AE022Ba39A536, only closes. The page does not keep recording the price.",
    ],
  },
  {
    h: "Desk",
    ps: [
      "Spot settles in the wallet that signed. BSC pairs use PancakeSwap. OKB uses PotatoSwap on X Layer and pays USDT0 (0x779Ded0c9e1022225f8E0630b35a9b54bE713736), not the other token named USDT. The coins you buy stay in that wallet. The desk fee is 0.20% of what you pay, on top of the pool fee, and it is in the same confirmation as the swap. Rejecting it or a revert does neither. The hot list is BEM/USDT, UP/USDT, UP/BEM, FAB/BEM, TAPE/USDT0, TAPE hashrate, and BTC, ETH, BNB, OKB, ZEC.",
      "UP spot is only on BSC. The token is the official TapeUP token 0xEd99445d72787Adb627cD8588586984DF548CD2F. UP/BNB, UP/BEM and UP/USDT buys and sells all use the tapeup.io official pool 0xDf40529fa3E797c992272e27B811E59E5f1827Ae, not a Pancake UP pool. A buy is credited on that pool's ledger, then redeemed in the same transaction into the wallet that signed. A sell first deposits the UP into that pool, then sells it there for BEM. UP/BNB then turns the BEM into BNB, and UP/USDT turns it into USDT. That pool is a proxy. tapeup.io can replace its implementation, and this page cannot stop that. When the wallet can batch, the desk fee is in that same confirmation.",
      "There are two perpetual books. They do not net. BSC margin is USDT. X Layer margin is USDT0. Margin is locked in the one contract on the chain you picked. The platform does not hold it. The live BEM books charge funding, keep insurance, and can haircut one pair. At about half the margin lost, anyone can liquidate. Bitcoin, ETH, ZEC and UP are on BSC. TAPE and FAB are on X Layer. Each opens its own book. Switching chain lands on that chain's BEM, because these six books do not cross chains. The 0.20 percent goes to that chain's multisig.",
      `The BSC BEM perpetual uses a roughly 10-minute PancakeSwap average as its mark. The last trade is not used for liquidation. Thin liquidity can still move that average for a short interval. The X Layer page quotes the BEM/WOKB 1% pool and does not print both prices on the tape. The deployed mark ${KNOWN_XMARK} still reads the old v4 pool, so its on-chain number sits above spot. Liquidation on the live book does not use it. The page shows ${KNOWN_XPERP}. It reads the 10-minute mark 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC and can be opened. The book just replaced, 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2, only closes. The old mark ${KNOWN_XMARK} is not used by this book. Only the wallet that posted a resting order can cancel it. A cancel costs 0.20 percent of the margin, and the rest is returned. A filled position cannot be cancelled. It can only be closed. An order nobody takes stays under Open orders. The book marks it, and it has no PnL. A taken order is a position, with size, entry, mark, margin, PnL and return.`,
      "On a computer the header switches BSC and X Layer. Beside it is Log in. A browser wallet can sign, or OKX, MetaMask or Binance can scan the code. After that, BSC and X Layer signatures and trades are both sent to that phone. If the wallet does not open by itself, the header says to open it and confirm. The page cannot sign by itself. The address and log out appear only after that. On a phone the top right keeps only those two chains. Language, theme, fees, OTC, the red packet and the other entries sit in the top-left menu and stay closed until opened. English, Français, 简体中文, 한국어 and Español stay inside Language and appear only after it is opened. The phone bottom bar is Markets, Trade and Account. On a phone, connect and log out stay on Account. Pay and receive is one row on Account and opens only when tapped. It can send TAPE, FAB, BEM on either chain, UP, OKB and BNB. FAB is on X Layer. UP is on BSC, the official token 0xEd99445d72787Adb627cD8588586984DF548CD2F. The two books do not net, and the switch charges nothing. A BEM perpetual stays BEM and only changes chain. Bitcoin, ETH, ZEC and UP on BSC open the X Layer BEM perpetual. The X Layer TAPE perpetual opens the BSC BEM perpetual. BSC BEM or BEM/BNB spot opens X Layer BEM/OKB. BNB spot opens OKB. Any other BSC spot opens the TAPE/USDT0 pool. X Layer BEM/OKB opens BSC BEM. OKB opens BNB. Any other X Layer spot opens BSC BEM. A connected wallet is asked to switch. With no wallet, only the desk changes.",
      "An open posts a quote. It does not fill itself. When the other side's price crosses, the later order takes that quote, and the 0.20 percent is taken in that match. If it does not cross, the quote rests and no fee is taken. The same wallet cannot take its own quote. Two opens, with nobody taking, are two resting quotes and neither is a position. This page accepts leverage from 1 to 50 and it can be typed. The contract still accepts up to 1000 if called directly. At 1000x a move of about 0.05 percent against the position is near liquidation. Locked margin is notional divided by that leverage, and one order locks at most 500. Cross margin does not rewrite the multiple. The beginner stop is sided. A long take-profit is entry times (1 + 1/leverage) and the stop is entry times (1 − 0.5/leverage). A short take-profit is below the entry and the stop is above it. That band lives on this page. The page has to stay open, and the wallet has to sign. The market list follows the page language: Spot, Perp, Stock, Pool, Book and Workshop.",
      "Referrals apply to every site fee this page sends, not only perpetuals. The site fee is 0.20% of the amount paid. With a referrer, 6% of that fee goes to the referrer, the trader pays 4% less, and 90% goes to that chain's multisig. Perpetuals record the 6% on the contract. Spot, including BSC bitcoin, ETH and ZEC, liquidity, official transistors, and official circuits split the same way when paid. The workshop book and the TAPE pools send their 0.20% entirely to the fee address. Those deployed contracts have no referrer field. A circuit container's open fee is protocol BNB, not this site fee. The BSC perpetual is BEM / USDT. Bitcoin, ETH, ZEC, UP, TAPE and FAB on the perpetual page are the same kind of margin contract as BEM, not a spot buy. Their desk and chart are the same as BEM: the same timeframes from 15 seconds through one year, volume and RSI, and the same ticket for long, short, margin, leverage and stops. Opening one signs that coin's own book. Their prices are not written into the BEM book.",
    ],
  },
  {
    h: "Workshop",
    ps: [
      "Mint NAND or LATCH, then tape out. The tape-out page shows the TAPELIQUID transistor cap, how many have been minted, and how many tape-out has burned. NAND and LATCH share that cap. The burned count is split by kind and does not include transfers into the dead address. Tape-out burns the transistors in the netlist. It cannot be undone or minted back. One sheet holds at most 18,000 NAND or 30,000 LATCH. A larger netlist fails, and the transistors stay in the wallet.",
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
      "TAPE is the only platform token of TAPELIQUID. There is one token, on X Layer, and there is not a second. The hard cap is 21,000,000. No premine, no team allocation, no private sale. It is paid only to a taped circuit that has been opened. A claim on an unlocked circuit goes to the miner address registered on that circuit. Circulating supply is claimed TAPE minus the dead address, both TAPE pools, both spot books, buyback TAPE not yet burned, TAPE locked as lend collateral, the circuit lock, the wafer lock, and TAPE still in the term contract. Timed-stake principal includes coins still locked and coins that matured but were not withdrawn. Mined TAPE that has not been claimed is not minted yet, so it is not circulating. The burn share is the dead balance divided by claimed supply. Taped sheets are the circuit contract's next id minus one. Staked circuits are sheets still in the circuit lock, not the TAPE in the term contract.",
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
      "Staked TAPE earns X Layer BEM. Staked X Layer BEM earns TAPE. On the page, Available is what this wallet can still lock. Staked is the principal this address has already locked, with the pool total written under it. Each lock shows the amount, the term, and the Singapore expiry. Principal cannot be taken before that time. After expiry, one signature on that row returns the principal. Claim pays rewards only, not principal. Anyone can add rewards. Only the address that added a reward can take back the part that has not vested over 365 days. What has already vested to stakers cannot be taken back. APY uses the unvested pot and the current pool price. It changes when someone stakes or withdraws unvested rewards. A missing price is shown as —, not zero. This timed contract has no admin and cannot be upgraded. The live one is 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833. The earlier one, 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A, only withdraws. Tokens sent to the contract without the stake function cannot be taken back.",
      "BSC BEM does not enter this contract. One contract cannot read the other chain. BEM on X Layer is 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952. BEM on BSC is a different contract. To stake BEM for TAPE, open the TapeOut bridge and move it to X Layer. That button calls the TapeOut bridge. This site does not custody the assets. This hop is one signature on the bridge itself and does not take a separate desk fee. The bridge's own fee is separate. TAPE cannot use that bridge.",
    ],
  },
  {
    h: "Spot",
    ps: [
      `Workshop spot is an X Layer order book. It is not the desk. One contract holds four books. TAPE, NAND and LATCH are quoted in USDT0. Each circuit is priced on its own. One price is one level, and the earlier order stands in front. The buyer pays that level. The seller receives 99.8 percent. The 0.2 percent is paid to the fee address. Size that can cross fills at once. The remainder rests. The page states the size offered by asks, the size bid, the prints read, the fees collected, and, at the price entered, how much would fill and how much would rest. NAND and LATCH are whole numbers. Switching markets clears the previous book. An empty market is not shown as zero, and another coin's orders are not left on it. The fee, both tokens, the transistors, the circuits and the fee address are written in the contract. There is no administrator. The fee cannot be changed and the contract cannot be upgraded. Assets sent to the contract outside an order cannot be recovered. The address is ${TAPE_SPOT}, and it is deployed. Every device reads this contract.`,
      "Circuits are separate from TAPE, NAND and LATCH. The book lists only circuits that are already offered. Circuits still in the wallet, and circuits still locked, are under Mine. They are not written into the book. Pick a row under Mine, then enter a USDT0 ask. The buyer pays that ask. The seller receives 99.8 percent. Each row shows shape, hash, ask, the 0.2 percent, what the seller receives, estimated daily output, the day-output price, and the seller. Hash is the gate count. Estimated daily output is today's emission times that gate count, divided by network weight, and it assumes the circuit is already mining. If it has not been started, that figure is not a receipt. The day-output price is the ask divided by that estimate. The unit is USDT0 per 1 TAPE per day. It is for comparison. Share of the network is the gate count divided by the current network weight. A dotted word shows a note while the pointer is on it, and the note hides when the pointer leaves. Fewer than two prints do not draw a chart. This circuit contract records inputs, outputs, state and gates. It does not record how many NAND and LATCH one circuit used, so this page does not show a crystal average.",
      "A row opens that circuit. On a desktop it is a window in the middle: spec and value on the left, the ask and the order on the right. On a phone it is a full page: the spec scrolls, and buy or list stays at the bottom. Click outside, click close, or press Esc, and it goes away. The spec shows shape, hash, seller and state. The value shows estimated daily output, the day-output price, the price per gate, the payback and the year look-back. The price per gate is the ask divided by the gate count. Payback is the ask divided by estimated daily output, turned into days at the current TAPE/USDT0 pool price. The year look-back is 365 divided by those days. Both change when the pool price changes. They are not a promise. There is no crystal average. There is no best bid, because a circuit book has only asks. The size is one, and it cannot be split. A listed circuit can be bought. Your own listing can be cancelled. A circuit in the wallet takes a price and is then listed. A locked one has to be claimed first.",
      "The mine page is claims, staking, burns, and the reserve. Earn shows this address's hashrate and its share of the network. Hashrate is the gate count of circuits that are mining, plus split shares recorded on this address. NAND, LATCH, and circuits are under TAPELIQUID in the top bar. Transistor contracts are under TapeOut. Minting has ended and the mint control is no longer shown. NAND and LATCH already held in a wallet may still be taped out, or sold on TAPELIQUID.",
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
      "Spot, a perpetual match, a cancel, adding liquidity, and removing liquidity all pay 0.20 percent of what is paid. That is on top of the pool fee. Closing adds nothing. Adding takes 0.20 percent from each side. Removing takes 0.20 percent from both sides that come back. A fee already sent is not returned. The spot fee and the swap are one confirmation. Rejecting it or a revert does neither. Opening a perpetual locks the margin. The 0.20 percent comes out of the match itself. A quote nobody takes is not charged. Cancelling returns the rest after 0.20 percent. Once the allowance equals this margin, an open is one confirmation.",
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
      `The live X Layer perpetual is ${KNOWN_XPERP}. It can be opened. Mark 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC averages the two pools for 10 minutes. When checked it was about 11.10. The book just replaced, 0x9fD9Ade0272646cc3aD36F1699Fd42CcFE8927c2, only closes. The BSC perpetual is ${BSC_REBATE}. That book can be opened. It reads the Pancake BEM/USDT average of about 10 minutes. The book just replaced, ${LAST_BSC}, only closes. The previous one, ${PREV_BSC}, only closes. The transistor perpetual is still ${GATE}. It is the previous book and takes no new position. Its marks start empty. The BSC multisig posts the first price. The 0.20 percent goes to the multisig of that chain. None has an admin.`,
      "This mark has one X Layer perpetual. The BEM perpetual on BSC reads the Pancake pool average. It does not read this mark. A thin pool can still move that average for a short time.",
      "An unmatched order stays under Open orders. The book marks it. There is no PnL until someone takes it. A taken order is a position. The position shows size, entry, mark, margin, PnL, and the return on margin. A resting quote can only be cancelled by the wallet that posted it. Cancelling takes 0.20 percent of the margin and returns the rest. A filled position cannot be cancelled. It can only be closed.",
      "BTC and ETH each have their own perpetual. The mark reads that coin's Pancake pool, about a 10-minute average, and it is not written into the BEM book. ZEC reads the Pancake ZEC/USDT pool 0x6701B287c8170D6c290C6f4Ef426782bD61Ae310. UP reads the official pool 0xDf40529fa3E797c992272e27B811E59E5f1827Ae. Its mark is 0x11dCaA2ee4A6F4c437B9B6B304FFBc09B768845B, quoted onward into USDT. Positions on the previous book 0xB3cdB968580cE0121f613886E8f86EFFcC514d70 read the official spot and take no new positions. The book before that, 0x5f913f7AFa71c51d69F472b0fE4c3EC74b1132F8, also takes no new positions. The TAPE perpetual is on X Layer. Its book is " +
        TAPE_COIN_BOOK +
        ". Its mark is 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7. The 0.20 percent goes to the X Layer multisig. There is no admin. The FAB perpetual is on X Layer. Its book is " +
        FAB_COIN_BOOK +
        ". Its mark is 0xe6F8419FE6F22d19933Ec6028366fc698709e73F. The BEM/FAB spot moves at most about 0.5 percent in one step, further after a quiet stretch, and at most about 10 percent in one update, then at most a 10-minute average. Dollars use the 10-minute BEM and OKB averages. A gap inside about 3 percent can open. The book just replaced, 0x80318c852eE7fBDe52cE439deC3AE022Ba39A536, only closes. The 0.20 percent goes to the X Layer multisig. There is no admin. The contract list shows these six books, and an order is signed to the address above. Switching chain lands on that chain's BEM. The 0.20 percent goes to the BSC multisig. An open price cannot exceed 100000.",
      "TAPE is the only platform token of TAPELIQUID. There is one token, not a second. The mine has no admin, and the emission cannot be changed.",
      "SealRebate has a clerk. The clerk can withdraw the unclaimed rebate balance. On a build whose circuit count is zero, the clerk can also grant a claim. That clerk is not a multisig. The creator of RedDesk, RedNext, RedPerp, and RedPacketOpen can change that copy's rules and withdraw its balance. TapeBid accepts deposits and withdrawals only from the fixed BUYER. Not every contract is without an admin.",
    ],
  },
  {
    h: "Lending",
    ps: [
      "Ten percent of lending interest is credited to the multisig. Suppliers keep 90 percent. Principal is not charged. The 5 percent liquidation bonus goes to the caller. There is no admin.",
      "X Layer, OKB collateral: 0x98814252d0BacaD3FddF4433F3BF388686F26F97, lending USDT0. X Layer, TAPE collateral: 0xB6d0fE8552f1F14E4F282DEcb137645E3c988D11. X Layer, BEM collateral: 0x07d25044cBE0524c0617267d6BFAf2Fa6A0A0eFe. TAPE and BEM refuse a price that has not reached the market. The pools just replaced, OKB 0x62f9016C97eF9255C8Ba16DDa7F531656015DAeA, TAPE 0x8674351Fae2781c077977aE589F2FA71a1bb4992 and BEM 0x741331f4c8e4D6937FB92eC88ceE27c9e0AC3062, only let funds out. The pools before those, OKB 0x6135b562c5d46595b044519e787FE396830C5C83, TAPE 0xF2925A78AdaC85cA330643bc5584A694199AfB76 and BEM 0x77F01670F70A13299531906e54D45c4247d0E3bf, only let funds out. The previous pools, OKB 0xc417780f4e1F9385BE1ba4cbDe7b40860B2aA8b0, TAPE 0x99CA040580837a2158Bfd0c8d84fcD4B85b6393b and BEM 0xfA211308F9583bEB9aaF724044863b78BfD7B9C1, only let funds out. The previous OKB pool 0x57228158cba08c61710ab2644e583c328ec86ea7, the previous TAPE pool 0x8d06D78bd5eC97104cE3c7F10A73516fE1Ab4525, the previous BEM pool 0x01264DBDEC9Be07c7C1E942D8C4dcfC72A7691b2, and the earlier TAPE pool 0x586B7992A8467290C5a1857FcE7EC8AF72be9445, BEM pool 0xeC55C19F6b0E08FbAd7DECD54bf8c892230fD353, TAPE pool 0xa49970ffafa28a0e596745e08993df611170f96f, BEM pool 0x8d3074bdf9412d77269f59cc506e318e5da27914, TAPE pool 0x425285da21ed3eabe64550d1be7dcabcf6f9e851 and BEM pool 0x5ed8551f90acc6395810d8274b019bf13ef1f696 only withdraw, unlock and repay. BSC, BNB collateral: 0xd80B34d487CeC5F8F4966B65517Ba0b0CB2E9c31, lending USDT. BSC, BEM collateral: 0x03e2fed201edeF0f70789A79c6D59BeEbc05fB41. The pools just replaced, BNB 0xC4bA21b1566Aee4b1113f166C5f496275E51A65E and BEM 0xEF9d226254b7Ce8CdCD5b1170d70518AfDC3e05A, only let funds out. The pools before those, BNB 0xd66C0EA7acCC3D4e8E82a999e7345404803643BC and BEM 0x0A0C3D5A8D20468fea019590Bd3FC11623260223, only let funds out. The previous pools, BNB 0x0712cCa64B91Ec87cc175aa46cC38b54c8D3Bff3 and BEM 0x4127ddA5153042B6E6aFC02316587ab85D985B3A, only let funds out. The previous BNB pool 0xd8d981d32b12ea85b739bb667946975d25b0ab53 and the previous BSC BEM pool 0xD71C270DFf9DF25245B367489D338629059E5014 only withdraw, unlock and repay. The earlier BSC BEM pool 0xd2c7150f7779ded403c3f81a68dab5164b54df28 only lets funds out. The earlier contracts 0x51a1f26d6e8142513ab6c5d1f8fa993683dd1212 and 0x58d980f548c150be59819cdbfe46b8a14ef4fe56 are not read.",
      "A deposit lends the stablecoin. What is still borrowed cannot be withdrawn. Borrowing requires collateral first, up to 50 percent of its value. Debt grows at the borrow rate, from 2 percent to 50 percent. Collateral comes back only after the debt is repaid. Above 75 percent of the collateral value, someone else may repay and take a 5 percent bonus from the collateral. OKB and BNB use about a 30-minute pool average. TAPE and BEM prices move at most 0.5 percent every 30 seconds. While the posted price has not reached the market, new borrows pause, and so do unlocks and liquidations while debt remains. The same pause applies 30 minutes after the last update. An unlock with no debt is still allowed. X Layer TAPE and BEM have this check. BSC BEM uses the live pool price and does not. The earlier pools do not. They only withdraw, unlock and repay. Assets sent straight in, outside a deposit or a lock, cannot be recovered. The five pools on the page were checked against this bytecode. Claiming part or all of a recovery does not change the later split. A pool can have at most 32 borrowers. Those two rules are on these five. X Layer TAPE and BEM refuse a deposit or a withdrawal while the price is still walking, or more than 30 minutes after the last update. OKB, BNB and BSC BEM do not have that switch. Earlier pools do not have these rules. A shortfall the collateral cannot cover is taken out of the price of a deposit or a withdrawal before anyone liquidates. The borrower still owes it. A later recovery only retires that write-down. It is not booked as new profit. The previous pools only withdraw, unlock and repay. They were read on chain. Apart from less than one USDT of dust in the previous BNB pool, deposits and debt were zero. A repayment close to the full debt is sent as the live debt plus one thousandth plus one unit. If the wallet cannot cover that extra, the transaction fails instead of repaying only the smaller displayed amount. When net assets are zero, interest on debt already impaired mints no fee shares, and the virtual 1,000 in the denominator cannot keep minting them. A new borrow with no debt must be at least 10 stablecoin units, 10 USDT0 on X Layer and 10 USDT on BSC. A repayment or liquidation that would leave more than zero but less than that must clear the debt. Repayment, liquidation and withdrawal still work. Those two rules are in the runtime of the five lending addresses above. After the immutable arguments are masked, that runtime matches this source. The pools cannot be upgraded. The five pools just replaced do not have these two rules and only let funds out. The two term books do not have these two rules. Their addresses have changed. The books just replaced only withdraw, unlock and repay. The BSC pool that accepts BNB as collateral has completed one on-chain cycle of 10 USDT: deposit, borrow, repayment, unlock, and withdrawal. Debt, collateral, and deposit shares were zero at the end. The X Layer pool that accepts OKB as collateral has completed one on-chain cycle of 10 USDT0: deposit, borrow, repayment, unlock, and withdrawal. Debt, collateral, deposit shares, and the allowance were zero at the end. The BSC pool that accepts BEM as collateral has completed one on-chain cycle of 10 USDT: deposit, borrow, repayment, unlock, and withdrawal. Debt, collateral, deposit shares, and the allowance were zero at the end. 21131405340 wei remain in that pool from share rounding. The X Layer pool that accepts TAPE, and the one that accepts BEM, have each completed the same cycle for a principal of 10 USDT0. Debt, collateral, deposit shares, the allowance, and pool cash were zero at the end. Both prices were then more than 30 minutes old. TAPE could be borrowed after one update. BEM could be borrowed only after successive updates of at most 0.5 percent, 30 seconds apart, until the posted price met the market.",
    ],
  },
  {
    h: "Term loans",
    ps: [
      "Term loans are a separate book. They are not the lending pools above, and they are not timed stake. One contract per chain, BSC and X Layer, from the same code. There is no admin and no upgrade. The rate is fixed. It does not follow utilization.",
      "There are eight terms, counted in exact days, not calendar months: 24 hours, 3 days, 7 days, 30 days, 90 days, 180 days, 270 days and 365 days. Interest is charged on the remaining principal once each completed hour. A partial hour is not charged. Repaying early pays only the hours already completed. After the due hour, each new hour is charged at twice the rate until the loan is repaid or liquidated. Unpaid interest is not added to principal.",
      "BSC can post and borrow USDT, BNB, BEM and UP. X Layer can post and borrow USDT0, OKB, BEM, TAPE and FAB. One asset cannot be both the collateral and the debt. USDT and USDT0 are not the same token. Base APR is 8 percent for USDT and USDT0, 12 percent for BNB and OKB, and 18 percent for BEM, UP, TAPE and FAB. The eight terms multiply that by 1, 1.05, 1.10, 1.20, 1.35, 1.50, 1.65 and 1.80. Overdue doubles the hourly rate again. The interest is simple.",
      "A new loan can borrow at most 50 percent of the collateral value, and at least 10 dollars. Above a 75 percent ratio, someone else may repay and take about 5 percent extra collateral at the posted price. The two books on the page were checked against this bytecode. Claiming part or all of a recovery does not change the later split. One book can have at most 32 open loans. While someone owes a pool, a stale price cannot price a deposit or a withdrawal. Those rules are on these two books. Principal the collateral cannot cover is taken out of the price of a deposit or a withdrawal before anyone liquidates. The borrower still owes it. A later recovery only retires that write-down. It is not booked as new profit. If they never repay, depositors still cannot withdraw that principal. The books just replaced, and the ones before them, were empty, with no open loan. The page no longer reads them. A repayment close to the full debt is sent as the live debt plus one thousandth plus one unit. If the wallet cannot cover that extra, the transaction fails. One address can have 16 open loans.",
      "Ten percent of interest is credited as deposit shares to that chain's multisig. Lenders keep 90 percent. Principal is not charged. Interest that has not been repaid is not withdrawable yet. It arrives on repayment or liquidation. Principal that has been borrowed cannot be withdrawn while cash is short. A borrower's PnL is equity now minus equity at open. Equity is collateral value minus debt. A lender's PnL is what can be withdrawn now minus the cost still booked to them. The page refreshes the countdown every second. Interest increases only on the hour.",
      "Anyone can post a price. A stablecoin posts at one dollar. Anything else moves at most 0.5 percent every 10 minutes. Until three posts are in, the button shows how many minutes remain before the next one. The price becomes usable only after repeated posts, and only while the spot is within 2 percent of the posted price. After 30 minutes it cannot be used for a new loan or a liquidation. Repayment and added collateral still work. UP is converted to BEM on the official pool, then multiplied by a usable BEM price. FAB is converted to BEM on the BEM/FAB pool. X Layer BEM uses a usable OKB price. TAPE is sold into BEM on the open pool, then multiplied by a usable BEM price. That side of the open pool is BEM, not USDT0. OKB uses WOKB to USDT0. BNB and BSC BEM use the Pancake quote.",
      "Assets sent straight to the contract, outside a deposit, a collateral lock, a repayment or a liquidation, cannot be recovered. The contract rejects a raw transfer. The page now reads the new term books. X Layer is 0x536327976231cf4c12759D81C99b12bD40aF0DD6. BSC is 0x92E44Ba44b2b3CC3E5C823d9dF5b571C7338f2c3. The page reads only that one book on each chain. The previous books only withdraw, unlock and repay: X Layer 0xC4fA8f4cE83ce03A0264D76ebdA8903FABb947d5 and BSC 0x073452aD271ad5D511295aEB7706D4742dD1a75E. The books before those were empty: X Layer 0x29a08A0a0619Fd60a8131477859615F8AD438b58 and BSC 0xf52a684531f8387e5383771887FF5b9FBa116b98. The previous books were empty: X Layer 0x087E68a1C6c5978Aab73056f7DCd69fc55d72839 and BSC 0x285e93b48e80A7d22CdE47056579074A3842fBcD. The earlier empty books were X Layer 0x683fb58ee77172626D5B49087DdAc71eF7825d20 and BSC 0xBa427D94b001FA1cf0f85E1E54c1E392e9a07610. On the BSC book, the BNB price is usable for a new loan only after three posts, ten minutes apart. A 24-hour loan of 10 USDT was then opened against BNB, as loan 1, and repaid in the same period. Collateral was returned, the deposit was withdrawn, cash in the pool was zero, and no loan remained open. On the X Layer book, a 24-hour loan of 10 USDT0 was opened against OKB, as loan 1, and repaid in the same period. Collateral was returned, the deposit was withdrawn, cash in the pool was zero, and no loan remained open. The allowances used for both loans were returned to zero.",
    ],
  },
  {
    h: "Rewards",
    ps: [
      "Each new red packet is its own contract. Only that chain's deployer can see and open an official round. Everyone else sees personal rounds, and anyone can open one. The desk header switches BSC and X Layer. On a phone the packet is in the top-left menu, and the chain switch stays at the top right. The packet still chooses its own chain. The sender chooses 24 hours, one week, or one month. The creator puts the prize into that round. The card shows how much has been claimed and how much remains. Claimed is funded minus the balance still in the pool when the funding event is found. Otherwise it is the sum of claim records on that round. On the same round, one address can claim once per Singapore day. A later round is not blocked by that claim. After the window ends, claims stop, and each depositor takes back only their own remainder.",
      "The task is a swap, not a transfer that merely leaves the wallet. A buy states how much OKB or BNB is swapped for about how much of that coin, using the pool quote. A sell states about how much of that coin is sold for how much OKB or BNB. Joining shows that swap first. The user can agree or refuse. The trade starts only after they agree. After the trade, they check it. The packet opens only when the check passes, and the asset is paid only when they claim. The packet cannot be claimed before the swap is finished and checked. A chain switch still needs another tap. If an allowance is left at some other amount, that tap sets it to zero, approves only this amount, and continues. It does not stop and ask for another tap just because of the approval. X Layer is priced in OKB and BSC in BNB. The signer has to be an ordinary wallet. A contract, a relayer, or an address that did not make the trade cannot claim. The amount is derived from the previous block's prevrandao, the claimer, and the balance, so it can be predicted before the claim. A claim can be simulated first and skipped when the amount is small. The deployed RedPacket and RedPacketOpen contracts do not wait for the next block hash, and they are not an equal split. An older packet that checks the spot price can be passed in the same transaction by moving that price first and then spending less. A newly opened X Layer TAPE buy sends the TAPE to the person doing the task. It does not stay in the packet. A claimed prize leaves the packet and returns to the wallet that claimed it. The prize token cannot be changed while the packet already holds a balance. The first round on the booth still uses the old code. The page does not accept a contract merely because edition() returns 2. It allows a TAPE buy only when the runtime hash matches a checked packet. A packet that reports edition 2 but has a different runtime does not pass. A checked sell has to receive the OKB or BNB amount written on the page. A tiny minimum is not enough. The checked round does send bought TAPE to the person doing the task, but its contract still does not enforce that sell threshold. A direct call can mark a sell done for much less. After the window ends, it cannot be claimed. The earlier red packet contracts are no longer used.",
      "Besides spot tasks there are perpetual tasks. X Layer can require a FAB spot trade, TAPE hashrate, or a BEM, FAB or TAPE perpetual. BSC can require an UP spot trade, or a BEM or UP perpetual. A BEM perpetual can be required on either chain. A perpetual task counts a fill on that book the same Singapore day, on the side and margin the packet wrote. It is not a spot swap. UP spot and the UP perpetual both use the official pool 0xDf40529fa3E797c992272e27B811E59E5f1827Ae. A newly published UP spot round buys on that pool and, in the same trade, redeems the credited UP to the person doing the task. A round that only credits the ledger, or that asks the pool for a quote during the trade, cannot finish and its prize cannot be claimed. Those already published cannot be changed. When the timer ends, the creator takes the UP back. A round stamped against the old Pancake UP/WBNB pool cannot read this pool and is not opened again.",
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
      "Circuits and TAPE are on X Layer. BEM moves between BSC and X Layer on the bridge TapeOut already runs: lock on BNB Chain and mint the same amount on X Layer, or burn on X Layer and release on BSC. It is 1:1, over LayerZero. This site does not custody the assets. This hop is one signature on the bridge itself and does not take a separate desk fee. The bridge's own fee is separate.",
      `BEM on BSC is ${BSC.bem}. The BSC bridge is ${BEM_BRIDGE}. BEM on X Layer is ${X_BEM}. The page is tapeout.net/bridge.`,
      "TAPE does not use the BEM bridge. TAPE has no 1:1 bridge contract yet, and there is no TAPE bridge button. OKB and BNB go through the live pools: swap to a stablecoin on X Layer and into BNB on BSC, or the reverse, joined by Symbiosis. The BSC hop that sells BNB is accepted only as four steps in this order: check the native amount, wrap BNB, sell it for USDC on one fixed Pancake path, then record positive slippage. That path cannot name another pool or another fee. The settler's minimum USDC must be at least 99 percent of that pool. The minimum OKB must be at least 98 percent of the OKB that same BNB buys at the pool price. If either pool price cannot be read, the quote is not given to the wallet. When the wallet can combine them, the 0.20% and the swap are one confirmation. Otherwise the swap is signed first, and the 0.20% is taken only after it succeeds. If the swap is not sent, there is no fee. The arrival is the pool price. The minimum is shown above the button. On 19 November 2026 the checked route sent 0.002 BNB from 0x7fa7193115a481067af731499c551c5571071528. The transaction is 0xeee2faafd71945707440817b69a9171c6e10907e4ce28493bffb52c207edf455. About 0.007803 OKB arrived on X Layer.",
    ],
  },
  {
    h: "What is on chain now",
    ps: [
      `TAPE is ${TAPE}. The mine is ${TAPE_MINE}. Both are on X Layer. The cap is 21,000,000 with 8 decimals. There is no admin and no way to change the rate. Only the mine can mint. Supply grows only when someone claims. The token runtime matches the published source on Sourcify, compiled with Solidity 0.8.37 and 200 optimizer runs.`,
      "That mine contract emits 7,200 a day from the moment it was deployed. It does not start at 1,000, and it has no one-time switch to 7,200. Weight is the gate count, which is b*, and the processor multiplier is 1. There is no task score yet, so q is not shown above 1. One-click check on the mine page and the circuit page only reads eval on the circuit contract. It does not sign and it does not spend OKB. A passed check means the gates ran the inputs that were given. It does not move weight into TapeOut's verified 99 percent pool. The mine contract has no verify entry, and this page cannot set that bit.",
      "The mine, the TAPE pool, and the wafer and circuit lock have no admin. They cannot be upgraded, and the terms and the fee cannot be changed. There is no rescue function. Assets sent to a contract without a matching position cannot be taken back by anyone, and the page does not send them that way. Liquidity that does not match the pool ratio is returned to the signer. It is not added to anyone else's share.",
      "The 100,000 opening allocation was not minted. The TAPE pool has no admin. The earlier pool takes no new deposit. A position already in it stays for 90 days to 3 years and can be withdrawn on the stake page only at expiry. That pool has no 9-month term. The official pool 0x58eaD5b41Cfd3627791D439402dd65571c286484 can take a new BEM/TAPE or OKB/TAPE deposit from the stake page, at the pool ratio. Its source is not in this repository. Terms offered here are 3 months, 6 months, 1 year or 2 years. The contract also has 3 years, and this page does not offer it. A 0.20 percent fee is taken first. Nothing comes out early. The wafer lock has no admin. Terms are 180 days, 365 days, 3 years, 4 years, or 5 years. Locked wafers cannot be taped and do not count as weight. The circuit lock is 0x06c877cc158d9ca3547220f9fc156f39bce7013c. The same circuit cannot be locked twice. The old buyback 0x72e28d564A90eF3E76f599bC210454f5360E200C is no longer used. The current one is 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF, with the buyer fixed. Timed stake is 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833. The earlier one, 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A, only withdraws. Neither has an admin. TAPE still has no bridge contract.",
      "TapeOut BEM is still claimed from the TapeOut mine. It is not the same signature as TAPE. A large tape-out does not mint TapeOut BEM.",
      "Holdings on the account page can send coins, NAND, and LATCH still in the wallet. One means one address. Many means one address per row, and that row's amount goes only to that address. Each transfer is its own signature, and none of them go through the lock. The confirmation has to be ticked first. The page does not leave. Circuits are ticked in a scrolling list. Each ticked circuit has one address. One signature per circuit. If an official contract does not list token ids, this page does not invent them.",
    ],
  },
  {
    h: "Addresses",
    ps: [
      `The fee this page collects, and the 0.20 percent inside the live spot and perpetual contracts: BSC multisig ${BSC_SAFE}, X Layer multisig ${XLAYER_SAFE}. The previous pool and the previous perpetual still pay ${FEE_TO}. TAPE ${TAPE}. TAPE mine ${TAPE_MINE}. TAPE pool 0x58eaD5b41Cfd3627791D439402dd65571c286484. Earlier pool 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641. Circulating supply subtracts both balances. Wafer lock 0xA28390924607F08aaD8d03F512B41b6a1c012Ace. Circuit lock 0x06c877cc158d9ca3547220f9fc156f39bce7013c. Buyback 0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF. Timed stake 0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833. Earlier locks 0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A. Spot ${TAPE_SPOT}. The previous spot 0xd398691dff583788e6e2d02dd33b1ffd9fa6b8bd only cancels. The earlier one, 0x154E82c6a2ac121906D29af0EE81131E93B57860, takes no new orders. TAPELIQUID circuits ${DEPLOYED.circuits}. TAPELIQUID transistors ${DEPLOYED.transistors}.`,
      `BSC perpetual ${BSC_REBATE}, which can be opened. It reads a roughly 10-minute Pancake BEM/USDT average. The book just replaced, ${LAST_BSC}, only closes. The previous book ${PREV_BSC} only closes. X Layer perpetual ${KNOWN_XPERP}, which can be opened. Bitcoin ${BTC_COIN_BOOK}. ETH ${ETH_COIN_BOOK}. ZEC ${ZEC_COIN_BOOK}. UP ${UP_COIN_BOOK}, tiered by margin, which can be opened. Its mark is 0xEf744901777f6CDD3C27D20380eC2E7c6740326C and it reads the official pool 0xDf40529fa3E797c992272e27B811E59E5f1827Ae. The book cap is 3000 USDT and one address on one side is at most 600. Insurance is 0, so an open does not fit yet. The book just replaced, 0x277689ab82b04aE8100683B155CE2e2E12C82b30, only closes. The book before that, 0x53610279d1fFaF4D211E4c3988c964A9E870007F, only closes. The book before that, 0xceC1334Bc30D05e3ceab6bA19a5C0915df075552, is still a flat 5× and only closes. The previous UP book 0xB3cdB968580cE0121f613886E8f86EFFcC514d70 read the official spot and takes no new positions. The book before that, 0x5f913f7AFa71c51d69F472b0fE4c3EC74b1132F8, also takes no new positions. TAPE ${TAPE_COIN_BOOK}, which can be opened. Its mark is 0xA3f7570d34E6DeE46b8c70FB804AcD97A02D95d7. The book cap is 3000 USDT0 and one address on one side is at most 600. Insurance is 0, so an open does not fit yet. The TAPE book just replaced, 0x5C9F44A4D1f5F9082D3Cb02d11d717DE9563251A, only closes. The book before that, 0x76FF80D56E1be05BabeD1C4ef31fb9dEfa941d22, only closes. The book before that, 0xd5CaE88012A443449BE3d6efCf86A245A6972a86, only closes. FAB ${FAB_COIN_BOOK}, tiered by margin, which can be opened. Its mark is 0xe6F8419FE6F22d19933Ec6028366fc698709e73F. The book cap is 3000 USDT0 and one address on one side is at most 600. Insurance is 0, so an open does not fit yet. The book just replaced, 0x03A1B0e5E225855905a63BD2a5A3Eb3A366A3caA, only closes. The book before that, 0x61eb43aa602554324701cd2b551adff5b850d9cd, only closes. The book before that, 0x80318c852eE7fBDe52cE439deC3AE022Ba39A536, only closes. These six books stay on the contract list. Bitcoin, ETH, ZEC, UP, TAPE and FAB sign the latest book. Switching chain lands on that chain's BEM. The transistor perpetual stays off the list and takes no new position. Fees on UP, TAPE and FAB stay in insurance. The other 0.20 percent goes to that chain's multisig. There is no admin. The X Layer BEM mark is 0xa5F4695e95bf9c67D9B0D7c9C27Ec428a14370dC. The old v4 mark ${KNOWN_XMARK} is not used for this book. Transistor perpetual ${GATE}, the previous book, which takes no new position. Liquidity positions ${NPM}. X Layer lending: OKB 0x98814252d0BacaD3FddF4433F3BF388686F26F97, TAPE 0xB6d0fE8552f1F14E4F282DEcb137645E3c988D11, BEM 0x07d25044cBE0524c0617267d6BFAf2Fa6A0A0eFe. The pools just replaced, OKB 0x62f9016C97eF9255C8Ba16DDa7F531656015DAeA, TAPE 0x8674351Fae2781c077977aE589F2FA71a1bb4992 and BEM 0x741331f4c8e4D6937FB92eC88ceE27c9e0AC3062, only let funds out. The pools before those, OKB 0x6135b562c5d46595b044519e787FE396830C5C83, TAPE 0xF2925A78AdaC85cA330643bc5584A694199AfB76 and BEM 0x77F01670F70A13299531906e54D45c4247d0E3bf, only let funds out. The previous pools, OKB 0xc417780f4e1F9385BE1ba4cbDe7b40860B2aA8b0, TAPE 0x99CA040580837a2158Bfd0c8d84fcD4B85b6393b and BEM 0xfA211308F9583bEB9aaF724044863b78BfD7B9C1, only let funds out. Previous OKB 0x57228158cba08c61710ab2644e583c328ec86ea7, previous TAPE 0x8d06D78bd5eC97104cE3c7F10A73516fE1Ab4525 and previous BEM 0x01264DBDEC9Be07c7C1E942D8C4dcfC72A7691b2 only let funds out. Earlier TAPE 0x586B7992A8467290C5a1857FcE7EC8AF72be9445 and earlier BEM 0xeC55C19F6b0E08FbAd7DECD54bf8c892230fD353 only let funds out. Earlier TAPE 0xa49970ffafa28a0e596745e08993df611170f96f, BEM 0x8d3074bdf9412d77269f59cc506e318e5da27914, TAPE 0x425285da21ed3eabe64550d1be7dcabcf6f9e851 and BEM 0x5ed8551f90acc6395810d8274b019bf13ef1f696 only let funds out as well. BSC lending: BNB 0xd80B34d487CeC5F8F4966B65517Ba0b0CB2E9c31, BEM 0x03e2fed201edeF0f70789A79c6D59BeEbc05fB41. The pools just replaced, BNB 0xC4bA21b1566Aee4b1113f166C5f496275E51A65E and BEM 0xEF9d226254b7Ce8CdCD5b1170d70518AfDC3e05A, only let funds out. The pools before those, BNB 0xd66C0EA7acCC3D4e8E82a999e7345404803643BC and BEM 0x0A0C3D5A8D20468fea019590Bd3FC11623260223, only let funds out. The previous pools, BNB 0x0712cCa64B91Ec87cc175aa46cC38b54c8D3Bff3 and BEM 0x4127ddA5153042B6E6aFC02316587ab85D985B3A, only let funds out. Previous BNB 0xd8d981d32b12ea85b739bb667946975d25b0ab53 and previous BSC BEM 0xD71C270DFf9DF25245B367489D338629059E5014 only let funds out. Earlier BSC BEM 0xd2c7150f7779ded403c3f81a68dab5164b54df28 only lets funds out. X Layer term book 0x536327976231cf4c12759D81C99b12bD40aF0DD6. BSC term book 0x92E44Ba44b2b3CC3E5C823d9dF5b571C7338f2c3. The books just replaced only withdraw, unlock and repay: X Layer 0xC4fA8f4cE83ce03A0264D76ebdA8903FABb947d5, BSC 0x073452aD271ad5D511295aEB7706D4742dD1a75E. The books before those were empty: X Layer 0x29a08A0a0619Fd60a8131477859615F8AD438b58, BSC 0xf52a684531f8387e5383771887FF5b9FBa116b98. The previous term books were empty: X Layer 0x087E68a1C6c5978Aab73056f7DCd69fc55d72839, BSC 0x285e93b48e80A7d22CdE47056579074A3842fBcD. Earlier empty books: X Layer 0x683fb58ee77172626D5B49087DdAc71eF7825d20, BSC 0xBa427D94b001FA1cf0f85E1E54c1E392e9a07610.`,
      `BSC BEM ${BSC.bem}. BSC UP ${BSC.up}. BSC bridge ${BEM_BRIDGE}. X Layer BEM ${X_BEM}. TapeOut BEM mine 0x7E2E0DC66a3bD9103E69b766afA62d9f7b697b46.`,
      `TapeOut transistor market ${OFFICIAL.transistorMarket}. TapeOut circuit market ${OFFICIAL.circuitMarket}. BEM pool ${BSC.pool}.`,
      `X Layer seal claim ${LOCKED_REBATE.xlayer}. BSC seal claim ${LOCKED_REBATE.bsc}. Red packet desk 0x284Fa8819980A229622B711A52BF66bD9cDCbC2d. X Layer already uses it, and each round is a new contract there. One checked round is 0xbF8c2d49faC5D66E85A4a228f64e93960F4823eE: the prize was sent, the bought TAPE reached the wallet, and the claim returned the prize to the same address. BSC uses the same address and places it on the first publish. TAPE uses the pool that can fill. Other spot assets use a market that can fill. Perpetuals stay on this exchange. The earlier packets are no longer used.`,
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
    "0x58eaD5b41Cfd3627791D439402dd65571c286484。旧池 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641，不再新加。流通减去这两口的余额",
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
    "0x58eaD5b41Cfd3627791D439402dd65571c286484. Earlier pool 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641 takes no new deposits. Circulating supply subtracts both balances",
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
