import { SignIn, SignUp } from "@clerk/react";

import { clerkAppearance } from "../auth/clerkAppearance";
import { Logo } from "../components/Logo";
import { MazeArt } from "../components/MazeArt";

type Mode = "sign-in" | "sign-up";

/**
 * The front door. Clerk's widget offers the sign-in methods turned on in the Clerk dashboard
 * (passkey, Google, LinkedIn, email code). Clew never sees a password.
 */
export function SignInPage({ mode }: { mode: Mode }) {
  return (
    <div className="signin">
      <section className="signin-story">
        <Logo variant="onDark" size={48} />
        <h1 className="signin-hero">
          Every job site.
          <br />
          <span className="signin-accent">One thread.</span>
        </h1>
        <p className="signin-lede">
          The job hunt is a maze of logins and copies of your resume. Clew keeps one profile,
          follows it to every site, and brings the jobs back to you.
        </p>
        <MazeArt />
      </section>
      <main className="signin-panel">
        <div className="signin-panel-inner">
          <span className="signin-panel-logo">
            <Logo variant="onLight" size={36} />
          </span>
          <span className="signin-badge">Free to join · US only for now</span>
          {/* Clerk's widget brings its own heading ("Sign in to Clew"), so the panel doesn't add a second one. */}
          {mode === "sign-in" ? (
            <SignIn
              routing="path"
              path="/sign-in"
              signUpUrl="/sign-up"
              fallbackRedirectUrl="/"
              appearance={clerkAppearance}
            />
          ) : (
            <SignUp
              routing="path"
              path="/sign-up"
              signInUrl="/sign-in"
              fallbackRedirectUrl="/"
              appearance={clerkAppearance}
            />
          )}
          <p className="signin-promise">Clew never asks for your passwords on other sites.</p>
        </div>
      </main>
    </div>
  );
}
