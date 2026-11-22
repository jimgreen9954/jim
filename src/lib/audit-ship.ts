import {
  concat,
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  toHex,
  type Hex,
} from "viem";
import { BSC, connectBsc } from "@/lib/bsc";
import { assertSafeDeployer, safeFor } from "@/lib/chain-marks";
import { lendSpec, type LendAsset, type LendChain } from "@/lib/lend";
import { LEND_BYTECODE } from "@/lib/lend-bytecode";
import { LEND_ERC_BYTECODE } from "@/lib/lend-erc-bytecode";
import { TERM_BYTECODE } from "@/lib/term-bytecode";
import { VAULT_BYTECODE } from "@/lib/vault-bytecode";
import { getProvider } from "@/lib/wallet";
import { XLAYER, connectXLayer } from "@/lib/xlayer";

export type ShipChain = "bsc" | "xlayer";

const FACTORY = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const LIVE_BOOK = {
  bsc: "0x070c66555535e1145275df54f4eEBBfd28d98581" as Hex,
  xlayer: "0x46cBAfCA59873E7115dF7825fdBF659BafAc3a51" as Hex,
};

const bscClient = createPublicClient({ transport: http(BSC.rpc) });
const xClient = createPublicClient({ transport: http(XLAYER.rpc) });

export type ShipRow = {
  id: string;
  chain: ShipChain;
  zh: string;
  en: string;
  address: Hex;
};

function salt(id: string): Hex {
  return keccak256(toHex(`tapeliquid-${id}-166fe74`));
}

function predict(init: Hex, id: string): Hex {
  const hash = keccak256(concat(["0xff", FACTORY, salt(id), keccak256(init)]));
  return getAddress(`0x${hash.slice(-40)}`);
}

function lendInit(chain: LendChain, asset: LendAsset): Hex {
  const spec = lendSpec(chain, asset);
  const minBorrow = 10n * 10n ** BigInt(spec.usdtDec);
  const args = spec.native
    ? encodeAbiParameters(
        [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
        [spec.usdt, spec.coll, spec.pool, spec.safe, minBorrow],
      )
    : encodeAbiParameters(
        [
          { type: "uint8" },
          { type: "address" },
          { type: "address" },
          { type: "address" },
          { type: "uint8" },
          { type: "address" },
          { type: "uint256" },
        ],
        [spec.mode, spec.usdt, spec.coll, spec.pool, spec.collDec, spec.safe, minBorrow],
      );
  return `${spec.native ? LEND_BYTECODE : LEND_ERC_BYTECODE}${args.slice(2)}` as Hex;
}

function vaultInit(chain: ShipChain): Hex {
  const usdt = chain === "bsc" ? BSC.usdt : ("0x779Ded0c9e1022225f8E0630b35a9b54bE713736" as Hex);
  const leader = safeFor(chain);
  const args = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "uint16" }],
    [usdt, LIVE_BOOK[chain], leader, 1000],
  );
  return `${VAULT_BYTECODE}${args.slice(2)}` as Hex;
}

function termInit(chain: ShipChain): Hex {
  const args = encodeAbiParameters([{ type: "address" }], [safeFor(chain)]);
  return `${TERM_BYTECODE}${args.slice(2)}` as Hex;
}

const SPEC: { id: string; chain: ShipChain; zh: string; en: string; init: () => Hex }[] = [
  { id: "vault-bsc", chain: "bsc", zh: "BSC 跟单金库", en: "BSC copy vault", init: () => vaultInit("bsc") },
  { id: "vault-x", chain: "xlayer", zh: "X Layer 跟单金库", en: "X Layer copy vault", init: () => vaultInit("xlayer") },
  { id: "lend-bsc-gas", chain: "bsc", zh: "BSC 借贷（BNB）", en: "BSC lend (BNB)", init: () => lendInit("bsc", "gas") },
  { id: "lend-bsc-bem", chain: "bsc", zh: "BSC 借贷（BEM）", en: "BSC lend (BEM)", init: () => lendInit("bsc", "bem") },
  { id: "lend-x-gas", chain: "xlayer", zh: "X Layer 借贷（OKB）", en: "X Layer lend (OKB)", init: () => lendInit("xlayer", "gas") },
  { id: "lend-x-tape", chain: "xlayer", zh: "X Layer 借贷（TAPE）", en: "X Layer lend (TAPE)", init: () => lendInit("xlayer", "tape") },
  { id: "lend-x-bem", chain: "xlayer", zh: "X Layer 借贷（BEM）", en: "X Layer lend (BEM)", init: () => lendInit("xlayer", "bem") },
  { id: "term-bsc", chain: "bsc", zh: "BSC 期限", en: "BSC term", init: () => termInit("bsc") },
  { id: "term-x", chain: "xlayer", zh: "X Layer 期限", en: "X Layer term", init: () => termInit("xlayer") },
];

export function shipPlan(): ShipRow[] {
  return SPEC.map((row) => ({ id: row.id, chain: row.chain, zh: row.zh, en: row.en, address: predict(row.init(), row.id) }));
}

function client(chain: ShipChain) {
  return chain === "xlayer" ? xClient : bscClient;
}

export async function shipPending(account: string | null): Promise<ShipRow[]> {
  if (!account) return [];
  const who = account.toLowerCase();
  const mine = shipPlan().filter((row) => safeFor(row.chain).toLowerCase() === who);
  const left: ShipRow[] = [];
  for (const row of mine) {
    const code = await client(row.chain).getBytecode({ address: row.address });
    if (!code || code === "0x") left.push(row);
  }
  return left;
}

export async function deployShip(id: string): Promise<Hex> {
  const row = SPEC.find((item) => item.id === id);
  if (!row) throw new Error("ship");
  const address = predict(row.init(), row.id);
  const existing = await client(row.chain).getBytecode({ address });
  if (existing && existing !== "0x") return address;
  const from = row.chain === "xlayer" ? await connectXLayer() : await connectBsc();
  assertSafeDeployer(row.chain, from);
  const eth = getProvider();
  if (!eth) throw new Error("nowallet");
  const data = concat([salt(row.id), row.init()]);
  const gasPrice = await client(row.chain).getGasPrice();
  const hash = (await eth.request({
    method: "eth_sendTransaction",
    params: [{ from, to: FACTORY, data, value: "0x0", gas: toHex(8_000_000n), gasPrice: toHex(gasPrice * 2n) }],
  })) as Hex;
  const receipt = await client(row.chain).waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (receipt.status !== "success") throw new Error("revert");
  const code = await client(row.chain).getBytecode({ address });
  if (!code || code === "0x") throw new Error("deploy");
  return address;
}
