// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// One perp fill can pay one red packet. A packet marks the fill here.
/// Only the runtime the multisig has allowed can mark one.
contract RedStamp {
    address public constant BSC_SAFE = 0xE51C19aE6E4261Ed329CC54F1120Cf0Ae09364Bd;
    address public constant X_SAFE = 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c;
    mapping(bytes32 => bool) public ok;
    mapping(bytes32 => bool) public used;

    function allow(bytes32 codehash) external {
        require(msg.sender == BSC_SAFE || msg.sender == X_SAFE, "safe");
        ok[codehash] = true;
    }

    /// Stops one packet version. A fill already marked stays marked.
    function revoke(bytes32 codehash) external {
        require(msg.sender == BSC_SAFE || msg.sender == X_SAFE, "safe");
        ok[codehash] = false;
    }

    function take(address book, uint256 id) external {
        require(ok[keccak256(msg.sender.code)], "code");
        bytes32 key = keccak256(abi.encode(book, id));
        require(!used[key], "used");
        used[key] = true;
    }
}
