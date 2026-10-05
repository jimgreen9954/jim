# TAPELIQUID

BEM and BNB spot, a two-chain perpetual, plus a TapeOut wafer on X Layer.

Spot fills on PancakeSwap V3 (BSC). BEM uses the 1% pool. BNB uses the 0.01% pool and settles as native BNB. The paper book stays in the browser. Each perpetual is one shared contract, so people on that chain can see and take each other's orders. BSC margin is USDT. X Layer margin is USDT0 and gas is OKB. The wafer does not settle PnL. Mining and the platform token are not deployed.

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

The rulebook on the site is the whitepaper page. It wins over this file.

## Run

```bash
npm install
npm run dev
```

Contracts are in `contracts/`. They are not upgradeable. Do not send a key to this repository.
