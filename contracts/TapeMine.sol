// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface ITapeCircuits {
    function ownerOf(uint256 id) external view returns (address);
    function circuitInfo(uint256 id) external view returns (uint256 inputs, uint256 outputs, uint256 state, uint256 gates);
}

contract TapeToken {
    string public constant name = "TAPELIQUID";
    string public constant symbol = "TAPE";
    uint8 public constant decimals = 8;
    uint256 public constant CAP = 21_000_000 * 10 ** 8;
    uint256 public totalSupply;
    address public immutable miner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(address miner_) {
        miner = miner_;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == miner, "miner");
        require(totalSupply + amount <= CAP, "cap");
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "bal");
        unchecked {
            balanceOf[msg.sender] -= amount;
        }
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allow");
            allowance[from][msg.sender] = allowed - amount;
        }
        require(balanceOf[from] >= amount, "bal");
        unchecked {
            balanceOf[from] -= amount;
        }
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// Emission matches BEM: 21,000,000 cap, 8 decimals, 7,200 per day, halving every 210,000 * 600 seconds.
/// Weight is the gate count of a TAPELIQUID circuit the wallet still holds. It is not the official task score.
contract TapeMine {
    uint256 public constant DAY = 7200 * 10 ** 8;
    uint256 public constant HALVING = 210_000 * 600;
    uint256 public constant SCALE = 1e18;
    ITapeCircuits public constant CPU = ITapeCircuits(0x69F663931209096037474d7C20402232E5C762cA);

    TapeToken public immutable token;
    uint256 public immutable start;
    uint256 public totalWeight;
    uint256 public acc;
    uint256 public last;

    struct Seat {
        address owner;
        uint256 weight;
        uint256 paid;
        bool on;
    }

    mapping(uint256 => Seat) public seat;

    event Opened(uint256 indexed id, address indexed owner, uint256 weight);
    event Claimed(uint256 indexed id, address indexed to, uint256 amount);
    event Closed(uint256 indexed id, address indexed previous);

    constructor() {
        token = new TapeToken(address(this));
        start = block.timestamp;
        last = block.timestamp;
    }

    function _reward(uint256 from, uint256 to) internal view returns (uint256 reward) {
        while (from < to) {
            uint256 era = (from - start) / HALVING;
            uint256 eraEnd = start + (era + 1) * HALVING;
            uint256 stop = eraEnd < to ? eraEnd : to;
            if (era < 64) reward += ((DAY / 1 days) >> era) * (stop - from);
            from = stop;
        }
    }

    function _preview() internal view returns (uint256 nextAcc, uint256 nextLast) {
        nextLast = block.timestamp;
        nextAcc = acc;
        if (nextLast <= last || totalWeight == 0) return (nextAcc, nextLast);
        uint256 reward = _reward(last, nextLast);
        uint256 room = 21_000_000 * 10 ** 8 - token.totalSupply();
        if (reward > room) reward = room;
        if (reward > 0) nextAcc += (reward * SCALE) / totalWeight;
    }

    function _accrue() internal {
        (uint256 nextAcc, uint256 nextLast) = _preview();
        acc = nextAcc;
        last = nextLast;
    }

    function pendingOf(uint256 id) external view returns (uint256) {
        Seat storage s = seat[id];
        if (!s.on || s.weight == 0) return 0;
        (uint256 nextAcc,) = _preview();
        return ((nextAcc - s.paid) * s.weight) / SCALE;
    }

    function open(uint256 id) external {
        _accrue();
        _closeIfMoved(id);
        require(CPU.ownerOf(id) == msg.sender, "owner");
        (,,, uint256 gates) = CPU.circuitInfo(id);
        require(gates > 0 && gates <= 200_000, "gates");
        Seat storage s = seat[id];
        if (s.on) {
            _pay(id);
            totalWeight = totalWeight - s.weight + gates;
        } else {
            totalWeight += gates;
            s.on = true;
        }
        s.owner = msg.sender;
        s.weight = gates;
        s.paid = acc;
        emit Opened(id, msg.sender, gates);
    }

    function claim(uint256 id) external {
        _accrue();
        if (_closeIfMoved(id)) return;
        require(seat[id].on && seat[id].owner == msg.sender, "owner");
        _pay(id);
    }

    function claimMany(uint256[] calldata ids) external {
        _accrue();
        for (uint256 i = 0; i < ids.length; i++) {
            if (_closeIfMoved(ids[i])) continue;
            if (seat[ids[i]].on && seat[ids[i]].owner == msg.sender) _pay(ids[i]);
        }
    }

    function _closeIfMoved(uint256 id) internal returns (bool) {
        Seat storage s = seat[id];
        if (!s.on) return false;
        if (CPU.ownerOf(id) == s.owner) return false;
        address previous = s.owner;
        _pay(id);
        totalWeight -= s.weight;
        s.on = false;
        s.weight = 0;
        emit Closed(id, previous);
        return true;
    }

    function _pay(uint256 id) internal {
        Seat storage s = seat[id];
        uint256 owed = ((acc - s.paid) * s.weight) / SCALE;
        s.paid = acc;
        if (owed == 0) return;
        token.mint(s.owner, owed);
        emit Claimed(id, s.owner, owed);
    }
}
