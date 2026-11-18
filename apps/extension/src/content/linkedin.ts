/**
 * Injected into a LinkedIn profile tab only when the user presses Fill in the popup (#130
 * step 3). It waits for the service worker to hand it the values, then shows the fill panel.
 * It never reads chrome.storage, never holds the token and never calls the API; the build
 * fails if it does (vite.content.config.ts).
 */

import { isFieldsMessage, type FilledMessage } from "../messages";
import { showPanel } from "./panel";

declare global {
  // Set in this extension's own isolated world, which the page can't see.
  var __clewLinkedInListening: boolean | undefined;
}

// Pressing Fill again injects this file again; one listener is enough.
if (!globalThis.__clewLinkedInListening) {
  globalThis.__clewLinkedInListening = true;
  chrome.runtime.onMessage.addListener((message, sender) => {
    // Only this extension's service worker sends to this tab.
    if (sender.id !== chrome.runtime.id || !isFieldsMessage(message) || message.site !== "linkedin") return undefined;
    showPanel(document, message, {
      report: (keys) => {
        const filled: FilledMessage = {
          type: "clew/filled",
          site: "linkedin",
          profileVersion: message.profileVersion,
          keys,
        };
        return chrome.runtime.sendMessage(filled);
      },
    });
    return undefined;
  });
}
