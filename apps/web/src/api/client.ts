import createClient from "openapi-fetch";

import type { paths } from "./schema";

/** Typed client for the Clew API. Types come from the backend's OpenAPI spec (`npm run gen:api`). */
export const api = createClient<paths>({
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8000",
  // Look up fetch on each call so tests and polyfills can replace it.
  fetch: (request) => globalThis.fetch(request),
});
