# Clew Chrome extension

Manifest V3, TypeScript strict, built with Vite. Plan and security notes: issue #130.

Step 1 (this skeleton) signs in and shows who it's signed in as. It has no content scripts and
asks only for `storage` and the Clew API host.

## How it signs in

No passwords and no cookies. In the web app, **Settings → Browser extension → Connect this
browser** asks the API for a one-time link code (needs a sign-in in the last 10 minutes) and
hands it to the extension with `chrome.runtime.sendMessage(<extension id>, …)`. The service
worker accepts it only from the web app's origin, trades it for an extension token
(`POST /extension/token`) and keeps the token in `chrome.storage.local`.

- The token works only on `/extension/*` routes; every other route answers it with 403.
- Settings lists connected browsers and can disconnect each. Signing out of Clew, or deleting
  the account, disconnects them all. The popup's "Sign out of the extension" revokes its own.
- Only the service worker holds the token and calls the API. The popup asks the worker.

## Run it locally

```sh
cd apps/extension
npm install
npm run build:dev   # dist/ talks to http://localhost:8000 and accepts http://localhost:5173
```

Then open `chrome://extensions`, turn on Developer mode, press **Load unpacked** and pick
`apps/extension/dist`. The manifest's `key` pins the id to `bknomgnbnlknofhndoodlaboaomlhben`,
so set `CLEW_EXTENSION_ID` to that in `backend/.env` for CORS.

`npm run build` makes the production build (api.clewapply.com, app.clewapply.com). It fails if
any file in it mentions localhost.

## Checks

```sh
npm run lint && npm run typecheck && npm test && npm run build
```

When an API route changes: `cd backend && uv run python -m clew.openapi > openapi.json`, then
`npm run gen:api` here and in `apps/web`.
