// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./FabCapMark.sol";
import "./TierTapeRisk.sol";

/// One multisig transaction. Deploys the FAB mark and the tiered book.
/// The page does not switch to these addresses until they are checked.
contract FabCapShip {
    address public constant STATE_VIEW = 0x76Fd297e2D437cd7f76d50F01AfE6160f86e9990;
    address public constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address public constant FAB = 0x72F349B1Eee7833B26f8C81a8410775A4e231ed2;
    address public constant BEM_POOL = 0x2CcF8aa17F5DF9Fb5D51C9de12135a913fF29f7A;
    address public constant OKB_POOL = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;
    address public constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public constant SAFE = 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c;

    event Shipped(address indexed mark, address indexed book);

    constructor() {
        bytes32 id = keccak256(abi.encode(BEM, FAB, uint24(9000), int24(180), address(0)));
        FabCapMark mark = new FabCapMark(STATE_VIEW, BEM_POOL, OKB_POOL, id);
        TierTapeRisk book = new TierTapeRisk(USDT0, address(mark), 1e6, SAFE);
        emit Shipped(address(mark), address(book));
    }
}
