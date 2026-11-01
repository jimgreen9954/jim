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

    uint256 public totalShares;
    uint256 public totalBorrow;
    uint256 public totalDebtShares;
    uint256 public lastAccrue;
    uint256 public stored;
    uint32 public stamp;
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
        if (mode_ != 0) {
            stored = _spot();
            if (stored == 0) revert Bad();
            stamp = uint32(block.timestamp);
        }
    }

    function cash() public view returns (uint256) {
        return usdt.balanceOf(address(this));
    }

    function assets() public view returns (uint256) {
        return cash() + totalBorrow;
    }

    function fresh() public view returns (bool) {
        if (mode == 0) return true;
        return stored != 0 && block.timestamp <= uint256(stamp) + WINDOW;
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
        if (spot > stored + step) stored += step;
        else if (spot + step < stored) stored -= step;
        else stored = spot;
        stamp = uint32(block.timestamp);
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
        if (collateral[msg.sender] + amount > 1_000_000 * unit) revert Bad();
        collateral[msg.sender] += amount;
        _pull(IERC20(coll), msg.sender, amount);
    }

    function unlock(uint256 amount) external guarded {
        if (amount == 0 || amount > collateral[msg.sender]) revert Bad();
        _accrue();
        collateral[msg.sender] -= amount;
        _solvent(msg.sender);
        _push(IERC20(coll), msg.sender, amount);
    }

    function borrow(uint256 amount) external guarded {
        if (amount == 0 || amount > cash()) revert Bad();
        if (!fresh()) revert Bad();
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
        _push(IERC20(coll), msg.sender, seize);
    }

    function debtOf(address user) external view returns (uint256) {
        return _previewDebt(user);
    }

    function supplyOf(address user) external view returns (uint256) {
        if (shares[user] == 0 || totalShares == 0) return 0;
        return shares[user] * (_previewAssets() + DUST) / (totalShares + DEAD);
    }

    function maxBorrow(address user) external view returns (uint256) {
        if (!fresh()) return 0;
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

    function _solvent(address user) internal view {
        if (debtShares[user] == 0) return;
        if (_debt(user) * 10000 > _usdt(collateral[user]) * LTV) revert Bad();
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
