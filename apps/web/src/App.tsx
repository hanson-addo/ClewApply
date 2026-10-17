import { Logo } from "./Logo";
import { useApiStatus, type ApiStatus } from "./useApiStatus";

const statusText: Record<ApiStatus, string> = {
  checking: "Checking the Clew service…",
  online: "Clew service is up",
  offline: "Clew service is unreachable",
};

export function App() {
  const status = useApiStatus();

  return (
    <main className="shell">
      <header className="brand">
        <Logo />
        <span className="wordmark">Clew</span>
      </header>
      <h1>One profile and one job feed for every site you job hunt on.</h1>
      <p className="lede">
        Update your resume once. Clew fills it into each job site for you to approve, and gathers
        jobs from everywhere into one ranked list.
      </p>
      <p className={`status status-${status}`} role="status">
        {statusText[status]}
      </p>
    </main>
  );
}
