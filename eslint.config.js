const { defineConfig } = require("eslint/config");
const eslintJs = require("@eslint/js");
const jestPlugin = require("eslint-plugin-jest");
const auraConfig = require("@salesforce/eslint-plugin-aura");
const lwcConfig = require("@salesforce/eslint-config-lwc/recommended");
const sldsPlugin = require("@salesforce-ux/eslint-plugin-slds");
const globals = require("globals");

// Outcome 9's gate. The plugin ships two entries: one for `**/*.{css,scss}`
// carrying `language: "css/css"`, one for `**/*.html` and friends carrying the
// html-eslint parser. Each is re-scoped under `**/lwc/**` so the linter never
// wanders into node_modules or this file's own neighbours — but the two are
// re-scoped *separately*, by rewriting each shipped pattern's leading `**/`.
// Collapsing both onto one `{css,html}` glob would hand the CSS entry's
// `css/css` language to every HTML file and silently disable the HTML rules.
// Nothing else about the shipped configs is altered: the severities are
// Salesforce's, and `--max-warnings 0` is what makes the warning-severity ones
// (hard-coded colour among them) actually fail a run.
const sldsLwcConfigs = sldsPlugin.configs["flat/recommended"].map((entry) => ({
  ...entry,
  files: entry.files.map((pattern) => pattern.replace(/^\*\*\//, "**/lwc/**/"))
}));

module.exports = defineConfig([
  // The fixtures under test/slds-lint-fixtures/ are inputs to
  // `npm run lint:slds-gate`, which asserts the gate's own exit codes. One of
  // them is deliberately dirty, so the ordinary lint run must not see them.
  {
    ignores: ["test/slds-lint-fixtures/**"]
  },

  // SLDS 2 styling gate — CSS and HTML under **/lwc/**
  ...sldsLwcConfigs,

  // Aura configuration
  {
    files: ["**/aura/**/*.js"],
    extends: [...auraConfig.configs.recommended, ...auraConfig.configs.locker]
  },

  // LWC configuration
  {
    files: ["**/lwc/**/*.js"],
    extends: [lwcConfig]
  },

  // LWC configuration with override for LWC test files
  {
    files: ["**/lwc/**/*.test.js"],
    extends: [lwcConfig],
    rules: {
      "@lwc/lwc/no-unexpected-wire-adapter-usages": "off"
    },
    languageOptions: {
      globals: {
        ...globals.node
      }
    }
  },

  // Jest mocks configuration
  {
    files: ["**/jest-mocks/**/*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
      globals: {
        ...globals.node,
        ...globals.es2021,
        // These mocks run under jsdom, and `lightning/modal`'s replacement
        // mounts the real component into the document rather than standing in
        // for it — so `document` is as much a global here as `jest` is.
        ...globals.browser,
        ...jestPlugin.environments.globals.globals
      }
    },
    plugins: {
      eslintJs
    },
    extends: ["eslintJs/recommended"]
  }
]);
