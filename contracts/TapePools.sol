// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Two locked pools: TAPE/USDT0 and TAPE/BEM. No owner, no rate setter, no rescue.
/// A deposit is a stake. The only terms are 90, 180, 365, 730 and 1095 days.
contract TapePools {
    address public constant TAPE = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;
    address public constant USDT = 0x779Ded0c9e1022225f8E0630b35a9b54bE713736;
    address public constant BEM = 0x60e62Efa9405d6873C5deaBD4E6CC91c25363952;
    address public constant FEE_TO = 0x823b9F6A93Ac44Ce5A469823A336c15b6117054D;
    uint256 public constant FEE_BPS = 20;
    /// 5,000 USDT0 on the quote side. At a balanced price that is about 10,000 dollars.
    uint256 public constant OPEN_USDT = 5_000 * 10 ** 6;
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

    Pool public usdtPool;
    Pool public bemPool;
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
        Pool memory p = quote == 0 ? usdtPool : bemPool;
        fee = (amountIn * FEE_BPS) / 10_000;
        uint256 net = amountIn - fee;
        if (tapeIn) out = p.tape == 0 ? 0 : (p.quote * net) / (p.tape + net);
        else out = p.quote == 0 ? 0 : (p.tape * net) / (p.quote + net);
    }

    function add(uint8 quote, uint8 term, uint256 tapeIn, uint256 quoteIn) external lock returns (uint256 id) {
        require(tapeIn > 0 && quoteIn > 0, "amt");
        uint256 dur = termOf(term);
        Pool storage p = _pool(quote);
        uint256 tapeFee = (tapeIn * FEE_BPS) / 10_000;
        uint256 quoteFee = (quoteIn * FEE_BPS) / 10_000;
        uint256 tapeNet = tapeIn - tapeFee;
        uint256 quoteNet = quoteIn - quoteFee;
        uint256 mintShares;
        if (p.shares == 0) {
            mintShares = _sqrt(tapeNet * quoteNet);
            require(mintShares > DEAD_SHARES, "min");
            p.shares = DEAD_SHARES;
            mintShares -= DEAD_SHARES;
        } else {
            uint256 byTape = (tapeNet * p.shares) / p.tape;
            uint256 byQuote = (quoteNet * p.shares) / p.quote;
            mintShares = byTape < byQuote ? byTape : byQuote;
        }
        require(mintShares > 0, "shares");
        _pull(TAPE, tapeIn);
        _pull(quote == 0 ? USDT : BEM, quoteIn);
        _push(TAPE, FEE_TO, tapeFee);
        _push(quote == 0 ? USDT : BEM, FEE_TO, quoteFee);
        p.tape += tapeNet;
        p.quote += quoteNet;
        p.shares += mintShares;
        id = nextId++;
        uint64 unlock = uint64(block.timestamp + dur);
        position[id] = Position(msg.sender, quote, term, unlock, mintShares);
        _owned[msg.sender].push(id);
        if (!live && usdtPool.quote >= OPEN_USDT) live = true;
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
        address quoteToken = pos.quote == 0 ? USDT : BEM;
        _push(TAPE, FEE_TO, tapeFee);
        _push(quoteToken, FEE_TO, quoteFee);
        _push(TAPE, msg.sender, tapeGross - tapeFee);
        _push(quoteToken, msg.sender, quoteGross - quoteFee);
        emit Removed(id, msg.sender, tapeGross - tapeFee, quoteGross - quoteFee);
    }

    function swap(uint8 quote, bool tapeIn, uint256 amountIn, uint256 minOut) external lock returns (uint256 out) {
        require(live, "closed");
        require(amountIn > 0, "amt");
        Pool storage p = _pool(quote);
        uint256 fee = (amountIn * FEE_BPS) / 10_000;
        uint256 net = amountIn - fee;
        address quoteToken = quote == 0 ? USDT : BEM;
        if (tapeIn) {
            out = (p.quote * net) / (p.tape + net);
            require(out >= minOut && out < p.quote, "out");
            _pull(TAPE, amountIn);
            _push(TAPE, FEE_TO, fee);
            p.tape += net;
            p.quote -= out;
            _push(quoteToken, msg.sender, out);
        } else {
            out = (p.tape * net) / (p.quote + net);
            require(out >= minOut && out < p.tape, "out");
            _pull(quoteToken, amountIn);
            _push(quoteToken, FEE_TO, fee);
            p.quote += net;
            p.tape -= out;
            _push(TAPE, msg.sender, out);
        }
        emit Swapped(msg.sender, quote, tapeIn, amountIn, out);
    }

    function _pool(uint8 quote) internal view returns (Pool storage) {
        require(quote <= 1, "quote");
        return quote == 0 ? usdtPool : bemPool;
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
