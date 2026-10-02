import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Exchange } from "@/components/exchange/exchange";
import "@/styles.css";

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Exchange />
    </StrictMode>,
  );
}
