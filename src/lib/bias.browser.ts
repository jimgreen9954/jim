export type Bias = { side: "long" | "short" | "flat"; p: number; why: string };

export async function readBias(input: { data: { lang: "zh" | "en" } }): Promise<Bias> {
  const zh = input?.data?.lang !== "en";
  return {
    side: "flat",
    p: 0,
    why: zh
      ? "DEWEB 没有模型服务器。看多看空只在带服务器的网页上，不在这份静态页里。"
      : "DEWEB has no model server. The lean only runs on the hosted site, not this static page.",
  };
}
