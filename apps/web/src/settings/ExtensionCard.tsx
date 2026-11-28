import { useCallback, useEffect, useState } from "react";

import { useApi } from "../auth/useApi";
import { config } from "../config";
import { isCancelled, useAccountRequest } from "./accountRequest";
import { handOffLinkCode } from "./extensionBridge";

type Connection = { id: string; label: string; created_at: string; last_used_at: string | null };
type State =
  | { status: "idle"; message?: string }
  | { status: "connecting" }
  | { status: "failed"; message: string };

const NOT_INSTALLED = "Install the Clew extension in Chrome, then press Connect again.";
const FAILED = "We couldn't connect the extension. Try again.";
const EXPIRED = "The connect code ran out before the extension used it. Press Connect again.";
const UNREACHABLE =
  "The extension couldn't reach Clew. Check that Clew is running, then press Connect again.";
const TOO_MANY = "You've connected a browser several times this hour. Try again later.";
const LIST_FAILED = "We couldn't load your connected browsers. Refresh the page to try again.";

function day(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** Settings → Browser extension: connect this browser, and see or disconnect the others (#130). */
export function ExtensionCard() {
  const api = useApi();
  const requestLink = useAccountRequest("POST", "/extension/link");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [listError, setListError] = useState(false);
  const [state, setState] = useState<State>({ status: "idle" });
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.GET("/extension/connections");
      return data?.connections ?? null;
    } catch {
      return null;
    }
  }, [api]);

  const show = useCallback((list: Connection[] | null) => {
    setListError(list === null);
    if (list) setConnections(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    load().then((list) => {
      if (!cancelled) show(list);
    });
    return () => {
      cancelled = true;
    };
  }, [load, show]);

  const reload = async () => show(await load());

  async function connect() {
    setState({ status: "connecting" });
    try {
      const result = await requestLink();
      if (!(result instanceof Response) || !result.ok) {
        const tooMany = result instanceof Response && result.status === 429;
        setState({ status: "failed", message: tooMany ? TOO_MANY : FAILED });
        return;
      }
      const { code } = (await result.json()) as { code: string };
      const handOff = await handOffLinkCode(config.extensionId, code);
      if (handOff === "connected") {
        setState({ status: "idle", message: "This browser is connected. Open the Clew extension to check." });
        await reload();
        return;
      }
      const messages = { "not-installed": NOT_INSTALLED, expired: EXPIRED, unavailable: UNREACHABLE };
      setState({ status: "failed", message: messages[handOff] });
    } catch (error) {
      setState(isCancelled(error) ? { status: "idle" } : { status: "failed", message: FAILED });
    }
  }

  async function disconnect(connection: Connection) {
    setRemoving(connection.id);
    try {
      const { response } = await api.DELETE("/extension/connections/{connection_id}", {
        params: { path: { connection_id: connection.id } },
      });
      if (response.ok || response.status === 404) {
        setState({ status: "idle", message: `Disconnected ${connection.label}.` });
        await reload();
      } else {
        setState({ status: "failed", message: "We couldn't disconnect that browser. Try again." });
      }
    } catch {
      setState({ status: "failed", message: "We couldn't disconnect that browser. Try again." });
    }
    setRemoving(null);
  }

  return (
    <section className="settings-card" aria-labelledby="extension-title">
      <h2 id="extension-title">Browser extension</h2>
      <p>
        The Clew extension for Chrome will fill your LinkedIn, Indeed and USAJobs profiles from your Clew profile.
        You tick each field, and you press Save on the site yourself. Connect it here first; filling arrives one site
        at a time.
      </p>
      {listError && (
        <p role="alert" className="settings-error">
          {LIST_FAILED}
        </p>
      )}
      {connections && connections.length > 0 && (
        <ul className="settings-browsers" aria-label="Connected browsers">
          {connections.map((connection) => (
            <li key={connection.id} className="settings-browser">
              <span>
                <strong>{connection.label}</strong>
                <span className="settings-browser-when">
                  Connected {day(connection.created_at)}
                  {connection.last_used_at ? `, last used ${day(connection.last_used_at)}` : ""}
                </span>
              </span>
              <button
                type="button"
                className="button button-secondary"
                disabled={removing !== null}
                aria-label={`Disconnect ${connection.label}`}
                onClick={() => void disconnect(connection)}
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}
      {connections && connections.length === 0 && <p className="settings-hint">No browsers are connected.</p>}
      <p className="settings-hint">Signing out of Clew also disconnects the extension in every browser.</p>
      <button
        type="button"
        className="button button-primary settings-action"
        disabled={state.status === "connecting"}
        onClick={() => void connect()}
      >
        Connect this browser
      </button>
      <p role="status" className="settings-status">
        {state.status === "connecting" && "Connecting the extension."}
        {state.status === "idle" && state.message}
      </p>
      {state.status === "failed" && (
        <p role="alert" className="settings-error">
          {state.message}
        </p>
      )}
    </section>
  );
}
