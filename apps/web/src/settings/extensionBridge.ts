/**
 * Hands a one-time link code to the Clew extension. Chrome exposes `chrome.runtime.sendMessage`
 * to this page only when an installed extension lists it in `externally_connectable`, and
 * delivers the message only to the extension whose id is named.
 */

export type HandOff = "connected" | "expired" | "unavailable" | "not-installed";

type Runtime = { sendMessage: (extensionId: string, message: unknown) => Promise<unknown> };

function runtime(): Runtime | null {
  const chrome = (globalThis as { chrome?: { runtime?: Partial<Runtime> } }).chrome;
  const send = chrome?.runtime?.sendMessage;
  return typeof send === "function" ? { sendMessage: send.bind(chrome?.runtime) } : null;
}

export async function handOffLinkCode(extensionId: string, code: string): Promise<HandOff> {
  const target = runtime();
  if (!target) return "not-installed";
  let answer: unknown;
  try {
    answer = await target.sendMessage(extensionId, { type: "clew/link", code });
  } catch {
    // "Could not establish connection": no extension with that id is installed.
    return "not-installed";
  }
  if (typeof answer !== "object" || answer === null) return "not-installed";
  const result = answer as { ok?: unknown; error?: unknown };
  if (result.ok === true) return "connected";
  return result.error === "expired" ? "expired" : "unavailable";
}
