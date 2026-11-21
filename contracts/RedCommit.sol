// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
}

/// A new red packet. The draw is the block hash of the block the claimer entered.
/// That hash does not exist yet when they enter, so it cannot be precomputed from prevrandao.
/// Anyone can settle an entry. The claimer cannot skip a small draw after seeing it.
/// The live RedPacket contracts are not replaced by this one.
contract RedCommit {
    IERC20 public immutable token;
    address public immutable desk;
    uint256 public lo;
    uint256 public hi;
    uint256 public left;
    uint256 public pending;
    bool public armed;
    mapping(address => uint256) public enteredAt;
    mapping(address => bool) public paid;

    error Bad();

    constructor(address token_, address desk_) {
        if (token_ == address(0) || desk_ == address(0)) revert Bad();
        token = IERC20(token_);
        desk = desk_;
    }

    function arm(uint256 lo_, uint256 hi_, uint256 count_) external {
        if (msg.sender != desk || armed || lo_ == 0 || hi_ < lo_ || count_ == 0) revert Bad();
        lo = lo_;
        hi = hi_;
        left = count_;
        armed = true;
    }

    function enter() external {
        if (!armed || enteredAt[msg.sender] != 0 || paid[msg.sender] || left == 0 || pending >= left) revert Bad();
        enteredAt[msg.sender] = block.number;
        pending += 1;
    }

    function settle(address who) external {
        uint256 at = enteredAt[who];
        if (at == 0 || paid[who] || block.number <= at || left == 0) revert Bad();
        bytes32 hash = blockhash(at);
        if (hash == bytes32(0)) revert Bad();
        uint256 span = hi - lo + 1;
        uint256 draw = lo + (uint256(keccak256(abi.encode(hash, who))) % span);
        paid[who] = true;
        pending -= 1;
        left -= 1;
        if (!token.transfer(who, draw)) revert Bad();
    }

    /// The block hash is only available for 256 blocks. An expired entry can be cleared and tried again.
    function drop(address who) external {
        uint256 at = enteredAt[who];
        if (at == 0 || paid[who] || block.number <= at + 256) revert Bad();
        enteredAt[who] = 0;
        pending -= 1;
    }
}
