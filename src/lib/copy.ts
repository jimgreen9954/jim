export type Lang = "zh" | "en";

export type Copy = {
  kicker: string;
  thesis: string;
  spot: string;
  perp: string;
  buy: string;
  sell: string;
  spotSub: string;
  perpSub: string;
  mark: string;
  equity: string;
  funding: string;
  fundingHint: string;
  paper: string;
  tfFast: string;
  tfMid: string;
  tfSlow: string;
  bidSub: string;
  askSub: string;
  market: string;
  limit: string;
  size: string;
  price: string;
  lev: string;
  freeUsd: string;
  freeBem: string;
  margin: string;
  liq: string;
  taker: string;
  maker: string;
  est: string;
  buySpot: string;
  sellSpot: string;
  openLong: string;
  openShort: string;
  addLong: string;
  addShort: string;
  closeLong: string;
  closeShort: string;
  flipLong: string;
  flipShort: string;
  book: string;
  kerf: string;
  mine: string;
  trade: string;
  holds: string;
  die: string;
  pos: string;
  ords: string;
  fills: string;
  inventory: string;
  emptyPos: string;
  emptyOrd: string;
  emptyFill: string;
  entry: string;
  upnl: string;
  closeHalf: string;
  closeAll: string;
  cancel: string;
  long: string;
  short: string;
  reset: string;
  resetArm: string;
  specimen: string;
  match: string;
  probe: string;
  probeHint: string;
  bidPad: string;
  askPad: string;
  lamp: string;
  on: string;
  off: string;
  seal: string;
  sealHint: string;
  stamp: string;
  sealDone: string;
  netlist: string;
  netlistBody: string;
  brief: string;
  briefP1: string;
  briefP2: string;
  reqTitle: string;
  req1: string;
  req2: string;
  req3: string;
  demo: string;
  linkHack: string;
  linkTape: string;
  walletTitle: string;
  walletNote: string;
  walletConnect: string;
  walletDeploy: string;
  walletNo: string;
  walletReject: string;
  walletBusy: string;
  walletFee: string;
  walletPrice: string;
  walletSupply: string;
  walletOfficial: string;
  walletTx: string;
  walletCpu: string;
  walletMin: string;
  liveCpu: string;
  liveMinted: string;
  liveCircuits: string;
  mintNand: string;
  openCanvas: string;
  nextHint: string;
  deskSpot: string;
  deskPaper: string;
  deskPerp: string;
  deskGate: string;
  deskWafer: string;
  deskBrief: string;
  chainSpot: string;
  chainPaper: string;
  chainPerp: string;
  chainGate: string;
  chainWafer: string;
  chainBrief: string;
  nextStep: string;
  chainBsc: string;
  chainX: string;
  deployX: string;
  deployX1: string;
  deployX2: string;
  deployX3: string;
  pushMark: string;
  realNote: string;
  paperNote: string;
  perpWarn: string;
  postLong: string;
  postShort: string;
  pullQuote: string;
  waitQuote: string;
  sameSide: string;
  cancelPost: string;
  closeDeal: string;
  liqNow: string;
  deployPerp: string;
  perpNeedUsdt: string;
  perpNeedX: string;
  perpNoChain: string;
  perpOther: string;
  perpRevert: string;
  signOkx: string;
  rpcWait: string;
  pkTitle: string;
  pkLong: string;
  pkShort: string;
  pkEmpty: string;
  pkLead: string;
  pkFlat: string;
  pkNote: string;
  pkMiss: string;
  deployOne: string;
  deployBook: string;
  bookTake: string;
  eatHint: string;
  sharedBook: string;
  sharedBookX: string;
  perpWarnX: string;
  perpStepsX: string;
  perpAddrX: string;
  xOpen: string;
  pnl: string;
  openPnl: string;
  limitPrice: string;
  useMark: string;
  upgradeBook: string;
  priceNote: string;
  badPrice: string;
  feeNote: string;
  bookMarket: string;
  myOrders: string;
  nickTitle: string;
  nickHint: string;
  nickSave: string;
  rebateTitle: string;
  rebateHint: string;
  rebateCode: string;
  rebateBind: string;
  rebateAccrued: string;
  rebateClaim: string;
  rebateUpgrade: string;
  rebateNeed: string;
  rebateCheck: string;
  rebateReview: string;
  rebateGo: string;
  rebateBack: string;
  rebateLocked: string;
  rebateMissing: string;
  rebateOld: string;
  rebateBsc: string;
  stopEasy: string;
  stopPro: string;
  stopTp: string;
  stopSl: string;
  stopNote: string;
  stopArmed: string;
  stopClear: string;
  bscDeploy: string;
  rebateRegister: string;
  rebateTaken: string;
  rebateHave: string;
  inviteLink: string;
  inviteCopy: string;
  inviteCopied: string;
  inviteGo: string;
  rebateShared: string;
  rebateNone: string;
  inviteTitle: string;
  inviteEmpty: string;
  inviteChecking: string;
  inviteMargin: string;
  inviteNotional: string;
  inviteReward: string;
  inviteCounted: string;
  inviteGap: string;
  inviteExact: string;
  inviteBsc: string;
  cancelFee: string;
  refund: string;
  perpAddr: string;
  balTitle: string;
  ofBal: string;
  beginner: string;
  advanced: string;
  presetTry: string;
  presetDaily: string;
  presetPush: string;
  sizeEst: string;
  liqRough: string;
  levCap: string;
  perpSteps: string;
  perpMark: string;
  yourEq: string;
  pay: string;
  receive: string;
  slippage: string;
  poolPrints: string;
  approve: string;
  swapNow: string;
  max: string;
  noBook: string;
  levLock: string;
  nearFuse: string;
  fundingPaid: string;
  spotMv: string;
  willFill: string;
  notional: string;
  liveTitle: string;
  liveNote: string;
  bemChain: string;
  vol24: string;
  chg24: string;
  miners: string;
  emission: string;
  kind: string;
  lastPx: string;
  inBem: string;
  trades: string;
  qty: string;
  volBnb: string;
  showAll: string;
  showLess: string;
  onlyBids: string;
  withTrades: string;
  bid: string;
  bidLeft: string;
  prints: string;
  noPrints: string;
  noBid: string;
  bidNote: string;
  filter: string;
  loading: string;
  liveFail: string;
  following: string;
  heldNote: string;
  idle: string;
  banners: Record<string, string>;
};

export const copy: Record<Lang, Copy> = {
  zh: {
    kicker: "现货 · 永续 · 工房",
    thesis:
      "撮合不该关在黑盒里。买价和卖价是两只管脚，NAND 一低，锁存器写下成交。BEM 现货和永续，刻在同一片白底金线上。",
    spot: "现货",
    perp: "永续",
    buy: "买入",
    sell: "卖出",
    spotSub: "BEM-USD",
    perpSub: "BEM-PERP",
    mark: "标记",
    equity: "练习金",
    funding: "资金费",
    fundingHint: "加速时钟，不是主网的 8 小时",
    paper: "纸上计价",
    tfFast: "4秒",
    tfMid: "8秒",
    tfSlow: "16秒",
    bidSub: "镀金",
    askSub: "揭膜",
    market: "市价",
    limit: "限价",
    size: "数量 BEM",
    price: "价格",
    lev: "杠杆",
    freeUsd: "可用美元",
    freeBem: "可用 BEM",
    margin: "保证金",
    liq: "强平",
    taker: "吃单",
    maker: "挂单",
    est: "预估占用",
    buySpot: "买入现货",
    sellSpot: "卖出现货",
    openLong: "开多",
    openShort: "开空",
    addLong: "继续加多",
    addShort: "继续加空",
    closeLong: "买入平空",
    closeShort: "卖出平多",
    flipLong: "平空并开多",
    flipShort: "平多并开空",
    book: "盘口",
    kerf: "割缝",
    mine: "我",
    trade: "下单",
    holds: "仓位",
    die: "晶圆",
    pos: "持仓",
    ords: "挂单",
    fills: "成交",
    inventory: "现货库存",
    emptyPos: "没有练习仓。存入保证金，或取出。",
    emptyOrd: "没有挂单。限价会停在割缝外面，等价格来碰。",
    emptyFill: "还没有你的成交。锁存器是空的。",
    entry: "开仓",
    upnl: "浮盈",
    closeHalf: "平一半",
    closeAll: "全平",
    cancel: "撤",
    long: "多",
    short: "空",
    reset: "只清除本机练习记录",
    resetArm: "再点一次，不动合约",
    specimen: "标本",
    match: "匹配电路 MATCH",
    probe: "探针",
    probeHint: "只看，不下单。买和卖都是 1，成交灯才亮。",
    bidPad: "买",
    askPad: "卖",
    lamp: "成交灯",
    on: "亮",
    off: "灭",
    seal: "个人印鉴",
    sealHint: "做完这三盏，永续手续费可以领回一半。流片一次，亮一盏。金、铜、朱，三盏颜色不同。每笔是这个钱包自己的电路：4 个输入、1 个输出、3 个 NAND。烧掉 3 个 NAND，支付 0.0013 OKB。灯亮本身不改下单时的费率，登记之后才能领。",
    stamp: "一键流片",
    sealDone: "三盏都亮，只说明三张印鉴在处理器上。订单簿仍按原费率收费。要减费，先在下面的领取合约登记这三张。登记后，你在一笔已撮合的成交里做多或做空，都能领回这笔保证金上手续费的一半。有推荐人时，按少付之后的手续费再减半。做多和做空都是这一半。钱从领取池转出，不从收费地址扣。同一笔只能领一次。池子没钱就领不到。BSC 读不到这台处理器，要由部署者把地址记上。",
    netlist: "网表",
    netlistBody: "两根都接到，才记一笔成交。",
    brief: "这片晶圆在比什么",
    briefP1:
      "TapeOut 把 NAND 和锁存器做成可以流片的晶体管。Hyperliquid 把订单簿做成快到像中心化的交易所。TAPELIQUID 把这两件事焊在一起：盘口就是电路，成交就是时钟沿。",
    briefP2:
      "这里交易的是 BEM 现货和 BEM 永续。处理器已经在 X Layer 上，不用再部署。铸造可以在本页签名，也可以去 TapeOut 官方的这台处理器。印鉴在本页点一次流片，亮一盏灯。",
    reqTitle: "现在这三件事",
    req1: "处理器 TAPELIQUID 已在 X Layer。公开网表是匹配电路 MATCH。",
    req2: "铸造走本页，或走 TapeOut 官方入口。NAND 或 LATCH，可选 100、1000、10000，也可以自己填。OKB 付给这台处理器。",
    req3: "印鉴是 4 个输入、1 个输出、3 个 NAND。三盏灯亮齐后，成交可以另领一半手续费。",
    demo: "探针只看，不下单。订单簿在永续合约里，不在这张晶圆上。",
    linkHack: "比赛页",
    linkTape: "官方铸造",
    walletTitle: "X Layer 钱包",
    walletNote:
      "处理器不用再部署。本页铸造：钱包切到 X Layer，留一点 OKB，选 NAND 或 LATCH，选 100、1000、10000 或自己填数量，在 OKX 或币安钱包里签名。官方铸造：打开 TapeOut 上的这台处理器，在晶体管市场买。两条路都把 OKB 付给处理器，不进交易所。",
    walletConnect: "连接钱包",
    walletDeploy: "部署 TAPELIQUID",
    walletNo: "没检测到对应钱包。OKX 会打开 App。币安请用币安 App 里的钱包浏览器打开这个页面后再点币安。",
    walletReject: "你在钱包里取消了。",
    walletBusy: "等钱包确认…",
    walletFee: "工厂创建费",
    walletPrice: "铸造单价 OKB",
    walletSupply: "晶体管供给",
    walletOfficial: "官方铸造",
    walletTx: "交易",
    walletCpu: "处理器合约",
    walletMin: "单价不能低于 0.000066 OKB。工厂只收 OKB，不收 BEM。创建后供给和单价都不能改。",
    liveCpu: "已上链",
    liveMinted: "已铸",
    liveCircuits: "已流片",
    mintNand: "铸造 16 颗 NAND",
    openCanvas: "去画布流片",
    nextHint: "先铸造，再流片。NAND 和 LATCH 的剩余分开数：已铸减去烧掉。新铸造仍从 2,100,000 的总额度里扣。流片烧掉晶体管，不能撤回。",
    deskSpot: "现货",
    deskPaper: "模拟",
    deskPerp: "合约",
    deskGate: "晶体管",
    deskWafer: "晶圆",
    deskBrief: "白皮书",
    chainSpot: "钱包里真买卖",
    chainPaper: "不进实盘成交",
    chainPerp: "同一份合约里互相成交",
    chainGate: "六个标",
    chainWafer: "X Layer 上流片",
    chainBrief: "规则和费用",
    nextStep: "下一步",
    chainBsc: "现在用 BSC 上的 USDT。只有同样停在 BSC 的人能吃你的单。",
    chainX: "现在用 X Layer 的 USDT0，gas 用 OKB。全站只锁这一份 X Layer 合约，同一条链上的人都能看到并吃单。标记价按 BSC 上的 BEM 池推进，每 30 秒最多挪一点。不能和 BSC 的单合成一笔。",
    deployX: "部署全站 X Layer 合约",
    deployX1: "第 1 次签名：部署标记价。OKX 弹出来就点确认。",
    deployX2: "第 2 次签名：把现价写进标记价。",
    deployX3: "第 3 次签名：部署永续合约。签完，地址会出现在下面，发给我。",
    pushMark: "把 BSC 现价推进 X Layer",
    realNote: "现货在 PancakeSwap V3 上成交。本台另收千分之二，签名后打进收费地址。币在签名之前留在钱包里。",
    paperNote: "这一页是练习。成交只记在这台浏览器里。只清除本机练习记录，不动合约。",
    perpWarn:
      "保证金是 BSC 的 USDT，锁进这一份合约，从 1 到 500。杠杆最高 1000 倍。亏到大约一半保证金就可以被强平，谁都可以调用，没有保险基金，也没有自动减仓。标记价是 Pancake 池大约 10 分钟的均价，不拿最后一笔去清算。没有资金费。撮合和撤单收保证金的千分之二。没有管理员，没有审计。簿上没有对手时，签下去只是挂单，不会马上成交。",
    postLong: "开多",
    postShort: "开空",
    pullQuote: "接下这一边",
    waitQuote: "等对手",
    sameSide: "已经有一笔同向挂单。",
    cancelPost: "撤回挂单",
    closeDeal: "平仓",
    liqNow: "强平",
    deployPerp: "部署合约",
    perpNeedUsdt: "这个地址在 BSC 上的 USDT 不够。合约自己没钱，保证金从你的钱包扣。",
    perpNeedX: "这个地址在 X Layer 上的 USDT0 不够。保证金从这条链扣，不是 BSC 的 USDT。Gas 用 OKB。",
    perpNoChain: "这个地址在 BSC 上没有合约代码。部署时钱包必须停在 BNB Smart Chain，不能停在 X Layer。",
    perpOther: "这张是你自己的单，同一个钱包不能吃。换一个钱包打开本页，点吃单。",
    perpRevert: "链上拒绝了这笔交易。常见原因是钱包不在 BSC、USDT 没授权，或余额不够。",
    signOkx: "去 OKX 签名",
    rpcWait: "签名已经上链。刚才是查询回执的节点挂了，不是交易失败。再点一次，这次直接签开仓。",
    pkTitle: "公开对局",
    pkLong: "多方",
    pkShort: "空方",
    pkEmpty: "空位",
    pkLead: "领先",
    pkFlat: "持平",
    pkNote: "柱子和输赢按合约标记价算。下面的线是池子真实成交，结算不看这根线的最后一笔。",
    pkMiss: "对手还没来。任何钱包打开本页都能看到这张单，点吃单就接上。不要再部署新合约。",
    deployOne: "部署 1 USDT 版",
    deployBook: "部署订单簿",
    bookTake: "吃单",
    eatHint: "下面列出所有钱包的挂单，不看你连的是哪个地址。不是你的单就点吃单。你自己的单换一个钱包才能吃。",
    sharedBook: "BSC 全站只用这一份合约。任何人、任何时候开的单都在这里，打开就能看到，点吃单就能接。",
    sharedBookX: "X Layer 全站只用这一份合约。用 X Layer 的 USDT0 开的单都在这里，打开就能看到，点吃单就能接。",
    perpWarnX:
      "保证金是 X Layer 的 USDT0，锁进这一份合约。gas 用 OKB。从 1 美元到 500。杠杆最高 1000 倍。亏到大约一半保证金就可以被强平，谁都可以调用，没有保险基金，也没有自动减仓。标记价由页面按 BSC 的 BEM 池推进，每 30 秒最多挪一点，标记停更时不要新开。没有资金费。不能和 BSC 的单合成一笔。簿上没有对手时，签下去只是挂单。",
    perpStepsX: "三步：钱包停在 X Layer，里面有 USDT0，再留一点 OKB 当 gas。选一档，点开多或开空。另一个 X Layer 钱包接反方向才成交。",
    perpAddrX: "X Layer 永续合约",
    xOpen: "X Layer 的全站合约还没写进页面。部署一次，把地址发我，我锁给所有人。在那之前，别人看不到你的单。",
    pnl: "盈亏",
    openPnl: "还没人接，盈亏 0",
    limitPrice: "开单价",
    useMark: "用标记价",
    upgradeBook: "升级限价簿",
    priceNote: "你填的价格就是成交价。别人吃这张单时按这个价开，之后盈亏跟着标记价走。",
    badPrice: "价格要在 0.01 到 100000 之间",
    feeNote: "谁都能看到挂单，点某一笔对赌。开过还能再开。撮合和撤单都收保证金的 0.2%，转到开发者地址。",
    bookMarket: "市场",
    myOrders: "我的订单",
    nickTitle: "对手昵称",
    nickHint: "只在你这台设备上显示。给对手地址起个名字，方便认出是谁。",
    nickSave: "记下",
    rebateTitle: "链上返佣",
    rebateHint: "比例按 Hyperliquid 标准返佣：推荐人拿手续费的 10%，其中 4% 让给被推荐人当折扣，推荐人实拿 6%。推荐码填完要点确认，确认之后不能改。提现只能是整数 1、10、20、50、100、300、500 美元。",
    rebateCode: "我的推荐码",
    rebateBind: "填写别人的推荐码",
    rebateAccrued: "可提返佣",
    rebateClaim: "提现",
    rebateUpgrade: "升级返佣合约",
    rebateNeed: "现在这份合约还没有返佣。升级一次之后，把新地址发我，我锁给所有人。在那之前，昵称已经能用。",
    rebateCheck: "核对",
    rebateReview: "确认后不能修改。绑定对象",
    rebateGo: "确认绑定",
    rebateBack: "返回修改",
    rebateLocked: "已确认，不能再改",
    rebateMissing: "这个推荐码还不存在",
    rebateOld: "领取档是 1、10、20、50、100、300、500。",
    rebateBsc: "返佣记在这一份 BSC 永续上。",
    stopEasy: "小白止盈止损",
    stopPro: "高手止盈止损",
    stopTp: "止盈价",
    stopSl: "止损价",
    stopNote: "小白档按保证金算：止盈赚一倍，止损亏一半。页面开着、价格碰到，会请你的钱包签名平仓。关掉页面就不会自动平。",
    stopArmed: "已挂上",
    stopClear: "取消止盈止损",
    bscDeploy: "部署 BSC 返佣合约",
    rebateRegister: "登记",
    rebateTaken: "这个码已经有人登记了，换一个。",
    rebateHave: "这个地址已经登记过码，不能再改。",
    inviteLink: "邀请链接",
    inviteCopy: "复制链接",
    inviteCopied: "链接已复制。朋友打开后核对，再点确认。",
    inviteGo: "推荐码在 X Layer。点这里去登记，不用部署新合约。",
    rebateShared: "推荐码跟你现在选的链走。停在 BSC，登记、绑定和提现花 BNB，提到 BSC 的 USDT。停在 X Layer，花 OKB，提到 USDT0。两条链的码不通用。",
    rebateNone: "这条链的全站合约上没有这个码。另一条链上的码不算，私人合约上的码也不算。",
    inviteTitle: "我邀请的人",
    inviteEmpty: "还没有人绑定你的码。",
    inviteChecking: "正在从链上逐块核对。对完之前不显示人数，避免把没看完的账当成全部。",
    inviteMargin: "保证金",
    inviteNotional: "名义",
    inviteReward: "返佣",
    inviteCounted: "已记返佣",
    inviteGap: "有一笔链上记录对不上，人数先不显示，避免算错。",
    inviteExact: "人数和已记返佣是链上对完之后，用合约同一套公式算的。上面的可提是合约里还没提走的余额，提现只认这个数。",
    inviteBsc: "BSC 的邀请和 X Layer 分开。名单按 X Layer 那份合约逐块核对。BSC 上谁绑了你，以这份合约里的绑定为准。",
    cancelFee: "撤单费",
    refund: "退回",
    perpAddr: "BSC 永续合约",
    balTitle: "钱包余额",
    ofBal: "余额",
    beginner: "新手",
    advanced: "高级",
    presetTry: "小试",
    presetDaily: "常用",
    presetPush: "进取",
    sizeEst: "大约仓位",
    liqRough: "反向大约",
    levCap: "杠杆 1 到 1000 倍。10 倍以上亏一半保证金就接近强平。",
    perpSteps: "三步：钱包里有 BSC 的 USDT，选一档，再点开多或开空。另一个钱包接反方向才成交。",
    perpMark: "标记价",
    yourEq: "权益",
    pay: "支付",
    receive: "预计得到",
    slippage: "滑点",
    poolPrints: "池子成交",
    approve: "授权",
    swapNow: "兑换",
    max: "全部",
    noBook: "这条区间里还没读到成交。",
    levLock: "杠杆跟仓走。想换，先平掉。",
    nearFuse: "接近熔断",
    fundingPaid: "累计资金费",
    spotMv: "市值",
    willFill: "将碰在",
    notional: "名义",
    liveTitle: "链上晶体管",
    liveNote:
      "成交和未成交的买价都在 tapeout.net/market.json。点一行，看这颗晶体管最近几笔，并按链上 BEM 折算。",
    bemChain: "链上 BEM",
    vol24: "24h 额",
    chg24: "24h",
    miners: "矿工",
    emission: "日产出",
    kind: "类型",
    lastPx: "最新",
    inBem: "折合 BEM",
    trades: "笔数",
    qty: "颗数",
    volBnb: "成交额",
    showAll: "全部成交",
    showLess: "前 12",
    onlyBids: "只有买价",
    withTrades: "有成交",
    bid: "最高买价",
    bidLeft: "剩余",
    prints: "最近成交 UTC",
    noPrints: "还没有成交。",
    noBid: "没有未成交的买价。",
    bidNote: "买价是挂着的出价，不是最新成交。",
    filter: "筛选处理器",
    loading: "正在读官网行情…",
    liveFail: "官网行情没读到。",
    following: "纸上标记已跟上链上 BEM。",
    heldNote: "账户里已有成交，纸上价格不改，避免把已有的练习仓强平。",
    idle: "挂出但还没成交",
    banners: {
      nofunds: "美元不够。",
      nobem: "BEM 不够。",
      nomargin: "保证金不够。杠杆放低，或先平一点。",
      badsize: "数量至少 1 BEM。",
      badprice: "限价得是正数。",
      nopos: "没有仓可平。",
      rested: "限价挂上了，等价格来碰割缝。",
      filled: "成交写进锁存器了。",
      cancelled: "撤了。锁住的钱退回。",
      stamped: "这一块只记在模拟盘。",
      sealed: "模拟盘三块齐了。真实手续费没变。",
      mismatch: "灯不对。再拨一下管脚。",
      resetok: "晶圆重熔了。印鉴还在。",
      liq: "保险丝熔了。这笔逐仓保证金烧毁。",
    },
  },
  en: {
    kicker: "Spot · Perps · Workshop",
    thesis:
      "Matching should not sit in a black box. Bid and ask are two pads. When the NAND falls, a latch writes the fill. BEM spot and the perpetual share one white wafer ruled in gold.",
    spot: "Spot",
    perp: "Perp",
    buy: "Buy",
    sell: "Sell",
    spotSub: "BEM-USD",
    perpSub: "BEM-PERP",
    mark: "Mark",
    equity: "Practice cash",
    funding: "Funding",
    fundingHint: "Sped-up clock, not the mainnet 8h",
    paper: "Paper quote",
    tfFast: "4s",
    tfMid: "8s",
    tfSlow: "16s",
    bidSub: "Plate",
    askSub: "Lift",
    market: "Market",
    limit: "Limit",
    size: "Size BEM",
    price: "Price",
    lev: "Leverage",
    freeUsd: "Free USD",
    freeBem: "Free BEM",
    margin: "Margin",
    liq: "Liq",
    taker: "Taker",
    maker: "Maker",
    est: "Locks about",
    buySpot: "Buy spot",
    sellSpot: "Sell spot",
    openLong: "Open long",
    openShort: "Open short",
    addLong: "Add long",
    addShort: "Add short",
    closeLong: "Buy to cover",
    closeShort: "Sell to close",
    flipLong: "Cover and flip long",
    flipShort: "Close and flip short",
    book: "Book",
    kerf: "Kerf",
    mine: "Me",
    trade: "Ticket",
    holds: "Risk",
    die: "Die",
    pos: "Position",
    ords: "Orders",
    fills: "Fills",
    inventory: "Spot inventory",
    emptyPos: "No practice position. Deposit margin, or withdraw.",
    emptyOrd: "No resting orders. A limit waits outside the kerf.",
    emptyFill: "No fills of yours yet. The latch is empty.",
    entry: "Entry",
    upnl: "uPnL",
    closeHalf: "Close half",
    closeAll: "Flatten",
    cancel: "Pull",
    long: "Long",
    short: "Short",
    reset: "Clears this browser only",
    resetArm: "Tap again. Contracts stay",
    specimen: "Specimen",
    match: "Matcher MATCH",
    probe: "Probe",
    probeHint: "Look only. It does not place an order. The lamp lights when bid and ask are both 1.",
    bidPad: "Bid",
    askPad: "Ask",
    lamp: "Fill lamp",
    on: "Lit",
    off: "Dark",
    seal: "Personal chop",
    sealHint: "Finish these three and half the perpetual fee can be claimed back. One tape-out lights one lamp. Gold, copper, then vermilion. Each circuit belongs to this wallet: 4 inputs, 1 output, 3 NAND gates. It burns 3 NAND and pays 0.0013 OKB. Lighting a lamp does not change the fee at the moment of the trade. Register before the claim.",
    stamp: "Tape out",
    sealDone: "Three lamps only mean the three seals sit on the processor. The book still charges its own fee. To reduce it, register those three on the rebate below. After that, if you are the long or the short on a matched deal, you can claim half the fee charged on your margin. With a referrer, that half is of the already discounted fee. Both sides get that half. The money comes from the rebate pool, not from the fee address. One claim per deal. An empty pool pays nothing. BSC cannot read this processor, so the deployer has to mark the address.",
    netlist: "Netlist",
    netlistBody: "Both leads have to be connected before a fill is counted.",
    brief: "What this wafer is for",
    briefP1:
      "TapeOut turns NAND and latches into transistors you can tape out. Hyperliquid turns an order book into an exchange that feels centralized. TAPELIQUID welds them: the book is a circuit, a fill is a clock edge.",
    briefP2:
      "You trade BEM spot and the BEM perpetual. The processor is already on X Layer. Mint here, or on this processor at official TapeOut. The seal on this page lights one lamp per tape-out.",
    reqTitle: "Three things, now",
    req1: "Processor TAPELIQUID is on X Layer. The public netlist is the MATCH circuit.",
    req2: "Mint here, or at the official TapeOut entrance. NAND or LATCH, in 100, 1,000, 10,000, or any amount you type. OKB is paid to this processor.",
    req3: "The seal is four inputs, one output, three NAND gates. After three lamps, a fill can claim half the fee.",
    demo: "The probe only looks. It does not place an order. The book lives in the perpetual, not on this wafer.",
    linkHack: "Hackathon",
    linkTape: "Official mint",
    walletTitle: "X Layer wallet",
    walletNote:
      "Do not deploy another processor. Mint here: switch the wallet to X Layer, keep a little OKB, pick NAND or LATCH, then 100, 1,000, 10,000, or your own number. Sign in OKX or Binance Wallet. Or open this processor on TapeOut and mint in the official transistor market. Both pay the processor, not an exchange.",
    walletConnect: "Connect wallet",
    walletDeploy: "Deploy TAPELIQUID",
    walletNo: "That wallet is not in this browser. OKX opens its app. For Binance, open this page in the Binance App wallet browser, then tap Binance.",
    walletReject: "You cancelled in the wallet.",
    walletBusy: "Waiting for the wallet…",
    walletFee: "Factory fee",
    walletPrice: "Mint price OKB",
    walletSupply: "Transistor supply",
    walletOfficial: "Official mint",
    walletTx: "Transaction",
    walletCpu: "Processor contract",
    walletMin: "Price cannot be under 0.000066 OKB. The factory takes OKB, not BEM. Supply and price are frozen after creation.",
    liveCpu: "On chain",
    liveMinted: "Minted",
    liveCircuits: "Taped out",
    mintNand: "Mint 16 NAND",
    openCanvas: "Tape out on the canvas",
    nextHint: "Mint first, then tape out. NAND and LATCH left are counted apart: minted minus burned. A new mint still comes out of the 2,100,000 cap. Tape-out burns transistors and cannot be undone.",
    deskSpot: "Spot",
    deskPaper: "Paper",
    deskPerp: "Perp",
    deskGate: "Transistors",
    deskWafer: "Wafer",
    deskBrief: "Brief",
    chainSpot: "Real wallet trades",
    chainPaper: "Not in the live tape",
    chainPerp: "Fills only inside this contract",
    chainGate: "Six markets",
    chainWafer: "Tape-out on X Layer",
    chainBrief: "Rules and fees",
    nextStep: "Next",
    chainBsc: "This book uses BSC USDT. Only people on BSC can take your order.",
    chainX: "This book uses USDT0 on X Layer, and gas is OKB. The whole site locks one X Layer contract, so anyone on this chain can see an order and take it. The mark is pushed from the BSC BEM pool and can move only a little every 30 seconds. It cannot be matched with a BSC order.",
    deployX: "Deploy the shared X Layer contract",
    deployX1: "Signature 1 of 3: deploy the mark. Confirm it in OKX.",
    deployX2: "Signature 2 of 3: write the current price into the mark.",
    deployX3: "Signature 3 of 3: deploy the perpetual. The address shows below. Send it to me.",
    pushMark: "Push the BSC price onto X Layer",
    realNote: "Spot fills on PancakeSwap V3. This desk takes 0.2% and sends it to the fee address when you sign. Tokens stay in your wallet until then.",
    paperNote: "This page is practice. Fills stay in this browser. Clearing it does not touch a contract.",
    perpWarn:
      "Margin is BSC USDT, locked in this one contract, from 1 to 500. Leverage goes to 1000x. About half the margin lost and anyone can liquidate it. There is no insurance fund and no auto-deleveraging. The mark is about a 10-minute Pancake average. The last trade is not used to liquidate. There is no funding fee. Matches and cancels take 0.2% of margin. No admin and no audit. If the book is empty, signing only posts a quote. It does not fill.",
    postLong: "Long",
    postShort: "Short",
    pullQuote: "Take this side",
    waitQuote: "Waiting",
    sameSide: "Someone is already waiting on this side.",
    cancelPost: "Cancel",
    closeDeal: "Close",
    liqNow: "Liquidate",
    deployPerp: "Deploy contract",
    perpNeedUsdt: "This address does not have enough USDT on BSC. The contract does not front money. Margin comes out of your wallet.",
    perpNeedX: "This address does not have enough USDT0 on X Layer. Margin comes from this chain, not BSC USDT. Gas is OKB.",
    perpNoChain: "No contract code at this address on BSC. The wallet has to be on BNB Smart Chain when you deploy, not X Layer.",
    perpOther: "This order is yours. The same wallet cannot take it. Open this page in another wallet and tap Take.",
    perpRevert: "The chain rejected the transaction. Usual causes: wallet not on BSC, USDT not approved, or not enough balance.",
    signOkx: "Sign in OKX",
    rpcWait: "The signature is on chain. The receipt node failed, the trade did not. Tap again. This time it asks for the order itself.",
    pkTitle: "Public match",
    pkLong: "Long",
    pkShort: "Short",
    pkEmpty: "Open seat",
    pkLead: "ahead",
    pkFlat: "Even",
    pkNote: "The bar uses the contract mark. The line is real pool prints. Settlement ignores the last print.",
    pkMiss: "Nobody has taken it yet. Any wallet that opens this page can see the order and take it. Do not deploy another contract.",
    deployOne: "Deploy the 1 USDT contract",
    deployBook: "Deploy the order book",
    bookTake: "Take",
    eatHint: "Other people's orders are below. The other wallet must open this page on the same contract address and tap Take. Taking a long makes you the short.",
    sharedBook: "The whole site uses this one BSC contract. Anyone can see every order here and take it.",
    sharedBookX: "The whole site uses this one X Layer contract. Orders posted in USDT0 are here, and anyone can take them.",
    perpWarnX:
      "Margin is X Layer USDT0, locked in this one contract. Gas is OKB. From 1 to 500 USD. Leverage goes to 1000x. About half the margin lost and anyone can liquidate it. There is no insurance fund and no auto-deleveraging. The mark is pushed from the BSC BEM pool, at most a small step every 30 seconds. Do not open a new order if the mark has stopped. There is no funding fee. It cannot net with a BSC order. If the book is empty, signing only posts a quote.",
    perpStepsX: "Three steps: be on X Layer with USDT0 and a little OKB for gas, pick a size, then long or short. It fills only when another X Layer wallet takes the other side.",
    perpAddrX: "X Layer perp",
    xOpen: "The shared X Layer contract is not written into the page yet. Deploy once and send me the address. Until then, other people cannot see your order.",
    pnl: "PnL",
    openPnl: "Not taken yet. PnL 0",
    limitPrice: "Your price",
    useMark: "Use mark",
    upgradeBook: "Upgrade the book",
    priceNote: "The price you type is the fill price. A taker opens at that price, then PnL follows the mark. This book is still market-priced. Upgrade once, then send me the new address and I will lock everyone to it.",
    badPrice: "Price must be between 0.01 and 100000",
    feeNote: "Everyone can see the quotes and take one. You can post again after posting. Matching and cancelling each cost 0.2% of the margin, paid to the developer.",
    bookMarket: "Book",
    myOrders: "My orders",
    nickTitle: "Counterparty names",
    nickHint: "Saved only on this device. Name an address so you can tell who it is.",
    nickSave: "Save",
    rebateTitle: "On-chain rebate",
    rebateHint: "Same split as Hyperliquid's standard referral: the referrer is owed 10% of fees, 4% of that is given back as the trader's discount, and 6% accrues to the referrer. Check the code, then confirm. After that it cannot be changed. Claims are whole amounts only: 1, 10, 20, 50, 100, 300, or 500 USD.",
    rebateCode: "My code",
    rebateBind: "Use someone's code",
    rebateAccrued: "Claimable",
    rebateClaim: "Claim",
    rebateUpgrade: "Upgrade the rebate contract",
    rebateNeed: "This contract has no rebates yet. Upgrade once, then send me the new address and I will lock it for everyone. Names already work.",
    rebateCheck: "Check",
    rebateReview: "This cannot be changed. Binding to",
    rebateGo: "Confirm",
    rebateBack: "Back",
    rebateLocked: "Confirmed. It cannot be changed.",
    rebateMissing: "That code does not exist",
    rebateOld: "Claim sizes are 1, 10, 20, 50, 100, 300, and 500.",
    rebateBsc: "Rebates sit on this BSC perpetual.",
    stopEasy: "Simple stop",
    stopPro: "Manual stop",
    stopTp: "Take profit",
    stopSl: "Stop loss",
    stopNote: "Simple mode uses margin: take profit at a double, stop at a half loss. While this page is open and the price touches either line, your wallet is asked to close. A closed page does not close the trade.",
    stopArmed: "Armed",
    stopClear: "Clear stops",
    bscDeploy: "Deploy BSC rebate contract",
    rebateRegister: "Register",
    rebateTaken: "Someone already registered that code. Pick another.",
    rebateHave: "This address already has a code. It cannot be changed.",
    inviteLink: "Invite link",
    inviteCopy: "Copy link",
    inviteCopied: "Link copied. Your friend opens it, checks, then confirms.",
    inviteGo: "Codes live on X Layer. Go there to register. You do not need a new contract.",
    rebateShared: "The code follows the chain you have selected. On BSC, registering, binding, and claiming spend BNB and pay BSC USDT. On X Layer they spend OKB and pay USDT0. A code does not cross chains.",
    rebateNone: "That code is not on this chain's shared contract. A code on the other chain, or on a private contract, does not count.",
    inviteTitle: "People I invited",
    inviteEmpty: "Nobody has bound your code.",
    inviteChecking: "Reading the chain block by block. The count stays hidden until the read is finished, so a half-read book is not shown as the total.",
    inviteMargin: "Margin",
    inviteNotional: "Notional",
    inviteReward: "Rebate",
    inviteCounted: "Rebates recorded",
    inviteGap: "One on-chain record does not line up. The count stays hidden so it is not wrong.",
    inviteExact: "The count and recorded rebates use the contract's own formula after the chain has been read through. Claimable is the balance still in the contract. A withdrawal uses only that number.",
    inviteBsc: "BSC invitations are separate from X Layer. The scanned list is the X Layer contract. On BSC, the binding stored in this contract is what counts.",
    cancelFee: "Cancel fee",
    refund: "Back",
    perpAddr: "BSC perp contract",
    balTitle: "Wallet",
    ofBal: "balance",
    beginner: "Simple",
    advanced: "Advanced",
    presetTry: "Small",
    presetDaily: "Usual",
    presetPush: "Bold",
    sizeEst: "Size about",
    liqRough: "Adverse move about",
    levCap: "Leverage is 1x to 1000x. At 10x and above, losing half the margin is near liquidation.",
    perpSteps: "Three steps: hold USDT on BSC, pick a size, then long or short. It fills only when another wallet takes the other side.",
    perpMark: "Mark",
    yourEq: "Equity",
    pay: "Pay",
    receive: "You receive",
    slippage: "Slippage",
    poolPrints: "Pool prints",
    approve: "Approve",
    swapNow: "Swap",
    max: "Max",
    noBook: "No prints in this block window.",
    levLock: "Leverage belongs to the open position. Flatten to change it.",
    nearFuse: "Fuse warming",
    fundingPaid: "Funding paid",
    spotMv: "Value",
    willFill: "Touches",
    notional: "Notional",
    liveTitle: "On-chain transistors",
    liveNote:
      "Trades and resting bids both come from tapeout.net/market.json. Open a row for that transistor's last prints, quoted in BEM.",
    bemChain: "On-chain BEM",
    vol24: "24h",
    chg24: "24h",
    miners: "Miners",
    emission: "Daily",
    kind: "Kind",
    lastPx: "Last",
    inBem: "In BEM",
    trades: "Trades",
    qty: "Qty",
    volBnb: "Volume",
    showAll: "All trades",
    showLess: "Top 12",
    onlyBids: "Bid only",
    withTrades: "with trades",
    bid: "Best bid",
    bidLeft: "Left",
    prints: "Last prints UTC",
    noPrints: "No trades yet.",
    noBid: "No resting bid.",
    bidNote: "A bid is a resting offer, not the last trade.",
    filter: "Filter processors",
    loading: "Reading the official tape…",
    liveFail: "Official tape did not load.",
    following: "Paper mark is following on-chain BEM.",
    heldNote: "This account already has fills, so the paper price stays put.",
    idle: "listed, no trades yet",
    banners: {
      nofunds: "Not enough dollars.",
      nobem: "Not enough BEM.",
      nomargin: "Not enough margin. Lower leverage, or close a little.",
      badsize: "Size has to be at least 1 BEM.",
      badprice: "A limit needs a positive price.",
      nopos: "Nothing to close.",
      rested: "Limit is resting, waiting for the kerf.",
      filled: "The fill is latched.",
      cancelled: "Pulled. Locked funds came back.",
      stamped: "Recorded on the paper book only.",
      sealed: "Three paper tapes. Live fees did not change.",
      mismatch: "Lamp misses the target. Flip a pad.",
      resetok: "Wafer remelted. The chop stayed.",
      liq: "Fuse blown. Isolated margin is gone.",
    },
  },
};
