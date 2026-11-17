// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./TickMath.sol";

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function observe(uint32[] calldata secondsAgos) external view returns (int56[] memory, uint160[] memory);
}

interface IBook {
    function okbPool() external view returns (uint256 tape, uint256 quote, uint256 shares);
    function bemPool() external view returns (uint256 tape, uint256 quote, uint256 shares);
}

/// Lend USDT against an ERC20.
/// Mode 0 prices the collateral from a 30-minute Uniswap v3 average.
/// Modes 1 and 2 price TAPE and BEM from the open pool, moving at most 0.5% each 30 seconds.
/// There is no owner and no rescue.
/// Ten percent of interest is credited to the fee address. Ninety percent stays with suppliers.
contract TapeLendErc {
    address public constant OPEN = 0x58eaD5b41Cfd3627791D439402dd65571c286484;
    address public constant OKB_POOL = 0xe3BE6A0137f1b0602Fc1a4841686f43B340a5082;
    address public constant TAPE = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
    address public constant XBEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address public constant XUSDT = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;

    IERC20 public immutable usdt;
    address public immutable coll;
    address public immutable pool;
    address public immutable feeTo;
    uint8 public immutable mode;
    uint256 public immutable unit;

    uint256 public constant LTV = 5000;
    uint256 public constant LIQ = 7500;
    uint256 public constant BONUS = 500;
    uint256 public constant CUT = 1000;
    uint32 public constant WINDOW = 1800;
    uint256 public constant YEAR = 365 days;
    uint256 private constant DEAD = 1_000_000;
    uint256 private constant DUST = 1_000;
    uint256 private constant STEP = 50;
    /// One withdrawal revalues every borrower. The list has to stay short enough to fit.
    uint256 public constant MAX_DEBTORS = 32;

    uint256 public totalShares;
    uint256 public totalBorrow;
    uint256 public totalDebtShares;
    uint256 public lastAccrue;
    uint256 public stored;
    uint32 public stamp;
    bool public lag;
    mapping(address => uint256) public shares;
    mapping(address => uint256) public debtShares;
    mapping(address => uint256) public collateral;
    /// Performing debt. Written-off debt is `impaired` and is not an asset.
    uint256 public impaired;
    uint256 public rescuePot;
    uint256 public rescueShares;
    /// Cumulative frozen-generation recovery. Claiming does not reduce this weight.
    uint256 public rescueEver;
    uint256 public rescueEpoch;
    uint256 public epoch;
    mapping(address => uint256) public shortOf;
    /// Shortfall opened before a zero-NAV restart. Repaying it does not enter the new pool.
    mapping(address => uint256) public rescueShortOf;
    mapping(address => uint256) public shortEpoch;
    mapping(address => uint256) public rescueOf;
    mapping(address => uint256) public rescueTaken;
    mapping(address => uint256) public seen;
    /// Borrowers with indexed debt. Deposit and withdraw revalue this list
    /// before pricing shares, so a shortfall is not an asset while it waits
    /// for a liquidator.
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

    constructor(uint8 mode_, address usdt_, address coll_, address pool_, uint8 dec_, address feeTo_) {
        if (dec_ == 0 || dec_ > 18 || feeTo_ == address(0)) revert Bad();
        if (mode_ == 0) {
            if (usdt_ == address(0) || coll_ == address(0) || pool_ == address(0)) revert Bad();
            if (IPool(pool_).token0() != usdt_ || IPool(pool_).token1() != coll_) revert Bad();
        } else if (mode_ == 1) {
            if (usdt_ != XUSDT || coll_ != TAPE || pool_ != OPEN || dec_ != 8) revert Bad();
        } else if (mode_ == 2) {
            if (usdt_ != XUSDT || coll_ != XBEM || pool_ != OPEN || dec_ != 8) revert Bad();
        } else {
            revert Bad();
        }
        usdt = IERC20(usdt_);
        coll = coll_;
        pool = pool_;
        mode = mode_;
        unit = 10 ** dec_;
        feeTo = feeTo_;
        lastAccrue = block.timestamp;
        epoch = 1;
        if (mode_ != 0) {
            stored = _spot();
            if (stored == 0) revert Bad();
            stamp = uint32(block.timestamp);
        }
    }

    /// Cash the current shares can withdraw. Recovery owed to a frozen generation is excluded.
    function cash() public view returns (uint256) {
        uint256 bal = usdt.balanceOf(address(this));
        if (bal <= rescuePot) return 0;
        return bal - rescuePot;
    }

    /// Recoverable assets. Uncovered indexed debt is subtracted even before
    /// liquidation writes it into `impaired`. After that write-down it is no
    /// longer in `totalBorrow`, so it is not subtracted twice.
    function assets() public view returns (uint256) {
        uint256 book = cash() + totalBorrow;
        uint256 hole = _pending(false);
        return hole >= book ? 0 : book - hole;
    }

    function fresh() public view returns (bool) {
        if (mode == 0) return true;
        return stored != 0 && !lag && block.timestamp <= uint256(stamp) + WINDOW;
    }

    function price() public view returns (uint256) {
        if (mode == 0) return _v3(pool, unit);
        if (stored == 0) revert Bad();
        return stored;
    }

    function poke() external guarded {
        if (mode == 0) revert Bad();
        if (block.timestamp < uint256(stamp) + 30) revert Bad();
        uint256 spot = _spot();
        if (spot == 0 || stored == 0) revert Bad();
        uint256 step = stored * STEP / 10000;
        if (step == 0) step = 1;
        if (spot > stored + step) {
            stored += step;
            lag = true;
        } else if (spot + step < stored) {
            stored -= step;
            lag = true;
        } else {
            stored = spot;
            lag = false;
        }
        stamp = uint32(block.timestamp);
    }

    function deposit(uint256 amount) external guarded {
        if (amount == 0 || !fresh()) revert Bad();
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
        if (!fresh()) revert Bad();
        _accrue();
        _markBook();
        _touch(msg.sender);
        if (shareAmt == 0 || shareAmt > shares[msg.sender] || totalShares == 0) revert Bad();
        uint256 out = shareAmt * (assets() + DUST) / (totalShares + DEAD);
        if (out == 0) revert Bad();
        if (out > cash()) {
            // The virtual share only pushes the final redemption a few wei over cash.
            // An earlier exit still cannot take cash that belongs to the remaining shares.
            if (shareAmt != totalShares) revert Bad();
            out = cash();
        }
        shares[msg.sender] -= shareAmt;
        totalShares -= shareAmt;
        _push(usdt, msg.sender, out);
    }

    /// Pay up to `amount` of recovery already credited to this frozen generation.
    /// Shares stay put, so a later repayment keeps the same split.
    function claim(uint256 amount) external guarded {
        _touch(msg.sender);
        uint256 have = rescueOf[msg.sender];
        if (amount == 0 || have == 0 || rescueShares == 0) revert Bad();
        uint256 entitled = have * rescueEver / rescueShares;
        uint256 taken = rescueTaken[msg.sender];
        if (entitled <= taken) revert Bad();
        uint256 pending = entitled - taken;
        uint256 out = amount < pending ? amount : pending;
        if (out == 0 || out > rescuePot) revert Bad();
        rescueTaken[msg.sender] = taken + out;
        rescuePot -= out;
        _push(usdt, msg.sender, out);
    }

    function lock(uint256 amount) external guarded {
        if (amount == 0) revert Bad();
        if (collateral[msg.sender] + amount > 1_000_000 * unit) revert Bad();
        collateral[msg.sender] += amount;
        _pull(IERC20(coll), msg.sender, amount);
    }

    function unlock(uint256 amount) external guarded {
        if (amount == 0 || amount > collateral[msg.sender]) revert Bad();
        _accrue();
        if (_due(msg.sender) != 0) {
            if (!fresh()) revert Bad();
        }
        collateral[msg.sender] -= amount;
        _solvent(msg.sender);
        _push(IERC20(coll), msg.sender, amount);
    }

    function borrow(uint256 amount) external guarded {
        if (amount == 0 || amount > cash()) revert Bad();
        if (!fresh()) revert Bad();
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
            // Current generation. The tokens stay in cash and are not put back
            // into `totalBorrow`, so the recovery is an asset exactly once.
        }
        uint256 toFrozen = left - toShort;
        if (toFrozen > 0) {
            rescueShortOf[msg.sender] = frozen - toFrozen;
            impaired -= toFrozen;
            // Frozen generation only. A shortfall opened after the restart is
            // `toShort` and must not be paid to the suppliers who already restarted.
            rescueEver += toFrozen;
            rescuePot += toFrozen;
        }
    }

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
        // No collateral left. The whole balance is a confirmed shortfall.
        if (posted == 0) {
            _realize(user);
            _unseat(user);
            return;
        }
        if (!fresh()) revert Bad();
        if (debt * 10000 <= _usdt(posted) * LIQ) revert Bad();
        uint256 cover = _usdt(posted * 10000 / (10000 + BONUS));
        // Worthless collateral cannot fund a repayment. Seize it and impair the debt
        // so the unpaid balance does not stay inside `totalBorrow`.
        if (cover == 0) {
            collateral[user] = 0;
            _realize(user);
            _unseat(user);
            _push(IERC20(coll), msg.sender, posted);
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
        if (seize > 0) _push(IERC20(coll), msg.sender, seize);
    }

    function _usdtDust() internal view returns (uint256) {
        (bool ok, bytes memory data) = address(usdt).staticcall(abi.encodeWithSelector(0x313ce567));
        uint8 dec = 6;
        if (ok && data.length >= 32) {
            uint256 raw = abi.decode(data, (uint256));
            if (raw > 0 && raw <= 18) dec = uint8(raw);
        }
        return dec <= 2 ? 1 : 5 * (10 ** (dec - 2));
    }

    function debtOf(address user) external view returns (uint256) {
        (uint256 current, uint256 frozen) = _holes(user);
        return _previewDebt(user) + current + frozen;
    }

    function supplyOf(address user) external view returns (uint256) {
        if (seen[user] != epoch || shares[user] == 0 || totalShares == 0) return 0;
        return shares[user] * (_previewAssets() + DUST) / (totalShares + DEAD);
    }

    function shareOf(address user) external view returns (uint256) {
        if (seen[user] != epoch) return 0;
        return shares[user];
    }

    function rescue(address user) external view returns (uint256 shareAmt, uint256 pot, uint256 total) {
        total = rescueShares;
        pot = rescuePot;
        if (rescueEpoch != 0 && seen[user] == rescueEpoch) shareAmt = shares[user];
        else shareAmt = rescueOf[user];
    }

    function maxBorrow(address user) external view returns (uint256) {
        if (!fresh()) return 0;
        uint256 room = _usdt(collateral[user]) * LTV / 10000;
        (uint256 current, uint256 frozen) = _holes(user);
        uint256 debt = _previewDebt(user) + current + frozen;
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

    function _solvent(address user) internal view {
        uint256 debt = _due(user);
        if (debt == 0) return;
        if (debt * 10000 > _usdt(collateral[user]) * LTV) revert Bad();
    }

    function _usdt(uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        return amount * price() / unit;
    }

    function _coll(uint256 amount) internal view returns (uint256) {
        uint256 px = price();
        if (amount == 0 || px == 0) return 0;
        return (amount * unit + px - 1) / px;
    }

    function _spot() internal view returns (uint256) {
        (uint256 tapeO, uint256 okb, ) = IBook(OPEN).okbPool();
        if (tapeO == 0 || okb == 0) revert Bad();
        uint256 usdtPerOkb = _v3(OKB_POOL, 1 ether);
        if (usdtPerOkb == 0) revert Bad();
        if (mode == 1) return okb * usdtPerOkb * (10 ** 8) / tapeO / 1 ether;
        (uint256 tapeB, uint256 bemAmt, ) = IBook(OPEN).bemPool();
        if (tapeB == 0 || bemAmt == 0) revert Bad();
        return tapeB * (10 ** 8) * okb / bemAmt / tapeO * usdtPerOkb / 1 ether;
    }

    function _v3(address book, uint256 amount) internal view returns (uint256) {
        if (amount == 0) return 0;
        uint256 sqrt = uint256(TickMath.getSqrtRatioAtTick(_tick(book)));
        uint256 step = amount * (uint256(1) << 96) / sqrt;
        return step * (uint256(1) << 96) / sqrt;
    }

    function _tick(address book) internal view returns (int24) {
        uint32[] memory ago = new uint32[](2);
        ago[0] = WINDOW;
        ago[1] = 0;
        (int56[] memory cum, ) = IPool(book).observe(ago);
        int56 delta = cum[1] - cum[0];
        int56 period = int56(uint56(WINDOW));
        int24 tick = int24(delta / period);
        if (delta < 0 && delta % period != 0) tick -= 1;
        if (tick < TickMath.MIN_TICK || tick > TickMath.MAX_TICK) revert Bad();
        return tick;
    }

    function _due(address user) internal view returns (uint256) {
        (uint256 current, uint256 frozen) = _holes(user);
        return _debt(user) + current + frozen;
    }

    /// Split a borrower's shortfall into the current generation and the one frozen at restart.
    function _holes(address user) internal view returns (uint256 current, uint256 frozen) {
        frozen = rescueShortOf[user];
        uint256 hole = shortOf[user];
        if (hole == 0 || shortEpoch[user] == epoch) current = hole;
        else if (rescueEpoch != 0 && shortEpoch[user] == rescueEpoch) frozen += hole;
        else current = hole;
    }

    /// A zero-NAV restart bumps `epoch` without walking every borrower.
    /// The first later touch moves that generation's shortfall out of the new pool.
    function _park(address user) internal {
        uint256 hole = shortOf[user];
        if (hole == 0 || shortEpoch[user] == epoch) return;
        if (rescueEpoch != 0 && shortEpoch[user] == rescueEpoch) {
            rescueShortOf[user] += hole;
            shortOf[user] = 0;
            shortEpoch[user] = epoch;
        }
    }

    /// Move debt that remaining collateral cannot cover out of pool assets.
    /// The borrower still owes it. Repayment credits the generation that was
    /// current when the shortfall was confirmed, and does not re-enter `totalBorrow`.
    function _realize(address user) internal {
        _realizePriced(user, price());
    }

    function _realizePriced(address user, uint256 px) internal {
        _park(user);
        uint256 debt = _debt(user);
        if (debt == 0) return;
        uint256 covered = collateral[user] * px / unit * 10000 / (10000 + BONUS);
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

    function _touch(address who) internal {
        if (seen[who] == epoch) return;
        if (rescueEpoch != 0 && seen[who] == rescueEpoch && shares[who] != 0) rescueOf[who] = shares[who];
        shares[who] = 0;
        seen[who] = epoch;
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

    function _seat(address user) internal {
        if (debtorIx[user] != 0 || debtShares[user] == 0) return;
        if (debtors.length >= MAX_DEBTORS) revert Bad();
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

    /// Crystallize every shortfall before a share is priced. Waiting for
    /// `liquidate` would let the first withdrawal use the old net asset value.
    function _markBook() internal {
        uint256 px = price();
        uint256 i;
        while (i < debtors.length) {
            address user = debtors[i];
            _realizePriced(user, px);
            uint256 n = debtors.length;
            _unseat(user);
            if (debtors.length == n) {
                unchecked { ++i; }
            }
        }
    }

    /// Indexed debt that collateral can no longer cover. `preview` includes
    /// interest that has not been written into `totalBorrow` yet.
    function _pending(bool preview) internal view returns (uint256 hole) {
        uint256 px = price();
        uint256 n = debtors.length;
        for (uint256 i; i < n; ) {
            address user = debtors[i];
            uint256 debt = preview ? _previewDebt(user) : _debt(user);
            if (debt != 0) {
                uint256 covered = collateral[user] * px / unit * 10000 / (10000 + BONUS);
                if (debt > covered) hole += debt - covered;
            }
            unchecked { ++i; }
        }
    }

    /// Collateral left after the indexed debt was already written off.
    /// Worthless collateral is seized. Collateral that still has a price must
    /// be paid for, and that payment retires the shortfall once.
    function _seizeResidual(address user, uint256 amount, uint256 posted) internal {
        _park(user);
        _unseat(user);
        uint256 hole = shortOf[user];
        uint256 frozen = rescueShortOf[user];
        uint256 owed = hole + frozen;
        if (posted == 0 || owed == 0) revert Bad();
        if (!fresh()) revert Bad();
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
                rescueEver += toFrozen;
                rescuePot += toFrozen;
            }
        }
        collateral[user] = posted - seize;
        if (seize > 0) _push(IERC20(coll), msg.sender, seize);
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
