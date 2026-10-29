import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatUnits, parseUnits } from "viem";
import {
  GIFT_ASSETS,
  buyPreview,
  claimRed,
  fundRed,
  giftDeployer,
  giftText,
  noteClaim,
  readClaimed,
  readMyClaims,
  type ClaimRow,
  meetsVolume,
  packetOf,
  readAssetVolume,
  readRed,
  readSpawned,
  openAnother,
  boothReady,
  sellPreview,
  setRedRule,
  sgClock,
  sgDay,
  taskAsset,
  taskLine,
  tradeRed,
  tradedNow,
  walletHold,
  withdrawRed,
  type GiftAsset,
  type GiftChain,
  type GiftLane,
  type RedRule,
} from "@/lib/red-packet";
import { currentChain, ensureProvider, onChain, switchDeskChain } from "@/lib/wallet";
import { TxPending } from "@/lib/chain-marks";

function blockReason(
  rule: RedRule,
  used: boolean,
  vol: { spot: number; perp: number },
  zh: boolean,
): string | null {
  if (!rule.deployed) return zh ? "链上没有代码" : "No code";
  if (!rule.ready || !rule.asset) return zh ? "已部署，去创建活动" : "Deployed. Create the game";
  if (rule.spotNeed === 0n && rule.perpNeed === 0n)
    return zh ? "部署者还没写交易量" : "No volume rule";
  if (used) return zh ? "今天已经参加过" : "Already joined today";
  if (!meetsVolume(rule.gate, rule.spotNeed, rule.perpNeed, vol))
    return zh ? "交易量还没到" : "Volume is short";
  if (rule.dayCap > 0n && rule.claimedToday >= rule.dayCap)
    return zh ? "今天名额满了" : "Today is full";
  if (rule.mode === 2 && rule.packetsLeft === 0n)
    return zh ? "这一轮领完了" : "This round is finished";
  if (rule.mode === 0 && rule.balance < rule.fixedAmt)
    return zh ? "池子不够这一份" : "Pool is short";
  if (rule.mode === 1 && rule.balance < rule.lo)
    return zh ? "池子不够最少的一份" : "Pool is under the minimum";
  if (rule.balance === 0n) return zh ? "池子是空的" : "Pool is empty";
  return null;
}

function blankRule(chain: GiftChain, lane: GiftLane): RedRule {
  return {
    chain,
    lane,
    address: packetOf(chain, lane),
    deployed: false,
    token: "0x0000000000000000000000000000000000000000",
    mode: 0,
    fixedAmt: 0n,
    lo: 0n,
    hi: 0n,
    packetsLeft: 0n,
    dayCap: 0n,
    spotNeed: 0n,
    perpNeed: 0n,
    gate: chain === "bsc" ? 1 : 0,
    endsAt: 0n,
    credit: 0n,
    maker: "0x0000000000000000000000000000000000000000",
    claimedToday: 0n,
    balance: 0n,
    lastDay: 0n,
    tradedDay: 0n,
    ready: false,
    asset: null,
  };
}

const SLOTS: { chain: GiftChain; lane: GiftLane }[] = [
  { chain: "xlayer", lane: "official" },
  { chain: "bsc", lane: "official" },
  { chain: "xlayer", lane: "volunteer" },
  { chain: "bsc", lane: "volunteer" },
];

export function RedGift({
  account,
  zh,
  forceOpen = false,
  onIdle,
}: {
  account: string | null;
  zh: boolean;
  forceOpen?: boolean;
  onIdle?: () => void;
}) {
  const [open, setOpen] = useState(forceOpen);
  const [books, setBooks] = useState<RedRule[]>(
    SLOTS.map((slot) => blankRule(slot.chain, slot.lane)),
  );
  const [seen, setSeen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [bad, setBad] = useState(false);
  const [pop, setPop] = useState<{ name: string; amount: string } | null>(null);
  const [lane, setLane] = useState<GiftLane>("volunteer");
  const [assetId, setAssetId] = useState("usdt");
  const [fixedText, setFixedText] = useState("1");
  const [packets, setPackets] = useState("10");
  const [spotText, setSpotText] = useState("0.01");
  const [perpText, setPerpText] = useState("100");
  const [gate, setGate] = useState(0);
  const [taskId, setTaskId] = useState("bem");
  const [life, setLife] = useState(86_400);
  const [pick, setPick] = useState<GiftChain>(() => (currentChain() === 196 ? "xlayer" : "bsc"));
  const [deskOn, setDeskOn] = useState(true);
  const [tab, setTab] = useState<"send" | "claim">("claim");
  const [info, setInfo] = useState<string | null>(null);
  const [seal, setSeal] = useState<RedRule | null>(null);
  const [boom, setBoom] = useState(false);
  const [logStamp, setLogStamp] = useState(0);
  const [paid, setPaid] = useState<Record<string, bigint | null>>({});
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [self, setSelf] = useState(account);
  useEffect(() => setSelf(account), [account]);
  useEffect(() => {
    const id = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, []);
  const day = sgDay();
  useEffect(() => {
    return onChain((id) => {
      if (id === 56) setPick("bsc");
      if (id === 196) setPick("xlayer");
    });
  }, []);
  useEffect(() => {
    let dead = false;
    setDeskOn(true);
    void boothReady(pick)
      .then((on) => {
        if (!dead) setDeskOn(on);
      })
      .catch(() => {
        if (!dead) setDeskOn(false);
      });
    return () => {
      dead = true;
    };
  }, [pick, logStamp]);
  const officialHere = Boolean(self && giftDeployer(pick).toLowerCase() === self.toLowerCase());
  useEffect(() => {
    if (!officialHere && lane === "official") setLane("volunteer");
  }, [officialHere, lane]);

  const reload = () => {
    void Promise.all([
      Promise.all(
        SLOTS.map((slot) =>
          readRed(slot.chain, account, slot.lane).catch(() => blankRule(slot.chain, slot.lane)),
        ),
      ),
      readSpawned("xlayer", account).catch(() => [] as RedRule[]),
      readSpawned("bsc", account).catch(() => [] as RedRule[]),
    ]).then(([slots, xlayer, bsc]) => {
      const rows: RedRule[] = [];
      const seenAddr = new Set<string>();
      for (const row of [...xlayer, ...bsc, ...slots]) {
        const key = row.address.toLowerCase();
        if (seenAddr.has(key)) continue;
        seenAddr.add(key);
        if (row.maker && giftDeployer(row.chain).toLowerCase() === row.maker.toLowerCase())
          row.lane = "official";
        rows.push(row);
      }
      setBooks(rows);
      setSeen(true);
    });
  };

  useEffect(() => {
    if (!open) return;
    reload();
  }, [open, account]);
  useEffect(() => {
    const rows = books.filter((book) => book.ready && book.asset);
    if (!rows.length) return;
    let dead = false;
    void Promise.all(
      rows.map(async (book) => {
        const n = await readClaimed(book.chain, book.address, book.balance).catch(() => null);
        return [book.address, n] as const;
      }),
    ).then((list) => {
      if (dead) return;
      setPaid((prev) => {
        const next = { ...prev };
        for (const [addr, n] of list) if (n != null) next[addr] = n;
        return next;
      });
    });
    return () => {
      dead = true;
    };
  }, [books, open]);

  const who = async () => {
    const eth = await ensureProvider();
    let rows = (await eth.request({ method: "eth_accounts" })) as string[];
    if (!rows[0]) {
      rows = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!rows[0]) throw new Error("nowallet");
      setSelf(rows[0]);
      throw new Error("connected");
    }
    if (!rows[0]) throw new Error("nowallet");
    setSelf(rows[0]);
    return rows[0];
  };

  const run = async (job: () => Promise<"cheer" | "ok" | void>) => {
    setBusy(true);
    setBad(false);
    setNote("");
    try {
      const kind = await job();
      if (kind === "cheer" || kind === "ok") return;
      setNote("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      const detail = `${message} ${String((err as { cause?: unknown }).cause ?? "")}`;
      const calm =
        message === "connected" ||
        message === "switched" ||
        message === "approve" ||
        message === "booth";
      setBad(!calm);
      if (calm && message === "connected")
        setNote(
          zh
            ? "钱包已连接。请再点一次刚才的按钮。这一次没有扣钱。"
            : "The wallet is connected. Tap the same button once more. Nothing was spent.",
        );
      else if (message === "switched")
        setNote(
          zh
            ? "已经换成这条链。请再点一次刚才的按钮。这一次没有扣钱。"
            : "The chain is switched. Tap the same button once more. Nothing was spent.",
        );
      else if (message === "approve")
        setNote(
          zh
            ? "授权已提交。请等它完成，再点一次。这一次还没有交易，也还没有领取。"
            : "The approval was sent. Wait for it, then tap once more. Nothing was traded or claimed.",
        );
      else if (message === "booth") {
        setDeskOn(true);
        setNote(
          zh
            ? "发布台已经放上。请再点一次「确认打入」，奖金才会进奖池。"
            : "The desk is in place. Tap Confirm once more. Only then does the prize enter the pool.",
        );
      }
      else if ((err as { code?: number }).code === 4001 || /user rejected|denied/i.test(detail))
        setNote(
          zh
            ? "你取消了钱包确认。这笔没有发出，资产没有变动。"
            : "You cancelled the wallet. Nothing was sent.",
        );
      else if (err instanceof TxPending || detail.includes("pending"))
        setNote(
          zh
            ? "钱包窗口正在弹出。请在窗口里点确认，不要重复点击。"
            : "The wallet window is opening. Confirm it there, and do not tap again.",
        );
      else if (detail.includes("nowallet"))
        setNote(zh ? "请先连接钱包，再继续。" : "Connect a wallet first.");
      else if (detail.includes("deployer") || message === "safe")
        setNote(
          zh
            ? "官方红包只能由该链的部署地址创建。"
            : "Only this chain's deployer can create an official packet.",
        );
      else if (message.startsWith("day") || message === "traded")
        setNote(
          zh
            ? "这个红包你今天已经领过。其他新红包仍可参加。"
            : "You already claimed this packet today. A new packet is still open.",
        );
      else if (message === "empty")
        setNote(
          zh ? "奖金池不够这一份，暂时不能领取。" : "The prize pool cannot cover this packet.",
        );
      else if (message === "cap")
        setNote(
          zh
            ? "今天的名额已经用完。创建人可以重新开放领取。"
            : "Today's places are full. The creator can open them again.",
        );
      else if (message === "rule")
        setNote(zh ? "创建人还没有写好活动规则。" : "The creator has not saved the rules.");
      else if (message === "dust")
        setNote(
          zh
            ? "池里还留着上一种资产。先领完，再换成新的。"
            : "The pool still holds the previous asset. Claim it before switching.",
        );
      else if (message === "packets")
        setNote(zh ? "请填写这一轮可以领几个人。" : "Enter how many people can claim this round.");
      else if (message === "fund")
        setNote(
          zh
            ? "奖金没有进入奖池。请再点一次确认。"
            : "The prize did not enter the pool. Confirm again.",
        );
      else if (message === "amount")
        setNote(
          zh
            ? "金额或人数不正确。请检查后再确认。"
            : "The amount or the number of people is not valid.",
        );
      else if (message === "early")
        setNote(
          zh
            ? "领取期限还没结束，未领的奖金还不能取回。"
            : "The claim window is still open, so the remainder cannot be taken back yet.",
        );
      else if (message === "late")
        setNote(zh ? "领取期限已过，这个红包不能再领。" : "The claim window is over.");
      else if (message === "life")
        setNote(
          zh
            ? "领取期限只能选 24 小时、一星期或一个月。"
            : "The window must be 24 hours, one week, or one month.",
        );
      else if (message === "bot")
        setNote(
          zh
            ? "合约地址不能领取。请用普通钱包。"
            : "A contract address cannot claim. Use an ordinary wallet.",
        );
      else if (message === "pace")
        setNote(
          zh
            ? "上一笔刚领完。请等待三分钟后再领下一个。"
            : "Wait three minutes after the last claim.",
        );
      else if (message === "task" || message === "buy" || message === "pull")
        setNote(
          zh
            ? "交易没有完成。请确认余额够这一笔，并在钱包里点确认。"
            : "The trade did not finish. Check the balance and confirm it in the wallet.",
        );
      else if (message === "fee")
        setNote(
          zh
            ? "这个币没有可成交的池子，暂时不能作为任务。"
            : "This coin has no pool that can fill the task.",
        );
      else if (detail.includes("creator"))
        setNote(
          zh
            ? "奖池里还有奖金。只有创建人可以修改这一份。"
            : "This round still has a prize. Only its creator can change it.",
        );
      else if (message === "funds")
        setNote(
          zh
            ? "钱包余额不够这一笔。请先补足，再回来交易。"
            : "The wallet does not have enough for this trade.",
        );
      else if (message === "net")
        setNote(
          zh
            ? "网络没有算出手续费，钱包没有弹出。请再点一次。"
            : "The network could not price the fee, so the wallet did not open. Tap once more.",
        );
      else if (message === "xlayer")
        setNote(
          zh
            ? "请先把钱包换到 X Layer，再点一次。"
            : "Switch the wallet to X Layer, then tap once more.",
        );
      else if (message === "bsc")
        setNote(
          zh ? "请先把钱包换到 BSC，再点一次。" : "Switch the wallet to BSC, then tap once more.",
        );
      else
        setNote(
          zh
            ? "这一步没有完成。钱包没有发出交易。请按上面的字再点一次。"
            : "This step did not finish. The wallet sent nothing. Read the note and tap once more.",
        );
    } finally {
      setBusy(false);
      reload();
    }
  };

  const whyNot = (book: RedRule, who = self): string | null => {
    if (book.lastDay === BigInt(day)) return zh ? "这个已经领过。" : "Already claimed this one.";
    if (book.endsAt > 0n && BigInt(Math.floor(Date.now() / 1000)) > book.endsAt)
      return zh ? "领取时间已经过了。" : "The claim window is over.";
    if (book.balance === 0n) return zh ? "奖金还没进池。" : "The prize is not in the pool.";
    if (book.dayCap > 0n && book.claimedToday >= book.dayCap)
      return zh
        ? "今天的名额满了。创建者点放开领取。"
        : "Today's quota is full. The creator can reopen it.";
    const task = taskAsset(book.chain, book.hi) ?? book.asset;
    if (!task) return zh ? "活动没有指定资产。" : "This round does not name an asset.";
    if (book.spotNeed === 0n && book.perpNeed === 0n)
      return zh ? "活动没有买入金额。" : "This round has no buy amount.";
    return null;
  };

  const verify = async (book: RedRule) => {
    const from = self ?? (await who().catch(() => null));
    if (from && from !== self) setSelf(from);
    const why = whyNot(book, from);
    if (why) {
      setBad(true);
      setNote(why);
      return;
    }
    setBad(false);
    setNote("");
    setSeal(book);
  };

  const claim = (book: RedRule) => {
    if (book.lastDay === BigInt(day)) {
      setBad(true);
      setNote(
        zh
          ? "这个红包你今天已经领过。其他新红包仍可参加。"
          : "You already claimed this packet today. A new packet is still open.",
      );
      setSeal(null);
      return;
    }
    void run(async () => {
      const from = await who();
      setNote(
        zh
          ? "钱包窗口正在弹出。请在窗口里点确认，奖金才会进入当前钱包。"
          : "The wallet window is opening. Confirm it there, and the prize will enter this wallet.",
      );
      const got = await claimRed(book.chain, from, book.lane, book.address);
      const text = book.asset
        ? `${giftText(got.amount, book.asset)} ${zh ? book.asset.zh : book.asset.en}`
        : "";
      noteClaim(from, {
        chain: book.chain,
        lane: book.lane,
        amount: book.asset ? giftText(got.amount, book.asset) : "",
        name: book.asset ? (zh ? book.asset.zh : book.asset.en) : "",
        at: Date.now(),
        tx: got.hash,
      });
      setLogStamp((n) => n + 1);
      setSeal(null);
      setPop({ name: book.asset ? (zh ? book.asset.zh : book.asset.en) : "", amount: text });
      return "cheer" as const;
    });
  };

  const act = async (job: () => Promise<unknown>) => {
    let ok = false;
    await run(async () => {
      await job();
      ok = true;
      return "ok" as const;
    });
    return ok;
  };

  return (
    <div
      className={
        forceOpen
          ? "bg-card px-4 py-4 text-base text-ink"
          : "border border-[#e6c36a]/50 bg-card text-base text-ink"
      }
    >
      {forceOpen ? null : (
        <button
          type="button"
          className="flex min-h-12 w-full items-center justify-between px-4 text-left"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="text-sm text-ink">{zh ? "新手礼包" : "Gift"}</span>
          <span className="text-sm text-ink">
            {open ? (zh ? "收起" : "Hide") : zh ? "打开" : "Open"}
          </span>
        </button>
      )}
      {open ? (
        <div className={forceOpen ? "" : "border-t border-gold/30 px-4 py-4"}>
          {books.some((book) => book.asset && self && book.credit > 0n) ? (
            <MineFunds
              zh={zh}
              books={books}
              now={now}
              self={self}
              busy={busy}
              run={run}
              who={who}
              setNote={setNote}
            />
          ) : null}
          <GiftChains zh={zh} chain={pick} busy={busy} onPick={setPick} />
          <div className="gift-seg mt-3">
            <button type="button" data-on={tab === "send" ? "1" : "0"} onClick={() => setTab("send")}>
              {zh ? "发红包" : "Send"}
            </button>
            <button type="button" data-on={tab === "claim" ? "1" : "0"} onClick={() => setTab("claim")}>
              {zh ? "领红包" : "Claim"}
            </button>
          </div>
          {tab === "claim" ? (
            <>
              <MineLog zh={zh} account={self} stamp={logStamp} />
              <ClaimBoard
                zh={zh}
                chain={pick}
                books={books}
                paid={paid}
                now={now}
                seen={seen}
                info={info}
                setInfo={setInfo}
                busy={busy}
                self={self}
                act={act}
                who={who}
                openSeal={setSeal}
                say={(text, bad) => {
                  setBad(bad);
                  setNote(text);
                }}
                take={(book) => {
                  const asset = book.asset;
                  if (!asset) return;
                  void run(async () => {
                    await withdrawRed(
                      book.chain,
                      await who(),
                      formatUnits(book.credit, asset.decimals),
                      asset,
                      book.lane,
                    );
                    setNote(zh ? "资金已经取回。" : "Funds received.");
                    return "ok" as const;
                  });
                }}
                lift={(book) => {
                  const asset = book.asset;
                  if (!asset) return;
                  void run(async () => {
                    const from = await who();
                    const each = formatUnits(
                      book.mode === 0 ? book.fixedAmt : book.lo,
                      asset.decimals,
                    );
                    await setRedRule(
                      book.chain,
                      from,
                      asset,
                      0,
                      each,
                      "0",
                      "0",
                      "0",
                      "0",
                      formatUnits(book.spotNeed, 6),
                      formatUnits(book.perpNeed, 6),
                      book.gate,
                      86_400,
                      book.lane,
                      book.hi > 0n ? book.hi : undefined,
                    );
                    setNote(zh ? "名额已经放开。" : "The quota is open.");
                    return "ok" as const;
                  });
                }}
              />
            </>
          ) : (
            <div className="mt-3">
              {officialHere ? (
                <div className="gift-seg mb-2">
                  <button type="button" data-on={lane === "volunteer" ? "1" : "0"} onClick={() => setLane("volunteer")}>
                    {zh ? "个人" : "Personal"}
                  </button>
                  <button type="button" data-on={lane === "official" ? "1" : "0"} onClick={() => setLane("official")}>
                    {zh ? "官方" : "Official"}
                  </button>
                </div>
              ) : null}
              {!deskOn ? (
                <p className="mb-2 text-center text-sm text-ink/70">
                  {pick === "bsc"
                    ? zh
                      ? "BSC 还没有发布台。第一次点确认只放上发布台，放好后再点一次，奖金才打进去。"
                      : "BSC has no desk yet. The first confirm only places it. Tap again after that to fund the prize."
                    : zh
                      ? "这条链还没有发布台。第一次点确认只放上发布台。"
                      : "This chain has no desk yet. The first confirm only places it."}
                </p>
              ) : null}
              <DeployerDesk
                zh={zh}
                chain={pick}
                busy={busy}
                assetId={assetId}
                setAssetId={setAssetId}
                eachText={fixedText}
                setEachText={setFixedText}
                countText={packets}
                setCountText={setPackets}
                spotText={spotText}
                setSpotText={setSpotText}
                perpText={perpText}
                setPerpText={setPerpText}
                gate={gate}
                setGate={setGate}
                life={life}
                setLife={setLife}
                taskId={taskId}
                setTaskId={setTaskId}
                placeDesk={!deskOn}
                onSave={() => {
                  const chain = pick;
                  const asset =
                    GIFT_ASSETS[chain].find((row) => row.id === assetId) ?? GIFT_ASSETS[chain][0];
                  const task =
                    GIFT_ASSETS[chain].find(
                      (row) =>
                        row.id === taskId &&
                        row.id !== "usdt" &&
                        row.id !== "okb" &&
                        row.id !== "bnb",
                    ) ??
                    GIFT_ASSETS[chain].find(
                      (row) => row.id !== "usdt" && row.id !== "okb" && row.id !== "bnb",
                    );
                  const total = payTotal(fixedText, packets);
                  void run(async () => {
                    const from = await who();
                    if (
                      lane === "official" &&
                      giftDeployer(chain).toLowerCase() !== from.toLowerCase()
                    )
                      throw new Error("deployer");
                    if (!total || !task || !(Number(spotText) > 0)) throw new Error("amount");
                    const taskHi =
                      task.token === "0x0000000000000000000000000000000000000000"
                        ? 1n
                        : BigInt(task.token);
                    setNote(
                      zh
                        ? "钱包窗口正在弹出。确认后，奖金才会进入奖池。"
                        : "The wallet window is opening. The prize enters the pool only after you confirm.",
                    );
                    await openAnother(
                      chain,
                      from,
                      asset,
                      fixedText,
                      total,
                      spotText,
                      gate,
                      life,
                      taskHi,
                    );
                    setBoom(true);
                    window.setTimeout(() => setBoom(false), 1600);
                    setTab("claim");
                    return "ok" as const;
                  });
                }}
              />
            </div>
          )}
          {note ? (
            <p className={`mt-2 text-center text-base ${bad ? "text-sell" : "text-ink"}`}>{note}</p>
          ) : null}
        </div>
      ) : null}
      {pop ? (
        <Cheer name={pop.name} amount={pop.amount} zh={zh} onClose={() => setPop(null)} />
      ) : null}
      {seal ? (
        <WxSeal
          personal={seal.lane === "volunteer"}
          zh={zh}
          busy={busy}
          onOpen={() => claim(seal)}
          onClose={() => setSeal(null)}
        />
      ) : null}
      {boom ? <Fireworks /> : null}
    </div>
  );
}

function MineLog({ zh, account, stamp }: { zh: boolean; account: string | null; stamp: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ClaimRow[] | null>(null);
  useEffect(() => {
    if (!open || !account) return;
    let dead = false;
    setRows(null);
    readMyClaims(account)
      .then((next) => {
        if (!dead) setRows(next);
      })
      .catch(() => {
        if (!dead) setRows([]);
      });
    return () => {
      dead = true;
    };
  }, [open, account, stamp]);
  return (
    <div className="mt-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between text-base text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{zh ? "领取记录" : "Claims"}</span>
        <span>{open ? (zh ? "收起" : "Hide") : zh ? "打开" : "Open"}</span>
      </button>
      {open ? (
        !account ? (
          <p className="text-center text-ink">{zh ? "先连接钱包" : "Connect a wallet"}</p>
        ) : rows === null ? (
          <p className="text-center text-ink">{zh ? "正在读" : "Reading"}</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-ink">{zh ? "还没有领取" : "None yet"}</p>
        ) : (
          rows.map((row) => (
            <p key={row.tx} className="mt-2 bg-paper px-3 py-2 font-mono text-base text-ink">
              {row.at
                ? new Date(row.at).toLocaleString("zh-CN", {
                    hour12: false,
                    month: "2-digit",
                    day: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : ""}{" "}
              {row.chain === "bsc" ? "BSC" : "X Layer"} ·{" "}
              {row.lane === "volunteer" ? (zh ? "个人" : "Personal") : zh ? "官方" : "Official"}{" "}
              {row.amount} {row.name}
            </p>
          ))
        )
      ) : null}
    </div>
  );
}

function purse(
  book: RedRule,
  paid: bigint | null,
): { claimed: string; each: string; left: string } | null {
  if (!book.asset) return null;
  const unit = book.mode === 0 ? book.fixedAmt : book.lo;
  return {
    claimed: paid == null ? "" : giftText(paid, book.asset),
    each: giftText(unit, book.asset),
    left: giftText(book.balance, book.asset),
  };
}

function GiftChains({
  zh,
  chain,
  busy,
  onPick,
}: {
  zh: boolean;
  chain: GiftChain;
  busy: boolean;
  onPick: (next: GiftChain) => void;
}) {
  const [id, setId] = useState<number | null>(currentChain());
  const [moving, setMoving] = useState(false);
  useEffect(() => onChain(setId), []);
  const go = (next: GiftChain) => {
    const want = next === "bsc" ? 56 : 196;
    onPick(next);
    if (id === want || moving) return;
    setMoving(true);
    void switchDeskChain(want)
      .catch(() => undefined)
      .finally(() => setMoving(false));
  };
  const pill = (next: GiftChain, label: string) => (
    <button
      type="button"
      disabled={busy || moving}
      data-on={chain === next ? "1" : "0"}
      onClick={() => go(next)}
      className="disabled:opacity-40"
    >
      {label}
    </button>
  );
  return (
    <div className="gift-seg">
      {pill("xlayer", "X Layer")}
      {pill("bsc", "BSC")}
    </div>
  );
}

function ClaimBoard({
  zh,
  chain,
  books,
  paid,
  now,
  seen,
  info,
  setInfo,
  busy,
  self,
  act,
  who,
  openSeal,
  say,
  take,
  lift,
}: {
  zh: boolean;
  chain: GiftChain;
  books: RedRule[];
  paid: Record<string, bigint | null>;
  now: number;
  seen: boolean;
  info: string | null;
  setInfo: (v: string | null) => void;
  busy: boolean;
  self: string | null;
  act: (job: () => Promise<unknown>) => Promise<boolean>;
  who: () => Promise<string>;
  openSeal: (book: RedRule) => void;
  say: (text: string, bad: boolean) => void;
  take: (book: RedRule) => void;
  lift: (book: RedRule) => void;
}) {
  const stamp = BigInt(now);
  const [showLive, setShowLive] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const live = books
    .filter(
      (book) =>
        book.chain === chain &&
        book.ready &&
        book.asset &&
        book.balance > 0n &&
        book.endsAt > 0n &&
        stamp <= book.endsAt,
    )
    .sort((a, b) => (a.endsAt < b.endsAt ? -1 : 1));
  const done = books
    .filter(
      (book) =>
        book.chain === chain &&
        book.ready &&
        book.asset &&
        (stamp > book.endsAt || (book.balance === 0n && book.claimedToday > 0n)),
    )
    .sort((a, b) => (a.endsAt > b.endsAt ? -1 : 1));
  return (
    <div className="mt-3 flex flex-col gap-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between text-base text-ink"
        onClick={() => setShowLive((v) => !v)}
      >
        <span>{zh ? "正在进行" : "Open"}</span>
        <span>{showLive ? (zh ? "收起" : "Hide") : zh ? "打开" : "Open"}</span>
      </button>
      {showLive ? (
        live.length ? (
          live.map((book) => (
            <PacketCard
              key={book.address}
              book={book}
              paid={paid[book.address] ?? null}
              zh={zh}
              info={info}
              setInfo={setInfo}
              busy={busy}
              self={self}
              act={act}
              who={who}
              openSeal={openSeal}
              say={say}
              take={take}
              lift={lift}
              ended={false}
            />
          ))
        ) : (
          <p className="text-center text-sm text-ink/70">
            {seen
              ? chain === "bsc"
                ? zh
                  ? "BSC 还没有可领的红包。先在「发红包」放上发布台，再打入奖金。"
                  : "BSC has nothing to claim yet. Place the desk under Send, then fund a prize."
                : zh
                  ? "这条链没有进行中的红包。"
                  : "Nothing is open on this chain."
              : ""}
          </p>
        )
      ) : null}
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between text-base text-ink"
        onClick={() => setShowDone((v) => !v)}
      >
        <span>{zh ? "已经结束" : "Ended"}</span>
        <span>{showDone ? (zh ? "收起" : "Hide") : zh ? "打开" : "Open"}</span>
      </button>
      {showDone ? (
        done.length ? (
          done.map((book) => (
            <PacketCard
              key={book.address}
              book={book}
              paid={paid[book.address] ?? null}
              zh={zh}
              info={info}
              setInfo={setInfo}
              busy={busy}
              self={self}
              act={act}
              who={who}
              openSeal={openSeal}
              say={say}
              take={take}
              lift={lift}
              ended
            />
          ))
        ) : (
          <p className="text-center text-ink">{seen ? (zh ? "没有结束的" : "None ended") : ""}</p>
        )
      ) : null}
    </div>
  );
}

function PacketCard({
  book,
  paid,
  zh,
  info,
  setInfo,
  busy,
  self,
  act,
  who,
  openSeal,
  say,
  take,
  lift,
  ended,
}: {
  book: RedRule;
  paid: bigint | null;
  zh: boolean;
  info: string | null;
  setInfo: (v: string | null) => void;
  busy: boolean;
  self: string | null;
  act: (job: () => Promise<unknown>) => Promise<boolean>;
  who: () => Promise<string>;
  openSeal: (book: RedRule) => void;
  say: (text: string, bad: boolean) => void;
  take: (book: RedRule) => void;
  lift: (book: RedRule) => void;
  ended: boolean;
}) {
  const personal = book.lane === "volunteer";
  const owner = Boolean(self && book.credit > 0n);
  const maker = Boolean(self && book.maker.toLowerCase() === self.toLowerCase());
  const mineToday = book.lastDay === BigInt(sgDay());
  const tradedToday = book.tradedDay === BigInt(sgDay()) && !mineToday;
  const stuck = book.dayCap > 0n && book.claimedToday >= book.dayCap && book.balance > 0n;
  const sum = purse(book, paid);
  const name = book.asset ? (zh ? book.asset.zh : book.asset.en) : "";
  const task = taskAsset(book.chain, book.hi);
  const taskName = task ? (zh ? task.zh : task.en) : name;
  const unit = book.chain === "bsc" ? "BNB" : "OKB";
  const selling = book.gate === 1;
  const [got, setGot] = useState("");
  const line = taskLine(book.chain, book.hi, book.spotNeed, book.perpNeed, book.gate, zh, got);
  const [step, setStep] = useState<"join" | "ask" | "go" | "check" | "open">(
    tradedToday ? "check" : "join",
  );
  const [hold, setHold] = useState("");
  const gate = useRef(false);
  useEffect(() => {
    const need = book.spotNeed > book.perpNeed ? book.spotNeed : book.perpNeed;
    if (need <= 0n || book.hi === 0n) return;
    let dead = false;
    const job =
      book.gate === 1
        ? sellPreview(book.chain, book.hi, need).then((row) => row.sold)
        : buyPreview(book.chain, book.hi, need);
    void job.then((text) => {
      if (!dead && text) setGot(text);
    });
    return () => {
      dead = true;
    };
  }, [book.chain, book.hi, book.gate, book.spotNeed, book.perpNeed]);
  useEffect(() => {
    if (book.tradedDay === BigInt(sgDay()) && book.lastDay !== BigInt(sgDay()))
      setStep((now) => (now === "join" || now === "ask" || now === "go" ? "check" : now));
  }, [book.tradedDay, book.lastDay]);
  const ask = () => {
    if (!self) {
      say(
        zh
          ? "请先连接右上角的钱包。这一步不会弹出交易，也不会扣钱。"
          : "Connect the wallet at the top right first. This does not open a transaction or spend anything.",
        true,
      );
      return;
    }
    setStep("ask");
    void walletHold(
      book.chain,
      self,
      ((selling ? task?.token : "0x0000000000000000000000000000000000000000") ??
        "0x0000000000000000000000000000000000000000") as `0x${string}`,
    )
      .then((raw) => {
        setHold(formatUnits(raw, selling ? (task?.decimals ?? 18) : 18));
      })
      .catch(() => setHold(""));
  };
  const goTrade = () => {
    if (gate.current || busy) return;
    gate.current = true;
    void act(async () => {
      const from = await who();
      say(
        zh
          ? "钱包窗口正在弹出。请只确认这一笔交易，不要重复点击。"
          : "The wallet window is opening. Confirm only this trade, and do not tap again.",
        false,
      );
      try {
        await tradeRed(book.chain, from, book.lane, book.address);
      } catch (err) {
        if (!(err instanceof Error) || err.message !== "traded") throw err;
      }
    })
      .then((ok) => {
        if (ok) setStep("check");
      })
      .finally(() => {
        gate.current = false;
      });
  };
  const check = async () => {
    const from = self ?? (await who().catch(() => ""));
    if (!from) return;
    const ok = await tradedNow(book.chain, from, book.lane, book.address).catch(() => false);
    if (ok) setStep("open");
    else
      say(
        zh
          ? "链上还没有这笔交易。请先完成交易，再点验证。红包还没有到账。"
          : "The trade is not on chain yet. Finish it, then check again. The prize has not arrived.",
        true,
      );
  };
  return (
    <div className="gift-card text-base text-ink">
      <div className="flex items-center gap-3">
        <span className={`gift-mark ${ended ? "is-off" : ""}`} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xl tracking-tight">{sum ? `${sum.each} ${name}` : name}</p>
          {sum ? (
            <p className="text-sm text-ink/70">
              {sum.claimed
                ? zh
                  ? `已领 ${sum.claimed} ${name}，还剩 ${sum.left} ${name}`
                  : `Claimed ${sum.claimed} ${name}, left ${sum.left} ${name}`
                : zh
                  ? `还剩 ${sum.left} ${name}`
                  : `Left ${sum.left} ${name}`}
            </p>
          ) : null}
          {!ended && book.endsAt > 0n ? <DayClock until={Number(book.endsAt)} /> : null}
        </div>
      </div>
      <Fold zh={zh}>
        <p>{personal ? (zh ? "个人创建" : "Personal") : zh ? "官方创建" : "Official"}</p>
        <p className="mt-1">{line}</p>
        {step === "join" ? (
          <p className="mt-1">
            {zh
              ? "先看清楚这一笔换成多少币。同意之后才会打开钱包。兑换完成并验证通过后，才能领取红包。"
              : "Read how much this swap returns. The wallet opens only after you agree. Claim the packet only after the swap is checked."}
          </p>
        ) : null}
        {step === "go" ? (
          <p className="mt-1">
            {zh
              ? "钱包只弹出这一笔兑换。成交后回来点验证。还没验证通过，不能领取红包。"
              : "The wallet opens once, for this swap. Then check it. You cannot claim until the swap is verified."}
          </p>
        ) : null}
        {step === "check" ? (
          <p className="mt-1">
            {zh
              ? "验证只核对这笔兑换是否成交。通过之后才能打开红包，现在还不会打款。"
              : "Checking only confirms the swap. The packet opens after that. Nothing is paid yet."}
          </p>
        ) : null}
        {step === "open" ? (
          <p className="mt-1">
            {zh
              ? "交易任务已经完成。打开后还要点领取，红包才会进入钱包。"
              : "The trade is done. After you open it, tap Claim. Only then does the prize enter your wallet."}
          </p>
        ) : null}
      </Fold>
      {ended && owner ? (
        <button
          type="button"
          className="gift-go disabled:opacity-40"
          disabled={busy}
          onClick={() => take(book)}
        >
          {zh ? "取回" : "Take back"}
        </button>
      ) : stuck && maker ? (
        <button
          type="button"
          className="gift-go disabled:opacity-40"
          disabled={busy}
          onClick={() => lift(book)}
        >
          {zh ? "重开" : "Reopen"}
        </button>
      ) : ended || mineToday ? (
        <button
          type="button"
          className="gift-go"
          disabled
        >
          {mineToday ? (zh ? "已领取" : "Claimed") : zh ? "已结束" : "Ended"}
        </button>
      ) : step === "join" ? (
        <button
          type="button"
          className="gift-go"
          disabled={busy}
          onClick={ask}
        >
          {zh ? "参与" : "Join"}
        </button>
      ) : step === "ask" ? (
        <div className="mt-3 bg-paper px-3 py-3 text-left">
          <p className="text-base text-ink">{line}</p>
          <p className="mt-2 text-sm text-ink/60">
            {zh ? "可用余额" : "Available"}
          </p>
          <p className="font-mono text-xl text-ink">
            {hold ? Number(hold).toLocaleString("en-US", { maximumFractionDigits: 6 }) : zh ? "读取中" : "Reading"}{" "}
            {selling ? taskName : unit}
          </p>
          <Fold zh={zh}>
            <p>
              {selling
                ? zh
                  ? `卖出 ${taskName}，按池子价格换回 ${unit}。余额不够就点不同意。这一步只完成兑换，还不能领取红包。`
                  : `Sell ${taskName} for ${unit} at the pool price. Decline if the balance is short. This swap does not pay the packet.`
                : zh
                  ? `用 ${unit} 按池子价格兑换 ${taskName}。余额不够就点不同意。这一步只完成兑换，还不能领取红包。`
                  : `Swap ${unit} for ${taskName} at the pool price. Decline if the balance is short. This swap does not pay the packet.`}
            </p>
          </Fold>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              className="min-h-12 bg-card text-base text-ink"
              onClick={() => setStep("join")}
            >
              {zh ? "不同意" : "Decline"}
            </button>
            <button
              type="button"
              className="gift-go"
              onClick={() => setStep("go")}
            >
              {zh ? "同意" : "Agree"}
            </button>
          </div>
        </div>
      ) : step === "go" ? (
        <button
          type="button"
          className="gift-go disabled:opacity-40"
          disabled={busy}
          onClick={goTrade}
        >
          {zh ? "去交易" : "Trade"}
        </button>
      ) : step === "check" ? (
        <button
          type="button"
          className="gift-go"
          onClick={() => void check()}
        >
          {zh ? "验证" : "Check"}
        </button>
      ) : (
        <button
          type="button"
          className="gift-go"
          onClick={() => openSeal(book)}
        >
          {zh ? "打开红包" : "Open"}
        </button>
      )}
    </div>
  );
}

function payTotal(each: string, count: string): string {
  const amount = Number(each);
  const people = Number(count);
  if (!(amount > 0) || !Number.isInteger(people) || people < 1) return "";
  return (Math.round(amount * people * 1e8) / 1e8).toString();
}

function DeployerDesk({
  zh,
  chain,
  busy,
  assetId,
  setAssetId,
  eachText,
  setEachText,
  countText,
  setCountText,
  spotText,
  setSpotText,
  perpText,
  setPerpText,
  gate,
  setGate,
  life,
  setLife,
  taskId,
  setTaskId,
  placeDesk = false,
  onSave,
}: {
  zh: boolean;
  chain: GiftChain;
  busy: boolean;
  assetId: string;
  setAssetId: (v: string) => void;
  eachText: string;
  setEachText: (v: string) => void;
  countText: string;
  setCountText: (v: string) => void;
  spotText: string;
  setSpotText: (v: string) => void;
  perpText: string;
  setPerpText: (v: string) => void;
  gate: number;
  setGate: (v: number) => void;
  life: number;
  setLife: (v: number) => void;
  taskId: string;
  setTaskId: (v: string) => void;
  placeDesk?: boolean;
  onSave: () => void;
}) {
  const assets = GIFT_ASSETS[chain];
  const tasks = assets.filter((row) => row.id !== "usdt" && row.id !== "okb" && row.id !== "bnb");
  const asset = assets.find((row) => row.id === assetId) ?? assets[0];
  const task = tasks.find((row) => row.id === taskId) ?? tasks[0];
  const total = payTotal(eachText, countText);
  const spot = Number(spotText);
  const ready = Boolean(total) && spot > 0;
  const lifeText = life === 604800 ? (zh ? "一星期" : "1 week") : life === 2592000 ? (zh ? "一个月" : "1 month") : (zh ? "24小时" : "24 hours");
  return (
    <div className="gift-form">
      <Line label={zh ? "红包" : "Prize"} text={zh ? asset.zh : asset.en} onPrev={() => setAssetId(cycle(assets.map((row) => row.id), asset.id, -1))} onNext={() => setAssetId(cycle(assets.map((row) => row.id), asset.id, 1))} />
      <label className="gift-field">
        <span>{zh ? "每人" : "Each"}</span>
        <input value={eachText} onChange={(e) => setEachText(e.target.value)} inputMode="decimal" className="h-10 min-w-0 flex-1 bg-transparent text-right font-mono text-lg text-ink outline-none" />
        <span className="w-16 text-right text-sm text-ink">{zh ? asset.zh : asset.en}</span>
      </label>
      <label className="gift-field">
        <span>{zh ? "人数" : "People"}</span>
        <input value={countText} onChange={(e) => setCountText(e.target.value)} inputMode="numeric" className="h-10 min-w-0 flex-1 bg-transparent text-right font-mono text-lg text-ink outline-none" />
      </label>
      <div className="gift-field justify-between">
        <span>{zh ? "付出" : "Pay"}</span>
        <span className="font-mono text-lg">{total ? `${total} ${zh ? asset.zh : asset.en}` : "—"}</span>
      </div>
      <Line label={zh ? "期限" : "Window"} text={lifeText} onPrev={() => setLife(cycle([86400, 604800, 2592000], life, -1))} onNext={() => setLife(cycle([86400, 604800, 2592000], life, 1))} />
      <Line label={zh ? "任务" : "Task"} text={zh ? task.zh : task.en} onPrev={() => setTaskId(cycle(tasks.map((row) => row.id), task.id, -1))} onNext={() => setTaskId(cycle(tasks.map((row) => row.id), task.id, 1))} />
      <Line label={zh ? "方向" : "Side"} text={gate === 1 ? (zh ? "卖出" : "Sell") : (zh ? "买入" : "Buy")} onPrev={() => setGate(gate === 1 ? 0 : 1)} onNext={() => setGate(gate === 1 ? 0 : 1)} />
      <label className="gift-field">
        <span>{chain === "bsc" ? "BNB" : "OKB"}</span>
        <input value={spotText} onChange={(e) => setSpotText(e.target.value)} inputMode="decimal" className="h-10 min-w-0 flex-1 bg-transparent text-right font-mono text-lg text-ink outline-none" />
      </label>
      <Fold zh={zh}>
        <p>{taskLine(chain, task.token === "0x0000000000000000000000000000000000000000" ? 1n : BigInt(task.token), (() => { try { return parseUnits(spotText.trim() || "0", 18); } catch { return 0n; } })(), 0n, gate, zh)}</p>
        <p className="mt-1">{zh ? "确认后，这些奖金划入这一份红包。没领完的，到期后可以取回。" : "After you confirm, this prize is locked in the packet. What nobody claims can be taken back after it ends."}</p>
      </Fold>
      <button type="button" className="gift-go disabled:opacity-40" disabled={busy || !ready} onClick={onSave}>
        {placeDesk ? (zh ? "放上发布台" : "Place the desk") : (zh ? "确认打入" : "Confirm")}
      </button>
    </div>
  );
}

function Line({ label, text, onPrev, onNext }: { label: string; text: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="gift-line">
      <span>{label}</span>
      <button type="button" onClick={onPrev} aria-label={label}>‹</button>
      <span className="min-w-0 flex-1 text-center font-mono text-lg">{text}</span>
      <button type="button" onClick={onNext} aria-label={label}>›</button>
    </div>
  );
}

function cycle<T>(list: T[], value: T, dir: number): T {
  const index = list.indexOf(value);
  const at = index < 0 ? 0 : index;
  return list[(at + dir + list.length) % list.length];
}

function Fold({ zh, children }: { zh: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        className="min-h-11 w-full text-base text-ink/80"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (zh ? "收起" : "Hide") : zh ? "打开" : "Open"}
      </button>
      {open ? (
        <div className="bg-paper px-3 py-3 text-left text-base text-ink">{children}</div>
      ) : null}
    </div>
  );
}

function MineFunds({
  zh,
  books,
  now,
  self,
  busy,
  run,
  who,
  setNote,
}: {
  zh: boolean;
  books: RedRule[];
  now: number;
  self: string | null;
  busy: boolean;
  run: (job: () => Promise<"cheer" | "ok" | void>) => Promise<void>;
  who: () => Promise<string>;
  setNote: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rows = books
    .filter((book) => book.asset && self && book.credit > 0n)
    .sort((a, b) => (a.endsAt < b.endsAt ? -1 : 1));
  if (!rows.length) return null;
  return (
    <div className="mb-3">
      <button
        type="button"
        className="flex min-h-11 w-full items-center justify-between text-base text-ink"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{zh ? "我放出的" : "Mine"}</span>
        <span>{open ? (zh ? "收起" : "Hide") : zh ? "打开" : "Open"}</span>
      </button>
      {open
        ? rows.map((book) => {
            const ended = book.endsAt > 0n && BigInt(now) > book.endsAt;
            const name = book.asset ? (zh ? book.asset.zh : book.asset.en) : "";
            return (
              <div key={book.address} className="mt-2 bg-paper px-3 py-3 text-base text-ink">
                <p>
                  {book.chain === "bsc" ? "BSC" : "X Layer"} · {giftText(book.credit, book.asset)}{" "}
                  {name}
                </p>
                {ended ? (
                  <button
                    type="button"
                    className="gift-go disabled:opacity-40"
                    disabled={busy}
                    onClick={() => {
                      const asset = book.asset;
                      if (!asset) return;
                      void run(async () => {
                        await withdrawRed(
                          book.chain,
                          await who(),
                          formatUnits(book.credit, asset.decimals),
                          asset,
                          book.lane,
                        );
                        setNote(zh ? "资金已经取回。" : "Funds received.");
                        return "ok" as const;
                      });
                    }}
                  >
                    {zh ? "取回" : "Take back"}
                  </button>
                ) : book.endsAt > 0n ? (
                  <DayClock until={Number(book.endsAt)} />
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}

function DayClock({ until }: { until: number }) {
  const [left, setLeft] = useState(() => Math.max(0, until * 1000 - Date.now()));
  useEffect(() => {
    const id = window.setInterval(() => setLeft(Math.max(0, until * 1000 - Date.now())), 1000);
    return () => window.clearInterval(id);
  }, [until]);
  return <p className="font-mono text-sm tracking-widest text-ink/55">{sgClock(left)}</p>;
}

function WxSeal({
  personal,
  zh,
  busy,
  onOpen,
  onClose,
}: {
  personal: boolean;
  zh: boolean;
  busy: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const fill = personal ? "#1f6b4a" : "#c83c3c";
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-6"
      onClick={onClose}
    >
      <div
        className="relative h-96 w-64 overflow-hidden"
        style={{ background: fill }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="absolute inset-x-0 top-0 h-52 rounded-b-[50%]"
          style={{ background: personal ? "#26845c" : "#e15a4a" }}
        />
        <button
          type="button"
          className="absolute left-1/2 top-40 grid h-20 w-20 -translate-x-1/2 place-items-center rounded-full bg-[#e6c36a] text-2xl text-[#6b1d12] shadow active:scale-95 disabled:opacity-40"
          disabled={busy}
          onClick={onOpen}
        >
          {zh ? "领取" : "Claim"}
        </button>
        <p className="absolute inset-x-4 bottom-8 text-center text-base text-[#fff7ea]">
          {zh
            ? "点领取后，奖金才进入你的钱包"
            : "The prize enters your wallet only after you claim"}
        </p>
      </div>
    </div>
  );
}

function Fireworks() {
  const sparks = Array.from({ length: 28 }, (_, i) => {
    const angle = (i / 28) * Math.PI * 2;
    const dist = 90 + (i % 5) * 28;
    return {
      dx: `${Math.cos(angle) * dist}px`,
      dy: `${Math.sin(angle) * dist}px`,
      color: ["#e6c36a", "#ff6b84", "#fff7ea", "#8c1c1c"][i % 4],
    };
  });
  return (
    <div className="tl-firework" aria-hidden="true">
      {sparks.map((spark, i) => (
        <span
          key={i}
          className="tl-spark"
          style={{
            background: spark.color,
            ["--dx" as string]: spark.dx,
            ["--dy" as string]: spark.dy,
            animationDelay: `${(i % 4) * 40}ms`,
          }}
        />
      ))}
    </div>
  );
}

function Cheer({
  amount,
  zh,
  onClose,
}: {
  name: string;
  amount: string;
  zh: boolean;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 px-6"
      onClick={onClose}
    >
      <button
        type="button"
        className="w-full max-w-sm border border-gold bg-paper px-6 py-8 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <svg viewBox="0 0 120 150" className="tl-god mx-auto h-40 w-32" aria-hidden="true">
          <rect x="28" y="58" width="64" height="78" rx="4" fill="#8c1c1c" />
          <rect x="28" y="88" width="64" height="14" fill="#e6c36a" />
          <rect x="54" y="58" width="12" height="78" fill="#e6c36a" />
          <circle cx="60" cy="34" r="16" fill="#f3d2b3" />
          <path d="M44 30h32v8H44z" fill="#111" />
          <path d="M48 22h24l4 8H44z" fill="#c9a227" />
          <path d="M46 42c6 8 22 8 28 0" fill="none" stroke="#111" strokeWidth="2" />
          <circle cx="54" cy="36" r="1.5" fill="#111" />
          <circle cx="66" cy="36" r="1.5" fill="#111" />
        </svg>
        <p className="mt-3 font-display text-3xl text-[#e6c36a]">{zh ? "恭喜发财" : "Fortune"}</p>
        <p className="mt-2 font-mono text-lg text-ink">{amount}</p>
        <p className="mt-2 text-base text-ink">
          {zh ? "奖金已经进入当前钱包。" : "The prize is now in this wallet."}
        </p>
      </button>
    </div>
  );
}
