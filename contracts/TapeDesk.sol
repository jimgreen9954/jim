// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// Fixed bid for TAPE, plus two stake pools. No admin and no upgrade.
/// A deposit belongs to the address that paid it. Only that address withdraws what is still its own.
/// 1 whole TAPE sells for 0.1 USDT0. The TAPE is then owed to the USDT0 depositors.
/// Stake rewards vest the current pot over 365 days. A sponsor can take back only the part not vested yet.
contract TapeDesk {
    IERC20 public constant TAPE = IERC20(0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3);
    IERC20 public constant USDT = IERC20(0x779Ded0c9e1022225f8E0630b35a9b54bE713736);
    IERC20 public constant BEM = IERC20(0x60e62Efa9405d6873C5deaBD4E6CC91c25363952);
    uint256 public constant UNIT = 100_000_000;
    uint256 public constant PRICE = 100_000;
    uint256 public constant YEAR = 365 days;
    uint256 private constant SCALE = 1e18;
    uint256 private entered = 1;

    uint256 public tapeIndex;
    uint256 public spentIndex;
    uint256 public totalShare;
    uint256 public usdtPool;
    uint256 public tapeBought;

    struct Bid {
        uint256 share;
        uint256 tapeCredit;
        uint256 tapeDebt;
        uint256 spentDebt;
    }
    mapping(address => Bid) public bids;

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

    Pool public tapeStake;
    Pool public bemStake;
    mapping(address => Seat) public tapeSeat;
    mapping(address => Seat) public bemSeat;
    mapping(address => Fund) public bemFund;
    mapping(address => Fund) public tapeFund;

    modifier lock() {
        require(entered == 1, "reenter");
        entered = 2;
        _;
        entered = 1;
    }

    function fundUsdt(uint256 amount) external lock {
        require(amount > 0, "amount");
        _settleBid(msg.sender);
        _pull(USDT, amount);
        Bid storage b = bids[msg.sender];
        b.share += amount;
        totalShare += amount;
        usdtPool += amount;
        b.spentDebt = b.share * spentIndex / SCALE;
        b.tapeDebt = b.share * tapeIndex / SCALE;
    }

    function withdrawUsdt(uint256 amount) external lock {
        _settleBid(msg.sender);
        Bid storage b = bids[msg.sender];
        require(amount > 0 && amount <= b.share && amount <= usdtPool, "amount");
        b.share -= amount;
        totalShare -= amount;
        usdtPool -= amount;
        b.spentDebt = b.share * spentIndex / SCALE;
        b.tapeDebt = b.share * tapeIndex / SCALE;
        _push(USDT, amount);
    }

    function withdrawTape(uint256 amount) external lock {
        _settleBid(msg.sender);
        Bid storage b = bids[msg.sender];
        require(amount > 0 && amount <= b.tapeCredit && amount <= tapeBought, "amount");
        b.tapeCredit -= amount;
        tapeBought -= amount;
        _push(TAPE, amount);
    }

    function sell(uint256 tapeAmount) external lock {
        require(tapeAmount >= UNIT && tapeAmount % UNIT == 0, "integer");
        uint256 cost = tapeAmount / UNIT * PRICE;
        require(totalShare > 0 && usdtPool >= cost, "pool");
        usdtPool -= cost;
        tapeBought += tapeAmount;
        tapeIndex += tapeAmount * SCALE / totalShare;
        spentIndex += cost * SCALE / totalShare;
        _pull(TAPE, tapeAmount);
        _push(USDT, cost);
    }

    function stakeTape(uint256 amount) external lock {
        _stake(tapeStake, tapeSeat[msg.sender], BEM, amount);
        _pull(TAPE, amount);
    }

    function unstakeTape(uint256 amount) external lock {
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

    function stakeBem(uint256 amount) external lock {
        _stake(bemStake, bemSeat[msg.sender], TAPE, amount);
        _pull(BEM, amount);
    }

    function unstakeBem(uint256 amount) external lock {
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

    function bidOf(address user) external view returns (uint256 usdtLeft, uint256 tapeOwed) {
        Bid memory b = bids[user];
        if (b.share == 0) return (0, b.tapeCredit);
        uint256 spent = b.share * spentIndex / SCALE - b.spentDebt;
        uint256 got = b.share * tapeIndex / SCALE - b.tapeDebt;
        return (b.share - spent, b.tapeCredit + got);
    }

    function sellCost(uint256 tapeAmount) external pure returns (uint256) {
        if (tapeAmount < UNIT || tapeAmount % UNIT != 0) return 0;
        return tapeAmount / UNIT * PRICE;
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

    function _settleBid(address user) internal {
        Bid storage b = bids[user];
        if (b.share == 0) return;
        uint256 spent = b.share * spentIndex / SCALE - b.spentDebt;
        uint256 got = b.share * tapeIndex / SCALE - b.tapeDebt;
        require(spent <= b.share, "share");
        b.tapeCredit += got;
        b.share -= spent;
        totalShare -= spent;
        b.spentDebt = b.share * spentIndex / SCALE;
        b.tapeDebt = b.share * tapeIndex / SCALE;
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
        require(amount > 0, "amount");
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
