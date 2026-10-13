import { useEffect, useRef, useState } from "react";
import { createPublicClient, encodeFunctionData, formatUnits, http, parseAbi, parseUnits, type Hex } from "viem";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { BSC, connectBsc } from "@/lib/bsc";
import { OKB } from "@/lib/okb";
import { TAPE_BEM, TAPE_TOKEN } from "@/lib/tape-pool";
import { currentAccount, getProvider, onAccount } from "@/lib/wallet";
import { connectXLayer, XLAYER } from "@/lib/xlayer";

const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)", "function transfer(address to, uint256 amount) returns (bool)"]);
const xClient = createPublicClient({ transport: http(XLAYER.rpc, { timeout: 12_000 }) });
const bscClient = createPublicClient({ transport: http(BSC.rpc, { timeout: 12_000 }) });

type AssetId = "TAPE" | "XBEM" | "BBEM" | "OKB";

const ASSETS: { id: AssetId; name: string; chain: "xlayer" | "bsc"; chainName: string; chainId: number; hex: string; decimals: number; token: Hex | null; explorer: string }[] = [
  { id: "TAPE", name: "TAPE", chain: "xlayer", chainName: "X Layer", chainId: XLAYER.chainId, hex: XLAYER.hex, decimals: 8, token: TAPE_TOKEN, explorer: XLAYER.explorer },
  { id: "XBEM", name: "BEM", chain: "xlayer", chainName: "X Layer", chainId: XLAYER.chainId, hex: XLAYER.hex, decimals: 8, token: TAPE_BEM, explorer: XLAYER.explorer },
  { id: "BBEM", name: "BEM", chain: "bsc", chainName: "BSC", chainId: BSC.chainId, hex: BSC.hex, decimals: 8, token: BSC.bem, explorer: BSC.explorer },
  { id: "OKB", name: "OKB", chain: "xlayer", chainName: "X Layer", chainId: XLAYER.chainId, hex: XLAYER.hex, decimals: 18, token: null, explorer: XLAYER.explorer },
];

type Bill = { asset: AssetId; to: string; amount: string; open: boolean };

function assetOf(id: AssetId) {
  return ASSETS.find((row) => row.id === id) ?? ASSETS[0];
}

function encodeBill(bill: Bill): string {
  const row = assetOf(bill.asset);
  return ["TAPELIQUID", "1", String(row.chainId), bill.asset, bill.to.toLowerCase(), bill.open ? "" : bill.amount.trim()].join("|");
}

function parseBill(raw: string): Bill | { error: string } {
  const text = raw.trim();
  if (/^0x[a-fA-F0-9]{40}$/.test(text)) return { asset: "TAPE", to: text, amount: "", open: true };
  const parts = text.split("|");
  if (parts[0] !== "TAPELIQUID" || parts.length < 6) return { error: "这不是本站的收款码。可以贴地址，或贴 TAPELIQUID 开头的那一行。" };
  if (parts[1] !== "1") return { error: "这张码的版本本页还不认识。" };
  const asset = ASSETS.find((row) => row.id === parts[3] && String(row.chainId) === parts[2]);
  if (!asset) return { error: "码里的币或链对不上。TAPE、BEM、OKB 不能混链。" };
  if (!/^0x[a-fA-F0-9]{40}$/.test(parts[4] ?? "")) return { error: "码里的收款地址不对。" };
  const amount = (parts[5] ?? "").trim();
  if (amount && !/^\d+(\.\d+)?$/.test(amount)) return { error: "码里的数量不是数字。" };
  return { asset: asset.id, to: parts[4], amount, open: amount === "" };
}

function trimAmount(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function readQr(source: CanvasImageSource, sw: number, sh: number, canvas: HTMLCanvasElement): string | null {
  if (sw < 8 || sh < 8) return null;
  const scale = Math.min(1, 720 / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, width, height);
  const image = ctx.getImageData(0, 0, width, height);
  return jsQR(image.data, width, height, { inversionAttempts: "attemptBoth" })?.data ?? null;
}

export function PayDesk({ zh, account }: { zh: boolean; account: string | null }) {
  const [mode, setMode] = useState<"receive" | "pay">("receive");
  const [asset, setAsset] = useState<AssetId>("TAPE");
  const [amount, setAmount] = useState("");
  const [openAmount, setOpenAmount] = useState(false);
  const [balances, setBalances] = useState<Partial<Record<AssetId, bigint>>>({});
  const [payTo, setPayTo] = useState("");
  const [scanned, setScanned] = useState("");
  const [scanOn, setScanOn] = useState(false);
  const [scanNote, setScanNote] = useState("");
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const [note, setNote] = useState("");
  const [hash, setHash] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const onCode = useRef<(raw: string) => void>(() => undefined);
  const who = account ?? currentAccount();
  const row = assetOf(asset);
  const held = balances[asset];

  useEffect(() => onAccount(() => setBalances({})), []);

  useEffect(() => {
    if (!who) return;
    let dead = false;
    const pull = () => {
      Promise.all([
        xClient.readContract({ address: TAPE_TOKEN, abi: erc20, functionName: "balanceOf", args: [who as Hex] }),
        xClient.readContract({ address: TAPE_BEM, abi: erc20, functionName: "balanceOf", args: [who as Hex] }),
        bscClient.readContract({ address: BSC.bem, abi: erc20, functionName: "balanceOf", args: [who as Hex] }),
        xClient.getBalance({ address: who as Hex }),
      ]).then(([tape, xbem, bbem, okb]) => {
        if (!dead) setBalances({ TAPE: tape, XBEM: xbem, BBEM: bbem, OKB: okb });
      }).catch(() => undefined);
    };
    pull();
    const id = window.setInterval(pull, 20_000);
    return () => { dead = true; window.clearInterval(id); };
  }, [who]);

  const bill: Bill | null = who && (mode === "pay" || openAmount || /^\d+(\.\d+)?$/.test(amount.trim()))
    ? { asset, to: mode === "pay" ? payTo.trim() : who, amount: amount.trim(), open: mode === "receive" && openAmount }
    : null;
  const code = bill && /^0x[a-fA-F0-9]{40}$/.test(bill.to) ? encodeBill(bill) : "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || mode !== "receive" || !code) return;
    QRCode.toCanvas(canvas, code, { width: 220, margin: 1, errorCorrectionLevel: "M" }).catch(() => undefined);
  }, [code, mode]);

  useEffect(() => {
    if (!scanOn) return;
    const video = videoRef.current;
    if (!video) return;
    let dead = false;
    let stream: MediaStream | null = null;
    let frame = 0;
    const scratch = document.createElement("canvas");
    const openCamera = async () => {
      const tries: MediaStreamConstraints[] = [
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        { video: true, audio: false },
      ];
      let last: unknown;
      for (const constraints of tries) {
        try { return await navigator.mediaDevices.getUserMedia(constraints); } catch (error) { last = error; }
      }
      throw last;
    };
    openCamera().then(async (next) => {
      stream = next;
      if (dead) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      video.srcObject = next;
      video.muted = true;
      await video.play();
      setScanNote(zh ? "把二维码放进画面，保持稳定。" : "Hold the code steady in the frame.");
      const look = () => {
        if (dead) return;
        frame = window.requestAnimationFrame(look);
        if (video.readyState < 2 || video.videoWidth === 0) return;
        const raw = readQr(video, video.videoWidth, video.videoHeight, scratch);
        if (!raw) return;
        dead = true;
        window.cancelAnimationFrame(frame);
        next.getTracks().forEach((track) => track.stop());
        onCode.current(raw);
        setScanOn(false);
      };
      frame = window.requestAnimationFrame(look);
    }).catch(() => setScanNote(zh ? "摄像头没打开。用相册里的照片，或把码里的字贴上。" : "The camera did not open. Use a photo, or paste the text."));
    return () => {
      dead = true;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
    };
  }, [scanOn, zh]);

  const applyCode = (raw: string) => {
    const parsed = parseBill(raw);
    setScanned(raw.trim());
    setAck(false);
    setHash("");
    if ("error" in parsed) {
      setBad(true);
      setNote(zh ? `${parsed.error} 读到：${raw.trim().slice(0, 72)}` : `Not a TAPELIQUID code. Read: ${raw.trim().slice(0, 72)}`);
      return;
    }
    setMode("pay");
    setAsset(parsed.asset);
    setPayTo(parsed.to);
    setAmount(parsed.amount);
    setOpenAmount(parsed.open);
    setBad(false);
    setNote(parsed.open ? (zh ? "这张码没有写死数量。币和地址已经填上，数量你自己定。" : "This code leaves the amount open. The asset and address are filled. You set the amount.") : (zh ? "币、地址和数量都按码填上了。数量还可以改，地址以码为准。" : "Asset, address and amount came from the code. You can still change the amount."));
  };
  onCode.current = applyCode;

  const onPhoto = (file: File | undefined) => {
    if (!file) return;
    createImageBitmap(file).then((bitmap) => {
      const raw = readQr(bitmap, bitmap.width, bitmap.height, document.createElement("canvas"));
      bitmap.close();
      if (!raw) {
        setBad(true);
        setNote(zh ? "这张图里没有认出二维码。离近一点，让码占满画面。" : "No code in that photo. Move closer so the code fills the picture.");
        return;
      }
      onCode.current(raw);
    }).catch(() => {
      setBad(true);
      setNote(zh ? "这张图读不了。" : "That image could not be read.");
    });
  };

  const pay = () => {
    if (!who) {
      setBad(true);
      setNote(zh ? "先连接钱包。" : "Connect a wallet first.");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(payTo.trim())) {
      setBad(true);
      setNote(zh ? "收款地址不是 0x 开头的 42 位。" : "The address is not a 42-character 0x address.");
      return;
    }
    if (payTo.trim().toLowerCase() === who.toLowerCase()) {
      setBad(true);
      setNote(zh ? "这是你自己的地址。" : "That is your own address.");
      return;
    }
    let value = 0n;
    try {
      value = parseUnits(amount.trim(), row.decimals);
    } catch {
      setBad(true);
      setNote(zh ? "数量不对。" : "The amount is not valid.");
      return;
    }
    if (value <= 0n) {
      setBad(true);
      setNote(zh ? "数量要大于 0。" : "The amount has to be more than zero.");
      return;
    }
    const reserve = row.id === "OKB" ? OKB.gasReserve : 0n;
    if (held != null && value + reserve > held) {
      setBad(true);
      setNote(row.id === "OKB" ? (zh ? "余额不够，还要留一点 OKB 当 gas。" : "Not enough OKB. Leave some for gas.") : (zh ? "余额不够。" : "The balance is not enough."));
      return;
    }
    setBusy(true);
    setBad(false);
    setHash("");
    setNote(zh ? "在钱包里确认。这一页不跳走。" : "Confirm in the wallet. This page stays.");
    const eth = getProvider();
    if (!eth) {
      setBusy(false);
      setBad(true);
      setNote(zh ? "没有检测到钱包。" : "No wallet was found.");
      return;
    }
    const go = async () => {
      const now = await eth.request({ method: "eth_chainId" }).catch(() => "");
      if (String(now).toLowerCase() !== row.hex.toLowerCase()) {
        if (row.chain === "bsc") await connectBsc();
        else await connectXLayer();
      }
      const tx = row.token
        ? { from: who, to: row.token, data: encodeFunctionData({ abi: erc20, functionName: "transfer", args: [payTo.trim() as Hex, value] }), chainId: row.hex }
        : { from: who, to: payTo.trim(), value: `0x${value.toString(16)}`, chainId: row.hex };
      return (await eth.request({ method: "eth_sendTransaction", params: [tx] })) as string;
    };
    go().then((next) => {
      setHash(next);
      setAck(false);
      setBad(false);
      setNote(zh ? "已提交。到账以链上为准。" : "Submitted. The chain is the record.");
    }).catch((error: unknown) => {
      const text = error instanceof Error ? error.message : "";
      setBad(true);
      setNote(/reject|denied|4001/i.test(text) ? (zh ? "你取消了。币还在钱包。" : "You cancelled. The coins stayed in the wallet.") : (zh ? "没有转出。" : "It did not send."));
    }).finally(() => setBusy(false));
  };

  const heldText = held == null ? "—" : trimAmount(formatUnits(held, row.decimals));

  return (
    <aside className="border border-gold bg-card">
      <div className="border-b border-gold/40 px-3 py-3">
        <p className="text-[11px] tracking-[0.18em] text-gold">{zh ? "收付款" : "Pay"}</p>
        <h3 className="mt-1 text-lg leading-6">{zh ? "扫码付，或生成收款码" : "Scan to pay, or make a code"}</h3>
        <p className="mt-1 text-xs leading-5 text-ink/55">{zh ? "只收 TAPE、BEM、OKB。X Layer 的 BEM 和 BSC 的 BEM 是两份币，码里写死了链，不能混。" : "TAPE, BEM and OKB only. X Layer BEM and BSC BEM are different coins. The code locks the chain."}</p>
      </div>
      <div className="grid grid-cols-2 border-b border-gold text-sm">
        <button type="button" className={`min-h-11 ${mode === "receive" ? "bg-ink text-paper" : ""}`} onClick={() => { setMode("receive"); setAck(false); setScanOn(false); }}>{zh ? "收款" : "Receive"}</button>
        <button type="button" className={`min-h-11 ${mode === "pay" ? "bg-ink text-paper" : ""}`} onClick={() => { setMode("pay"); setAck(false); }}>{zh ? "付款" : "Pay"}</button>
      </div>
      <div className="grid grid-cols-2 gap-1 p-3">
        {ASSETS.map((item) => (
          <button key={item.id} type="button" className={`min-h-11 border px-2 text-left text-xs ${asset === item.id ? "border-ink bg-ink text-paper" : "border-gold"}`} onClick={() => { setAsset(item.id); setAck(false); setHash(""); }}>
            <span className="block text-sm">{item.name}</span>
            <span className={`block ${asset === item.id ? "text-paper/70" : "text-ink/45"}`}>{item.chainName}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-3 px-3 pb-3">
        <p className="font-mono text-xs text-ink/55">{zh ? "钱包" : "Wallet"} {heldText} {row.name} · {row.chainName}{row.token ? "" : (zh ? " · 原生币，还要留 gas" : " · native, leave gas")}</p>
        {mode === "receive" ? (
          <>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4" checked={openAmount} onChange={(event) => setOpenAmount(event.target.checked)} />
              {zh ? "不写死数量，付款人自己填" : "Leave the amount open"}
            </label>
            <label className={`grid gap-1 text-xs text-ink/55 ${openAmount ? "opacity-40" : ""}`}>
              {zh ? `收取 ${row.name}` : `Ask for ${row.name}`}
              <input value={amount} disabled={openAmount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="0" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink disabled:bg-transparent" />
            </label>
            {who ? <p className="break-all font-mono text-[11px] leading-5 text-ink/50">{zh ? "收到" : "To"} {who}</p> : <p className="text-sm">{zh ? "先连接钱包，码上才有你的地址。" : "Connect a wallet so the code carries your address."}</p>}
            {code ? (
              <div className="grid justify-items-center gap-2 border border-gold/40 bg-paper p-3">
                <canvas ref={canvasRef} width={220} height={220} className="h-[220px] w-[220px]" />
                <p className="text-center text-sm">{openAmount ? (zh ? `${row.name} · 数量由对方填` : `${row.name} · they choose the amount`) : `${amount.trim()} ${row.name}`}</p>
                <p className="text-center text-xs text-ink/50">{row.chainName} · {row.chainId}</p>
                <div className="flex w-full gap-2">
                  <button type="button" className="min-h-10 flex-1 border border-gold text-xs" onClick={() => { void navigator.clipboard?.writeText(code); setNote(zh ? "收款码文字已复制。" : "Code text copied."); setBad(false); }}>{zh ? "复制码" : "Copy code"}</button>
                  <button type="button" className="min-h-10 flex-1 border border-gold text-xs" onClick={() => { if (who) void navigator.clipboard?.writeText(who); setNote(zh ? "地址已复制。" : "Address copied."); setBad(false); }}>{zh ? "复制地址" : "Copy address"}</button>
                </div>
              </div>
            ) : <p className="text-xs leading-5 text-ink/50">{zh ? "填一个数量，或勾上不写死数量，就会生成码。" : "Enter an amount, or leave it open, and the code appears."}</p>}
            <p className="text-[11px] leading-5 text-ink/45">{zh ? "对方用本页「付款」扫这张码。别的钱包扫出来是一段文字，不会自动转账。链不对的币转进来，取不回。" : "The other person scans it with Pay on this page. Another wallet only sees the text. A coin sent on the wrong chain cannot be recovered."}</p>
          </>
        ) : (
          <>
            <div className="flex gap-2">
              <button type="button" className="min-h-11 flex-1 bg-ink text-sm text-paper" onClick={() => { setScanOn(true); setScanNote(zh ? "正在打开摄像头。" : "Opening the camera."); }}>{zh ? "打开摄像头" : "Camera"}</button>
              <button type="button" className="min-h-11 border border-gold px-3 text-xs" onClick={() => fileRef.current?.click()}>{zh ? "相册" : "Photo"}</button>
              <button type="button" className="min-h-11 border border-gold px-3 text-xs" onClick={() => { setPayTo(""); setAmount(""); setScanned(""); setAck(false); setNote(zh ? "已清空，可以手填。" : "Cleared."); setBad(false); }}>{zh ? "清空" : "Clear"}</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; onPhoto(file); }} />
            {scanOn ? (
              <div className="grid gap-2 border border-gold/40 p-2">
                <video ref={videoRef} className="aspect-square w-full bg-ink object-cover" muted autoPlay playsInline />
                <p className="text-center text-xs text-ink/60">{scanNote || (zh ? "正在找二维码。" : "Looking for a code.")}</p>
                <button type="button" className="min-h-9 text-xs" onClick={() => setScanOn(false)}>{zh ? "关闭摄像头" : "Close camera"}</button>
              </div>
            ) : null}
            <label className="grid gap-1 text-xs text-ink/55">
              {zh ? "贴上收款码里的字" : "Paste the code text"}
              <textarea value={scanned} onChange={(event) => setScanned(event.target.value)} rows={2} className="min-h-16 border border-gold/50 bg-transparent px-2 py-2 font-mono text-xs text-ink" placeholder="TAPELIQUID|1|..." />
            </label>
            <button type="button" className="min-h-10 border border-gold text-xs" onClick={() => applyCode(scanned)}>{zh ? "按这段字填写" : "Fill from this text"}</button>
            <label className="grid gap-1 text-xs text-ink/55">
              {zh ? "付给" : "Pay to"}
              <input value={payTo} onChange={(event) => { setPayTo(event.target.value.trim()); setAck(false); }} placeholder="0x" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-sm text-ink" />
            </label>
            <label className="grid gap-1 text-xs text-ink/55">
              {zh ? `数量 ${row.name}` : `Amount ${row.name}`}
              <input value={amount} onChange={(event) => { setAmount(event.target.value); setAck(false); }} inputMode="decimal" placeholder="0" className="min-h-12 border border-gold/50 bg-transparent px-2 font-mono text-base text-ink" />
            </label>
            <div className="border border-gold/40 px-3 py-2 text-xs leading-5">
              <p>{row.name} · {row.chainName}</p>
              <p className="break-all font-mono text-[11px] text-ink/50">{row.token ?? (zh ? "原生 OKB" : "Native OKB")}</p>
              <p className="mt-1">{zh ? `余额 ${heldText}。付给 ${payTo ? `${payTo.slice(0, 6)}…${payTo.slice(-4)}` : "—"}。数量 ${amount.trim() || "—"}。` : `Balance ${heldText}. To ${payTo ? `${payTo.slice(0, 6)}…${payTo.slice(-4)}` : "—"}. Amount ${amount.trim() || "—"}.`}</p>
            </div>
            <label className="flex items-start gap-2 text-sm leading-6">
              <input type="checkbox" className="mt-1 size-4" checked={ack} onChange={(event) => setAck(event.target.checked)} />
              <span>{zh ? `我核对过：这是 ${row.chainName} 上的 ${row.name}，地址和数量无误。` : `I checked: this is ${row.name} on ${row.chainName}, and the address and amount are right.`}</span>
            </label>
            <button type="button" disabled={busy || !ack} className="min-h-12 bg-ink text-sm text-paper disabled:opacity-40" onClick={pay}>{busy ? (zh ? "在钱包里确认" : "Confirm in the wallet") : (zh ? `支付 ${row.name}` : `Pay ${row.name}`)}</button>
            {hash ? <a className="break-all font-mono text-[11px] underline" href={`${row.explorer}/tx/${hash}`} target="_blank" rel="noreferrer">{hash}</a> : null}
          </>
        )}
        {note ? <p className={`text-sm leading-6 ${bad ? "text-sell" : ""}`}>{note}</p> : null}
      </div>
    </aside>
  );
}
