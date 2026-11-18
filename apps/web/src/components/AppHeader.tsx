import { useEffect, useId, useRef, useState } from "react";
import { Link, NavLink } from "react-router";

import { Logo } from "./Logo";

const LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/jobs", label: "Jobs", end: false },
  { to: "/applications", label: "Applications", end: false },
  { to: "/profile", label: "Profile", end: false },
  { to: "/sync", label: "Sync", end: false },
];

/**
 * The avatar button and its menu. It's a disclosure (a button that shows a panel), not an ARIA
 * menu, so Tab moves through it like any links. Escape or a click outside closes it.
 */
function AccountMenu({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="account-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="app-header-avatar" aria-hidden="true">
          {email ? email.charAt(0).toUpperCase() : "•"}
        </span>
        <span className="clew-sr-only">Account</span>
        <span className="account-menu-caret" aria-hidden="true" />
      </button>
      <div id={panelId} className="account-menu-panel" hidden={!open}>
        {email && (
          <p className="account-menu-email">
            <span className="clew-sr-only">Signed in as </span>
            {email}
          </p>
        )}
        <ul>
          <li>
            <Link to="/profile" className="account-menu-item" onClick={() => setOpen(false)}>
              Your profile
            </Link>
          </li>
          <li>
            <Link
              to="/onboarding/preferences"
              className="account-menu-item"
              onClick={() => setOpen(false)}
            >
              Job preferences
            </Link>
          </li>
          <li>
            <Link to="/settings" className="account-menu-item" onClick={() => setOpen(false)}>
              Settings
            </Link>
          </li>
          <li>
            <button type="button" className="account-menu-item" onClick={onSignOut}>
              Sign out
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * True until the page scrolls. At the top the header is see-through, so a page's indigo band
 * runs up behind it in one piece; once the page moves, the header turns solid. One observer
 * on a 1px marker, so nothing runs while scrolling.
 */
function useAtTop() {
  const marker = useRef<HTMLSpanElement>(null);
  const [atTop, setAtTop] = useState(true);
  useEffect(() => {
    const node = marker.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setAtTop(entry?.isIntersecting ?? true));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { marker, atTop };
}

/** Indigo bar on every signed-in page: skip link, logo, main nav and the account menu. */
export function AppHeader({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  const { marker, atTop } = useAtTop();
  return (
    <>
      <span ref={marker} className="app-top-marker" aria-hidden="true" />
      <span className="page-thread" aria-hidden="true" />
      <a href="#main" className="clew-skip-link">
        Skip to main content
      </a>
      <header className="app-header clew-inverse" data-at-top={atTop || undefined}>
        <Link to="/" className="app-header-home" aria-label="Clew home">
          <Logo variant="onDark" size={36} />
        </Link>
        <nav aria-label="Main" className="app-nav">
          <ul>
            {LINKS.map((link) => (
              <li key={link.to}>
                <NavLink to={link.to} end={link.end} className="app-nav-link">
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="app-header-account">
          <AccountMenu email={email} onSignOut={onSignOut} />
        </div>
      </header>
    </>
  );
}
