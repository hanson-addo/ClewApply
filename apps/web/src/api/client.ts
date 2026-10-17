import createClient, { type Client, type Middleware } from "openapi-fetch";

import { config } from "../config";
import type { paths } from "./schema";

export type ApiClient = Client<paths>;
export type GetToken = () => Promise<string | null>;

/**
 * Typed client for the Clew API. Types come from the backend's OpenAPI spec (`npm run gen:api`).
 *
 * With `getToken`, every request carries the Clerk session token as a Bearer header. The token
 * is fetched fresh from Clerk's SDK per request (it lives about 60 seconds) and is never stored.
 */
export function createApiClient(getToken?: GetToken): ApiClient {
  const client = createClient<paths>({
    baseUrl: config.apiUrl,
    // Look up fetch on each call so tests and polyfills can replace it.
    fetch: (request) => globalThis.fetch(request),
  });
  if (getToken) {
    const auth: Middleware = {
      async onRequest({ request }) {
        const token = await getToken();
        if (token) request.headers.set("Authorization", `Bearer ${token}`);
        return request;
      },
    };
    client.use(auth);
  }
  return client;
}
