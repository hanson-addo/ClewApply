/**
 * The service worker: the only part of the extension that holds the token and calls the API.
 * The popup asks it for status; the web app hands it a link code.
 */

import { config } from "./config";
import { browserLabel, handleExternal, handlePopup, type Deps } from "./handlers";
import { chromeTokenStore } from "./tokenStore";

const deps: Deps = {
  apiUrl: config.apiUrl,
  webOrigin: config.webOrigin,
  extensionId: chrome.runtime.id,
  store: chromeTokenStore(),
  label: () => browserLabel(),
};

// Keep storage to the extension's own pages and this worker, out of reach of content scripts
// (Security #8; there are no content scripts yet). Chrome versions that don't support this for
// local storage reject the call; step 3 must settle that before adding content scripts.
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
  void handlePopup(deps, message, sender).then((result) => {
    if (result) sendResponse(result);
  });
  return true;
});
