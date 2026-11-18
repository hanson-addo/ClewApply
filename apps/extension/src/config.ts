/** Hosts for this build (production or development), baked in by vite.config.ts. */
export const config = {
  apiUrl: __CLEW_API_URL__,
  /** The web app, the only page allowed to hand the extension a link code. */
  webOrigin: __CLEW_WEB_ORIGIN__,
};
