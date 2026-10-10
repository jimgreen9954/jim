// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Timed stake. No admin and no upgrade.
/// Terms are 90, 180, 270, 365, 730 and 1095 days. Principal cannot leave early.
/// A reward deposit belongs to the address that paid it. Only that address withdraws what has not vested.
contract TapeTerm {
    IERC20 public constant TAPE = IERC20(0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3);
    IERC20 public constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);
    uint256 public constant YEAR = 365 days;
    uint256 private constant SCALE = 1e18;
    uint256 private constant MAX_LOCKS = 16;
    uint256 private entered = 1;

    struct Pool {
        uint256 staked;
        uint256 pot;
        uint256 bucket;
        uint256 acc;
        uint256 last;
        uint256 sponsorIndex;
        uint256 sponsorTotal;
    }
    struct Seat {
        uint256 amount;
        uint256 debt;
    }
    struct Fund {
        uint256 amount;
        uint256 debt;
    }
    struct Lock {
        uint128 amount;
        uint64 unlock;
        uint8 term;
        bool open;
    }

    Pool public tapeStake;
    Pool public bemStake;
    mapping(address => Seat) public tapeSeat;
    mapping(address => Seat) public bemSeat;
    mapping(address => Fund) public bemFund;
    mapping(address => Fund) public tapeFund;
    mapping(address => Lock[]) private tapeLocks;
    mapping(address => Lock[]) private bemLocks;

    modifier lock() {
        require(entered == 1, "reenter");
        entered = 2;
        _;
        entered = 1;
    }

    function termSeconds(uint8 term) public pure returns (uint256) {
        if (term == 0) return 90 days;
        if (term == 1) return 180 days;
        if (term == 2) return 270 days;
        if (term == 3) return 365 days;
        if (term == 4) return 730 days;
        if (term == 5) return 1095 days;
        revert("term");
    }

    function stakeTape(uint256 amount, uint8 term) external lock {
        _open(tapeLocks[msg.sender], amount, term);
        _stake(tapeStake, tapeSeat[msg.sender], BEM, amount);
        _pull(TAPE, amount);
    }

    function unstakeTape(uint256 index) external lock {
        uint256 amount = _close(tapeLocks[msg.sender], index);
        _unstake(tapeStake, tapeSeat[msg.sender], BEM, amount);
        _push(TAPE, amount);
    }

    function claimBem() external lock {
        _claim(tapeStake, tapeSeat[msg.sender], BEM);
    }

    function fundBem(uint256 amount) external lock {
        _fund(tapeStake, bemFund[msg.sender], amount);
        _pull(BEM, amount);
    }

    function withdrawBem(uint256 amount) external lock {
        _unfund(tapeStake, bemFund[msg.sender], amount);
        _push(BEM, amount);
    }

    function stakeBem(uint256 amount, uint8 term) external lock {
        _open(bemLocks[msg.sender], amount, term);
        _stake(bemStake, bemSeat[msg.sender], TAPE, amount);
        _pull(BEM, amount);
    }

    function unstakeBem(uint256 index) external lock {
        uint256 amount = _close(bemLocks[msg.sender], index);
        _unstake(bemStake, bemSeat[msg.sender], TAPE, amount);
        _push(BEM, amount);
    }

    function claimTape() external lock {
        _claim(bemStake, bemSeat[msg.sender], TAPE);
    }

    function fundTape(uint256 amount) external lock {
        _fund(bemStake, tapeFund[msg.sender], amount);
        _pull(TAPE, amount);
    }

    function withdrawTapeReward(uint256 amount) external lock {
        _unfund(bemStake, tapeFund[msg.sender], amount);
        _push(TAPE, amount);
    }

    function tapeLockCount(address user) external view returns (uint256) {
        return tapeLocks[user].length;
    }

    function bemLockCount(address user) external view returns (uint256) {
        return bemLocks[user].length;
    }

    function tapeLock(address user, uint256 index) external view returns (uint128 amount, uint64 unlock, uint8 term, bool open) {
        Lock memory row = tapeLocks[user][index];
        return (row.amount, row.unlock, row.term, row.open);
    }

    function bemLock(address user, uint256 index) external view returns (uint128 amount, uint64 unlock, uint8 term, bool open) {
        Lock memory row = bemLocks[user][index];
        return (row.amount, row.unlock, row.term, row.open);
    }

    function tapeStakeOf(address user) external view returns (uint256 amount, uint256 bemOwed) {
        (uint256 acc,,) = _preview(tapeStake);
        Seat memory s = tapeSeat[user];
        return (s.amount, s.amount * acc / SCALE - s.debt);
    }

    function bemStakeOf(address user) external view returns (uint256 amount, uint256 tapeOwed) {
        (uint256 acc,,) = _preview(bemStake);
        Seat memory s = bemSeat[user];
        return (s.amount, s.amount * acc / SCALE - s.debt);
    }

    function bemSponsorOf(address user) external view returns (uint256 left) {
        (,, uint256 index) = _preview(tapeStake);
        Fund memory f = bemFund[user];
        if (f.amount == 0) return 0;
        return f.amount - (f.amount * index / SCALE - f.debt);
    }

    function tapeSponsorOf(address user) external view returns (uint256 left) {
        (,, uint256 index) = _preview(bemStake);
        Fund memory f = tapeFund[user];
        if (f.amount == 0) return 0;
        return f.amount - (f.amount * index / SCALE - f.debt);
    }

    function tapeStakePot() external view returns (uint256 staked, uint256 pot) {
        (, uint256 left,) = _preview(tapeStake);
        return (tapeStake.staked, left);
    }

    function bemStakePot() external view returns (uint256 staked, uint256 pot) {
        (, uint256 left,) = _preview(bemStake);
        return (bemStake.staked, left);
    }

    function _open(Lock[] storage rows, uint256 amount, uint8 term) internal {
        require(amount > 0 && amount <= type(uint128).max, "amount");
        uint256 span = termSeconds(term);
        uint256 n = rows.length;
        uint256 slot = n;
        uint256 openCount;
        for (uint256 i; i < n; i++) {
            if (rows[i].open) openCount++;
            else if (slot == n) slot = i;
        }
        require(openCount < MAX_LOCKS, "full");
        Lock memory next = Lock(uint128(amount), uint64(block.timestamp + span), term, true);
        if (slot == n) rows.push(next);
        else rows[slot] = next;
    }

    function _close(Lock[] storage rows, uint256 index) internal returns (uint256 amount) {
        Lock storage row = rows[index];
        require(row.open && block.timestamp >= row.unlock, "early");
        amount = row.amount;
        row.open = false;
        row.amount = 0;
    }

    function _preview(Pool storage p) internal view returns (uint256 acc, uint256 pot, uint256 index) {
        acc = p.acc;
        pot = p.pot;
        index = p.sponsorIndex;
        if (p.staked == 0 || p.pot == 0 || p.sponsorTotal == 0 || block.timestamp == p.last) return (acc, pot, index);
        uint256 release = p.pot * (block.timestamp - p.last) / YEAR;
        if (release == 0) return (acc, pot, index);
        if (release > p.pot) release = p.pot;
        return (acc + release * SCALE / p.staked, pot - release, index + release * SCALE / p.sponsorTotal);
    }

    function _drip(Pool storage p) internal {
        if (p.staked == 0 || p.pot == 0 || p.sponsorTotal == 0) {
            p.last = block.timestamp;
            return;
        }
        uint256 dt = block.timestamp - p.last;
        uint256 release = p.pot * dt / YEAR;
        if (release == 0) return;
        if (release > p.pot) release = p.pot;
        p.acc += release * SCALE / p.staked;
        p.sponsorIndex += release * SCALE / p.sponsorTotal;
        p.pot -= release;
        p.last = block.timestamp;
    }

    function _stake(Pool storage p, Seat storage s, IERC20 reward, uint256 amount) internal {
        _drip(p);
        _pay(p, s, reward);
        s.amount += amount;
        p.staked += amount;
        s.debt = s.amount * p.acc / SCALE;
    }

    function _unstake(Pool storage p, Seat storage s, IERC20 reward, uint256 amount) internal {
        require(amount > 0 && amount <= s.amount, "amount");
        _drip(p);
        _pay(p, s, reward);
        s.amount -= amount;
        p.staked -= amount;
        s.debt = s.amount * p.acc / SCALE;
    }

    function _claim(Pool storage p, Seat storage s, IERC20 reward) internal {
        _drip(p);
        _pay(p, s, reward);
    }

    function _pay(Pool storage p, Seat storage s, IERC20 reward) internal {
        uint256 owed = s.amount * p.acc / SCALE - s.debt;
        s.debt = s.amount * p.acc / SCALE;
        if (owed == 0) return;
        require(owed <= p.bucket - p.pot, "reward");
        p.bucket -= owed;
        _push(reward, owed);
    }

    function _fund(Pool storage p, Fund storage f, uint256 amount) internal {
        require(amount > 0, "amount");
        _drip(p);
        _settleFund(p, f);
        f.amount += amount;
        p.sponsorTotal += amount;
        p.pot += amount;
        p.bucket += amount;
        f.debt = f.amount * p.sponsorIndex / SCALE;
    }

    function _unfund(Pool storage p, Fund storage f, uint256 amount) internal {
        _drip(p);
        _settleFund(p, f);
        require(amount > 0 && amount <= f.amount && amount <= p.pot, "amount");
        f.amount -= amount;
        p.sponsorTotal -= amount;
        p.pot -= amount;
        p.bucket -= amount;
        f.debt = f.amount * p.sponsorIndex / SCALE;
    }

    function _settleFund(Pool storage p, Fund storage f) internal {
        if (f.amount == 0) return;
        uint256 burned = f.amount * p.sponsorIndex / SCALE - f.debt;
        require(burned <= f.amount, "fund");
        f.amount -= burned;
        p.sponsorTotal -= burned;
        f.debt = f.amount * p.sponsorIndex / SCALE;
    }

    function _pull(IERC20 token, uint256 amount) internal {
        _move(address(token), abi.encodeWithSelector(IERC20.transferFrom.selector, msg.sender, address(this), amount));
    }

    function _push(IERC20 token, uint256 amount) internal {
        _move(address(token), abi.encodeWithSelector(IERC20.transfer.selector, msg.sender, amount));
    }

    function _move(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "token");
    }
}
