/**
 * Where the extension token lives: chrome.storage.local, readable only by the extension's own
 * pages and service worker (never by content scripts). The token is never logged.
 */

const KEY = "clew.extensionToken";

export type TokenStore = {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
};

export function chromeTokenStore(): TokenStore {
  return {
    async get() {
      const value = (await chrome.storage.local.get(KEY))[KEY];
      return typeof value === "string" ? value : null;
    },
    async set(token) {
      await chrome.storage.local.set({ [KEY]: token });
    },
    async clear() {
      await chrome.storage.local.remove(KEY);
    },
  };
}
