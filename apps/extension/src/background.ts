/**
 * The service worker: the only part of the extension that holds the token and calls the API.
 * The popup asks it for status and to open the fill panel; the web app hands it a link code;
 * the fill panel tells it which fields the user filled.
 */

import { config } from "./config";
import { browserLabel, handleContent, handleExternal, handlePopup, isOwnPage, type Deps } from "./handlers";
import { chromeTokenStore } from "./tokenStore";

const deps: Deps = {
  apiUrl: config.apiUrl,
  webOrigin: config.webOrigin,
  extensionId: chrome.runtime.id,
  store: chromeTokenStore(),
  label: () => browserLabel(),
  browser: {
    tabUrl: async (tabId) => (await chrome.tabs.get(tabId)).url,
    hasPermission: (origin) => chrome.permissions.contains({ origins: [origin] }),
    inject: async (tabId, file) => {
      await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    },
    sendToTab: async (tabId, message) => {
      await chrome.tabs.sendMessage(tabId, message);
    },
  },
};

// Keep storage to the extension's own pages and this worker (Security #8). Chrome may refuse
// this for local storage; the fill panel never touches chrome.storage either way, and the
// content-script build fails if it does.
chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch(() => {
  console.warn("Clew: couldn't restrict storage access");
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  void handleExternal(deps, message, sender).then((result) => {
    if (result) sendResponse(result);
  });
  return true;
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handled = isOwnPage(deps, sender) ? handlePopup(deps, message, sender) : handleContent(deps, message, sender);
  void handled.then((result) => {
    if (result) sendResponse(result);
  });
  return true;
});
