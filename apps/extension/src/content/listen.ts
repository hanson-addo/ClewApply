/**
 * The part of each site's fill script that waits for the service worker to hand it the values,
 * then shows the fill panel. It never reads chrome.storage, never holds the token and never
 * calls the API; the build fails if it does (vite.content.config.ts).
 */

import { isFieldsMessage, type FilledMessage } from "../messages";
import type { SiteId } from "../sites";
import type { SiteForms } from "./forms";
import { showPanel } from "./panel";

declare global {
  // Set in this extension's own isolated world, which the page can't see.
  var __clewFillListening: boolean | undefined;
}

export function listen(siteId: SiteId, site: SiteForms): void {
  // Pressing Fill again injects the script again; one listener is enough.
  if (globalThis.__clewFillListening) return;
  globalThis.__clewFillListening = true;
  chrome.runtime.onMessage.addListener((message, sender) => {
    // Only this extension's service worker sends to this tab.
    if (sender.id !== chrome.runtime.id || !isFieldsMessage(message) || message.site !== siteId) return undefined;
    showPanel(document, message, site, {
      report: (keys) => {
        const filled: FilledMessage = { type: "clew/filled", site: siteId, profileVersion: message.profileVersion, keys };
        return chrome.runtime.sendMessage(filled);
      },
    });
    return undefined;
  });
}
