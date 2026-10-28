// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

interface IPunk {
    function balanceOf(address account) external view returns (uint256);
}

/// Desk fee still leaves this contract in full. The safe is only the forward address.
/// A deposit can be withdrawn by that depositor alone. A claim spends deposits first, oldest first.
contract CardPool {
    IERC20 public immutable token;
    address public immutable safe;
    IPunk public immutable punk;
    uint256 public lotHead;

    struct Lot {
        address who;
        uint256 left;
    }

    Lot[] public lots;
    mapping(address => uint256) public credit;
    mapping(address => mapping(uint256 => mapping(uint8 => uint256))) public paid;
    mapping(address => mapping(uint256 => uint256)) public claimed;
    mapping(address => mapping(uint256 => bool)) public didClaim;

    constructor(address token_, address safe_, address punk_) {
        token = IERC20(token_);
        safe = safe_;
        punk = IPunk(punk_);
    }

    function deposit(uint256 amount) external {
        require(amount > 0, "amount");
        _pull(msg.sender, amount);
        credit[msg.sender] += amount;
        lots.push(Lot(msg.sender, amount));
    }

    function withdraw(uint256 amount) external {
        require(amount > 0 && credit[msg.sender] >= amount, "credit");
        credit[msg.sender] -= amount;
        _reduceLots(msg.sender, amount);
        _push(msg.sender, amount);
    }

    /// Records a desk fee and forwards the same amount to the multisig. The rate is not cut here.
    function pay(uint8 desk, uint256 amount) external {
        require(desk < 4 && amount > 0, "desk");
        _pull(msg.sender, amount);
        paid[msg.sender][monthOf(block.timestamp)][desk] += amount;
        _push(safe, amount);
    }

    function claim(uint256 month, uint16[4] calldata bps) external {
        require(!didClaim[msg.sender][month], "once");
        require(inWindow(month), "window");
        _bps(bps);
        uint256 owed = _owed(msg.sender, month, bps);
        require(owed > 0, "none");
        uint256 have = token.balanceOf(address(this));
        uint256 payOut = owed > have ? have : owed;
        require(payOut > 0, "empty");
        didClaim[msg.sender][month] = true;
        claimed[msg.sender][month] = payOut;
        _consume(payOut);
        _push(msg.sender, payOut);
    }

    function monthOf(uint256 ts) public pure returns (uint256) {
        (uint256 y, uint256 m, ) = _civil(ts);
        return y * 12 + m;
    }

    function dayOf(uint256 ts) public pure returns (uint256) {
        (, , uint256 d) = _civil(ts);
        return d;
    }

    function inWindow(uint256 month) public view returns (bool) {
        uint256 cur = monthOf(block.timestamp);
        if (month + 1 != cur) return false;
        uint256 day = dayOf(block.timestamp);
        return day >= 1 && day < 8;
    }

    function owed(address who, uint256 month, uint16[4] calldata bps) external view returns (uint256) {
        _bps(bps);
        return _owed(who, month, bps);
    }

    function _owed(address who, uint256 month, uint16[4] calldata bps) internal view returns (uint256) {
        uint256 sum;
        for (uint8 desk; desk < 4; desk++) {
            if (bps[desk] >= 20) continue;
            sum += paid[who][month][desk] * (20 - bps[desk]) / 20;
        }
        return sum;
    }

    function _bps(uint16[4] calldata bps) internal view {
        bool copper = _shape(bps, 16, 14);
        bool silver = _shape(bps, 12, 10);
        bool gold = _shape(bps, 8, 6);
        bool euv = _shape(bps, 6, 4);
        bool faux = _shape(bps, 8, 8);
        require(copper || silver || gold || euv || faux, "bps");
        if (address(punk) == address(0)) return;
        uint256 held = punk.balanceOf(msg.sender);
        if (faux) require(held >= 20, "punk");
        else if (euv || gold || silver) require(held >= 3, "punk");
        else require(held >= 2, "punk");
    }

    function _shape(uint16[4] calldata bps, uint16 all, uint16 main) internal pure returns (bool) {
        uint256 mains;
        for (uint256 i; i < 4; i++) {
            if (bps[i] == all) continue;
            if (bps[i] == main && all != main) {
                mains++;
                continue;
            }
            return false;
        }
        return mains <= 1;
    }

    function _reduceLots(address who, uint256 amount) internal {
        uint256 left = amount;
        for (uint256 i = lotHead; i < lots.length && left > 0; i++) {
            if (lots[i].who != who || lots[i].left == 0) continue;
            uint256 take = lots[i].left > left ? left : lots[i].left;
            lots[i].left -= take;
            left -= take;
        }
        require(left == 0, "lots");
    }

    function _consume(uint256 amount) internal {
        uint256 left = amount;
        while (left > 0 && lotHead < lots.length) {
            Lot storage lot = lots[lotHead];
            if (lot.left == 0) {
                lotHead++;
                continue;
            }
            uint256 take = lot.left > left ? left : lot.left;
            lot.left -= take;
            credit[lot.who] -= take;
            left -= take;
            if (lot.left == 0) lotHead++;
        }
    }

    function _pull(address from, uint256 amount) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "pull");
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20.transfer.selector, to, amount)
        );
        require(ok && (data.length == 0 || abi.decode(data, (bool))), "push");
    }

    function _civil(uint256 ts) internal pure returns (uint256 y, uint256 m, uint256 d) {
        uint256 z = (ts + 8 hours) / 1 days + 719468;
        uint256 era = z / 146097;
        uint256 doe = z - era * 146097;
        uint256 yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
        y = yoe + era * 400;
        uint256 doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
        uint256 mp = (5 * doy + 2) / 153;
        d = doy - (153 * mp + 2) / 5 + 1;
        m = mp < 10 ? mp + 3 : mp - 9;
        if (m <= 2) y += 1;
    }
}
