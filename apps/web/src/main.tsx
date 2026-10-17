import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
// Fonts are bundled with the app, so no visitor data goes to a font CDN.
import "@fontsource/figtree/400.css";
import "@fontsource/figtree/500.css";
import "@fontsource/figtree/600.css";
import "@fontsource/syne/600.css";
import "@fontsource/syne/700.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
