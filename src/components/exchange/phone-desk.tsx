export type PhonePane = "chart" | "book" | "ticket";

let wanted: PhonePane = "ticket";

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
      <div
        className="phone-tabs relative z-20 flex border-b border-gold xl:hidden"
        style={{ background: "var(--color-card)" }}
      >
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

export function ArriveHint(_: { zh: boolean }) {
  return null;
}
