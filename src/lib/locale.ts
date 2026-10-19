export type Lang = "zh" | "en";

const COPY = {
  zh: {
    navDiscover: "发现",
    navMarket: "系列",
    navTokens: "代币",
    navLaunch: "发射",
    navActivity: "动态",
    navAssets: "用户",
    navProfile: "资料",
    navPaper: "白皮书",
    searchPh: "搜索系列 / NFT / 钱包",
    connect: "连接钱包",
    logout: "退出",
    loginOkx: "用 OKX 登录",
    themeDay: "白天",
    themeNight: "深夜",
    langBtn: "EN",
    genesisTitle: "创世电路 NFT",
    genesisNote: "创世处理器 0x50A9…9DD9，链上已有 {n} 枚电路 NFT。买卖走 TapeOut 官方电路市场，用 OKX 钱包签名，手续费 {fee}%。",
    genesisLoading: "正在读创世处理器。只有官方电路市场挂着的单子才能买。",
    sale: "在售",
    browse: "翻全部",
    prev: "上一页",
    next: "下一页",
    emptySale: "这一页最近的挂单里没有创世电路。翻下一页，或切到「翻全部」。",
    emptyAll: "这一页没有电路。",
    end: "全部 · 已到末页",
    pageAll: "全部 {from}–{to} / {minted}",
    pageSale: "在售 · 第 {page} 页 · 这一段扫到 {n} 笔创世挂单",
    pageSaleEmpty: "在售 · 没有更早的挂单",
    genesisFail: "创世电路没读到：{err}。没有用假 NFT 顶上。",
    genCard: "创世 #{id}",
    listed: "在售 {px} BNB",
    unlisted: "未挂单",
    genName: "创世电路 #{id}",
    listedPx: "官方挂单 {px} BNB，卖家 {seller}。用 OKX 付这个价，市场费 {fee}% 从里面扣。",
    noListing: "还没有有效挂单{owner}。不能按一个假价格买。",
    ownerBit: "，持有人 {owner}",
    needOkx: "创世电路只用 OKX 钱包。请在弹出的 OKX 里确认。",
    noWallet: "没有连上 OKX。",
    payBnb: "OKX 会支付 {px} BNB。取消就等于没买。",
    buySent: "买单已提交 {hash}。以链上收据为准。",
    buyFail: "没买成",
    priceHint: "先写挂单价格，例如 0.05",
    priceRange: "价格超出合约能收的范围",
    notOwner: "这枚不是当前 OKX 钱包的，不能挂",
    approve: "第一次挂单要授权官方市场。OKX 会先弹出授权。",
    approveSent: "授权已提交 {hash}。等它上链后再点一次挂单。",
    listSent: "已提交挂单 {hash}。市场上出现之后这里才会显示在售。",
    listFail: "没挂上",
    genBuy: "用 OKX 买下",
    genList: "挂到官方市场",
    genScan: "在 BscScan 看这枚",
    close: "关闭",
    refTitle: "兑换",
    refNote: "点 BEM 或 OKB 打开真实兑换。BEM 对 USDT 走 BSC 池，OKB 对 BEM 走 X Layer 池。报价来自链上，不会假成交。",
    bemHint: "点此用 USDT 换 BEM",
    okbHint: "点此用 OKB 换 BEM",
    swapTitle: "兑换",
    swapPay: "支付",
    swapRecv: "收到",
    swapGo: "用 OKX 兑换",
    quoteBsc: "报价来自 BSC，滑点 1%。到账以钱包收据为准。",
    quoteXl: "报价是 X Layer 池子中间价，成交至少要到 95%。",
    swapWait: "等 OKX 确认。取消就等于没成交。",
    swapSent: "兑换已提交。到账以链上收据为准。",
    swapView: "查看这笔交易",
    swapNeed: "先连上 OKX，再兑换。",
    bridgeTitle: "BEM 跨链",
    bridgeGo: "跨过去",
    assetsTitle: "用户中心",
    assetsEmpty: "还没登录",
    addrOn: "{addr} · 已连接",
    addrOff: "未连接钱包",
    balNote: "余额是这个地址在 BSC 和 X Layer 上的链上数据，不是欧易交易所账户。",
    balEmpty: "用 OKX 登录后，这里显示 BNB、OKB、BEM、USDT。",
    holdings: "链上资产",
    profileTitle: "资料",
    nickLabel: "昵称",
    avatarLabel: "头像",
    nickPh: "最多 16 个字",
    save: "保存",
    clearAv: "去掉头像",
    profileHint: "存在这台浏览器，只对当前连接的钱包生效。",
    connectTitle: "登录",
    connectLead: "创世电路和兑换用 OKX 钱包签名。点 OKX 会唤起 OKX 钱包。",
    binance: "币安钱包",
    walletWait: "正在唤起 OKX…",
    walletPop: "已弹出 OKX，请在 App 里确认",
    walletFail: "没有连上 OKX。请安装 OKX 钱包，或在 OKX App 里打开。",
    binanceFail: "浏览器里没有币安钱包，请用币安 App 打开这个页面",
    me: "我的",
    myAssets: "我的资产",
    activity: "动态",
  },
  en: {
    navDiscover: "Discover",
    navMarket: "Collections",
    navTokens: "Tokens",
    navLaunch: "Launch",
    navActivity: "Activity",
    navAssets: "Account",
    navProfile: "Profile",
    navPaper: "Paper",
    searchPh: "Search collections, NFTs, wallets",
    connect: "Connect wallet",
    logout: "Log out",
    loginOkx: "Log in with OKX",
    themeDay: "Light",
    themeNight: "Dark",
    langBtn: "中文",
    genesisTitle: "Genesis circuits",
    genesisNote: "Genesis processor 0x50A9…9DD9. {n} circuit NFTs on chain. Trades use the official TapeOut market and are signed in OKX Wallet. Fee {fee}%.",
    genesisLoading: "Reading the genesis processor. Only official listings can be bought.",
    sale: "For sale",
    browse: "Browse",
    prev: "Prev",
    next: "Next",
    emptySale: "No genesis listings in this slice. Try the next page, or browse all.",
    emptyAll: "No circuits on this page.",
    end: "All · end of supply",
    pageAll: "All {from}–{to} / {minted}",
    pageSale: "For sale · page {page} · {n} genesis listings in this slice",
    pageSaleEmpty: "For sale · no older listings",
    genesisFail: "Genesis read failed: {err}. No fake NFTs were substituted.",
    genCard: "Genesis #{id}",
    listed: "Listed {px} BNB",
    unlisted: "Not listed",
    genName: "Genesis circuit #{id}",
    listedPx: "Official ask {px} BNB, seller {seller}. OKX pays this price. The market takes {fee}% from it.",
    noListing: "No live listing{owner}. This will not invent a price.",
    ownerBit: ", holder {owner}",
    needOkx: "Genesis trades sign only in OKX. Confirm the OKX prompt.",
    noWallet: "OKX is not connected.",
    payBnb: "OKX will pay {px} BNB. Cancelling means no purchase.",
    buySent: "Buy submitted {hash}. The receipt is the record.",
    buyFail: "Buy was not sent",
    priceHint: "Enter a list price, for example 0.05",
    priceRange: "Price is outside what the contract accepts",
    notOwner: "This OKX wallet does not own it, so it cannot list",
    approve: "First listing needs market approval. OKX will ask first.",
    approveSent: "Approval submitted {hash}. List again after it confirms.",
    listSent: "Listing submitted {hash}. It shows as for sale only after the market sees it.",
    listFail: "Listing was not sent",
    genBuy: "Buy with OKX",
    genList: "List on official market",
    genScan: "View on BscScan",
    close: "Close",
    refTitle: "Swap",
    refNote: "Tap BEM or OKB to open a real swap. BEM/USDT uses the BSC pool. OKB/BEM uses the X Layer pool. Quotes are on-chain. Nothing is simulated.",
    bemHint: "Swap USDT for BEM",
    okbHint: "Swap OKB for BEM",
    swapTitle: "Swap",
    swapPay: "You pay",
    swapRecv: "You receive",
    swapGo: "Swap with OKX",
    quoteBsc: "Quote is from BSC, 1% slippage. The wallet receipt is final.",
    quoteXl: "Quote is the X Layer pool mid price. Fills must clear at least 95%.",
    swapWait: "Waiting for OKX. Cancel means no swap.",
    swapSent: "Swap submitted. Balances update only after the receipt.",
    swapView: "View transaction",
    swapNeed: "Connect OKX before swapping.",
    bridgeTitle: "Bridge BEM",
    bridgeGo: "Bridge",
    assetsTitle: "Account",
    assetsEmpty: "Not signed in",
    addrOn: "{addr} · connected",
    addrOff: "Wallet not connected",
    balNote: "Balances are this address on BSC and X Layer, not an OKX exchange account.",
    balEmpty: "Log in with OKX to see BNB, OKB, BEM and USDT.",
    holdings: "On-chain assets",
    profileTitle: "Profile",
    nickLabel: "Name",
    avatarLabel: "Avatar",
    nickPh: "Up to 16 characters",
    save: "Save",
    clearAv: "Remove avatar",
    profileHint: "Stored in this browser, only for the connected wallet.",
    connectTitle: "Log in",
    connectLead: "Genesis trades and swaps are signed in OKX Wallet.",
    binance: "Binance Wallet",
    walletWait: "Opening OKX…",
    walletPop: "OKX is open. Confirm in the app.",
    walletFail: "OKX did not connect. Install OKX Wallet, or open this page in the OKX app.",
    binanceFail: "Binance Wallet is not in this browser. Open this page in the Binance app.",
    me: "Me",
    myAssets: "My assets",
    activity: "Activity",
  },
} as const;

export type CopyKey = keyof (typeof COPY)["zh"];

let lang: Lang = "zh";
const listeners = new Set<() => void>();

export function uiLang(): Lang {
  return lang;
}

export function setUiLang(next: Lang) {
  lang = next;
  if (typeof window !== "undefined") window.localStorage.setItem("tape-lang", next);
  listeners.forEach((cb) => cb());
}

export function onLang(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function t(key: CopyKey): string {
  return COPY[lang][key];
}

export function tf(key: CopyKey, vars: Record<string, string | number>): string {
  return t(key).replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? ""));
}

export function applyDom(root: ParentNode) {
  root.querySelectorAll<HTMLElement>("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n as CopyKey | undefined;
    if (key && key in COPY.zh) node.textContent = t(key);
  });
  root.querySelectorAll<HTMLInputElement>("[data-i18n-ph]").forEach((node) => {
    const key = node.dataset.i18nPh as CopyKey | undefined;
    if (key && key in COPY.zh) node.placeholder = t(key);
  });
  if (typeof document !== "undefined") document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
}

export function bootLang() {
  if (typeof window === "undefined") return;
  lang = window.localStorage.getItem("tape-lang") === "en" ? "en" : "zh";
}
