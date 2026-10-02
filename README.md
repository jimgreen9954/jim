# TAPELIQUID

BEM spot and a two-chain perpetual, plus a TapeOut wafer on X Layer.

Spot fills on PancakeSwap V3 (BSC). The paper book stays in the browser. Each perpetual is one shared contract, so people on that chain can see and take each other's orders. BSC margin is USDT. X Layer margin is USDT0 and gas is OKB. The wafer does not settle PnL. Mining and the platform token are not deployed.

## Locked addresses

| What | Chain | Address |
|---|---|---|
| Perpetual | BSC | `0xB98D14333a93D49a4E05478d002FC3944D88A3b7` |
| Perpetual | X Layer | `0xa0344f5B0518D31B7CFa6CaC266b4eDd289821ce` |
| Mark | X Layer | `0xc35C8cB9FFaC92F25cAFaEdC82F03144b24bCb1d` |
| Circuits | X Layer | `0x69F663931209096037474d7C20402232E5C762cA` |
| Transistors | X Layer | `0x3FA393d3081AcCff9E7989619B688235F6d3EE3F` |
| Fee recipient | both books | `0xb67741A0463779c0dab3fDCFE883bA7572AC0AC2` |

The rulebook on the site is the whitepaper page. It wins over this file.

## Run

```bash
npm install
npm run dev
```

Contracts are in `contracts/`. They are not upgradeable. Do not send a key to this repository.
