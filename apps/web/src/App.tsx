import { ClerkProvider } from "@clerk/react";
import { Navigate, Route, Routes, useNavigate } from "react-router";

import { clerkAppearance } from "./auth/clerkAppearance";
import { RequireSignIn } from "./auth/RequireSignIn";
import { config } from "./config";
import { HomePage } from "./pages/HomePage";
import { SetupNeededPage } from "./pages/SetupNeededPage";
import { SignInPage } from "./pages/SignInPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/sign-in/*" element={<SignInPage mode="sign-in" />} />
      <Route path="/sign-up/*" element={<SignInPage mode="sign-up" />} />
      <Route
        path="/"
        element={
          <RequireSignIn>
            <HomePage />
          </RequireSignIn>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

/** Must render inside a router: Clerk navigates with react-router so pages don't reload. */
export function App({ publishableKey = config.clerkPublishableKey }: { publishableKey?: string }) {
  const navigate = useNavigate();
  if (!publishableKey) return <SetupNeededPage />;
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      routerPush={(to) => navigate(to)}
      routerReplace={(to) => navigate(to, { replace: true })}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignOutUrl="/sign-in"
      appearance={clerkAppearance}
    >
      <AppRoutes />
    </ClerkProvider>
  );
}
