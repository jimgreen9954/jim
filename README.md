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
| Fee recipient | already deployed spot and the three books | `0x823b9F6A93Ac44Ce5A469823A336c15b6117054D` |
| New factory signer and platform fee | X Layer, not deployed yet | `0x7a2cC9b4dd8302FDD104159CeE97Be8a90BF772c` |
| Seal claim | X Layer, BSC | X Layer `0x863AA822fE2EDde5Ae0b8ca949Ed5dd25f772DdD`, BSC `0x864EBcf258855f674255D78195598B2fbFAaB8Db` |
| TAPE | X Layer | `0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3` |
| TAPE mine | X Layer | `0x60b1b7cae1bbd0e84ac3e1e43f933712f3ab67e8` |
| TAPE pool | X Layer | `0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641` |
| Wafer and circuit lock | X Layer | wafer `0xA28390924607F08aaD8d03F512B41b6a1c012Ace`, circuit `0x06c877cc158d9ca3547220f9fc156f39bce7013c` |
| Starter gift | X Layer NAND, BSC BEM | NAND `0x5374DFfD3186FfEDAC46Cc6c9545B9e9e2CEF45b`, BEM `0xa29f86319E66DAdF1e30548bcC593fa91CBB7278` |
| BEM bridge | BSC | `0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72` |
| BEM | X Layer | `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` |

The rulebook is the whitepaper on the site: [/whitepaper](/whitepaper). It wins over this file. The market now trades genesis circuits on the official TapeOut market and swaps BEM and OKB in official pools, signed by whichever wallet is connected. The top-right control logs in and, once connected, logs out, and can switch BSC or X Layer. TapeCode-Test1 listings are read from OKX and stay folded until opened. Launch proceeds split 30/40/30 inside the factory bytecode: 30% is claimable after the sale closes, 40% buys and burns listings under twice mint, and the last 30% is claimable only after 90 days and three days at or above twice mint, otherwise it is burned on a daily schedule. Anyone can call tick; the caller receives 5% of that spend from inside the day's 1/90, and the site holds no key. Create calls the deployed factory 0x2872E6D6AB14C5Cdb08587b437Bd16248270A04d. Older perpetual and wafer addresses below stay where they were. If a rule changes, update the page and this README the same day.

The new factory is signed and paid by `0x7a2cC9b4dd8302FDD104159CeE97Be8a90BF772c`. That address is a wallet, not a factory contract. Create calls the deployed factory 0x2872E6D6AB14C5Cdb08587b437Bd16248270A04d. Already deployed spot, perpetuals, and the mark still pay `0x823b9F6A93Ac44Ce5A469823A336c15b6117054D`. Those contracts cannot be retargeted. The mark accepts a price only from that old fee address. Each post moves at most 0.5 percent and waits at least 30 seconds. Settlement uses a 10-minute average. Spot is PancakeSwap on BSC, except OKB, which is PotatoSwap on X Layer. The desk fee is 0.20% of the input, on top of the pool fee. The two perpetuals are separate contracts. The wafer and tape-out are on X Layer: minting spends OKB, tape-out burns NAND and LATCH and pays the protocol fee (0.0013 OKB), not the desk fee address. One sheet stores at most 18,000 NAND or 30,000 LATCH. A larger netlist reverts and the transistors stay put. TAPE is deployed. Its mine has no admin and emits 7,200 a day from deployment, weighted by gate count. The written schedule, a start at 1,000 and one later change to 7,200, is not in that contract. The TAPE pool and the wafer and circuit lock have no admin, no upgrade, and no rescue. An add that does not match the pool ratio refunds the extra. A circuit cannot be locked twice. Official BEM still bridges at tapeout.net/bridge. This site does not custody that bridge. Official transistor and circuit trades are signed on this site and settle on the tapeout.net BSC markets. They pay that market's own fee only. The 0.2% desk fee starts when this site's factory secondary is live, and it is not taken before an official fill. Account reads balances and prices. It does not custody. Maker rewards and points have not started.

## Run

```bash
npm install
npm run dev
```

Contracts are in `contracts/`. They are not upgradeable. Do not send a key to this repository.
