export type Bias = { side: "long" | "short" | "flat"; price: number; why: string };

export async function readBias(input: { data: { lang: "zh" | "en" } }): Promise<Bias> {
  const zh = input?.data?.lang !== "en";
  return {
    side: "flat",
    price: 0,
    why: zh
      ? "DEWEB 没有模型服务器。看多看空和预测价只在带服务器的网页上，不在这份静态页里。"
      : "DEWEB has no model server. The lean and the guessed price only run on the hosted site, not this static page.",
  };
}
