// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

interface IERC1155 {
    function safeTransferFrom(address, address, uint256, uint256, bytes calldata) external;
}

interface IERC721 {
    function transferFrom(address, address, uint256) external;
}

/// Immutable books. No admin, no upgrade.
/// 0 TAPE / USDT0, 1 NAND / USDT0, 2 LATCH / USDT0, plus one price per circuit.
/// The buyer pays the resting price. The seller receives 99.8%. 0.2% goes to FEE.
/// Same price is first-in. A worse price sits behind it.
contract TapeSpot {
    IERC20 public constant USDT = IERC20(0x779Ded0c9e1022225f8E0630b35a9b54bE713736);
    IERC20 public constant TAPE = IERC20(0x8f2d517D3d62019CD8D7F08ae178Be05BBb6EBE3);
    IERC1155 public constant WAFER = IERC1155(0x3FA393d3081AcCff9E7989619B688235F6d3EE3F);
    IERC721 public constant CIRCUIT = IERC721(0x69F663931209096037474d7C20402232E5C762cA);
    address public constant FEE = 0xb4D6039394c8B97C3AC3234aa07011B564Fcb88c;
    uint256 public constant FEE_BPS = 20;
    uint256 public constant TAPE_UNIT = 100_000_000;

    uint256 private entered = 1;
    uint64 public nextId = 1;

    struct Order {
        address maker;
        uint8 market;
        bool bid;
        uint128 price;
        uint128 left;
        uint128 escrow;
        uint64 prev;
        uint64 next;
    }

    mapping(uint64 => Order) public orders;
    mapping(uint8 => mapping(bool => uint64)) public best;
    mapping(address => uint64[]) private mineIds;

    struct Listing {
        address seller;
        uint128 price;
    }

    mapping(uint256 => Listing) public lists;
    uint256[] public listedIds;
    mapping(uint256 => uint256) private listAt;

    modifier lock() {
        require(entered == 1, "reenter");
        entered = 2;
        _;
        entered = 1;
    }

    event Make(uint64 indexed id, address indexed maker, uint8 market, bool bid, uint128 price, uint128 left);
    event Take(uint64 indexed id, address indexed taker, address indexed maker, uint8 market, uint128 price, uint128 base, uint128 quote, uint128 fee);
    event Kill(uint64 indexed id, address indexed maker);
    event Listed(uint256 indexed id, address indexed seller, uint128 price);
    event Delisted(uint256 indexed id, address indexed seller);
    event CircuitBought(uint256 indexed id, address indexed buyer, address indexed seller, uint128 price, uint128 fee);

    function place(uint8 market, bool bid, uint128 price, uint128 amount) external lock returns (uint64 id) {
        require(market < 3 && price > 0 && amount > 0, "amount");
        uint128 left = amount;
        uint256 guard;
        while (left > 0 && guard < 40) {
            uint64 cur = best[market][!bid];
            if (cur == 0) break;
            Order storage maker = orders[cur];
            if (bid ? price < maker.price : price > maker.price) break;
            require(maker.maker != msg.sender, "self");
            uint128 fill = left < maker.left ? left : maker.left;
            _fill(cur, fill, bid);
            left -= fill;
            guard++;
        }
        if (left > 0 && best[market][!bid] != 0) {
            Order storage top = orders[best[market][!bid]];
            require(bid ? price < top.price : price > top.price, "deep");
        }
        if (left == 0) return 0;
        uint256 escrow = bid ? _cost(market, left, price) : 0;
        if (bid) {
            uint256 fee = escrow * FEE_BPS / 10000;
            require(fee > 0 && fee < escrow, "fee");
            _pull(USDT, escrow);
        } else {
            require(_cost(market, left, price) * FEE_BPS / 10000 > 0, "fee");
            _pullBase(market, left);
        }
        id = nextId++;
        orders[id] = Order(msg.sender, market, bid, price, left, uint128(escrow), 0, 0);
        _insert(id);
        _addMine(msg.sender, id);
        emit Make(id, msg.sender, market, bid, price, left);
    }

    function cancel(uint64 id) external lock {
        Order storage o = orders[id];
        require(o.maker == msg.sender && o.left > 0, "order");
        uint128 left = o.left;
        uint128 escrow = o.escrow;
        uint8 market = o.market;
        bool bid = o.bid;
        _unlink(id);
        _dropMine(msg.sender, id);
        o.left = 0;
        o.escrow = 0;
        if (bid) _push(USDT, msg.sender, escrow);
        else _pushBase(market, msg.sender, left);
        emit Kill(id, msg.sender);
    }

    function listCircuit(uint256 id, uint128 price) external lock {
        require(price > 0 && lists[id].seller == address(0), "list");
        require(uint256(price) * FEE_BPS / 10000 > 0, "fee");
        CIRCUIT.transferFrom(msg.sender, address(this), id);
        lists[id] = Listing(msg.sender, price);
        listedIds.push(id);
        listAt[id] = listedIds.length;
        emit Listed(id, msg.sender, price);
    }

    function cancelCircuit(uint256 id) external lock {
        Listing memory row = lists[id];
        require(row.seller == msg.sender, "seller");
        _forget(id);
        CIRCUIT.transferFrom(address(this), msg.sender, id);
        emit Delisted(id, msg.sender);
    }

    function buyCircuit(uint256 id) external lock {
        Listing memory row = lists[id];
        require(row.seller != address(0) && row.seller != msg.sender, "list");
        uint256 fee = uint256(row.price) * FEE_BPS / 10000;
        require(fee > 0 && fee < row.price, "fee");
        _forget(id);
        _pull(USDT, row.price);
        _push(USDT, row.seller, uint256(row.price) - fee);
        _push(USDT, FEE, fee);
        CIRCUIT.transferFrom(address(this), msg.sender, id);
        emit CircuitBought(id, msg.sender, row.seller, row.price, uint128(fee));
    }

    function book(uint8 market, bool bid, uint256 n) external view returns (uint256 count, uint128[] memory price, uint128[] memory size, uint32[] memory lots) {
        if (n > 24) n = 24;
        price = new uint128[](n);
        size = new uint128[](n);
        lots = new uint32[](n);
        uint64 cur = best[market][bid];
        uint256 guard;
        while (cur != 0 && count < n && guard < 400) {
            Order storage o = orders[cur];
            if (count == 0 || price[count - 1] != o.price) {
                price[count] = o.price;
                size[count] = o.left;
                lots[count] = 1;
                count++;
            } else {
                size[count - 1] += o.left;
                lots[count - 1] += 1;
            }
            cur = o.next;
            guard++;
        }
    }

    function myOrders(address who) external view returns (uint64[] memory ids, uint8[] memory markets, bool[] memory bids, uint128[] memory prices, uint128[] memory lefts) {
        uint64[] storage rows = mineIds[who];
        uint256 n = rows.length;
        ids = new uint64[](n);
        markets = new uint8[](n);
        bids = new bool[](n);
        prices = new uint128[](n);
        lefts = new uint128[](n);
        for (uint256 i; i < n; i++) {
            Order storage o = orders[rows[i]];
            ids[i] = rows[i];
            markets[i] = o.market;
            bids[i] = o.bid;
            prices[i] = o.price;
            lefts[i] = o.left;
        }
    }

    function listingCount() external view returns (uint256) {
        return listedIds.length;
    }

    function listings(uint256 start, uint256 n) external view returns (uint256[] memory ids, address[] memory sellers, uint128[] memory prices) {
        if (start > listedIds.length) start = listedIds.length;
        if (n > 40) n = 40;
        if (start + n > listedIds.length) n = listedIds.length - start;
        ids = new uint256[](n);
        sellers = new address[](n);
        prices = new uint128[](n);
        for (uint256 i; i < n; i++) {
            uint256 id = listedIds[start + i];
            ids[i] = id;
            sellers[i] = lists[id].seller;
            prices[i] = lists[id].price;
        }
    }

    function onERC1155Received(address, address, uint256, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata) external pure returns (bytes4) {
        return this.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == 0x01ffc9a7 || id == 0x4e2312e0;
    }

    function _fill(uint64 id, uint128 fill, bool takerBid) internal {
        Order storage maker = orders[id];
        uint256 cost = _cost(maker.market, fill, maker.price);
        uint256 fee = cost * FEE_BPS / 10000;
        require(fee > 0 && fee < cost, "fee");
        maker.left -= fill;
        if (takerBid) {
            _pull(USDT, cost);
            _push(USDT, maker.maker, cost - fee);
            _push(USDT, FEE, fee);
            _pushBase(maker.market, msg.sender, fill);
        } else {
            require(maker.escrow >= cost, "escrow");
            maker.escrow -= uint128(cost);
            _pullBase(maker.market, fill);
            _pushBase(maker.market, maker.maker, fill);
            _push(USDT, msg.sender, cost - fee);
            _push(USDT, FEE, fee);
        }
        emit Take(id, msg.sender, maker.maker, maker.market, maker.price, fill, uint128(cost), uint128(fee));
        if (maker.left == 0) {
            uint128 dust = maker.escrow;
            address who = maker.maker;
            _unlink(id);
            _dropMine(who, id);
            maker.escrow = 0;
            if (dust > 0) _push(USDT, who, dust);
        }
    }

    function _insert(uint64 id) internal {
        Order storage o = orders[id];
        uint64 cur = best[o.market][o.bid];
        uint64 prev;
        for (uint256 i; i < 200 && cur != 0; i++) {
            Order storage row = orders[cur];
            bool better = o.bid ? o.price > row.price : o.price < row.price;
            if (better) {
                o.next = cur;
                o.prev = row.prev;
                if (row.prev != 0) orders[row.prev].next = id;
                else best[o.market][o.bid] = id;
                row.prev = id;
                return;
            }
            prev = cur;
            cur = row.next;
        }
        require(cur == 0, "deep");
        o.prev = prev;
        if (prev == 0) best[o.market][o.bid] = id;
        else orders[prev].next = id;
    }

    function _unlink(uint64 id) internal {
        Order storage o = orders[id];
        if (o.prev != 0) orders[o.prev].next = o.next;
        else best[o.market][o.bid] = o.next;
        if (o.next != 0) orders[o.next].prev = o.prev;
        o.prev = 0;
        o.next = 0;
    }

    function _addMine(address who, uint64 id) internal {
        require(mineIds[who].length < 32, "many");
        mineIds[who].push(id);
    }

    function _dropMine(address who, uint64 id) internal {
        uint64[] storage rows = mineIds[who];
        uint256 n = rows.length;
        for (uint256 i; i < n; i++) {
            if (rows[i] != id) continue;
            rows[i] = rows[n - 1];
            rows.pop();
            return;
        }
    }

    function _forget(uint256 id) internal {
        uint256 at = listAt[id];
        require(at > 0, "list");
        uint256 last = listedIds.length - 1;
        uint256 moved = listedIds[last];
        listedIds[at - 1] = moved;
        listAt[moved] = at;
        listedIds.pop();
        delete listAt[id];
        delete lists[id];
    }

    function _cost(uint8 market, uint128 base, uint128 price) internal pure returns (uint256) {
        if (market == 0) return uint256(base) * uint256(price) / TAPE_UNIT;
        return uint256(base) * uint256(price);
    }

    function _pullBase(uint8 market, uint128 amount) internal {
        if (market == 0) _pull(TAPE, amount);
        else WAFER.safeTransferFrom(msg.sender, address(this), market == 1 ? 0 : 1, amount, "");
    }

    function _pushBase(uint8 market, address to, uint128 amount) internal {
        if (market == 0) _push(TAPE, to, amount);
        else WAFER.safeTransferFrom(address(this), to, market == 1 ? 0 : 1, amount, "");
    }

    function _pull(IERC20 token, uint256 amount) internal {
        _move(address(token), abi.encodeWithSelector(IERC20.transferFrom.selector, msg.sender, address(this), amount));
    }

    function _push(IERC20 token, address to, uint256 amount) internal {
        if (amount == 0) return;
        _move(address(token), abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
    }

    function _move(address token, bytes memory data) internal {
        (bool ok, bytes memory ret) = token.call(data);
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "token");
    }
}
