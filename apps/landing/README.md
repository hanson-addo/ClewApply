# Clew coming-soon page

A single static page for clewapply.com until the app launches. No scripts, no forms and no tracking, so it collects nothing from visitors.

- `index.html`: the page (brand colors, logo and the maze art from the sign-in screen).
- `_headers`: security headers, applied by Cloudflare Pages.
- `landing.test.mjs`: checks, run with `node --test apps/landing/landing.test.mjs`.

## Hosting on Cloudflare Pages (free)

1. In Cloudflare, go to **Workers & Pages → Create → Pages → Connect to Git** and pick this repo.
2. Build settings: framework preset **None**, build command empty, build output directory `apps/landing`.
3. Deploy, then open **Custom domains → Set up a domain** and enter `clewapply.com` (and `www.clewapply.com`).
4. If the domain is registered elsewhere, Cloudflare shows the DNS records or nameservers to set at your registrar.

Preview deployments for other branches are on by default; turn them off under **Settings → Builds** if you only want `main` published.
