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
/// Ten percent of interest is credited to the fee address. Ninety percent stays with suppliers.
contract TapeLend {
    IERC20 public immutable usdt;
    address public immutable coll;
    IPool public immutable pool;
    address public immutable feeTo;

    uint256 public constant LTV = 5000;
    uint256 public constant LIQ = 7500;
    uint256 public constant BONUS = 500;
    uint256 public constant CUT = 1000;
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
    /// Debt collateral can no longer cover. Not an asset. The borrower still owes it.
    uint256 public impaired;
    uint256 public rescuePot;
    uint256 public rescueShares;
    uint256 public rescueEpoch;
    uint256 public epoch = 1;
    mapping(address => uint256) public shortOf;
    mapping(address => uint256) public rescueShortOf;
    mapping(address => uint256) public shortEpoch;
    mapping(address => uint256) public rescueOf;
    mapping(address => uint256) public seen;
    address[] private debtors;
    mapping(address => uint256) private debtorIx;

    uint256 private entered = 1;
    error Bad();

    modifier guarded() {
        if (entered != 1) revert Bad();
        entered = 2;
        _;
        entered = 1;
    }

    constructor(address usdt_, address coll_, address pool_, address feeTo_) {
        if (usdt_ == address(0) || coll_ == address(0) || pool_ == address(0) || feeTo_ == address(0)) revert Bad();
        if (IPool(pool_).token0() != usdt_ || IPool(pool_).token1() != coll_) revert Bad();
        usdt = IERC20(usdt_);
        coll = coll_;
        pool = IPool(pool_);
        feeTo = feeTo_;
        lastAccrue = block.timestamp;
        epoch = 1;
    }

    receive() external payable {
        if (msg.sender != coll) revert Bad();
    }

    /// Cash the current shares can withdraw. Recovery owed to a frozen generation is excluded.
    function cash() public view returns (uint256) {
        uint256 bal = usdt.balanceOf(address(this));
        if (bal <= rescuePot) return 0;
        return bal - rescuePot;
    }

    /// Cash plus indexed debt that collateral still covers. A shortfall is excluded
    /// before anyone liquidates, and it is not subtracted again after `impaired`.
    function assets() public view returns (uint256) {
        uint256 book = cash() + totalBorrow;
        uint256 hole = _pending(false);
        return hole >= book ? 0 : book - hole;
    }

    function deposit(uint256 amount) external guarded {
        if (amount == 0) revert Bad();
        _accrue();
        _markBook();
        if (cash() == 0 && totalBorrow == 0 && totalShares != 0) {
            if (rescueShares == 0 && impaired == 0) {
                epoch += 1;
                totalShares = 0;
            } else if (rescueShares == 0) {
                rescueShares = totalShares;
                rescueEpoch = epoch;
                epoch += 1;
                totalShares = 0;
            }
        }
        _touch(msg.sender);
        uint256 minted = amount * (totalShares + DEAD) / (assets() + DUST);
        if (minted == 0) revert Bad();
        _pull(usdt, msg.sender, amount);
        shares[msg.sender] += minted;
        totalShares += minted;
    }

    function withdraw(uint256 shareAmt) external guarded {
        _accrue();
        _markBook();
        _touch(msg.sender);
        if (shareAmt == 0 || shareAmt > shares[msg.sender] || totalShares == 0) revert Bad();
        uint256 out = shareAmt * (assets() + DUST) / (totalShares + DEAD);
        if (out == 0) revert Bad();
        if (out > cash()) {
            if (shareAmt != totalShares) revert Bad();
            out = cash();
        }
        shares[msg.sender] -= shareAmt;
        totalShares -= shareAmt;
        _push(usdt, msg.sender, out);
    }

    function claim(uint256 shareAmt) external guarded {
        _touch(msg.sender);
        uint256 have = rescueOf[msg.sender];
        if (shareAmt == 0 || shareAmt > have || rescueShares == 0) revert Bad();
        uint256 out = shareAmt * rescuePot / rescueShares;
        if (out == 0 || out > rescuePot) revert Bad();
        rescueOf[msg.sender] = have - shareAmt;
        rescueShares -= shareAmt;
        rescuePot -= out;
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
        uint256 debt = _due(msg.sender);
        uint256 room = _usdt(collateral[msg.sender]) * LTV / 10000;
        if (debt + amount > room) revert Bad();
        uint256 minted = totalDebtShares == 0 || totalBorrow == 0 ? amount : amount * totalDebtShares / totalBorrow;
        if (minted == 0) revert Bad();
        debtShares[msg.sender] += minted;
        totalDebtShares += minted;
        totalBorrow += amount;
        _seat(msg.sender);
        _push(usdt, msg.sender, amount);
    }

    function repay(uint256 amount) external guarded {
        _accrue();
        _park(msg.sender);
        uint256 debt = _debt(msg.sender);
        uint256 hole = shortOf[msg.sender];
        uint256 frozen = rescueShortOf[msg.sender];
        if (amount == 0 || debt + hole + frozen == 0) revert Bad();
        uint256 pay = amount >= debt + hole + frozen ? debt + hole + frozen : amount;
        _pull(usdt, msg.sender, pay);
        uint256 toIndex = pay < debt ? pay : debt;
        if (toIndex > 0) {
            uint256 have = debtShares[msg.sender];
            uint256 burn = toIndex == debt ? have : toIndex * totalDebtShares / totalBorrow;
            if (burn == 0 || burn > have) revert Bad();
            debtShares[msg.sender] = have - burn;
            totalDebtShares -= burn;
            totalBorrow -= toIndex;
            if (totalDebtShares == 0) totalBorrow = 0;
            _unseat(msg.sender);
        }
        uint256 left = pay - toIndex;
        uint256 toShort = left < hole ? left : hole;
        if (toShort > 0) {
            shortOf[msg.sender] = hole - toShort;
            impaired -= toShort;
        }
        uint256 toFrozen = left - toShort;
        if (toFrozen > 0) {
            rescueShortOf[msg.sender] = frozen - toFrozen;
            impaired -= toFrozen;
            if (rescueShares != 0) rescuePot += toFrozen;
        }
    }

    /// Repay someone's debt and take their collateral plus 5%.
    /// If the collateral cannot cover the debt, the shortfall is written off the lenders.
    function liquidate(address user, uint256 amount) external guarded {
        if (user == address(0) || amount == 0) revert Bad();
        _accrue();
        uint256 have = debtShares[user];
        uint256 debt = _debt(user);
        uint256 posted = collateral[user];
        if (have == 0 || debt == 0) {
            _seizeResidual(user, amount, posted);
            return;
        }
        if (posted == 0) {
            _realize(user);
            _unseat(user);
            return;
        }
        if (debt * 10000 <= _usdt(posted) * LIQ) revert Bad();
        uint256 cover = _usdt(posted * 10000 / (10000 + BONUS));
        if (cover == 0) {
            collateral[user] = 0;
            _realize(user);
            _unseat(user);
            _sendColl(msg.sender, posted);
            return;
        }
        uint256 maxPay = cover < debt ? cover : debt;
        uint256 pay = amount < maxPay ? amount : maxPay;
        uint256 seize = pay == 0 ? 0 : _coll(pay * (10000 + BONUS) / 10000);
        if (seize > posted) seize = posted;
        if (posted > seize && _usdt(posted - seize) == 0) seize = posted;
        if (pay == 0 && seize == 0) {
            _realize(user);
            _unseat(user);
            return;
        }
        if (pay > 0) _pull(usdt, msg.sender, pay);
        collateral[user] = posted - seize;
        if (pay > 0 && debt > 0) {
            uint256 burn = pay >= debt ? have : pay * have / debt;
            if (burn == 0) burn = 1;
            if (burn > have) burn = have;
            debtShares[user] = have - burn;
            totalDebtShares -= burn;
            uint256 removed = pay >= debt ? debt : pay;
            if (removed > totalBorrow) removed = totalBorrow;
            totalBorrow -= removed;
            if (totalDebtShares == 0) totalBorrow = 0;
        }
        _realize(user);
        _unseat(user);
        if (seize > 0) _sendColl(msg.sender, seize);
    }

    function price() external view returns (uint256) {
        return _usdt(1 ether);
    }

    function debtOf(address user) external view returns (uint256) {
        (uint256 current, uint256 frozen) = _holes(user);
        return _previewDebt(user) + current + frozen;
    }

    function supplyOf(address user) external view returns (uint256) {
        if (seen[user] != epoch || shares[user] == 0 || totalShares == 0) return 0;
        return shares[user] * (_previewAssets() + DUST) / (totalShares + DEAD);
    }

    function maxBorrow(address user) external view returns (uint256) {
        uint256 room = _usdt(collateral[user]) * LTV / 10000;
        uint256 debt = _previewDebt(user);
        (uint256 current, uint256 frozen) = _holes(user);
        debt += current + frozen;
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

    function _touch(address who) internal {
        if (seen[who] == epoch) return;
        if (rescueEpoch != 0 && seen[who] == rescueEpoch && shares[who] != 0) rescueOf[who] = shares[who];
        shares[who] = 0;
        seen[who] = epoch;
    }

    function _due(address user) internal view returns (uint256) {
        (uint256 current, uint256 frozen) = _holes(user);
        return _debt(user) + current + frozen;
    }

    function _holes(address user) internal view returns (uint256 current, uint256 frozen) {
        frozen = rescueShortOf[user];
        uint256 hole = shortOf[user];
        if (hole == 0 || shortEpoch[user] == epoch) current = hole;
        else if (rescueEpoch != 0 && shortEpoch[user] == rescueEpoch) frozen += hole;
        else current = hole;
    }

    function _park(address user) internal {
        uint256 hole = shortOf[user];
        if (hole == 0 || shortEpoch[user] == epoch) return;
        if (rescueEpoch != 0 && shortEpoch[user] == rescueEpoch) {
            rescueShortOf[user] += hole;
            shortOf[user] = 0;
            shortEpoch[user] = epoch;
        }
    }

    function _seat(address user) internal {
        if (debtorIx[user] != 0 || debtShares[user] == 0) return;
        debtors.push(user);
        debtorIx[user] = debtors.length;
    }

    function _unseat(address user) internal {
        if (debtShares[user] != 0) return;
        uint256 ix = debtorIx[user];
        if (ix == 0) return;
        uint256 last = debtors.length;
        if (ix != last) {
            address tail = debtors[last - 1];
            debtors[ix - 1] = tail;
            debtorIx[tail] = ix;
        }
        debtors.pop();
        debtorIx[user] = 0;
    }

    function _markBook() internal {
        uint256 i;
        while (i < debtors.length) {
            address user = debtors[i];
            _realize(user);
            uint256 n = debtors.length;
            _unseat(user);
            if (debtors.length == n) {
                unchecked { ++i; }
            }
        }
    }

    function _pending(bool preview) internal view returns (uint256 hole) {
        uint256 n = debtors.length;
        for (uint256 i; i < n; ) {
            address user = debtors[i];
            uint256 debt = preview ? _previewDebt(user) : _debt(user);
            if (debt != 0) {
                uint256 covered = _usdt(collateral[user]) * 10000 / (10000 + BONUS);
                if (debt > covered) hole += debt - covered;
            }
            unchecked { ++i; }
        }
    }

    function _realize(address user) internal {
        _park(user);
        uint256 debt = _debt(user);
        if (debt == 0) return;
        uint256 covered = _usdt(collateral[user]) * 10000 / (10000 + BONUS);
        if (debt <= covered) return;
        uint256 have = debtShares[user];
        uint256 loss = debt - covered;
        uint256 burn = loss >= debt ? have : loss * have / debt;
        if (burn == 0) burn = 1;
        if (burn > have) burn = have;
        uint256 removed = burn == have ? debt : burn * totalBorrow / totalDebtShares;
        if (removed > totalBorrow) removed = totalBorrow;
        debtShares[user] = have - burn;
        totalDebtShares -= burn;
        totalBorrow -= removed;
        if (totalDebtShares == 0 && totalBorrow != 0) {
            removed += totalBorrow;
            totalBorrow = 0;
        }
        shortOf[user] += removed;
        shortEpoch[user] = epoch;
        impaired += removed;
    }

    function _seizeResidual(address user, uint256 amount, uint256 posted) internal {
        _park(user);
        _unseat(user);
        uint256 hole = shortOf[user];
        uint256 frozen = rescueShortOf[user];
        uint256 owed = hole + frozen;
        if (posted == 0 || owed == 0) revert Bad();
        if (owed * 10000 <= _usdt(posted) * LIQ) revert Bad();
        uint256 cover = _usdt(posted * 10000 / (10000 + BONUS));
        uint256 maxPay = cover < owed ? cover : owed;
        uint256 pay = amount < maxPay ? amount : maxPay;
        if (pay == 0 && cover != 0) revert Bad();
        uint256 seize = posted;
        if (pay > 0) {
            seize = _coll(pay * (10000 + BONUS) / 10000);
            if (seize == 0 || seize > posted) seize = posted;
            if (posted > seize && _usdt(posted - seize) == 0) seize = posted;
            _pull(usdt, msg.sender, pay);
            uint256 toShort = pay < hole ? pay : hole;
            if (toShort > 0) {
                shortOf[user] = hole - toShort;
                impaired -= toShort;
            }
            uint256 toFrozen = pay - toShort;
            if (toFrozen > 0) {
                rescueShortOf[user] = frozen - toFrozen;
                impaired -= toFrozen;
                if (rescueShares != 0) rescuePot += toFrozen;
            }
        }
        collateral[user] = posted - seize;
        if (seize > 0) _sendColl(msg.sender, seize);
    }

    function _sendColl(address to, uint256 amount) internal {
        IWETH(coll).withdraw(amount);
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert Bad();
    }

    function _add(address user, uint256 amount) internal {
        if (collateral[user] + amount > CAP) revert Bad();
        collateral[user] += amount;
    }

    function _solvent(address user) internal view {
        uint256 debt = _due(user);
        if (debt == 0) return;
        if (debt * 10000 > _usdt(collateral[user]) * LTV) revert Bad();
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
        uint256 book = cash() + _previewBorrow();
        uint256 hole = _pending(true);
        return hole >= book ? 0 : book - hole;
    }

    function _accrue() internal {
        if (block.timestamp <= lastAccrue) return;
        uint256 dt = block.timestamp - lastAccrue;
        lastAccrue = block.timestamp;
        if (totalBorrow == 0) return;
        uint256 util = totalBorrow * 10000 / (cash() + totalBorrow);
        uint256 interest = totalBorrow * _apr(util) / YEAR * dt / 1e18;
        if (interest == 0) return;
        totalBorrow += interest;
        uint256 cut = interest * CUT / 10000;
        if (cut == 0) return;
        uint256 minted = cut * (totalShares + DEAD) / (assets() + DUST);
        if (minted == 0) return;
        shares[feeTo] += minted;
        totalShares += minted;
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
