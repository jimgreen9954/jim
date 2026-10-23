// Compile with solc 0.8.37, optimizer 200 runs, via IR, Cancun.
// The page deploys the matching bytecode. A Remix build without via IR does not fit.
pragma solidity 0.8.37;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IWOKB {
    function deposit() external payable;
    function withdraw(uint256) external;
}

/// TAPE/BEM and TAPE/OKB. No USDT. No owner, no rate setter, no rescue.
/// The old USDT pool at 0x96dA5acDf8Fb8d3A6Ab742871CEA6167694a8641 is not this contract.
/// Trading opens only after the BEM side holds 100 BEM and the OKB side holds 61 OKB.
/// Those two first deposits are not charged. Later adds, swaps and removes still pay 0.20%.
/// Until trading is open, only the fee address can add. A deposit is a stake.
/// The only terms are 90, 180, 365, 730 and 1095 days.
contract TapePools {
    address public constant TAPE = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
    address public constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address public constant WOKB = 0xe538905cf8410324e03A5A23C1c177a474D59b2b;
    address public constant FEE_TO = 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D;
    uint256 public constant FEE_BPS = 20;
    uint256 public constant OPEN_BEM = 100 * 10 ** 8;
    uint256 public constant OPEN_OKB = 61 ether;
    uint256 public constant DEAD_SHARES = 1_000;

    struct Pool {
        uint256 tape;
        uint256 quote;
        uint256 shares;
    }

    struct Position {
        address owner;
        uint8 quote;
        uint8 term;
        uint64 unlock;
        uint256 shares;
    }

    Pool public bemPool;
    Pool public okbPool;
    bool public live;
    uint256 public nextId = 1;
    mapping(uint256 => Position) public position;
    mapping(address => uint256[]) private _owned;
    uint256 private locked;

    event Added(uint256 indexed id, address indexed owner, uint8 quote, uint8 term, uint256 shares, uint64 unlock);
    event Removed(uint256 indexed id, address indexed owner, uint256 tapeOut, uint256 quoteOut);
    event Swapped(address indexed sender, uint8 quote, bool tapeIn, uint256 amountIn, uint256 amountOut);

    modifier lock() {
        require(locked == 0, "re");
        locked = 1;
        _;
        locked = 0;
    }

    receive() external payable {
        require(msg.sender == WOKB, "wokb");
    }

    function termOf(uint8 term) public pure returns (uint256) {
        if (term == 0) return 90 days;
        if (term == 1) return 180 days;
        if (term == 2) return 365 days;
        if (term == 3) return 730 days;
        if (term == 4) return 1095 days;
        revert("term");
    }

    function ownedCount(address owner) external view returns (uint256) {
        return _owned[owner].length;
    }

    function ownedId(address owner, uint256 index) external view returns (uint256) {
        return _owned[owner][index];
    }

    function previewSwap(uint8 quote, bool tapeIn, uint256 amountIn) external view returns (uint256 fee, uint256 out) {
        Pool memory p = quote == 0 ? bemPool : okbPool;
        fee = (amountIn * FEE_BPS) / 10_000;
        uint256 net = amountIn - fee;
        if (tapeIn) out = p.tape == 0 ? 0 : (p.quote * net) / (p.tape + net);
        else out = p.quote == 0 ? 0 : (p.tape * net) / (p.quote + net);
    }

    function add(uint8 quote, uint8 term, uint256 tapeIn, uint256 quoteIn) external payable lock returns (uint256 id) {
        require(tapeIn > 0 && quoteIn > 0, "amt");
        if (!live) require(msg.sender == FEE_TO, "seed");
        uint256 dur = termOf(term);
        Pool storage p = _pool(quote);
        _pull(TAPE, tapeIn);
        _takeQuote(quote, quoteIn);
        uint256 mintShares;
        uint256 tapeKeep;
        uint256 quoteKeep;
        if (p.shares == 0) {
            mintShares = _sqrt(tapeIn * quoteIn);
            require(mintShares > DEAD_SHARES, "min");
            p.shares = DEAD_SHARES;
            mintShares -= DEAD_SHARES;
            tapeKeep = tapeIn;
            quoteKeep = quoteIn;
        } else {
            uint256 tapeNet = tapeIn - (tapeIn * FEE_BPS) / 10_000;
            uint256 quoteNet = quoteIn - (quoteIn * FEE_BPS) / 10_000;
            uint256 byTape = (tapeNet * p.shares) / p.tape;
            uint256 byQuote = (quoteNet * p.shares) / p.quote;
            mintShares = byTape < byQuote ? byTape : byQuote;
            require(mintShares > 0, "shares");
            tapeKeep = (mintShares * p.tape) / p.shares;
            quoteKeep = (mintShares * p.quote) / p.shares;
            require(tapeKeep > 0 && quoteKeep > 0 && tapeKeep <= tapeNet && quoteKeep <= quoteNet, "dust");
            uint256 tapeFee = (tapeKeep * FEE_BPS) / (10_000 - FEE_BPS);
            uint256 quoteFee = (quoteKeep * FEE_BPS) / (10_000 - FEE_BPS);
            if (tapeKeep + tapeFee > tapeIn) tapeFee = tapeIn - tapeKeep;
            if (quoteKeep + quoteFee > quoteIn) quoteFee = quoteIn - quoteKeep;
            _push(TAPE, FEE_TO, tapeFee);
            _giveQuote(quote, FEE_TO, quoteFee);
            _push(TAPE, msg.sender, tapeIn - tapeKeep - tapeFee);
            _giveQuote(quote, msg.sender, quoteIn - quoteKeep - quoteFee);
        }
        p.tape += tapeKeep;
        p.quote += quoteKeep;
        p.shares += mintShares;
        id = nextId++;
        uint64 unlock = uint64(block.timestamp + dur);
        position[id] = Position(msg.sender, quote, term, unlock, mintShares);
        _owned[msg.sender].push(id);
        if (!live && bemPool.quote >= OPEN_BEM && okbPool.quote >= OPEN_OKB) live = true;
        emit Added(id, msg.sender, quote, term, mintShares, unlock);
    }

    function remove(uint256 id) external lock {
        Position memory pos = position[id];
        require(pos.owner == msg.sender, "owner");
        require(block.timestamp >= pos.unlock, "lock");
        Pool storage p = _pool(pos.quote);
        uint256 tapeGross = (pos.shares * p.tape) / p.shares;
        uint256 quoteGross = (pos.shares * p.quote) / p.shares;
        require(tapeGross > 0 && quoteGross > 0, "dust");
        uint256 tapeFee = (tapeGross * FEE_BPS) / 10_000;
        uint256 quoteFee = (quoteGross * FEE_BPS) / 10_000;
        p.tape -= tapeGross;
        p.quote -= quoteGross;
        p.shares -= pos.shares;
        delete position[id];
        _push(TAPE, FEE_TO, tapeFee);
        _giveQuote(pos.quote, FEE_TO, quoteFee);
        _push(TAPE, msg.sender, tapeGross - tapeFee);
        _giveQuote(pos.quote, msg.sender, quoteGross - quoteFee);
        emit Removed(id, msg.sender, tapeGross - tapeFee, quoteGross - quoteFee);
    }

    function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) external payable lock returns (uint256 out) {
        require(live, "closed");
        require(amountIn > 0, "amt");
        Pool storage p = _pool(quote);
        uint256 fee = (amountIn * FEE_BPS) / 10_000;
        uint256 net = amountIn - fee;
        if (tapeIn) {
            require(msg.value == 0, "value");
            out = (p.quote * net) / (p.tape + net);
            require(out >= minOut && out < p.quote, "out");
            _pull(TAPE, amountIn);
            _push(TAPE, FEE_TO, fee);
            p.tape += net;
            p.quote -= out;
            _giveQuote(quote, msg.sender, out);
        } else {
            out = (p.tape * net) / (p.quote + net);
            require(out >= minOut && out < p.tape, "out");
            _takeQuote(quote, amountIn);
            _giveQuote(quote, FEE_TO, fee);
            p.quote += net;
            p.tape -= out;
            _push(TAPE, msg.sender, out);
        }
        emit Swapped(msg.sender, quote, tapeIn, amountIn, out);
    }

    function _pool(uint8 quote) internal view returns (Pool storage) {
        require(quote <= 1, "quote");
        return quote == 0 ? bemPool : okbPool;
    }

    function _takeQuote(uint8 quote, uint256 amount) internal {
        if (quote == 0) {
            require(msg.value == 0, "value");
            _pull(BEM, amount);
            return;
        }
        if (msg.value > 0) {
            require(msg.value == amount, "value");
            IWOKB(WOKB).deposit{value: msg.value}();
            return;
        }
        _pull(WOKB, amount);
    }

    function _giveQuote(uint8 quote, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (quote == 0) {
            _push(BEM, to, amount);
            return;
        }
        IWOKB(WOKB).withdraw(amount);
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "okb");
    }

    function _pull(address token, uint256 amount) internal {
        uint256 beforeBal = IERC20(token).balanceOf(address(this));
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), "pull");
        require(IERC20(token).balanceOf(address(this)) - beforeBal == amount, "short");
    }

    function _push(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        require(IERC20(token).transfer(to, amount), "push");
    }

    function _sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }
}
