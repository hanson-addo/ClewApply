import createClient, { type Client } from "openapi-fetch";

import type { paths } from "./schema";

export type ApiClient = Client<paths>;

/**
 * Typed client for the Clew API (types from the backend's OpenAPI spec, `npm run gen:api`).
 * Only the service worker uses it. With a token, every request carries it as a Bearer header.
 */
export function createApiClient(baseUrl: string, token?: string): ApiClient {
  return createClient<paths>({
    baseUrl,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    // Look up fetch on each call so tests can replace it.
    fetch: (request) => globalThis.fetch(request),
  });
}
