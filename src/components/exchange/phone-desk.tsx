import { useEffect, useState } from "react";

export type PhonePane = "chart" | "book" | "ticket";

let wanted: PhonePane = "chart";

export function wantedPane(): PhonePane {
  return wanted;
}

export function askChart() {
  wanted = "chart";
  window.dispatchEvent(new CustomEvent("tape-chart"));
}

export function askTrade() {
  wanted = "ticket";
  window.dispatchEvent(new CustomEvent("tape-trade"));
}

export function PhoneChrome({
  zh,
  pane,
  setPane,
  sheet = true,
}: {
  zh: boolean;
  perp?: boolean;
  pane: PhonePane;
  setPane: (next: PhonePane) => void;
  onBuy: () => void;
  onSell: () => void;
  sheet?: boolean;
}) {
  const tabs: { id: PhonePane; zh: string; en: string }[] = [
    { id: "chart", zh: "图表", en: "Chart" },
    { id: "book", zh: "订单簿", en: "Book" },
    { id: "ticket", zh: "下单", en: "Trade" },
  ];
  return (
    <>
      <div className="phone-tabs sticky top-[var(--desk-top)] z-20 flex border-b border-gold bg-card xl:hidden">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setPane(tab.id)}
            className={`h-10 flex-1 text-sm ${pane === tab.id ? "tab-on" : "text-ink/45"}`}
          >
            {zh ? tab.zh : tab.en}
          </button>
        ))}
      </div>
      {sheet && pane === "ticket" ? (
        <button
          type="button"
          aria-label={zh ? "收起" : "Close"}
          className="fixed inset-0 z-[34] bg-black/45 xl:hidden"
          onClick={() => setPane("chart")}
        />
      ) : null}
    </>
  );
}

const ARRIVE = "tapeliquid-arrive-v2";

export function ArriveHint({ zh }: { zh: boolean }) {
  const [step, setStep] = useState<number | null>(null);
  const [seen, setSeen] = useState(true);
  useEffect(() => {
    try {
      setSeen(window.localStorage.getItem(ARRIVE) === "1");
    } catch {
      setSeen(true);
    }
  }, []);
  if (seen) return null;
  const close = () => {
    try {
      window.localStorage.setItem(ARRIVE, "1");
    } catch {
      /* ignore */
    }
    setSeen(true);
    setStep(null);
  };
  if (step == null) {
    return (
      <button type="button" className="arrive-banner" onClick={() => setStep(0)}>
        {zh ? (
          <>
            欢迎来到 TAPELIQUID。<span className="underline">点击这里</span>开始。
          </>
        ) : (
          <>
            Welcome to TAPELIQUID. <span className="underline">Tap here</span> to start.
          </>
        )}
      </button>
    );
  }
  const lines = zh
    ? [
        [
          "选市场",
          "左上角三条线打开菜单，里面是资产、赚取、工房和跨链。交易对旁边的三角用来换现货或合约。",
        ],
        ["看盘", "手机上切「图表 / 订单簿 / 下单」。点一档价格，会填进限价。"],
        ["下单", "底部只有市场、交易、账户。点「下单」填写价格和数量，先连接钱包再签名。"],
      ]
    : [
        [
          "Pick a market",
          "The three lines at the top left open the menu. The triangle beside the pair switches spot and perps.",
        ],
        [
          "Read the book",
          "On a phone, switch Chart, Book, and Trade. A price tap fills the limit.",
        ],
        [
          "Send the order",
          "The bottom bar is Markets, Trade, and Account. Open Trade to enter a price, connect a wallet, then sign.",
        ],
      ];
  const [title, body] = lines[step];
  const last = step === lines.length - 1;
  return (
    <div className="arrive-card fixed inset-x-3 z-40 border border-gold bg-card p-3 shadow-plate">
      <p className="text-[11px] text-ink/45">
        {step + 1} / {lines.length}
      </p>
      <p className="mt-1 text-sm">{title}</p>
      <p className="mt-1 text-xs leading-5 text-ink/70">{body}</p>
      <div className="mt-3 flex gap-2">
        <button type="button" className="h-9 px-2 text-xs text-ink/50" onClick={close}>
          {zh ? "跳过" : "Skip"}
        </button>
        <button
          type="button"
          className="ml-auto h-9 bg-ink px-3 text-xs"
          onClick={() => (last ? close() : setStep(step + 1))}
        >
          {last ? (zh ? "开始" : "Start") : zh ? "下一步" : "Next"}
        </button>
      </div>
    </div>
  );
}
