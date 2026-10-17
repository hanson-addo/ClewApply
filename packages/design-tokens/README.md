# @clew/design-tokens

Clew's colors, type, spacing and sizes, shared by the web app and the browser add-on. No runtime dependencies.

- `tokens.json` is the source of truth. Edit only this file.
- `tokens.css` and `tokens.ts` are generated. Run `npm run build` after editing and commit the results.
- `base.css` holds the shared focus ring, skip link, screen-reader-only class and reduced-motion rules.
- `npm test` checks that every text and control color pair meets WCAG AA contrast and that the generated files are up to date.

Guidelines and component specs: [docs/design](../../docs/design/README.md).
