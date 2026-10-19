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

interface IERC1155 {
    function balanceOf(address account, uint256 id) external view returns (uint256);
    function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external;
}

interface IMine {
    function open(uint256 id) external;
    function claim(uint256 id) external;
}

/// Locks TAPELIQUID wafers and circuits. No owner and no early exit.
/// Terms are 180, 365, 1095, 1460 and 1825 days.
/// A locked circuit is opened on the existing mine in this contract's name.
/// Claimed TAPE stays here until the same position is released.
contract TapeLock {
    address public constant WAFERS = 0x3FA393d3081AcCff9E7989619B688235F6d3EE3F;
    address public constant CIRCUITS = 0x69F663931209096037474d7C20402232E5C762cA;
    address public constant MINE = 0x60b1B7cAE1BBD0e84AC3e1e43F933712F3ab67E8;
    address public constant TAPE = 0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3;

    struct Seat {
        address owner;
        uint8 kind;
        uint8 term;
        uint64 start;
        uint64 unlock;
        uint256 amount;
        uint256 ref;
        uint256 gates;
        uint256 tape;
    }

    uint256 public nextId = 1;
    uint256 private entered;
    mapping(uint256 => Seat) public seat;
    mapping(uint256 => uint256) public circuitSeat;
    mapping(address => uint256[]) private _owned;

    modifier guard() {
        require(entered == 0, "re");
        entered = 1;
        _;
        entered = 0;
    }

    event Locked(uint256 indexed id, address indexed owner, uint8 kind, uint256 ref, uint256 amount, uint64 unlock);
    event Released(uint256 indexed id, address indexed owner, uint256 tape);
    event Harvested(uint256 indexed id, uint256 tape);

    function termOf(uint8 term) public pure returns (uint256) {
        if (term == 0) return 180 days;
        if (term == 1) return 365 days;
        if (term == 2) return 1095 days;
        if (term == 3) return 1460 days;
        if (term == 4) return 1825 days;
        revert("term");
    }

    function ownedCount(address owner) external view returns (uint256) {
        return _owned[owner].length;
    }

    function ownedId(address owner, uint256 index) external view returns (uint256) {
        return _owned[owner][index];
    }

    function lockWafer(uint8 kind, uint256 amount, uint8 term) external guard returns (uint256 id) {
        require(kind <= 1 && amount > 0, "amt");
        uint256 dur = termOf(term);
        uint256 beforeBal = IERC1155(WAFERS).balanceOf(address(this), kind);
        IERC1155(WAFERS).safeTransferFrom(msg.sender, address(this), kind, amount, "");
        require(IERC1155(WAFERS).balanceOf(address(this), kind) - beforeBal == amount, "short");
        id = nextId++;
        uint64 start = uint64(block.timestamp);
        seat[id] = Seat(msg.sender, kind, term, start, start + uint64(dur), amount, kind, 0, 0);
        _owned[msg.sender].push(id);
        emit Locked(id, msg.sender, kind, kind, amount, start + uint64(dur));
    }

    function lockCircuit(uint256 circuitId, uint8 term) external guard returns (uint256 id) {
        require(circuitSeat[circuitId] == 0, "open");
        uint256 dur = termOf(term);
        (,,, uint256 gates) = IERC721(CIRCUITS).circuitInfo(circuitId);
        require(gates > 0 && gates <= 200_000, "gates");
        IERC721(CIRCUITS).transferFrom(msg.sender, address(this), circuitId);
        require(IERC721(CIRCUITS).ownerOf(circuitId) == address(this), "own");
        IMine(MINE).open(circuitId);
        id = nextId++;
        uint64 start = uint64(block.timestamp);
        seat[id] = Seat(msg.sender, 2, term, start, start + uint64(dur), 1, circuitId, gates, 0);
        circuitSeat[circuitId] = id;
        _owned[msg.sender].push(id);
        emit Locked(id, msg.sender, 2, circuitId, 1, start + uint64(dur));
    }

    function harvest(uint256 id) public guard {
        Seat storage s = seat[id];
        require(s.kind == 2 && s.owner != address(0), "seat");
        require(circuitSeat[s.ref] == id, "open");
        uint256 beforeBal = IERC20(TAPE).balanceOf(address(this));
        IMine(MINE).claim(s.ref);
        uint256 got = IERC20(TAPE).balanceOf(address(this)) - beforeBal;
        if (got > 0) {
            s.tape += got;
            emit Harvested(id, got);
        }
    }

    function release(uint256 id) external guard {
        Seat memory s = seat[id];
        require(s.owner == msg.sender, "owner");
        require(block.timestamp >= s.unlock, "lock");
        if (s.kind == 2) {
            require(circuitSeat[s.ref] == id, "open");
            uint256 beforeBal = IERC20(TAPE).balanceOf(address(this));
            IMine(MINE).claim(s.ref);
            uint256 got = IERC20(TAPE).balanceOf(address(this)) - beforeBal;
            s.tape += got;
            circuitSeat[s.ref] = 0;
        }
        delete seat[id];
        if (s.kind == 2) {
            if (s.tape > 0) require(IERC20(TAPE).transfer(msg.sender, s.tape), "tape");
            IERC721(CIRCUITS).transferFrom(address(this), msg.sender, s.ref);
        } else {
            IERC1155(WAFERS).safeTransferFrom(address(this), msg.sender, s.kind, s.amount, "");
        }
        emit Released(id, msg.sender, s.tape);
    }

    /// Send several TAPELIQUID circuits this wallet still holds. All of them move, or none do.
    function fan(uint256[] calldata ids, address[] calldata tos) external guard {
        require(ids.length == tos.length && ids.length > 0 && ids.length <= 30, "len");
        for (uint256 i = 0; i < ids.length; i++) {
            require(tos[i] != address(0) && tos[i] != msg.sender && tos[i] != address(this), "to");
            IERC721(CIRCUITS).transferFrom(msg.sender, tos[i], ids[i]);
        }
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external view returns (bytes4) {
        require(msg.sender == WAFERS, "wafer");
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external view returns (bytes4) {
        require(msg.sender == WAFERS, "wafer");
        return this.onERC1155BatchReceived.selector;
    }
}
