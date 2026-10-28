# TAPELIQUID

BEM and BNB spot, a two-chain perpetual, a TapeOut wafer on X Layer, and TAPE, the processor token.

Spot fills on PancakeSwap V3 (BSC). BEM uses the 1% pool. BNB uses the 0.01% pool and settles as native BNB. The paper book stays in the browser. Each perpetual is one shared contract, so people on that chain can see and take each other's orders. BSC margin is USDT. X Layer margin is USDT0 and gas is OKB. The wafer does not settle PnL. TAPE, its pool, and the wafer and circuit lock are on X Layer. None of those three has an admin.

## Locked addresses

| What | Chain | Address |
|---|---|---|
| Perpetual | BSC | `0xce3511b6e909c9694826cfd5dbe434d457920eba` |
| Perpetual | X Layer | `0xF771BECD373af1d062169E42AB7b3B1fadE2b11b` |
| Mark | X Layer | `0xba5234cd46ec5eB0DFdf4ac329FF42EB3062B4eA` |
| Transistor perpetual | BSC | `0x798637b6d18cE053D69CfC0B08Ead105de352c11` |
| Circuits | X Layer | `0x69F663931209096037474d7C20402232E5C762cA` |
| Transistors | X Layer | `0x3FA393d3081AcCff9E7989619B688235F6d3EE3F` |
| Fee recipient | spot and the three books | `0x823b9F6A93Ac44Ce5A469823A336c15b6117054D` |
| Seal claim | X Layer, BSC | X Layer `0x863AA822fE2EDde5Ae0b8ca949Ed5dd25f772DdD`, BSC `0x864EBcf258855f674255D78195598B2fbFAaB8Db` |
| TAPE | X Layer | `0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3` |
| TAPE mine | X Layer | `0x60b1b7cae1bbd0e84ac3e1e43f933712f3ab67e8` |
| TAPE pool | X Layer | `0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641` |
| Wafer and circuit lock | X Layer | wafer `0xA28390924607F08aaD8d03F512B41b6a1c012Ace`, circuit `0x06c877cc158d9ca3547220f9fc156f39bce7013c` |
| Starter gift | X Layer NAND, BSC BEM | NAND `0x5374DFfD3186FfEDAC46Cc6c9545B9e9e2CEF45b`, BEM `0xa29f86319E66DAdF1e30548bcC593fa91CBB7278` |
| BEM bridge | BSC | `0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72` |
| BEM | X Layer | `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` |

The rulebook is the whitepaper on the site: [/whitepaper](https://trade.yizhantoken.com/whitepaper). It wins over this file. If a rule changes, update the page and this README the same day.

X: https://x.com/TAPELIQUID
Telegram: https://t.me/+JN0c8XGQpIkxNTRh

The fee address on the page, in the contracts, and here is `0x823b9F6A93Ac44Ce5A469823A336c15b6117054D`. The mark accepts a price only from the fee address. Each post moves at most 0.5 percent and waits at least 30 seconds. Settlement uses a 10-minute average. Spot is PancakeSwap on BSC, except OKB, which is PotatoSwap on X Layer. The desk fee is 0.20% of the input, on top of the pool fee. A Circuit Punk card is crafted and confirmed at nft.tapeliquid.net before the same wallet confirms identity at app.tapeliquid.net and trades. The desk fee then falls from 0.20% to copper 0.16% (0.14% on its main desk), silver 0.12% (0.10%), gold 0.08% (0.06%), extreme ultraviolet 0.06% (0.04%), or faux extreme ultraviolet 0.08%. The rebate is claimed once each calendar month, only during the first seven days of the next month, Singapore time, and only while the pool still has a balance. Anyone, including the project, can fund that pool. A missed week is gone. NFT sales stay at the 0.2% already in the Circuit Punk contract. The account page at app.tapeliquid.net only confirms the wallet and shows the rebate. It does not craft and does not change the 0.20% charged on an order. Identity is a personal_sign of tapeliquid-fee-pass plus the Circuit Punks that wallet holds at 0xB5ac1dddc158a639D4499aad2d8F393989D4bD34 on X Layer. The highest valid card wins. A browser confirm on the NFT site is not proof. The rebate is desk fees paid that month times (20 minus the card basis points) divided by 20. Claim once a month, only in the first seven days of the next month, Singapore time, first come first served, from a pool anyone can fund. Until that pool contract exists, show the amount and do not send it.

The two perpetuals are separate contracts. The wafer and tape-out are on X Layer: minting spends OKB, tape-out burns NAND and LATCH and pays the protocol fee (0.0013 OKB), not the desk fee address. One sheet stores at most 18,000 NAND or 30,000 LATCH. A larger netlist reverts and the transistors stay put. TAPE is deployed. Its mine has no admin and emits 7,200 a day from deployment, weighted by gate count. The written schedule, a start at 1,000 and one later change to 7,200, is not in that contract. The TAPE pool and the wafer and circuit lock have no admin, no upgrade, and no rescue. An add that does not match the pool ratio refunds the extra. A circuit cannot be locked twice. Official BEM still bridges at tapeout.net/bridge. This site does not custody that bridge. Official transistor and circuit spot follow the tapeout.net snapshot and settle on BSC; the extra 0.20% is paid first and is not returned if the official fill fails. Account reads balances and prices. It does not custody. Maker rewards and points have not started.

## Run

```bash
npm install
npm run dev
```

Contracts are in `contracts/`. They are not upgradeable. Do not send a key to this repository.
