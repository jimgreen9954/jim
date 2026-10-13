declare module "qrcode" {
  const QRCode: {
    toCanvas: (canvas: HTMLCanvasElement, text: string, options?: { width?: number; margin?: number; errorCorrectionLevel?: "L" | "M" | "Q" | "H" }) => Promise<void>;
  };
  export default QRCode;
}
