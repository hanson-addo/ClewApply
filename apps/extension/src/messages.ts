/** Messages between the web app, the popup, the service worker and the fill panel. */

import type { components } from "./api/schema";
import { SITES, type SiteId } from "./sites";

export type FillField = components["schemas"]["FillField"];

/** From the web app (Settings → Browser extension → Connect). */
export type LinkMessage = { type: "clew/link"; code: string };
export type LinkResult = { ok: true } | { ok: false; error: "expired" | "unavailable" };

/** From the popup. */
export type PopupMessage =
  | { type: "clew/status" }
  | { type: "clew/sign-out" }
  /** The user pressed Fill: open the fill panel on this tab. */
  | { type: "clew/fill-tab"; tabId: number };

export type Status =
  | { state: "signed-out" }
  | { state: "signed-in"; email: string; profileVersion: number | null; profileSavedAt: string | null }
  | { state: "unavailable" };

export type FillTabResult =
  | { ok: true }
  | { ok: false; error: "signed-out" | "wrong-page" | "not-turned-on" | "no-profile" | "unavailable" };

/** From the service worker to the fill panel it just injected: the values it may fill. */
export type FieldsMessage = { type: "clew/fields"; site: SiteId; profileVersion: number; fields: FillField[] };

/** From the fill panel after the user filled ticked fields: which ones, never their values. */
export type FilledMessage = { type: "clew/filled"; site: SiteId; profileVersion: number; keys: string[] };

const CODE = /^clk_[A-Za-z0-9_-]{40,60}$/;
const KEY = /^[A-Za-z0-9_.-]{1,64}$/;

function record(message: unknown): Record<string, unknown> | null {
  return typeof message === "object" && message !== null ? (message as Record<string, unknown>) : null;
}

function isSiteId(value: unknown): value is SiteId {
  return typeof value === "string" && Object.hasOwn(SITES, value);
}

export function isLinkMessage(message: unknown): message is LinkMessage {
  const m = record(message);
  return m?.type === "clew/link" && typeof m.code === "string" && CODE.test(m.code);
}

export function isPopupMessage(message: unknown): message is PopupMessage {
  const m = record(message);
  if (m?.type === "clew/status" || m?.type === "clew/sign-out") return true;
  return m?.type === "clew/fill-tab" && Number.isInteger(m.tabId);
}

export function isFilledMessage(message: unknown): message is FilledMessage {
  const m = record(message);
  return (
    m?.type === "clew/filled" &&
    isSiteId(m.site) &&
    Number.isInteger(m.profileVersion) &&
    Array.isArray(m.keys) &&
    m.keys.length > 0 &&
    m.keys.length <= 200 &&
    m.keys.every((key) => typeof key === "string" && KEY.test(key))
  );
}

export function isFieldsMessage(message: unknown): message is FieldsMessage {
  const m = record(message);
  return (
    m?.type === "clew/fields" &&
    isSiteId(m.site) &&
    Number.isInteger(m.profileVersion) &&
    Array.isArray(m.fields) &&
    m.fields.every((f: unknown) => {
      const field = record(f);
      return (
        typeof field?.key === "string" &&
        typeof field.label === "string" &&
        typeof field.value === "string" &&
        typeof field.behind === "boolean"
      );
    })
  );
}
