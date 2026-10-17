import { Link } from "react-router";

import { Logo } from "./Logo";

/** Indigo bar on every signed-in page. Navigation arrives with the pages it links to. */
export function AppHeader({ email, onSignOut }: { email: string | null; onSignOut: () => void }) {
  return (
    <header className="app-header clew-inverse">
      <Link to="/" className="app-header-home" aria-label="Clew home">
        <Logo variant="onDark" size={36} />
      </Link>
      <div className="app-header-account">
        {email && <span className="app-header-email">{email}</span>}
        <button type="button" className="button button-inverse-outline" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
