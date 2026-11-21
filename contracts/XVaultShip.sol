// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "./TapeVault.sol";

/// One multisig transaction. A new X Layer copy vault bound to the live BEM book.
/// The page keeps reading the old vault until this address is checked on chain.
contract XVaultShip {
    address public constant USDT0 = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public constant BOOK = 0x46cBAfCA59873E7115dF7825fdBF659BafAc3a51;
    address public constant SAFE = 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c;
    uint16 public constant FEE = 1000;

    event Shipped(address indexed vault);

    constructor() {
        TapeVault vault = new TapeVault(USDT0, BOOK, SAFE, FEE);
        emit Shipped(address(vault));
    }
}
