const COLORS = ["#3DDEA2", "#E0B15A", "#7EE7FF", "#FF5C6C", "#E7EDF6", "#2081E2"];

export function showMintWin(host: ParentNode, detail: string) {
  const win = host.querySelector<HTMLElement>("#mint-win");
  const line = host.querySelector("#mint-line");
  if (!win) return;
  if (line) line.textContent = detail;
  win.hidden = false;
  win.querySelectorAll(".flake").forEach((node) => node.remove());
  for (let i = 0; i < 72; i += 1) {
    const flake = document.createElement("i");
    flake.className = "flake";
    flake.style.left = `${Math.random() * 100}%`;
    flake.style.background = COLORS[i % COLORS.length] ?? "#3DDEA2";
    flake.style.animationDuration = `${1.6 + Math.random() * 1.8}s`;
    flake.style.animationDelay = `${Math.random() * 0.4}s`;
    flake.style.transform = `rotate(${Math.random() * 80}deg)`;
    win.append(flake);
  }
}

export async function whenMined(
  eth: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  hash: string,
): Promise<boolean> {
  for (let i = 0; i < 8; i += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
    const receipt = (await eth.request({
      method: "eth_getTransactionReceipt",
      params: [hash],
    })) as { status?: string } | null;
    if (!receipt) continue;
    return receipt.status === "0x1";
  }
  return false;
}
