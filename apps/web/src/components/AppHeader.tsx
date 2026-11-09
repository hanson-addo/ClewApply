import { Link, NavLink } from "react-router";

import { Logo } from "./Logo";

const LINKS = [
  { to: "/", label: "Home", end: true },
  { to: "/jobs", label: "Jobs", end: false },
  { to: "/applications", label: "Applications", end: false },
  { to: "/profile", label: "Profile", end: false },
];

/** Indigo bar on every signed-in page: skip link, logo, main nav and sign-out. */
export function AppHeader({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  return (
    <>
      <a href="#main" className="clew-skip-link">
        Skip to main content
      </a>
      <header className="app-header clew-inverse">
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
          {email && <span className="app-header-email">{email}</span>}
          <button type="button" className="button button-inverse-outline" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </header>
    </>
  );
}
