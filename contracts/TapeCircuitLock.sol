// SPDX-License-Identifier: MIT
pragma solidity 0.8.37;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}

interface IERC721 {
    function transferFrom(address from, address to, uint256 id) external;
    function ownerOf(uint256 id) external view returns (address);
    function circuitInfo(uint256 id) external view returns (uint256, uint256, uint256, uint256);
}

interface IMine {
    function open(uint256 id) external;
    function claim(uint256 id) external;
}

/// Locks one TAPELIQUID circuit. No admin and no early exit.
/// The mine seat stays open in this contract's name, so the gates keep counting.
/// After unlock, TAPE and the circuit are claimed in separate transactions.
/// Claiming the circuit also sends any TAPE still here, then closes the mine seat
/// in the same transaction so a later settlement cannot mint into this contract.
contract TapeCircuitLock {
    address public constant CIRCUITS = 0x69F663931209096037474d7C20402232E5C762cA;
    address public constant MINE = 0x60b1B7cAE1BBD0e84AC3e1e43F933712F3ab67E8;
    address public constant TAPE = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;

    struct Seat {
        address owner;
        uint8 term;
        uint64 start;
        uint64 unlock;
        uint256 circuitId;
        uint256 gates;
    }

    uint256 public nextId = 1;
    uint256 private entered;
    mapping(uint256 => Seat) public seat;
    mapping(uint256 => uint256) public circuitSeat;
    mapping(address => uint256[]) private owned;

    modifier guard() {
        require(entered == 0, "re");
        entered = 1;
        _;
        entered = 0;
    }

    event Locked(uint256 indexed id, address indexed owner, uint256 circuitId, uint64 unlock);
    event TapeClaimed(uint256 indexed id, address indexed owner, uint256 amount);
    event CircuitClaimed(uint256 indexed id, address indexed owner, uint256 circuitId, uint256 tape);

    function termOf(uint8 term) public pure returns (uint256) {
        if (term == 0) return 180 days;
        if (term == 1) return 365 days;
        if (term == 2) return 1095 days;
        if (term == 3) return 1460 days;
        if (term == 4) return 1825 days;
        revert("term");
    }

    function ownedCount(address owner) external view returns (uint256) {
        return owned[owner].length;
    }

    function ownedId(address owner, uint256 index) external view returns (uint256) {
        return owned[owner][index];
    }

    function lock(uint256 circuitId, uint8 term) external guard returns (uint256 id) {
        require(circuitSeat[circuitId] == 0, "open");
        uint256 dur = termOf(term);
        (,,, uint256 gates) = IERC721(CIRCUITS).circuitInfo(circuitId);
        require(gates > 0 && gates <= 200_000, "gates");
        IERC721(CIRCUITS).transferFrom(msg.sender, address(this), circuitId);
        require(IERC721(CIRCUITS).ownerOf(circuitId) == address(this), "own");
        IMine(MINE).open(circuitId);
        id = nextId++;
        uint64 start = uint64(block.timestamp);
        seat[id] = Seat(msg.sender, term, start, start + uint64(dur), circuitId, gates);
        circuitSeat[circuitId] = id;
        owned[msg.sender].push(id);
        emit Locked(id, msg.sender, circuitId, start + uint64(dur));
    }

    function claimTape(uint256 id) external guard {
        Seat storage s = seat[id];
        require(s.owner == msg.sender, "owner");
        require(block.timestamp >= s.unlock, "lock");
        require(circuitSeat[s.circuitId] == id, "open");
        uint256 out = _pull(s.circuitId);
        if (out > 0) {
            require(IERC20(TAPE).transfer(msg.sender, out), "tape");
            emit TapeClaimed(id, msg.sender, out);
        }
    }

    function claimCircuit(uint256 id) external guard {
        Seat memory s = seat[id];
        require(s.owner == msg.sender, "owner");
        require(block.timestamp >= s.unlock, "lock");
        require(circuitSeat[s.circuitId] == id, "open");
        circuitSeat[s.circuitId] = 0;
        delete seat[id];
        uint256 beforeBal = IERC20(TAPE).balanceOf(address(this));
        IMine(MINE).claim(s.circuitId);
        IERC721(CIRCUITS).transferFrom(address(this), msg.sender, s.circuitId);
        IMine(MINE).claim(s.circuitId);
        uint256 out = IERC20(TAPE).balanceOf(address(this)) - beforeBal;
        if (out > 0) require(IERC20(TAPE).transfer(msg.sender, out), "tape");
        emit CircuitClaimed(id, msg.sender, s.circuitId, out);
    }

    function _pull(uint256 circuitId) internal returns (uint256 got) {
        uint256 beforeBal = IERC20(TAPE).balanceOf(address(this));
        IMine(MINE).claim(circuitId);
        got = IERC20(TAPE).balanceOf(address(this)) - beforeBal;
    }
}
