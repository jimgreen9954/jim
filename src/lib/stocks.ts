export const STOCKS = {
  spy: { zh: "标普", en: "SPY", token: "0x7138b48df7D98D7e3cc221BfE7192D0a178182D8", pool: "0x7aa6d92fc369a8c1edc631a3aac44efb0808ddbf", fee: 100, assetIsToken0: false },
  qqq: { zh: "纳指", en: "QQQ", token: "0x205812CdBed920aFf76C6580abD681a46D11efc7", pool: "0xe531fcb1F5a195de7608B9F4f9518544C2cdB693", fee: 100, assetIsToken0: true },
  aapl: { zh: "苹果", en: "AAPL", token: "0x431a3BEE82E2ca41e49895CbECE5bB0F76A89b7A", pool: "0xe9b9998b2ec5430d2246c7f1f8d9f298c97d7365", fee: 2500, assetIsToken0: true },
  nvda: { zh: "英伟达", en: "NVDA", token: "0x02Fca66C1D1aFB4E2A7884261eB00F63598a7436", pool: "0x8fb4243b553ac29ba088acf00b9b7da24bd6690c", fee: 2500, assetIsToken0: true },
  intc: { zh: "英特尔", en: "INTC", token: "0xe614E2fc6C787035FF51f452e8E826Bfd32D5283", pool: "0x4dD8e7C67033Ef4A745bB9f82a7C57c676eB2481", fee: 2500, assetIsToken0: false },
  msft: { zh: "微软", en: "MSFT", token: "0x80106cb3EAD06659A5ad19DF39D9b4733863B9b0", pool: "0x5018b018cEB7645c927c5Cf246786F89ebCbe7Ea", fee: 2500, assetIsToken0: false },
  tsla: { zh: "特斯拉", en: "TSLA", token: "0x5b1910eAaD6450E50f816082Aa078C41F10C292f", pool: "0xb0f5e5400e8f0f7c242f2b7740c004f020579c41", fee: 2500, assetIsToken0: false },
  spcx: { zh: "SpaceX", en: "SPCX", token: "0xbe9D156892E55e7154BcD3cB0FEA677F9D3103E1", pool: "0x977DaFFC095b33872E2741c19568925015C35b4d", fee: 2500, assetIsToken0: false },
  googl: { zh: "谷歌", en: "GOOGL", token: "0x3F53De71c126BdaBAe20f9cD64848d317f6C3238", pool: "0x89001d846f7ca36ee089f73eefc25657e1798144", fee: 2500, assetIsToken0: true },
} as const;

export type StockKey = keyof typeof STOCKS;
export const STOCK_KEYS = Object.keys(STOCKS) as StockKey[];
