import { createPublicClient, encodeFunctionData, http, parseAbi, type Hex } from "viem";
import { TxPending } from "@/lib/chain-marks";
import type { DeskParts } from "@/lib/invite-cut";
import { rejected, sendAsMulticall, sendUserBatch, type SignedCall } from "@/lib/one-sign";
import { sayTradeStep } from "@/lib/trade-step";
import { ensureProvider, armChain, remoteWallet, switchDeskChain } from "@/lib/wallet";

/** CREATE2 via the canonical deployer. The first packed trade on a chain deploys it. */
export const DESK_LOCK = "0xC5A63E4c37c23F97558673731196abC30FBFa659" as Hex;
const DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Hex;
const SALT = "0xf0ddd109365b6c1dfcaff9684dfb1c126240dbf12c6b8ead72f8022d08f0be87" as Hex;
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;
const MAX = (1n << 256n) - 1n;
const BYTECODE = "0x6080604052348015600e575f80fd5b50610a398061001c5f395ff3fe608060405260043610610020575f3560e01c80635e9db44b1461002b575f80fd5b3661002757005b5f80fd5b61003e610039366004610873565b610040565b005b5f54156100815760405162461bcd60e51b8152600401610078906020808252600490820152636c6f636b60e01b604082015260600190565b60405180910390fd5b60015f55346001600160a01b038c166101105789156100a4576100a48b8b61020f565b87156100b4576100b4898961020f565b6100be888b610975565b8110156100f55760405162461bcd60e51b815260206004820152600560248201526476616c756560d81b6044820152606401610078565b6100ff888b610975565b610109908261098e565b905061014e565b8915610121576101218c8c8c61029c565b8715610132576101328c8a8a61029c565b861561014e576101438c308961029c565b61014e8c87896103a1565b5f80866001600160a01b031683868660405161016b9291906109a1565b5f6040518083038185875af1925050503d805f81146101a5576040519150601f19603f3d011682016040523d82523d5f602084013e6101aa565b606091505b5091509150816101bc57805160208201fd5b6001600160a01b038616156101ea575f6101d58761066b565b905080156101e8576101e8873383610760565b505b4780156101fb576101fb338261020f565b50505f805550505050505050505050505050565b5f826001600160a01b0316826040515f6040518083038185875af1925050503d805f8114610258576040519150601f19603f3d011682016040523d82523d5f602084013e61025d565b606091505b50509050806102975760405162461bcd60e51b81526004016100789060208082526004908201526373696e6b60e01b604082015260600190565b505050565b604080513360248201526001600160a01b038481166044830152606480830185905283518084039091018152608490920183526020820180516001600160e01b03166323b872dd60e01b17905291515f928392908716916102fd91906109b0565b5f604051808303815f865af19150503d805f8114610336576040519150601f19603f3d011682016040523d82523d5f602084013e61033b565b606091505b509150915081801561036557508051158061036557508080602001905181019061036591906109c6565b61039a5760405162461bcd60e51b8152600401610078906020808252600490820152636d6f766560e01b604082015260600190565b5050505050565b604080516001600160a01b038481166024830152604480830185905283518084039091018152606490920183526020820180516001600160e01b031663095ea7b360e01b17905291515f928392908716916103fc91906109b0565b5f604051808303815f865af19150503d805f8114610435576040519150601f19603f3d011682016040523d82523d5f602084013e61043a565b606091505b509150915081801561046457508051158061046457508080602001905181019061046491906109c6565b15610470575050505050565b604080516001600160a01b0386811660248301525f604480840182905284518085039091018152606490930184526020830180516001600160e01b031663095ea7b360e01b17905292518392918916916104c9916109b0565b5f604051808303815f865af19150503d805f8114610502576040519150601f19603f3d011682016040523d82523d5f602084013e610507565b606091505b509150915081801561053157508051158061053157508080602001905181019061053191906109c6565b6105675760405162461bcd60e51b8152602060048201526007602482015266617070726f766560c81b6044820152606401610078565b604080516001600160a01b038881166024830152604480830189905283518084039091018152606490920183526020820180516001600160e01b031663095ea7b360e01b17905291515f928392908b16916105c291906109b0565b5f604051808303815f865af19150503d805f81146105fb576040519150601f19603f3d011682016040523d82523d5f602084013e610600565b606091505b509150915081801561062a57508051158061062a57508080602001905181019061062a91906109c6565b6106605760405162461bcd60e51b8152602060048201526007602482015266617070726f766560c81b6044820152606401610078565b505050505050505050565b604080513060248083019190915282518083039091018152604490910182526020810180516001600160e01b03166370a0823160e01b17905290515f91829182916001600160a01b038616916106c191906109b0565b5f60405180830381855afa9150503d805f81146106f9576040519150601f19603f3d011682016040523d82523d5f602084013e6106fe565b606091505b509150915081801561071257506020815110155b6107445760405162461bcd60e51b815260206004820152600360248201526218985b60ea1b6044820152606401610078565b8080602001905181019061075891906109ec565b949350505050565b604080516001600160a01b038481166024830152604480830185905283518084039091018152606490920183526020820180516001600160e01b031663a9059cbb60e01b17905291515f928392908716916107bb91906109b0565b5f604051808303815f865af19150503d805f81146107f4576040519150601f19603f3d011682016040523d82523d5f602084013e6107f9565b606091505b509150915081801561082357508051158061082357508080602001905181019061082391906109c6565b61039a5760405162461bcd60e51b8152600401610078906020808252600490820152630e0eae6d60e31b604082015260600190565b80356001600160a01b038116811461086e575f80fd5b919050565b5f805f805f805f805f805f6101408c8e03121561088e575f80fd5b6108978c610858565b9a506108a560208d01610858565b995060408c013598506108ba60608d01610858565b975060808c0135965060a08c013595506108d660c08d01610858565b94506108e460e08d01610858565b93506108f36101008d01610858565b92506101208c013567ffffffffffffffff81111561090f575f80fd5b8c01601f81018e1361091f575f80fd5b803567ffffffffffffffff811115610935575f80fd5b8e6020828401011115610946575f80fd5b60208201935080925050509295989b509295989b9093969950565b634e487b7160e01b5f52601160045260245ffd5b8082018082111561098857610988610961565b92915050565b8181038181111561098857610988610961565b818382375f9101908152919050565b5f82518060208501845e5f920191825250919050565b5f602082840312156109d6575f80fd5b815180151581146109e5575f80fd5b9392505050565b5f602082840312156109fc575f80fd5b505191905056fea2646970667358221220144d6855c7a5d190e6e2878972f04a6413a16a841e05169fec4aa2518dbdb4b064736f6c634300081a0033" as Hex;

const lockAbi = parseAbi([
  "function run(address token, address safe, uint256 desk, address referrer, uint256 reward, uint256 pull, address spender, address router, address sweep, bytes data) payable",
]);

const erc20 = parseAbi([
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function transfer(address,uint256) returns (bool)",
]);

const RPC: Record<number, string[]> = {
  56: ["https://bsc-dataseed.binance.org", "https://bsc.publicnode.com"],
  196: ["https://rpc.xlayer.tech", "https://xlayerrpc.okx.com"],
};

function pub(chainId: number) {
  return createPublicClient({ transport: http(RPC[chainId][0], { timeout: 12_000 }) });
}

async function hasCode(chainId: number, address: Hex): Promise<boolean> {
  for (const url of RPC[chainId]) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
      });
      const json = (await res.json()) as { result?: string };
      if (json.result === "0x") return false;
      if (json.result && json.result.length > 2) return true;
    } catch {
      /* next */
    }
  }
  return false;
}

async function sendTx(from: string, chainId: 56 | 196, to: Hex, data: Hex, value = 0n): Promise<Hex> {
  const eth = await ensureProvider();
  if (remoteWallet()) await armChain(chainId);
  else await switchDeskChain(chainId);
  const tx: { from: string; to: Hex; data: Hex; chainId: Hex; value?: Hex } = {
    from,
    to,
    data,
    chainId: chainId === 56 ? "0x38" : "0xc4",
  };
  if (value > 0n) tx.value = `0x${value.toString(16)}`;
  return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as Hex;
}

async function mined(chainId: number, hash: Hex): Promise<void> {
  for (let i = 0; i < 40; i++) {
    for (const url of RPC[chainId]) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [hash] }),
        });
        const json = (await res.json()) as { result?: { status?: string } | null };
        const status = json.result?.status;
        if (status === "0x1") return;
        if (status === "0x0") throw new Error("reverted");
      } catch (err) {
        if (err instanceof Error && err.message === "reverted") throw err;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new TxPending(hash);
}

function feeCalls(token: Hex | null, safe: Hex, parts: DeskParts): SignedCall[] {
  const calls: SignedCall[] = [];
  if (token) {
    if (parts.reward > 0n && parts.referrer) {
      calls.push({
        to: token,
        data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [parts.referrer, parts.reward] }),
      });
    }
    if (parts.desk > 0n) {
      calls.push({
        to: token,
        data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [safe, parts.desk] }),
      });
    }
  } else {
    if (parts.reward > 0n && parts.referrer) calls.push({ to: parts.referrer, data: "0x", value: parts.reward });
    if (parts.desk > 0n) calls.push({ to: safe, data: "0x", value: parts.desk });
  }
  return calls;
}

async function ensureLock(from: string, chainId: 56 | 196) {
  if (await hasCode(chainId, DESK_LOCK)) return;
  const hash = await sendTx(from, chainId, DEPLOYER, (SALT + BYTECODE.slice(2)) as Hex);
  await mined(chainId, hash);
  if (!(await hasCode(chainId, DESK_LOCK))) throw new Error("reverted");
}

async function ensureAllowance(from: string, chainId: 56 | 196, token: Hex, need: bigint) {
  const current = await pub(chainId).readContract({
    address: token,
    abi: erc20,
    functionName: "allowance",
    args: [from as Hex, DESK_LOCK],
  });
  if (current >= need) return;
  const grant = encodeFunctionData({ abi: erc20, functionName: "approve", args: [DESK_LOCK, MAX] });
  try {
    await mined(chainId, await sendTx(from, chainId, token, grant));
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "reverted") throw err;
    const reset = encodeFunctionData({ abi: erc20, functionName: "approve", args: [DESK_LOCK, 0n] });
    await mined(chainId, await sendTx(from, chainId, token, reset));
    await mined(chainId, await sendTx(from, chainId, token, grant));
  }
}

export type FeeSwap = {
  from: string;
  chainId: 56 | 196;
  token: Hex | null;
  safe: Hex;
  parts: DeskParts;
  swapTo: Hex;
  data: Hex;
  value: bigint;
  pull: bigint;
  spender: Hex;
  /** False for a bridge call that might pay msg.sender. Those stay on the wallet batch or Multicall3. */
  lock?: boolean;
};

/** One signature. The phone wallet sees the same router call as the desktop, not a chain switch plus a fee plus a swap. */
export async function sendFeeAndSwap(args: FeeSwap): Promise<Hex> {
  const { from, chainId, token, safe, parts, swapTo, data, value, pull, spender } = args;
  if (remoteWallet()) {
    sayTradeStep("fill");
    return sendTx(from, chainId, swapTo, data, value);
  }
  const calls = feeCalls(token, safe, parts);
  calls.push({ to: swapTo, data, value });
  if (parts.desk <= 0n && parts.reward <= 0n) {
    sayTradeStep("both");
    return sendUserBatch(from, chainId, calls);
  }
  try {
    sayTradeStep("both");
    return await sendUserBatch(from, chainId, calls);
  } catch (err) {
    if (rejected(err) || err instanceof TxPending) throw err;
    const message = err instanceof Error ? err.message : "";
    if (message !== "no-batch") throw err;
  }
  if (!token) {
    try {
      sayTradeStep("both");
      return await sendAsMulticall(from, calls, chainId);
    } catch (err) {
      if (rejected(err) || err instanceof TxPending) throw err;
      const message = err instanceof Error ? err.message : "";
      if (message !== "no-batch") throw err;
    }
    if (args.lock === false) throw new Error("no-batch");
  }
  await ensureLock(from, chainId);
  if (token) {
    const need = parts.desk + parts.reward + pull;
    if (need > 0n) await ensureAllowance(from, chainId, token, need);
  }
  const run = encodeFunctionData({
    abi: lockAbi,
    functionName: "run",
    args: [token ?? ZERO, safe, parts.desk, parts.referrer ?? ZERO, parts.reward, token ? pull : 0n, token ? spender : ZERO, swapTo, ZERO, data],
  });
  const pay = token ? value : value + parts.desk + parts.reward;
  sayTradeStep("both");
  return sendTx(from, chainId, DESK_LOCK, run, pay);
}
