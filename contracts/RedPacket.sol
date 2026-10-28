// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// Anyone may fund the asset the deployer selected. Anyone may claim once per Singapore day.
/// The deployer, set at construction, is the only address that can change the game.
contract RedPacket {
    address public immutable deployer;
    address public token;
    uint8 public mode;
    uint256 public fixedAmt;
    uint256 public lo;
    uint256 public hi;
    uint256 public packetsLeft;
    uint256 public dayCap;
    uint256 public cursor;
    uint256 public claimedToday;
    mapping(address => uint256) public lastDay;

    constructor(address deployer_) {
        deployer = deployer_;
    }

    function deposit(uint256 amount) external {
        require(token != address(0) && amount > 0, "token");
        _pull(token, msg.sender, amount);
    }

    function depositNative() external payable {
        require(token == address(0) && msg.value > 0, "native");
    }

    function setRule(
        address token_,
        uint8 mode_,
        uint256 fixedAmt_,
        uint256 lo_,
        uint256 hi_,
        uint256 packets_,
        uint256 dayCap_
    ) external {
        require(msg.sender == deployer, "deployer");
        require(mode_ < 3, "mode");
        if (mode_ == 1) require(hi_ >= lo_ && lo_ > 0, "range");
        if (mode_ == 0) require(fixedAmt_ > 0, "amount");
        if (token_ != token && _balance() > 0) revert("dust");
        token = token_;
        mode = mode_;
        fixedAmt = fixedAmt_;
        lo = lo_;
        hi = hi_;
        packetsLeft = packets_;
        dayCap = dayCap_;
    }

    function claim() external {
        uint256 day = sgDay(block.timestamp);
        require(lastDay[msg.sender] != day, "day");
        if (cursor != day) {
            cursor = day;
            claimedToday = 0;
        }
        require(dayCap == 0 || claimedToday < dayCap, "cap");
        uint256 bal = _balance();
        uint256 pay = mode == 0 ? _fixed(bal) : mode == 1 ? _range(bal) : _lucky(bal);
        require(pay > 0 && pay <= bal, "empty");
        lastDay[msg.sender] = day;
        claimedToday += 1;
        if (mode == 2 && packetsLeft > 0) packetsLeft -= 1;
        _push(msg.sender, pay);
    }

    function sgDay(uint256 ts) public pure returns (uint256) {
        return (ts + 8 hours) / 1 days;
    }

    function _fixed(uint256 bal) internal view returns (uint256) {
        return fixedAmt <= bal ? fixedAmt : 0;
    }

    function _range(uint256 bal) internal view returns (uint256) {
        uint256 top = hi > bal ? bal : hi;
        if (lo > top) return 0;
        if (lo == top) return lo;
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, msg.sender, claimedToday, bal)));
        return lo + (seed % (top - lo + 1));
    }

    function _lucky(uint256 bal) internal view returns (uint256) {
        if (packetsLeft == 0 || bal == 0) return 0;
        if (packetsLeft == 1) return bal;
        uint256 keep = packetsLeft - 1;
        if (bal <= keep) return 0;
        uint256 cap = (bal / packetsLeft) * 2;
        uint256 room = bal - keep;
        if (cap > room) cap = room;
        if (cap == 0) return 0;
        uint256 seed = uint256(keccak256(abi.encodePacked(block.prevrandao, msg.sender, packetsLeft, bal)));
        return 1 + (seed % cap);
    }

    function _balance() internal view returns (uint256) {
        if (token == address(0)) return address(this).balance;
        return IERC20(token).balanceOf(address(this));
    }

    function _pull(address erc, address from, uint256 amount) internal {
        (bool ok, bytes memory data) = erc.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "pull");
    }

    function _push(address to, uint256 amount) internal {
        if (token == address(0)) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "push");
            return;
        }
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "push");
    }
}
