import { useRef, useState, type ReactNode } from "react";

/** Hover text. It stays while the pointer is on the label or the note, then disappears. */
export function Hint({ label, text }: { label: ReactNode; text: ReactNode }) {
  const [box, setBox] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | null>(null);
  const show = (event: { currentTarget: HTMLElement }) => {
    if (timer.current) window.clearTimeout(timer.current);
    const rect = event.currentTarget.getBoundingClientRect();
    setBox({ x: rect.left, y: rect.bottom + 6 });
  };
  const hide = () => {
    timer.current = window.setTimeout(() => setBox(null), 220);
  };
  return (
    <span
      className="cursor-help underline decoration-dotted underline-offset-4"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {label}
      {box ? (
        <span
          role="tooltip"
          className="fixed z-[80] block w-80 max-w-[min(20rem,calc(100vw-1rem))] whitespace-normal border border-gold bg-paper px-3 py-2.5 text-left text-[13px] font-normal normal-case leading-6 tracking-normal text-ink no-underline shadow-plate"
          style={{
            left: Math.max(8, Math.min(box.x, window.innerWidth - 336)),
            top: Math.min(box.y, window.innerHeight - 240),
          }}
          onMouseEnter={() => {
            if (timer.current) window.clearTimeout(timer.current);
          }}
          onMouseLeave={hide}
        >
          {text}
        </span>
      ) : null}
    </span>
  );
}

export function verifyCopy(zh: boolean): ReactNode {
  return zh ? (
    <span className="grid gap-2">
      <span>点「一键验证」，用这张电路自己的 eval，在链上把输入跑一遍。不签名，不扣 OKB。跑通就标成已核对。</span>
      <span>TAPELIQUID 的矿机只记开工和门数，没有验证位。核对不会把权重改进 TapeOut 的 99% 池，仍按门数占今天的排放。</span>
      <span>
        TapeOut 的题目验证在{" "}
        <a className="underline" href="https://tapeout.net/pod/" target="_blank" rel="noreferrer">
          tapeout.net/pod
        </a>
        。
      </span>
    </span>
  ) : (
    <span className="grid gap-2">
      <span>Verify runs this circuit's own eval on chain. No signature and no OKB. A pass is marked checked.</span>
      <span>The TAPELIQUID mine stores open and gates only, so a check does not move weight into TapeOut's 99% pool.</span>
      <span>
        TapeOut's task check is at{" "}
        <a className="underline" href="https://tapeout.net/pod/" target="_blank" rel="noreferrer">
          tapeout.net/pod
        </a>
        .
      </span>
    </span>
  );
}
