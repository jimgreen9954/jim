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
    uint256 public spotNeed;
    uint256 public perpNeed;
    uint8 public gate;
    bool public ready;
    mapping(address => uint256) public credit;
    struct Lot { address who; uint256 left; }
    Lot[] private lots;
    uint256 private head;
    mapping(address => uint256) public lastDay;

    event Claimed(address indexed who, uint256 indexed day, uint256 amount);
    event Funded(address indexed from, uint256 amount);
    event RuleSet(address token, uint8 mode, uint256 fixedAmt, uint256 lo, uint256 hi, uint256 packets, uint256 dayCap, uint256 spotNeed, uint256 perpNeed, uint8 gate);

    constructor(address deployer_) {
        deployer = deployer_;
    }

    function deposit(uint256 amount) external {
        require(token != address(0) && amount > 0, "token");
        _pull(token, msg.sender, amount);
        _note(msg.sender, amount);
        emit Funded(msg.sender, amount);
    }

    function depositNative() external payable {
        require(token == address(0) && msg.value > 0, "native");
        _note(msg.sender, msg.value);
        emit Funded(msg.sender, msg.value);
    }

    function setRule(
        address token_,
        uint8 mode_,
        uint256 fixedAmt_,
        uint256 lo_,
        uint256 hi_,
        uint256 packets_,
        uint256 dayCap_,
        uint256 spotNeed_,
        uint256 perpNeed_,
        uint8 gate_
    ) external {
        require(msg.sender == deployer, "deployer");
        require(mode_ < 3 && gate_ < 2, "mode");
        if (mode_ == 1) require(hi_ >= lo_ && lo_ > 0, "range");
        if (mode_ == 0) require(fixedAmt_ > 0, "amount");
        if (mode_ == 2) require(packets_ > 0, "packets");
        if (token_ != token && _balance() > 0) revert("dust");
        token = token_;
        mode = mode_;
        fixedAmt = fixedAmt_;
        lo = lo_;
        hi = hi_;
        packetsLeft = packets_;
        dayCap = dayCap_;
        spotNeed = spotNeed_;
        perpNeed = perpNeed_;
        gate = gate_;
        ready = true;
        emit RuleSet(token_, mode_, fixedAmt_, lo_, hi_, packets_, dayCap_, spotNeed_, perpNeed_, gate_);
    }

    function withdraw(uint256 amount) external {
        require(amount > 0 && credit[msg.sender] >= amount, "credit");
        uint256 left = amount;
        for (uint256 i = head; i < lots.length && left > 0; i++) {
            if (lots[i].who != msg.sender || lots[i].left == 0) continue;
            uint256 use = lots[i].left > left ? left : lots[i].left;
            lots[i].left -= use;
            left -= use;
        }
        require(left == 0, "lot");
        credit[msg.sender] -= amount;
        _push(msg.sender, amount);
    }

    function claim() external {
        require(ready, "rule");
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
        _eat(pay);
        _push(msg.sender, pay);
        emit Claimed(msg.sender, day, pay);
    }

    /// Yesterday's count must not look like today's.
    function claimsToday(uint256 ts) external view returns (uint256) {
        return cursor == sgDay(ts) ? claimedToday : 0;
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

    function _note(address who, uint256 amount) internal {
        credit[who] += amount;
        lots.push(Lot(who, amount));
    }

    function _eat(uint256 amount) internal {
        uint256 left = amount;
        uint256 i = head;
        while (left > 0 && i < lots.length) {
            if (lots[i].left == 0) {
                i++;
                continue;
            }
            uint256 use = lots[i].left > left ? left : lots[i].left;
            lots[i].left -= use;
            credit[lots[i].who] -= use;
            left -= use;
            if (lots[i].left == 0) i++;
        }
        require(left == 0, "credit");
        head = i;
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
