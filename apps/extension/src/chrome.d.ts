/**
 * The few Chrome extension APIs this extension uses, typed by hand so the build needs no extra
 * type package. Add to this as later steps use more of `chrome.*`.
 */

declare namespace chrome.runtime {
  interface MessageSender {
    /** The sending extension's id; for a web page, absent. */
    id?: string;
    /** The sending page's origin, set by Chrome (not by the sender). */
    origin?: string;
    url?: string;
  }
  type Listener = (
    message: unknown,
    sender: MessageSender,
    sendResponse: (response: unknown) => void,
  ) => boolean | undefined;
  interface MessageEvent {
    addListener(listener: Listener): void;
  }
  const id: string;
  const onMessage: MessageEvent;
  const onMessageExternal: MessageEvent;
  function sendMessage(message: unknown): Promise<unknown>;
  function getURL(path: string): string;
}

declare namespace chrome.storage {
  interface StorageArea {
    get(key: string): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
    remove(key: string): Promise<void>;
    setAccessLevel(options: { accessLevel: "TRUSTED_CONTEXTS" | "TRUSTED_AND_UNTRUSTED_CONTEXTS" }): Promise<void>;
  }
  const local: StorageArea;
}
