# @clew/design-tokens

Clew's colors, type, spacing and sizes, shared by the web app and the browser add-on. No runtime dependencies.

- `tokens.json` is the source of truth. Edit only this file.
- `tokens.css` and `tokens.ts` are generated. Run `npm run build` after editing and commit the results.
- `base.css` holds the shared focus ring, skip link, screen-reader-only class and reduced-motion rules.
- `npm test` checks that every text and control color pair meets WCAG AA contrast and that the generated files are up to date.

## Installing in an app

There is no npm workspace yet, so apps depend on the folder directly. In `apps/web/package.json` (or `apps/extension/package.json`):

```json
"dependencies": { "@clew/design-tokens": "file:../../packages/design-tokens" }
```

Then import the CSS once at the app entry and use the typed tokens anywhere:

```ts
import '@clew/design-tokens/tokens.css';
import '@clew/design-tokens/base.css';
import { tokens, cssVar } from '@clew/design-tokens';
```

The package exports raw `tokens.ts`, so the consumer needs a bundler (Vite) or `tsc` with `"moduleResolution": "bundler"`. Use the `--clew-*` variables from `tokens.css` instead of defining brand colors locally.

Guidelines and component specs: [docs/design](../../docs/design/README.md).
