import { ClerkProvider } from "@clerk/react";
import { Navigate, Route, Routes, useNavigate } from "react-router";

import { ApplicationsPage } from "./applications/ApplicationsPage";
import { clerkAppearance } from "./auth/clerkAppearance";
import { RequireSignIn } from "./auth/RequireSignIn";
import { config } from "./config";
import { JobsPage } from "./jobs/JobsPage";
import { PreferencesStep } from "./onboarding/PreferencesStep";
import { ReviewStep } from "./onboarding/ReviewStep";
import { UploadStep } from "./onboarding/UploadStep";
import { HomePage } from "./pages/HomePage";
import { ProfilePage } from "./profile/ProfilePage";
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
      <Route
        path="/jobs/:jobId?"
        element={
          <RequireSignIn>
            <JobsPage />
          </RequireSignIn>
        }
      />
      <Route
        path="/applications/:applicationId?"
        element={
          <RequireSignIn>
            <ApplicationsPage />
          </RequireSignIn>
        }
      />
      <Route path="/onboarding" element={<Navigate to="/onboarding/upload" replace />} />
      <Route
        path="/onboarding/upload"
        element={
          <RequireSignIn>
            <UploadStep />
          </RequireSignIn>
        }
      />
      <Route
        path="/onboarding/review"
        element={
          <RequireSignIn>
            <ReviewStep />
          </RequireSignIn>
        }
      />
      <Route
        path="/onboarding/preferences"
        element={
          <RequireSignIn>
            <PreferencesStep />
          </RequireSignIn>
        }
      />
      <Route path="/profile" element={<Navigate to="/profile/basics" replace />} />
      <Route
        path="/profile/:section"
        element={
          <RequireSignIn>
            <ProfilePage />
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
