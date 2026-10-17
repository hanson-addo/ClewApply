import { Logo } from "../components/Logo";

/** Shown when the web app was built without a Clerk publishable key. */
export function SetupNeededPage() {
  return (
    <main className="setup-needed">
      <Logo variant="onLight" />
      <h1>Sign-in isn&apos;t set up yet</h1>
      <p>
        This copy of Clew was built without a Clerk key. Set <code>VITE_CLERK_PUBLISHABLE_KEY</code>{" "}
        in <code>apps/web/.env.local</code> and restart. The steps are in{" "}
        <code>docs/setup/clerk.md</code>.
      </p>
    </main>
  );
}
