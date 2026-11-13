# TAPELIQUID

BEM and BNB spot, two-chain perpetuals, a TapeOut wafer on X Layer, and TAPE, the only platform token.

Spot on BSC uses PancakeSwap. OKB uses PotatoSwap on X Layer and pays USDT0. The desk fee is 0.20% of the amount paid, on top of the pool fee, in the same confirmation as the swap. New desk fees go to that chain's multisig. Older pools and the previous perpetual still pay the old fee address. A new contract can be deployed only by that chain's multisig.

The rulebook is the live page: [app.tapeliquid.net/whitepaper](https://app.tapeliquid.net/whitepaper). The same text is in [TAPELIQUID-white-paper](https://github.com/jimgreen9954/TAPELIQUID-white-paper). If the page and this file disagree, the page and the chain win.

## Live addresses

Taken from the site on 13 November 2026.

| What | Chain | Address |
|---|---|---|
| Multisig | BSC | `0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd` |
| Multisig | X Layer | `0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c` |
| Old fee address, previous books only | BSC | `0x823b9F6A93Ac44Ce5A469823A336c15b6117054D` |
| Old trade lock, cancel approval, do not use | both | `0xC5A63E4c37c23F97558673731196abC30FBFa659` |
| BEM perpetual, live | BSC | `0xdA4aA9E0aaad6F91835cD19345D49a8fcA8d019A` |
| BEM perpetual, previous | BSC | `0xce3511b6e909c9694826cfd5dbe434d457920eba` |
| BEM perpetual, live | X Layer | `0xE8Ed0fE7a7aaEF822b2e5Ce9679ccACcF3aEFF56` |
| BEM perpetual, previous | X Layer | `0xCAC69F02c06bfCa3bFDb1eaF1F4a60e17e718081` |
| Mark, live | X Layer | `0xb4B2ee90D10ECfC7ed36A58e96e03074fA8731Eb` |
| Mark, previous | X Layer | `0xba5234cd46ec5eB0DFdf4ac329FF42EB3062B4eA` |
| Bitcoin perpetual | BSC | `0x81A35fDaaEe7dE3dcDa195F312279Bb2aDc0b8B4` |
| ETH perpetual | BSC | `0x564C9f5aa89430ca4f2945b466e34BE8705ee0B8` |
| ZEC perpetual | BSC | `0xdAd8E211ec6c8b43eCe19Da2519C9505CDCbF229` |
| UP perpetual, live | BSC | `0x7aaf00Dab91e0e6dDDb6093323D0140c11C55aD3` |
| UP perpetual, previous | BSC | `0x5f913f7AFa71c51d69F472b0fE4c3EC74b1132F8` |
| UP mark | BSC | `0xB1e9FCCa14429b067466bd67bbF68939230d0678` |
| TAPE perpetual | X Layer | `0x9b17D0F6431957661AdD30051de2615cb08A3886` |
| FAB perpetual | X Layer | `0x6Bd480BF658FaB7A2cb758c0408A7b3B5B94B431` |
| Transistor perpetual | BSC | `0x2b909Ecc36a24D3dD3695a38B11Cb40302454899` |
| TAPE | X Layer | `0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3` |
| TAPE mine | X Layer | `0x60b1b7cae1bbd0e84ac3e1e43f933712f3ab67e8` |
| TAPE pool, live | X Layer | `0x58eaD5b41Cfd3627791D439402dd65571c286484` |
| TAPE pool, previous | X Layer | `0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641` |
| Workshop spot, live | X Layer | `0x68F66fAf7b29E30D0740934F81EB266F6ff17428` |
| Workshop spot, previous | X Layer | `0x154E82c6a2ac121906D29af0EE81131E93B57860` |
| Wafer lock | X Layer | `0xA28390924607F08aaD8d03F512B41b6a1c012Ace` |
| Circuit lock | X Layer | `0x06c877cc158d9ca3547220f9fc156f39bce7013c` |
| Buyback | X Layer | `0x53fa6A76ce9A3fE08698E04a4E9A674bd77a9DfF` |
| Timed stake, live | X Layer | `0x9D603A45321a3aDbFcAD0E49Fd944Cc281Baa833` |
| Timed stake, previous | X Layer | `0x957a7CC82D42C31E79Ee4C668898AA30EC259c0A` |
| Term book | X Layer | `0x683fb58ee77172626D5B49087DdAc71eF7825d20` |
| Term book | BSC | `0xBa427D94b001FA1cf0f85E1E54c1E392e9a07610` |
| Lend, OKB | X Layer | `0x57228158cba08c61710ab2644e583c328ec86ea7` |
| Lend, TAPE | X Layer | `0x425285da21ed3eabe64550d1be7dcabcf6f9e851` |
| Lend, BEM | X Layer | `0x5ed8551f90acc6395810d8274b019bf13ef1f696` |
| Lend, BNB | BSC | `0xd8d981d32b12ea85b739bb667946975d25b0ab53` |
| Lend, BEM | BSC | `0xd2c7150f7779ded403c3f81a68dab5164b54df28` |
| Circuits | X Layer | `0x69F663931209096037474d7C20402232E5C762cA` |
| Transistors | X Layer | `0x3FA393d3081AcCff9E7989619B688235F6d3EE3F` |
| BEM bridge | BSC | `0xa84B8D3893De6e9922f2B29bE1e1b115845F5E72` |
| BEM | BSC | `0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a` |
| BEM | X Layer | `0x60e62Efa9405d6873C5deaBD4E6CC91c25363952` |

The mine emits 7,200 TAPE a day from deployment. It has no admin and no rate switch. The cap is 21,000,000. Circuit Punk cards are made at nft.tapeliquid.net. The same wallet then confirms identity at app.tapeliquid.net. An order still charges 0.20% until the monthly rebate is claimed.

X: https://x.com/TAPELIQUID
Telegram: https://t.me/+JN0c8XGQpIkxNTRh

## Run

```bash
npm install
npm run dev
```

Contracts are in `contracts/`. They are not upgradeable. Do not send a key to this repository.
