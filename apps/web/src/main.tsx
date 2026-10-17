import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
// Fonts are bundled with the app, so no visitor data goes to a font CDN.
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/600.css";
import "@fontsource/figtree/700.css";
import "@fontsource/figtree/800.css";
import "@fontsource/syne/700.css";
import "@fontsource/syne/800.css";
import "@clew/design-tokens/tokens.css";
import "@clew/design-tokens/base.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
