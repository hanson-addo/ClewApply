# Clew Chrome extension

Manifest V3, TypeScript strict, built with Vite. Plan and security notes: issue #130.

It signs in (step 1) and fills your LinkedIn profile's edit forms from your Clew profile
(step 3). Indeed and USAJobs come next, one site per change.

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

## How filling works

1. In the popup, **Turn on LinkedIn**. Chrome asks you to allow `https://www.linkedin.com/*`.
   That's an optional permission: nothing is granted at install, and **Turn off LinkedIn**
   gives it back.
2. On your LinkedIn profile, open a section's edit form (a pencil, or Add), then press **Fill
   this LinkedIn form** in the popup.
3. The service worker checks the tab is a LinkedIn profile page, fetches the values
   (`GET /sync/fields/linkedin`), injects `content/linkedin.js` into that tab and hands it the
   values. Nothing runs on LinkedIn before you press Fill, and the manifest has no
   `content_scripts`.
4. The panel (in a closed shadow root) finds the open form by its heading and each box by its
   label, lists the fields unticked, and fills only what you tick, on a real click. It never
   clicks Save, Submit or Apply, never reads what you typed, and never sees the token.
5. It tells the service worker which field keys it filled (no values), and the worker records
   them (`POST /sync/fills`) so the Sync Center can show what's behind.

Forms filled on LinkedIn: intro (headline, city), about, experience (title, company, start and
end month and year) and education (school, degree, field of study, dates). Skills aren't filled:
LinkedIn adds them one at a time through a search box. LinkedIn's labels can change; a box the
panel can't find is shown as "not found on this form" and left alone.

`vite.content.config.ts` builds each content script as one classic script and fails the build
if it mentions `chrome.storage`, `fetch` or the API's address.

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
