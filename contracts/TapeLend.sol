// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TickMath.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256) external;
}

interface IPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
}

/// Isolated USDT lending.
/// Collateral is the gas token of this chain, wrapped inside the contract.
/// Price is a 30-minute pool average, rounded down. There is no owner and no rescue.
contract TapeLend {
    IERC20 public immutable usdt;
    address public immutable coll;
    IPool public immutable pool;

    uint256 public constant LTV = 5000;
    uint256 public constant LIQ = 7500;
    uint256 public constant BONUS = 500;
    uint32 public constant WINDOW = 1800;
    uint256 public constant YEAR = 365 days;
    uint256 public constant CAP = 1_000_000 ether;
    uint256 private constant DEAD = 1_000_000;
    uint256 private constant DUST = 1_000;

    uint256 public totalShares;
    uint256 public totalBorrow;
    uint256 public totalDebtShares;
    uint256 public lastAccrue;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public debtShares;
    mapping(address => uint256) public collateral;

    uint256 private entered = 1;
    error Bad();

    modifier guarded() {
        if (entered != 1) revert Bad();
        entered = 2;
        _;
        entered = 1;
    }

    constructor(address usdt_, address coll_, address pool_) {
        if (usdt_ == address(0) || coll_ == address(0) || pool_ == address(0)) revert Bad();
        if (IPool(pool_).token0() != usdt_ || IPool(pool_).token1() != coll_) revert Bad();
        usdt = IERC20(usdt_);
        coll = coll_;
        pool = IPool(pool_);
        lastAccrue = block.timestamp;
    }

    receive() external payable {
        if (msg.sender != coll) revert Bad();
    }

    function cash() public view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    function assets() public view returns (uint256) {
        return cash() + totalBorrow;
    }

    function deposit(uint256 amount) external guarded {
        if (amount == 0) revert Bad();
        _accrue();
        uint256 minted = amount * (totalShares + DEAD) / (assets() + DUST);
        if (minted == 0) revert Bad();
        _pull(usdt, msg.sender, amount);
        shares[msg.sender] += minted;
        totalShares += minted;
    }

    function withdraw(uint256 shareAmt) external guarded {
        if (shareAmt == 0 || shareAmt > shares[msg.sender] || totalShares == 0) revert Bad();
        _accrue();
        uint256 out = shareAmt * (assets() + DUST) / (totalShares + DEAD);
        if (out == 0 || out > cash()) revert Bad();
        shares[msg.sender] -= shareAmt;
        totalShares -= shareAmt;
        _push(usdt, msg.sender, out);
    }

    function lock(uint256 amount) external guarded {
        if (amount == 0) revert Bad();
        _add(msg.sender, amount);
        _pull(IERC20(coll), msg.sender, amount);
    }

    function lockNative() external payable guarded {
        if (msg.value == 0) revert Bad();
        _add(msg.sender, msg.value);
        IWETH(coll).deposit{value: msg.value}();
    }

    function unlock(uint256 amount) external guarded {
        if (amount == 0 || amount > collateral[msg.sender]) revert Bad();
        _accrue();
        collateral[msg.sender] -= amount;
        _solvent(msg.sender);
        IWETH(coll).withdraw(amount);
        (bool ok, ) = msg.sender.call{value: amount}("");
        if (!ok) revert Bad();
    }

    function borrow(uint256 amount) external guarded {
        if (amount == 0 || amount > cash()) revert Bad();
        _accrue();
        uint256 debt = _debt(msg.sender);
        uint256 room = _usdt(collateral[msg.sender]) * LTV / 10000;
        if (debt + amount > room) revert Bad();
        uint256 minted = totalDebtShares == 0 || totalBorrow == 0 ? amount : amount * totalDebtShares / totalBorrow;
        if (minted == 0) revert Bad();
        debtShares[msg.sender] += minted;
        totalDebtShares += minted;
        totalBorrow += amount;
        _push(usdt, msg.sender, amount);
    }

    function repay(uint256 amount) external guarded {
        _accrue();
        uint256 have = debtShares[msg.sender];
        uint256 debt = _debt(msg.sender);
        if (have == 0 || debt == 0 || amount == 0) revert Bad();
        uint256 pay = amount >= debt ? debt : amount;
        uint256 burn = amount >= debt ? have : pay * totalDebtShares / totalBorrow;
        if (burn == 0 || burn > have) revert Bad();
        _pull(usdt, msg.sender, pay);
        debtShares[msg.sender] = have - burn;
        totalDebtShares -= burn;
        totalBorrow -= pay;
        if (totalDebtShares == 0) totalBorrow = 0;
    }

    /// Repay someone's debt and take their collateral plus 5%.
    /// If the collateral cannot cover the debt, the shortfall is written off the lenders.
    function liquidate(address user, uint256 amount) external guarded {
        if (user == address(0) || amount == 0) revert Bad();
        _accrue();
        uint256 have = debtShares[user];
        uint256 debt = _debt(user);
        uint256 posted = collateral[user];
        if (have == 0 || debt == 0 || posted == 0) revert Bad();
        if (debt * 10000 <= _usdt(posted) * LIQ) revert Bad();
        uint256 cover = _usdt(posted * 10000 / (10000 + BONUS));
        uint256 maxPay = cover < debt ? cover : debt;
        uint256 pay = amount < maxPay ? amount : maxPay;
        if (pay == 0) revert Bad();
        uint256 seize = _coll(pay * (10000 + BONUS) / 10000);
        if (seize == 0) revert Bad();
        if (seize > posted) seize = posted;
        _pull(usdt, msg.sender, pay);
        collateral[user] = posted - seize;
        bool close = pay == debt || seize == posted;
        if (close) {
            debtShares[user] = 0;
            totalDebtShares -= have;
            totalBorrow -= debt;
        } else {
            uint256 burn = pay * have / debt;
            if (burn == 0) burn = 1;
            if (burn > have) burn = have;
            debtShares[user] = have - burn;
            totalDebtShares -= burn;
            totalBorrow -= pay;
        }
        if (totalDebtShares == 0) totalBorrow = 0;
        IWETH(coll).withdraw(seize);
        (bool ok, ) = msg.sender.call{value: seize}("");
        if (!ok) revert Bad();
    }

    function price() external view returns (uint256) {
        return _usdt(1 ether);
    }

    function debtOf(address user) external view returns (uint256) {
        return _previewDebt(user);
    }

    function supplyOf(address user) external view returns (uint256) {
        if (shares[user] == 0 || totalShares == 0) return 0;
        return shares[user] * (_previewAssets() + DUST) / (totalShares + DEAD);
    }

    function maxBorrow(address user) external view returns (uint256) {
        uint256 room = _usdt(collateral[user]) * LTV / 10000;
        uint256 debt = _previewDebt(user);
        return room > debt ? room - debt : 0;
    }

    function rates() external view returns (uint256 borrowApr, uint256 supplyApr, uint256 util) {
        uint256 debt = _previewBorrow();
        uint256 base = cash() + debt;
        if (base == 0 || debt == 0) return (0, 0, 0);
        util = debt * 10000 / base;
        borrowApr = _apr(util);
        supplyApr = borrowApr * debt / base;
    }

    function _add(address user, uint256 amount) internal {
        if (collateral[user] + amount > CAP) revert Bad();
        collateral[user] += amount;
    }

    function _solvent(address user) internal view {
        if (debtShares[user] == 0) return;
        if (_debt(user) * 10000 > _usdt(collateral[user]) * LTV) revert Bad();
    }

    function _debt(address user) internal view returns (uint256) {
        if (debtShares[user] == 0 || totalDebtShares == 0 || totalBorrow == 0) return 0;
        return debtShares[user] * totalBorrow / totalDebtShares;
    }

    function _previewDebt(address user) internal view returns (uint256) {
        uint256 debt = _previewBorrow();
        if (debtShares[user] == 0 || totalDebtShares == 0 || debt == 0) return 0;
        return debtShares[user] * debt / totalDebtShares;
    }

    function _previewBorrow() internal view returns (uint256) {
        if (totalBorrow == 0 || block.timestamp <= lastAccrue) return totalBorrow;
        uint256 util = totalBorrow * 10000 / (cash() + totalBorrow);
        uint256 interest = totalBorrow * _apr(util) / YEAR * (block.timestamp - lastAccrue) / 1e18;
        return totalBorrow + interest;
    }

    function _previewAssets() internal view returns (uint256) {
        return cash() + _previewBorrow();
    }

    function _accrue() internal {
        if (block.timestamp <= lastAccrue) return;
        uint256 dt = block.timestamp - lastAccrue;
        lastAccrue = block.timestamp;
        if (totalBorrow == 0) return;
        uint256 util = totalBorrow * 10000 / (cash() + totalBorrow);
        uint256 interest = totalBorrow * _apr(util) / YEAR * dt / 1e18;
        totalBorrow += interest;
    }

    function _apr(uint256 util) internal pure returns (uint256) {
        if (util <= 8000) return 2e16 + (8e16 * util) / 8000;
        uint256 extra = util - 8000;
        if (extra > 2000) extra = 2000;
        return 10e16 + (40e16 * extra) / 2000;
    }

    function _tick() internal view returns (int24) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = WINDOW;
        ago[1] = 0;
        (int56[] memory cum, ) = pool.observe(ago);
        int56 delta = cum[1] - cum[0];
        int56 period = int56(uint56(WINDOW));
        int24 tick = int24(delta / period);
        if (delta < 0 && delta % period != 0) tick -= 1;
        if (tick < TickMath.MIN_TICK || tick > TickMath.MAX_TICK) revert Bad();
        return tick;
    }

    /// USDT raw for a collateral amount. Rounded down.
    function _usdt(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 sqrt = uint256(TickMath.getSqrtRatioAtTick(_tick()));
        uint256 step = amount * (uint256(1) << 96) / sqrt;
        return step * (uint256(1) << 96) / sqrt;
    }

    /// Collateral raw for a USDT amount. Rounded up.
    function _coll(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 sqrt = uint256(TickMath.getSqrtRatioAtTick(_tick()));
        uint256 unit = uint256(1) << 96;
        uint256 step = (amount * sqrt + unit - 1) / unit;
        return (step * sqrt + unit - 1) / unit;
    }

    function _pull(IERC20 token, address from, uint256 amount) internal {
        uint256 before = token.balanceOf(address(this));
        token.transferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) != before + amount) revert Bad();
    }

    function _push(IERC20 token, address to, uint256 amount) internal {
        uint256 before = token.balanceOf(address(this));
        token.transfer(to, amount);
        if (token.balanceOf(address(this)) != before - amount) revert Bad();
    }
}
