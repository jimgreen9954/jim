// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IV3Quoter {
    struct Params {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(Params calldata params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

interface IV2Router {
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

interface ITapePool {
    function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) external view returns (uint256 fee, uint256 out);
}

interface IUpPool {
    function quoteSell(uint256 amountIn) external view returns (uint256 wad, uint256 rest, uint256 gross, uint256 fee, uint256 net);
}

interface IFabQuoter {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct Params {
        PoolKey poolKey;
        bool zeroForOne;
        uint128 exactAmount;
        bytes hookData;
    }

    function quoteExactInputSingle(Params calldata params) external returns (uint256 amountOut, uint256 gasEstimate);
}

/// Fixed-term loans. No admin and no upgrade. Rates are fixed in this bytecode.
/// One deployment per chain. BSC is 56, X Layer is 196.
/// Interest is simple, charged on principal for each completed hour.
/// After the due hour it is charged at twice that rate until the loan is closed.
contract TermBook {
    address public immutable safe;
    uint256 public immutable chain;

    uint256 public constant OPEN_LTV = 5000;
    uint256 public constant LIQ_LTV = 7500;
    uint256 public constant BONUS_BPS = 500;
    uint256 public constant FEE_BPS = 1000;
    uint256 public constant WAD = 1e18;
    uint256 public constant MIN_USD = 10e18;
    uint256 public constant HOUR = 1 hours;
    uint256 public constant POKE_GAP = 10 minutes;
    uint256 public constant FRESH = 30 minutes;
    uint8 public constant MAX_LOANS = 16;

    struct Loan {
        address user;
        uint8 coll;
        uint8 debt;
        uint8 term;
        uint64 start;
        uint64 marked;
        uint64 due;
        uint256 collAmt;
        uint256 principal;
        uint256 interest;
        uint256 collUsd0;
        uint256 debtUsd0;
        bool open;
    }

    mapping(uint8 => uint256) public px;
    mapping(uint8 => uint64) public pxTime;
    mapping(uint8 => uint8) public stamps;
    mapping(uint8 => bool) public warm;
    mapping(uint8 => uint256) public cash;
    mapping(uint8 => uint256) public principalOut;
    mapping(uint8 => uint256) public totalShares;
    mapping(uint8 => uint256) public epoch;
    mapping(uint8 => mapping(address => uint256)) internal shares;
    mapping(uint8 => mapping(address => uint256)) internal paidIn;
    mapping(uint8 => mapping(address => uint256)) internal seen;
    mapping(uint256 => Loan) public loans;
    mapping(address => uint256[]) internal mine;
    mapping(address => uint8) public openLoans;
    uint256[] internal alive;
    mapping(uint256 => uint256) internal alivePos;
    uint256 public nextId;
    uint256 private locked;

    event Poked(uint8 indexed id, uint256 px);
    event Deposited(address indexed who, uint8 indexed id, uint256 amount, uint256 shareAmt);
    event Withdrawn(address indexed who, uint8 indexed id, uint256 amount, uint256 shareAmt);
    event Opened(uint256 indexed id, address indexed who, uint8 coll, uint8 debt, uint8 term, uint256 collAmt, uint256 principal);
    event Repaid(uint256 indexed id, address indexed who, uint256 pay, uint256 left);
    event Liquidated(uint256 indexed id, address indexed who, address indexed caller, uint256 pay, uint256 seize);
    event Closed(uint256 indexed id);

    error ClosedBook();
    error Bad();
    error Stale();
    error Early();

    modifier lock() {
        if (locked == 1) revert Bad();
        locked = 1;
        _;
        locked = 0;
    }

    constructor(address safe_) {
        if (safe_ == address(0)) revert Bad();
        if (block.chainid != 56 && block.chainid != 196) revert Bad();
        safe = safe_;
        chain = block.chainid;
    }

    receive() external payable {
        revert Bad();
    }

    fallback() external payable {
        revert Bad();
    }

    function count() public view returns (uint8) {
        return chain == 56 ? 4 : 5;
    }

    function edition() external pure returns (uint8) {
        return 2;
    }

    function nativeId() public pure returns (uint8) {
        return 1;
    }

    function stable(uint8 id) public pure returns (bool) {
        return id == 0;
    }

    function termMul(uint8 term) public pure returns (uint256) {
        if (term == 0) return 10000;
        if (term == 1) return 10500;
        if (term == 2) return 11000;
        if (term == 3) return 12000;
        if (term == 4) return 13500;
        if (term == 5) return 15000;
        if (term == 6) return 16500;
        if (term == 7) return 18000;
        revert Bad();
    }

    function duration(uint8 term) public pure returns (uint64) {
        if (term == 0) return 1 days;
        if (term == 1) return 3 days;
        if (term == 2) return 7 days;
        if (term == 3) return 30 days;
        if (term == 4) return 90 days;
        if (term == 5) return 180 days;
        if (term == 6) return 270 days;
        if (term == 7) return 365 days;
        revert Bad();
    }

    function hourly(uint8 debtId, uint8 term) public pure returns (uint256) {
        uint256 year = stable(debtId) ? 80000000000000000 : debtId == nativeId() ? 120000000000000000 : 180000000000000000;
        return year / 365 / 24 * termMul(term) / 10000;
    }

    function apr(uint8 debtId, uint8 term) external pure returns (uint256) {
        return hourly(debtId, term) * 24 * 365;
    }

    function dec(uint8 id) public view returns (uint8) {
        if (chain == 56) return id == 2 ? 8 : 18;
        if (id == 0) return 6;
        if (id == 1) return 18;
        return 8;
    }

    function tokenOf(uint8 id) public view returns (address) {
        if (chain == 56) {
            if (id == 0) return 0x55d398326f99059fF775485246999027B3197955;
            if (id == 2) return 0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a;
            if (id == 3) return 0xEd99445d72787Adb627cD8588586984DF548CD2F;
            revert Bad();
        }
        if (id == 0) return 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
        if (id == 2) return 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
        if (id == 3) return 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
        if (id == 4) return 0x72F349B1Eee7833B26f8C81a8410775A4e231ed2;
        revert Bad();
    }

    function fresh(uint8 id) public view returns (bool) {
        return warm[id] && px[id] > 0 && block.timestamp - pxTime[id] <= FRESH;
    }

    function usd(uint8 id, uint256 amt) public view returns (uint256) {
        if (px[id] == 0 || amt == 0) return 0;
        return amt * px[id] / (10 ** dec(id));
    }

    function pool(uint8 id)
        external
        view
        returns (uint256 cashAmt, uint256 outAmt, uint256 sharesAmt, uint256 price, uint64 at, uint8 stamp, bool ready)
    {
        return (cash[id], principalOut[id], totalShares[id], px[id], pxTime[id], stamps[id], fresh(id));
    }

    function account(uint8 id, address who) external view returns (uint256 supply, uint256 basis, uint256 shareAmt) {
        shareAmt = _live(id, who);
        if (shareAmt == 0) return (0, 0, 0);
        uint256 total = totalShares[id];
        supply = total == 0 ? 0 : shareAmt * (cash[id] + principalOut[id]) / total;
        basis = paidIn[id][who];
    }

    function loanCount(address who) external view returns (uint256) {
        return mine[who].length;
    }

    function loanOf(address who, uint256 index) external view returns (uint256) {
        return mine[who][index];
    }

    function myLoan(address who, uint256 index) external view returns (uint256 id, Loan memory row) {
        id = mine[who][index];
        row = loans[id];
    }

    function activeCount() external view returns (uint256) {
        return alive.length;
    }

    function activeId(uint256 index) external view returns (uint256) {
        return alive[index];
    }

    function activeLoan(uint256 index) external view returns (uint256 id, Loan memory row) {
        id = alive[index];
        row = loans[id];
    }

    function debtOf(uint256 id) public view returns (uint256) {
        Loan memory row = loans[id];
        if (!row.open) return 0;
        return _owed(row);
    }

    function poke(uint8 id) external lock {
        if (id >= count()) revert Bad();
        if (stable(id)) {
            px[id] = WAD;
            pxTime[id] = uint64(block.timestamp);
            stamps[id] = 3;
            warm[id] = true;
            emit Poked(id, WAD);
            return;
        }
        if (chain == 56 && id == 3 && !fresh(2)) revert Stale();
        if (chain == 196 && id == 2 && !fresh(1)) revert Stale();
        if (chain == 196 && (id == 3 || id == 4) && !fresh(2)) revert Stale();
        uint256 spotPx = _spot(id);
        if (spotPx == 0) revert Bad();
        uint256 prev = px[id];
        if (prev == 0) {
            px[id] = spotPx;
            pxTime[id] = uint64(block.timestamp);
            stamps[id] = 1;
            warm[id] = false;
            emit Poked(id, spotPx);
            return;
        }
        if (block.timestamp < uint256(pxTime[id]) + POKE_GAP) revert Early();
        uint256 room = prev / 200;
        if (room == 0) room = 1;
        uint256 next = spotPx;
        if (next > prev + room) next = prev + room;
        else if (next + room < prev) next = prev - room;
        bool near = spotPx * 10000 <= next * 10200 && next * 10000 <= spotPx * 10200;
        px[id] = next;
        pxTime[id] = uint64(block.timestamp);
        if (!near) {
            warm[id] = false;
            stamps[id] = 0;
        } else if (stamps[id] < 3) {
            stamps[id] += 1;
            if (stamps[id] >= 3) warm[id] = true;
        } else {
            warm[id] = true;
        }
        emit Poked(id, next);
    }

    function deposit(uint8 id, uint256 amount) external payable lock {
        if (id >= count() || amount == 0) revert Bad();
        _pull(id, amount);
        uint256 assets = cash[id] + principalOut[id];
        if (assets == 0 && totalShares[id] != 0) {
            epoch[id] += 1;
            totalShares[id] = 0;
        }
        _touch(id, msg.sender);
        uint256 total = totalShares[id];
        uint256 mintAmt = total == 0 ? amount : amount * total / assets;
        if (mintAmt == 0) revert Bad();
        shares[id][msg.sender] += mintAmt;
        totalShares[id] = total + mintAmt;
        cash[id] += amount;
        paidIn[id][msg.sender] += amount;
        emit Deposited(msg.sender, id, amount, mintAmt);
    }

    function withdraw(uint8 id, uint256 shareAmt) external lock {
        if (id >= count() || shareAmt == 0) revert Bad();
        uint256 have = _live(id, msg.sender);
        if (shareAmt > have) revert Bad();
        uint256 total = totalShares[id];
        uint256 assets = cash[id] + principalOut[id];
        uint256 amount = shareAmt * assets / total;
        if (amount == 0 || amount > cash[id]) revert Bad();
        uint256 basis = paidIn[id][msg.sender];
        uint256 cut = basis * shareAmt / have;
        shares[id][msg.sender] = have - shareAmt;
        paidIn[id][msg.sender] = basis - cut;
        totalShares[id] = total - shareAmt;
        cash[id] -= amount;
        _push(id, msg.sender, amount);
        emit Withdrawn(msg.sender, id, amount, shareAmt);
    }

    function open(uint8 coll, uint8 debt, uint8 term, uint256 collAmt, uint256 principal) external payable lock {
        if (coll >= count() || debt >= count() || coll == debt || term > 7) revert Bad();
        if (collAmt == 0 || principal == 0 || principal > cash[debt]) revert Bad();
        if (!fresh(coll) || !fresh(debt)) revert Stale();
        if (openLoans[msg.sender] >= MAX_LOANS) revert Bad();
        uint256 collUsd = usd(coll, collAmt);
        uint256 debtUsd = usd(debt, principal);
        if (debtUsd < MIN_USD || collUsd * OPEN_LTV < debtUsd * 10000) revert Bad();
        _pull(coll, collAmt);
        cash[debt] -= principal;
        principalOut[debt] += principal;
        uint256 id = ++nextId;
        uint64 start = uint64(block.timestamp);
        loans[id] = Loan({
            user: msg.sender,
            coll: coll,
            debt: debt,
            term: term,
            start: start,
            marked: start,
            due: start + duration(term),
            collAmt: collAmt,
            principal: principal,
            interest: 0,
            collUsd0: collUsd,
            debtUsd0: debtUsd,
            open: true
        });
        mine[msg.sender].push(id);
        openLoans[msg.sender] += 1;
        _track(id);
        _push(debt, msg.sender, principal);
        emit Opened(id, msg.sender, coll, debt, term, collAmt, principal);
    }

    function addColl(uint256 id, uint256 amount) external payable lock {
        Loan storage row = loans[id];
        if (!row.open || row.user != msg.sender || amount == 0) revert Bad();
        _pull(row.coll, amount);
        row.collAmt += amount;
    }

    function repay(uint256 id, uint256 amount) external payable lock {
        Loan storage row = loans[id];
        if (!row.open || amount == 0) revert Bad();
        _accrue(row);
        uint256 owed = row.principal + row.interest;
        if (owed == 0) revert Bad();
        uint256 pay = amount < owed ? amount : owed;
        _collect(row.debt, pay);
        _credit(row.debt, pay, row);
        emit Repaid(id, row.user, pay, row.principal + row.interest);
        if (row.principal == 0 && row.interest == 0) _close(id, row);
    }

    function liquidate(uint256 id) external payable lock {
        Loan storage row = loans[id];
        if (!row.open) revert ClosedBook();
        if (msg.sender == row.user) revert Bad();
        if (!fresh(row.coll) || !fresh(row.debt)) revert Stale();
        _accrue(row);
        uint256 owed = row.principal + row.interest;
        uint256 collUsd = usd(row.coll, row.collAmt);
        uint256 debtUsd = usd(row.debt, owed);
        if (owed == 0 || debtUsd == 0 || debtUsd * 10000 <= collUsd * LIQ_LTV) revert Bad();
        uint256 coverUsd = collUsd * 10000 / (10000 + BONUS_BPS);
        uint256 wantUsd = debtUsd < coverUsd ? debtUsd : coverUsd;
        uint256 pay = _usdToAmt(row.debt, wantUsd);
        if (pay > owed) pay = owed;
        if (pay == 0) revert Bad();
        _collect(row.debt, pay);
        _credit(row.debt, pay, row);
        uint256 paidUsd = usd(row.debt, pay);
        uint256 seize = coverUsd == 0 ? row.collAmt : row.collAmt * paidUsd / coverUsd;
        if (seize > row.collAmt) seize = row.collAmt;
        uint8 coll = row.coll;
        uint8 debt = row.debt;
        address user = row.user;
        row.collAmt -= seize;
        if (row.principal > 0) {
            principalOut[debt] -= row.principal;
            row.principal = 0;
            row.interest = 0;
        }
        uint256 left = row.collAmt;
        row.collAmt = 0;
        row.open = false;
        _finish(id, user);
        if (seize > 0) _push(coll, msg.sender, seize);
        if (left > 0) _push(coll, user, left);
        emit Liquidated(id, user, msg.sender, pay, seize);
        emit Closed(id);
    }

    function _owed(Loan memory row) internal view returns (uint256) {
        uint256 done = (block.timestamp - row.start) / HOUR;
        uint256 was = (uint256(row.marked) - row.start) / HOUR;
        if (done <= was) return row.principal + row.interest;
        uint256 span = (uint256(row.due) - row.start) / HOUR;
        uint256 rate = hourly(row.debt, row.term);
        uint256 add;
        if (was >= span) add = row.principal * rate * 2 * (done - was) / WAD;
        else if (done <= span) add = row.principal * rate * (done - was) / WAD;
        else {
            add = row.principal * rate * (span - was) / WAD;
            add += row.principal * rate * 2 * (done - span) / WAD;
        }
        return row.principal + row.interest + add;
    }

    function _accrue(Loan storage row) internal {
        if (!row.open) return;
        uint256 done = (block.timestamp - row.start) / HOUR;
        uint256 was = (uint256(row.marked) - row.start) / HOUR;
        if (done <= was) return;
        uint256 span = (uint256(row.due) - row.start) / HOUR;
        uint256 rate = hourly(row.debt, row.term);
        uint256 add;
        if (was >= span) add = row.principal * rate * 2 * (done - was) / WAD;
        else if (done <= span) add = row.principal * rate * (done - was) / WAD;
        else {
            add = row.principal * rate * (span - was) / WAD;
            add += row.principal * rate * 2 * (done - span) / WAD;
        }
        row.interest += add;
        row.marked = uint64(row.start + done * HOUR);
    }

    function _credit(uint8 id, uint256 pay, Loan storage row) internal {
        uint256 interestPay = pay < row.interest ? pay : row.interest;
        uint256 principalPay = pay - interestPay;
        row.interest -= interestPay;
        row.principal -= principalPay;
        principalOut[id] -= principalPay;
        cash[id] += pay;
        if (interestPay == 0) return;
        uint256 fee = interestPay * FEE_BPS / 10000;
        if (fee == 0) return;
        uint256 total = totalShares[id];
        uint256 base = cash[id] + principalOut[id] - fee;
        uint256 mintAmt;
        if (total == 0) mintAmt = fee;
        else if (base == 0) return;
        else mintAmt = fee * total / base;
        if (mintAmt == 0) return;
        _touch(id, safe);
        shares[id][safe] += mintAmt;
        totalShares[id] = total + mintAmt;
    }

    function _close(uint256 id, Loan storage row) internal {
        uint256 left = row.collAmt;
        address user = row.user;
        uint8 coll = row.coll;
        row.collAmt = 0;
        row.open = false;
        _finish(id, user);
        if (left > 0) _push(coll, user, left);
        emit Closed(id);
    }

    function _finish(uint256 id, address user) internal {
        if (openLoans[user] != 0) openLoans[user] -= 1;
        _untrack(id);
    }

    function _track(uint256 id) internal {
        alive.push(id);
        alivePos[id] = alive.length;
    }

    function _untrack(uint256 id) internal {
        uint256 pos = alivePos[id];
        if (pos == 0) return;
        uint256 last = alive[alive.length - 1];
        alive[pos - 1] = last;
        alivePos[last] = pos;
        alive.pop();
        alivePos[id] = 0;
    }

    function _live(uint8 id, address who) internal view returns (uint256) {
        if (seen[id][who] != epoch[id]) return 0;
        return shares[id][who];
    }

    function _touch(uint8 id, address who) internal {
        if (seen[id][who] == epoch[id]) return;
        shares[id][who] = 0;
        paidIn[id][who] = 0;
        seen[id][who] = epoch[id];
    }

    function _usdToAmt(uint8 id, uint256 usdAmt) internal view returns (uint256) {
        uint256 price = px[id];
        if (price == 0 || usdAmt == 0) return 0;
        return (usdAmt * (10 ** dec(id)) + price - 1) / price;
    }

    function _collect(uint8 id, uint256 amount) internal {
        if (id == nativeId()) {
            if (msg.value < amount) revert Bad();
            uint256 rest = msg.value - amount;
            if (rest > 0) {
                (bool ok, ) = msg.sender.call{value: rest}("");
                if (!ok) revert Bad();
            }
            return;
        }
        if (msg.value != 0) revert Bad();
        _take(tokenOf(id), amount);
    }

    function _pull(uint8 id, uint256 amount) internal {
        if (id == nativeId()) {
            if (msg.value != amount) revert Bad();
            return;
        }
        if (msg.value != 0) revert Bad();
        _take(tokenOf(id), amount);
    }

    function _push(uint8 id, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (id == nativeId()) {
            (bool ok, ) = to.call{value: amount}("");
            if (!ok) revert Bad();
            return;
        }
        _give(tokenOf(id), to, amount);
    }

    function _take(address asset, uint256 amount) internal {
        uint256 beforeBal = _bal(asset);
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSelector(0x23b872dd, msg.sender, address(this), amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert Bad();
        if (_bal(asset) < beforeBal + amount) revert Bad();
    }

    function _give(address asset, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = asset.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert Bad();
    }

    function _bal(address asset) internal view returns (uint256) {
        (bool ok, bytes memory data) = asset.staticcall(abi.encodeWithSelector(0x70a08231, address(this)));
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint256));
    }

    function _spot(uint8 id) internal returns (uint256) {
        if (chain == 56) return _spotBsc(id);
        return _spotX(id);
    }

    function _spotBsc(uint8 id) internal returns (uint256) {
        if (id == 1) {
            return _v3(0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997, 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c, 0x55d398326f99059fF775485246999027B3197955, 100, 1e18);
        }
        if (id == 2) {
            return _v3(0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997, 0x5ce033B2bFCa3Af30b3e8C8457DeaF776A8b695a, 0x55d398326f99059fF775485246999027B3197955, 10000, 1e8);
        }
        if (id == 3) {
            if (px[2] == 0) revert Bad();
            uint256 bem = _upBem(1e18);
            return bem * px[2] / 1e8;
        }
        revert Bad();
    }

    function _spotX(uint8 id) internal returns (uint256) {
        if (id == 1) return _v2(1e18) * 1e12;
        if (id == 2) {
            if (px[1] == 0) revert Bad();
            uint256 okb = _v3(0x976183AC3d09840D243A88c0268BADb3B3e3259f, 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952, 0xe538905cf8410324e03A5A23C1c177a474D59b2b, 10000, 1e8);
            return okb * px[1] / WAD;
        }
        if (id == 3) {
            if (px[2] == 0) revert Bad();
            uint256 bemOut = _tape(1e8);
            if (bemOut == 0) revert Bad();
            return bemOut * px[2] / 1e8;
        }
        if (id == 4) {
            if (px[2] == 0) revert Bad();
            uint256 bem = _fab(1e8);
            return bem * px[2] / 1e8;
        }
        revert Bad();
    }

    function _v3(address quoter, address tokenIn, address tokenOut, uint24 fee, uint256 amountIn) internal returns (uint256) {
        (uint256 out,,,) = IV3Quoter(quoter).quoteExactInputSingle(
            IV3Quoter.Params({ tokenIn: tokenIn, tokenOut: tokenOut, amountIn: amountIn, fee: fee, sqrtPriceLimitX96: 0 })
        );
        return out;
    }

    function _v2(uint256 amountIn) internal view returns (uint256) {
        address[] memory path = new address[](2);
        path[0] = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
        path[1] = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
        uint256[] memory amounts = IV2Router(0x881fB2f98c13d521009464e7D1CBf16E1b394e8E).getAmountsOut(amountIn, path);
        return amounts[amounts.length - 1];
    }

    /// Open-pool quote 0 pays BEM (8 decimals), not USDT0.
    function _tape(uint256 amountIn) internal view returns (uint256) {
        (, uint256 out) = ITapePool(0x58eaD5b41Cfd3627791D439402dd65571c286484).previewSwap(0, true, amountIn);
        return out;
    }

    function _upBem(uint256 amountIn) internal view returns (uint256) {
        (,,,, uint256 net) = IUpPool(0xDf40529fa3E797c992272e27B811E59E5f1827Ae).quoteSell(amountIn);
        return net;
    }

    function _fab(uint256 amountIn) internal returns (uint256) {
        IFabQuoter.PoolKey memory key = IFabQuoter.PoolKey({
            currency0: 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952,
            currency1: 0x72F349B1Eee7833B26f8C81a8410775A4e231ed2,
            fee: 9000,
            tickSpacing: 180,
            hooks: address(0)
        });
        (uint256 out, ) = IFabQuoter(0x8928074CA1b241D8Ec02815881c1Af11E8bC5219).quoteExactInputSingle(
            IFabQuoter.Params({ poolKey: key, zeroForOne: false, exactAmount: uint128(amountIn), hookData: "" })
        );
        return out;
    }
}
