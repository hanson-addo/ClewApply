/** Messages between the web app, the popup and the service worker. */

/** From the web app (Settings → Browser extension → Connect). */
export type LinkMessage = { type: "clew/link"; code: string };
export type LinkResult = { ok: true } | { ok: false; error: "expired" | "unavailable" };

/** From the popup. */
export type PopupMessage = { type: "clew/status" } | { type: "clew/sign-out" };

export type Status =
  | { state: "signed-out" }
  | { state: "signed-in"; email: string; profileVersion: number | null; profileSavedAt: string | null }
  | { state: "unavailable" };

const CODE = /^clk_[A-Za-z0-9_-]{40,60}$/;

export function isLinkMessage(message: unknown): message is LinkMessage {
  if (typeof message !== "object" || message === null) return false;
  const { type, code } = message as Record<string, unknown>;
  return type === "clew/link" && typeof code === "string" && CODE.test(code);
}

export function isPopupMessage(message: unknown): message is PopupMessage {
  if (typeof message !== "object" || message === null) return false;
  const { type } = message as Record<string, unknown>;
  return type === "clew/status" || type === "clew/sign-out";
}
