import { useEffect, useState } from "react";
import {
  createPublicClient,
  encodeFunctionData,
  formatEther,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { BSC, connectBsc, txUrl } from "@/lib/bsc";
import { currentAccount, ensureProvider, onAccount } from "@/lib/wallet";

/** TapeOut circuit container registry on BSC. Not a swap, and not this site's 0.2% fee. */
const REGISTRY = "0x021745DE2f42A7839d96f2d3634d0294487D81F1" as const;

const registryAbi = parseAbi([
  "function FEE() view returns (uint256)",
  "function accountOf(address circuits, uint256 circuitId) view returns (address)",
  "function isOpened(address circuits, uint256 circuitId) view returns (bool)",
  "function isDeployed(address circuits, uint256 circuitId) view returns (bool)",
  "function open(address circuits, uint256 circuitId) payable returns (address)",
]);

const nftAbi = parseAbi(["function ownerOf(uint256 tokenId) view returns (address)"]);

const bsc = createPublicClient({ transport: http(BSC.rpc) });
const ZERO = "0x0000000000000000000000000000000000000000";

function isHexAddress(value: string): value is Hex {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function short(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr || "—";
}

export function ContainerDesk({ zh }: { zh: boolean }) {
  const [chain, setChain] = useState<"bsc" | "xlayer">("bsc");
  const [account, setAccount] = useState<string | null>(currentAccount());
  const [circuits, setCircuits] = useState("");
  const [circuitId, setCircuitId] = useState("");
  const [fee, setFee] = useState<bigint | null>(null);
  const [accountOf, setAccountOf] = useState<string | null>(null);
  const [opened, setOpened] = useState<boolean | null>(null);
  const [deployed, setDeployed] = useState<boolean | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [miss, setMiss] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const live = chain === "bsc";

  useEffect(() => onAccount(setAccount), []);

  useEffect(() => {
    if (!live) return;
    let dead = false;
    bsc
      .readContract({ address: REGISTRY, abi: registryAbi, functionName: "FEE" })
      .then((value) => {
        if (!dead) setFee(value);
      })
      .catch(() => {
        if (!dead) setFee(null);
      });
    return () => {
      dead = true;
    };
  }, [live]);

  useEffect(() => {
    if (!live) return;
    const token = circuits.trim();
    const id = circuitId.trim();
    if (!isHexAddress(token) || !/^\d+$/.test(id)) {
      setAccountOf(null);
      setOpened(null);
      setDeployed(null);
      setOwner(null);
      setMiss(false);
      return;
    }
    let dead = false;
    setMiss(false);
    const tokenId = BigInt(id);
    Promise.all([
      bsc.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "accountOf",
        args: [token, tokenId],
      }),
      bsc.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "isOpened",
        args: [token, tokenId],
      }),
      bsc.readContract({
        address: REGISTRY,
        abi: registryAbi,
        functionName: "isDeployed",
        args: [token, tokenId],
      }),
      bsc
        .readContract({ address: token, abi: nftAbi, functionName: "ownerOf", args: [tokenId] })
        .catch(() => null),
    ])
      .then(([next, isOpen, isLive, who]) => {
        if (dead) return;
        setAccountOf(next);
        setOpened(isOpen);
        setDeployed(isLive);
        setOwner(typeof who === "string" ? who : null);
      })
      .catch(() => {
        if (!dead) setMiss(true);
      });
    return () => {
      dead = true;
    };
  }, [live, circuits, circuitId]);

  const open = () => {
    const token = circuits.trim();
    const id = circuitId.trim();
    if (!isHexAddress(token) || !/^\d+$/.test(id) || fee == null) {
      setBad(true);
      setNote(
        zh
          ? "先填电路合约和编号，并等创建费读出来。"
          : "Enter the circuit contract and id, and wait for the fee.",
      );
      return;
    }
    setBusy(true);
    setBad(false);
    setNote(
      zh
        ? "先在钱包确认。创建费是 BNB，付给容器协议。"
        : "Confirm in the wallet. The fee is BNB, paid to the container protocol.",
    );
    void (async () => {
      try {
        const from = account ?? (await connectBsc());
        setAccount(from);
        const data = encodeFunctionData({
          abi: registryAbi,
          functionName: "open",
          args: [token, BigInt(id)],
        });
        const eth = await ensureProvider();
        const tx = (await eth.request({
          method: "eth_sendTransaction",
          params: [{ from, to: REGISTRY, data, value: `0x${fee.toString(16)}` }],
        })) as string;
        setHash(tx);
        setNote(
          zh
            ? "已提交。容器地址跟着这张电路，控制权跟着 NFT 所有者。"
            : "Submitted. The container follows this circuit. Control follows the NFT owner.",
        );
        setBad(false);
      } catch (err) {
        setBad(true);
        const message = err instanceof Error ? err.message : "";
        setNote(
          /rejected|denied|4001/i.test(message)
            ? zh
              ? "你取消了。"
              : "You cancelled."
            : zh
              ? "没有开通。看这张是不是你的，以及 BNB 够不够创建费。"
              : "It did not open. Check that you own it, and that you have the BNB fee.",
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <section className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="border border-gold bg-card">
        <div className="flex items-end justify-between gap-3 border-b border-gold/30 px-3 py-3">
          <div>
            <p className="text-[11px] tracking-[0.16em] text-gold">
              {zh ? "电路容器" : "Circuit container"}
            </p>
            <h2 className="font-display text-3xl italic leading-none">
              {zh ? "绑在电路上的账户" : "An account bound to a circuit"}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-ink/70">
              {zh
                ? "这不是充放电，也不是把 USDT 换成 BEM。容器是绑在一张电路 NFT 上的账户，控制权跟着这张电路的所有者走。换了所有者，容器也跟着走。"
                : "This is not a charge or a swap. A container is an account bound to one circuit NFT. Control follows the owner of that circuit."}
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 border border-gold text-xs">
            <button
              type="button"
              className={`min-h-9 px-3 ${chain === "bsc" ? "bg-ink text-paper" : ""}`}
              onClick={() => {
                setChain("bsc");
                setHash(null);
                setNote(null);
              }}
            >
              BSC
            </button>
            <button
              type="button"
              className={`min-h-9 px-3 ${chain === "xlayer" ? "bg-ink text-paper" : ""}`}
              onClick={() => {
                setChain("xlayer");
                setHash(null);
                setNote(null);
              }}
            >
              X Layer
            </button>
          </div>
        </div>
        {live ? (
          <div className="grid gap-3 px-3 py-4 sm:grid-cols-2">
            <label className="text-xs text-ink/55">
              {zh ? "电路合约" : "Circuit contract"}
              <input
                value={circuits}
                onChange={(event) => setCircuits(event.target.value.trim())}
                placeholder="0x"
                className="mt-1 w-full border border-gold/50 bg-paper px-2 py-2 font-mono text-sm text-ink outline-none"
              />
            </label>
            <label className="text-xs text-ink/55">
              {zh ? "电路编号" : "Circuit id"}
              <input
                value={circuitId}
                onChange={(event) => setCircuitId(event.target.value.replace(/[^\d]/g, ""))}
                inputMode="numeric"
                placeholder="0"
                className="mt-1 w-full border border-gold/50 bg-paper px-2 py-2 font-mono text-sm text-ink outline-none"
              />
            </label>
          </div>
        ) : (
          <p className="px-3 py-4 text-sm leading-6">
            {zh
              ? "当前网络尚未配置电路容器协议。X Layer 上的 TAPELIQUID 电路不能在这里开通。换到 BSC，填 TapeOut 电路合约和编号。"
              : "This network has no circuit-container protocol. TAPELIQUID circuits on X Layer cannot be opened here. Switch to BSC and enter a TapeOut circuit."}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-px bg-gold/30 sm:grid-cols-4">
          {[
            [
              zh ? "预计容器地址" : "Predicted account",
              !live ? "—" : accountOf && accountOf.toLowerCase() !== ZERO ? short(accountOf) : "—",
            ],
            [
              zh ? "容器创建费" : "Open fee",
              !live ? "—" : fee == null ? (zh ? "没读到" : "Unread") : `${formatEther(fee)} BNB`,
            ],
            [
              zh ? "是否已开通" : "Opened",
              !live || opened == null
                ? "—"
                : opened
                  ? zh
                    ? "已开通"
                    : "Open"
                  : zh
                    ? "未开通"
                    : "Not yet",
            ],
            [
              zh ? "控制权" : "Control",
              !live ? "—" : owner ? short(owner) : miss ? (zh ? "没读到" : "Unread") : "—",
            ],
          ].map(([k, v]) => (
            <p key={k} className="bg-card px-3 py-2">
              <span className="block text-[10px] text-ink/45">{k}</span>
              <span className="font-mono text-sm">{v}</span>
            </p>
          ))}
        </dl>
        <p className="px-3 py-3 text-sm leading-6 text-ink/70">
          {zh
            ? "开通只绑已经流片的那一张。创建费是协议的 BNB，不是本站千分之二，也不拆邀请人。控制权跟随电路，不跟随付款的钱包。流片在「流片」页，不在这里。"
            : "Open binds a circuit that already exists. The fee is the protocol's BNB, not this site's 0.2%, and it is not split with a referrer. Control follows the circuit, not the wallet that paid. Tape-out is on the tape page, not here."}
          {live && deployed != null
            ? zh
              ? ` 合约代码${deployed ? "已经" : "还没有"}部署到这个容器。`
              : ` Contract code is ${deployed ? "already" : "not yet"} on this container.`
            : ""}
        </p>
      </div>
      <aside className="border border-gold bg-card px-3 py-3 lg:sticky lg:top-16">
        <p className="text-[11px] tracking-[0.16em] text-gold">{zh ? "开通" : "Open"}</p>
        <p className="mt-2 font-mono text-sm">
          {live
            ? `BSC · ${short(REGISTRY)}`
            : zh
              ? "X Layer · 协议未配置"
              : "X Layer · not configured"}
        </p>
        <p className="mt-2 text-sm leading-6 text-ink/70">
          {owner && account && owner.toLowerCase() !== account.toLowerCase()
            ? zh
              ? "这张电路的所有者不是当前钱包。开通可能被拒绝。"
              : "The current wallet does not own this circuit. Open may be rejected."
            : zh
              ? "所有者就是这张 NFT 的 owner。付款的人不必是所有者，但协议可以拒绝。"
              : "The owner is this NFT's owner. The payer need not be the owner, but the protocol may reject it."}
        </p>
        <button
          type="button"
          disabled={!live || busy || fee == null}
          onClick={open}
          className="mt-3 min-h-12 w-full bg-ink font-display text-xl italic text-paper disabled:opacity-40"
        >
          {live
            ? zh
              ? "开通容器"
              : "Open container"
            : zh
              ? "这条链没有协议"
              : "No protocol on this chain"}
        </button>
        <a
          className="mt-3 inline-flex text-sm underline decoration-gold underline-offset-4"
          href="https://tapeout.net/"
          target="_blank"
          rel="noreferrer"
        >
          {zh ? "到 TapeOut 核对容器" : "Check the container on TapeOut"}
        </a>
        {live ? (
          <a
            className="mt-1 block text-xs text-ink/60"
            href={`${BSC.explorer}/address/${REGISTRY}`}
            target="_blank"
            rel="noreferrer"
          >
            {zh ? "BSC 上的登记合约" : "Registry on BSC"}
          </a>
        ) : null}
        {hash ? (
          <a
            className="mt-1 block break-all font-mono text-xs underline"
            href={txUrl(hash as Hex)}
            target="_blank"
            rel="noreferrer"
          >
            {hash}
          </a>
        ) : null}
        {note ? <p className={`mt-2 text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </aside>
    </section>
  );
}
