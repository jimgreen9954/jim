# TAPELIQUID

BEM and BNB spot, a two-chain perpetual, a TapeOut wafer on X Layer, and TAPE, the processor token.

Spot fills on PancakeSwap V3 (BSC). BEM uses the 1% pool. BNB uses the 0.01% pool and settles as native BNB. The paper book stays in the browser. Each perpetual is one shared contract, so people on that chain can see and take each other's orders. BSC margin is USDT. X Layer margin is USDT0 and gas is OKB. The wafer does not settle PnL. TAPE is deployed on X Layer. Its mine pays by gate count. Locks and the opening pool are not contracts yet.

## Locked addresses

| What | Chain | Address |
|---|---|---|
| Perpetual | BSC | `0xce3511b6e909c9694826cfd5dbe434d457920eba` |
| Perpetual | X Layer | `0x0f22b18b67477886311ee0fb7cf684d3f48c5eca` |
| Transistor perpetual | BSC | `0xc075443ab7ebef86fe044be2c93a4ff4376ffe0b` |
| Mark | X Layer | `0xc35C8cB9FFaC92F25cAFaEdC82F03144b24bCb1d` |
| Circuits | X Layer | `0x69F663931209096037474d7C20402232E5C762cA` |
| Transistors | X Layer | `0x3FA393d3081AcCff9E7989619B688235F6d3EE3F` |
| Fee recipient | spot and the three books | `0x823b9F6A93Ac44Ce5A469823A336c15b6117054D` |
| TAPE | X Layer | `0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3` |
| TAPE mine | X Layer | `0x60b1b7cae1bbd0e84ac3e1e43f933712f3ab67e8` |
| BEM bridge | BSC | `0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72` |
| BEM | X Layer | `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` |

The rulebook is the whitepaper on the site: [/whitepaper](https://trade.yizhantoken.com/whitepaper). It wins over this file. If a rule changes, update the page and this README the same day.

The fee address on the page, in the contracts, and here is `0x823b9F6A93Ac44Ce5A469823A336c15b6117054D`. `0xb67741A0463779c0dab3fDCFE883bA7572AC0AC2` is retired. Spot is PancakeSwap on BSC, except OKB, which is PotatoSwap on X Layer. The desk fee is 0.20% of the input, on top of the pool fee. The two perpetuals are separate contracts. The wafer and tape-out are on X Layer: minting spends OKB, tape-out burns NAND and LATCH and pays the protocol fee (0.0013 OKB), not the desk fee address. One sheet stores at most 18,000 NAND or 30,000 LATCH. A larger netlist reverts and the transistors stay put. TAPE is deployed. Its mine emits 7,200 a day from deployment, weighted by gate count. The written schedule, a start at 1,000 and one later change to 7,200, is not in that contract. Locks, the opening pool, buyback, and a TAPE bridge are not contracts yet. Official BEM still bridges at tapeout.net/bridge. This site does not custody that bridge. Official transistor and circuit spot follow the tapeout.net snapshot and settle on BSC; the extra 0.20% is paid first and is not returned if the official fill fails. Account reads balances and prices. It does not custody. Maker rewards and points have not started.

## Run

```bash
npm install
npm run dev
```

Contracts are in `contracts/`. They are not upgradeable. Do not send a key to this repository.
