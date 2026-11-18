import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "src/api/schema.d.ts"] },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.strict],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.serviceworker },
    },
    rules: {
      // Text goes into pages with textContent only (Security #9).
      "no-restricted-properties": [
        "error",
        { property: "innerHTML", message: "Use textContent." },
        { property: "outerHTML", message: "Use textContent." },
        { property: "insertAdjacentHTML", message: "Use textContent." },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
    },
  },
);
