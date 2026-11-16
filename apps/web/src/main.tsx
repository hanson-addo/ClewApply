import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";

import { App } from "./App";
import { StartupErrorBoundary } from "./pages/StartupProblemPage";
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

// A data router, so the profile editor can ask before Back leaves with unsaved changes.
const router = createBrowserRouter([{ path: "*", element: <App /> }]);

createRoot(root).render(
  <StrictMode>
    <StartupErrorBoundary>
      <RouterProvider router={router} />
    </StartupErrorBoundary>
  </StrictMode>,
);
