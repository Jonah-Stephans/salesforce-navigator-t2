---
paths:
  - "**/lwc/**/*.js"
  - "**/lwc/**/*.html"
  - "**/lwc/**/*.css"
---

# Lightning Web Components Standards

## Design Principles

- Small, focused components with a single responsibility.
- Intention-revealing names for components, properties, and methods.
- Minimal nesting in HTML templates — extract child components for complex markup.
- Modularity, composability, reactive data binding.

## Naming Conventions

- **Folders**: camelCase — `accountDetail`, `contactList`
- **HTML usage**: kebab-case — `<c-account-detail>`, `<c-contact-list>`
- **JS classes**: PascalCase — `AccountDetail extends LightningElement`
- **Constants**: UPPER_SNAKE_CASE — `const MAX_ITEMS = 50;`
- **Events**: kebab-case — `new CustomEvent('record-selected', { detail: record })`

## Data Access

Use the lightest-weight approach that meets the requirement — avoid Apex when the platform handles it:

1. **Base record form components** (`lightning-record-form`, `lightning-record-edit-form`, `lightning-record-view-form`) — metadata-driven CRUD, no Apex needed. Specify fields (not layouts) for performance.
2. **Lightning Data Service wire adapters** (`getRecord`, `getRecordUi`) — no API cost, shared cross-component cache. Works with all custom objects and standard objects supported by UI API.
3. **GraphQL wire adapter** (`lightning/graphql`) — multiple queries in one operation, complex relationships, exact field selection, pagination.
4. **Apex** — use ONLY when LDS is insufficient: unsupported objects (Task, Event), cross-record transactions, operations not supported by UI API.

- Prefer `@wire` over imperative Apex calls — reactive, cacheable, automatic refresh.
- Imperative calls only when you need control over timing (e.g., save button click).
- Always handle errors from wire adapters and imperative calls.

## Component Communication

- **Parent → Child**: `@api` properties and public methods
- **Child → Parent**: `CustomEvent` with `detail` payload — `this.dispatchEvent(new CustomEvent('select', { detail: { recordId } }))`
- **Siblings**: Lightning Message Service (LMS) via `MessageChannel`
- **Stick to primitives in `event.detail`** — objects and arrays are passed by reference, enabling unintended mutations. If non-primitives are needed, copy to a new object before adding to detail.
- NEVER manipulate another component's DOM directly
- NEVER use `window.postMessage` for component communication

## Security

- No `innerHTML` — use template directives (`lwc:if`, `for:each`) instead.
- No `eval()` or `new Function()` — blocked by Lightning Web Security (LWS).
- No `document.querySelector` across shadow boundaries — use `this.template.querySelector` within your own component.
- Load third-party JavaScript via Static Resources, not CDN links.
- Use `lightning-navigation` for navigation — never construct URLs manually.
- **Lightning Web Security (LWS)** has replaced Lightning Locker Service as the modern security architecture. LWS provides better performance and broader web standards compatibility.

## Performance

- Lazy load data — don't fetch everything on `connectedCallback`.
- Use `lightning-datatable` with infinite loading for large datasets.
- Avoid heavy computation in `renderedCallback` — it fires on every re-render.
- Use `@wire` caching — same parameters return cached results.
- Debounce search inputs to reduce server round-trips.

## SLDS

- Use SLDS utility classes for layout and spacing — don't write custom CSS for standard patterns.
- Prefer `lightning-*` base components over custom implementations.
- Use `lightning-card`, `lightning-layout`, `lightning-layout-item` for structure.
- Use SLDS 2 global styling hooks (`--slds-g-*`) for colors, spacing, and typography — always in the
  `var(--hook, fallback)` form. See `rstk-slds2-ux-standards.md`. Do NOT use SLDS *design tokens*:
  that is the deprecated `--lwc-*` mechanism, and `lwc-token-to-slds-hook` is an error-severity lint
  rule that will fail the build.

## Template Patterns

- **`if:true` / `if:false` are DEPRECATED.** Use `lwc:if` / `lwc:elseif` / `lwc:else` for all conditional rendering.
- Use `for:each` with `key` directive for list rendering — key must be unique.
- Use `<template>` wrapper for conditional/iterative blocks, not `<div>`.
- Keep template expressions simple — move complex logic to getters.

## Cache Invalidation

- After imperative DML calls on **Apex `@wire` adapters**, use `refreshApex(wiredResult)` to force re-fetch. `refreshApex()` is NOT deprecated for Apex wires.
- For **LDS/ui*Api wire adapters** (`getRecord`, `getRecordUi`, etc.), use `notifyRecordUpdateAvailable(recordIds)` instead of `refreshApex()`.
- For **GraphQL wire adapters**, use `refreshGraphQL(result)`.
- Always refresh wired data after any operation that modifies records the wire adapter depends on.
- **Never mix Apex and GraphQL** for the same data — they don't share caches, causing inconsistencies.

## Aura Deprecation

- **Aura is legacy** — do NOT create new Aura components. All new development must use LWC.
- Aura `ui:*` namespace components are deprecated — use LWC `lightning-*` equivalents.
- Aura application events are deprecated — use Lightning Message Service (LMS) instead.
- **Migration strategy:** Aura can contain LWC children but NOT vice versa. Migrate leaf components first, working inward.
- The `lightning/graphql` module is the current standard for GraphQL queries (supersedes `lightning/uiGraphQLApi`).
