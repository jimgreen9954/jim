// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TapeSyncMark.sol";
import "./SyncTierTapeRisk.sol";

/// One multisig transaction. Deploys the TAPE mark and the tiered book.
/// The page does not switch to these addresses until they are checked.
/// CAP is 40 USDT0 of entry notional. Moving the official pool 3% took about
/// 45 USDT0 of inventory when this was set. A round trip lost about 0.67 USDT0,
/// so one round trip can still be cheaper than a full book. The pool is thin.
contract TapeSyncShip {
    address public constant TAPE_POOL = 0x58eaD5b41Cfd3627791D439402dd65571c286484;
    address public constant OKB_POOL = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;
    address public constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public constant SAFE = 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c;
    uint256 public constant CAP = 40_000_000;

    event Shipped(address indexed mark, address indexed book);

    constructor() {
        TapeSyncMark mark = new TapeSyncMark(TAPE_POOL, OKB_POOL);
        SyncTierTapeRisk book = new SyncTierTapeRisk(USDT0, address(mark), 1e6, SAFE, CAP);
        emit Shipped(address(mark), address(book));
    }
}
