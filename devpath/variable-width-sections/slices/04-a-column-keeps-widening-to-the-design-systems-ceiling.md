---
depends_on:
  - devpath/variable-width-sections/slices/01-width-follows-columns-side-by-side.md
touches:
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.css
  - force-app/main/default/lwc/salesforceNavigator/__tests__/salesforceNavigator.test.js
done: true
fix_cycles: 0
---

# On a very wide display a column keeps widening a little further before it stops

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user on a display wide enough to run the columns out to their limit sees them keep widening to 480px
instead of stopping at 416px, so the longest tab name has room to spare rather than only just fitting —
and the width they stop at is a value the design system supplies rather than a number written into this
component's stylesheet.

## Acceptance criteria

- [x] met Past the point where the ceiling binds — roughly 2,992px of available width — a column measures
      480px rather than 416px. `--rstk-nav-col-max`'s fallback is now `var(--slds-g-sizing-16, 30rem)`,
      and `-16` is 30rem/480px in both slds and cosmos per
      `node_modules/@salesforce-ux/sds-metadata/current/SLDSStylingHooks.csv`. Not directly assertable in
      jest — rendered width is not observable in jsdom, per the design's own `### Test entry points` — so
      this is verified by the stylesheet-text pin below rather than a live-width assertion.
- [x] met Below roughly 2,600px of available width the layout is unchanged from what slice 01 shipped: the
      same track widths at 1280, 1440 and 1680. Only the ceiling's fallback value changed; the floor, the
      `minmax()` shape, and every other rule on `.rstk-nav-sections` are untouched, and the design's own
      arithmetic places the ceiling's bind point at ~2,600-2,992px, above all three viewports.
- [x] met The floor is untouched — a column still stops shrinking at 160px, and the layout still gains its
      horizontal scroll bar below roughly 1,072px of available width. `--rstk-nav-col-min`'s fallback
      stays `var(--slds-g-sizing-13, 10rem)`, unedited; `salesforceNavigator.test.js`'s floor sub-pattern
      and its `overflow-x: auto` assertion both still pass, untouched.
- [x] met The shipped stylesheet expresses the ceiling as `--slds-g-sizing-16` carrying its own fallback, and
      no raw length remains anywhere in the canvas grid's `minmax()`. Verified by the updated regex in
      `salesforceNavigator.test.js`'s "lays the canvas out as a six-track grid..." test, watched red
      against the pre-edit CSS (still expressing the raw `26rem`) and green after the CSS edit; the regex
      requires the exact tokenised form, so a raw length, a wrong hook, or a hook missing its fallback all
      fail it.
- [x] met Overriding `--rstk-nav-col-max` still bypasses the hook entirely and sets the ceiling directly,
      exactly as it did before. Unchanged CSS custom-property cascade semantics: the property is declared
      nowhere in the repo, so `var()` still resolves to its fallback chain, and setting
      `--rstk-nav-col-max` anywhere in scope still overrides that chain entirely, exactly as
      `--rstk-nav-col-min` already did.
- [x] met `npm run lint` passes at `--max-warnings 0` over the changed CSS. Ran clean, zero warnings.
- [x] met Slice 01's existing checks all still pass untouched — the six-track pin driven off `MAX_COLUMNS`,
      the floor pin, the `overflow-x: auto` pin, and the span-class uniqueness guard across all six
      column counts. Only the ceiling literal inside the combined regex changed; the `MAX_COLUMNS`
      sub-pattern, the floor sub-pattern, the `overflow-x: auto` `toContain`, and the separate span-class
      uniqueness tests are byte-for-byte as slice 01 left them, and all pass.

## Deviations

## Critique findings

- [x] false positive — `--slds-g-sizing-16` really is `30rem`/480px, 🔒 and identical in the slds and cosmos columns, at `node_modules/@salesforce-ux/sds-metadata/current/SLDSStylingHooks.csv:190`, and it really is the top of the scale: no `--slds-g-sizing-17` or higher exists in the file
- [x] false positive — the retraction on `.rstk-nav-sections` is correct. Under `repeat(6, minmax(…))` six tracks always exist and a one-column section spans exactly one of them, so a lone one-column section was never going to stretch to 1,376px; that claim only ever held for the fixed-width model the design rejected. What the comment now says in its place is true
- [x] false positive — the one changed assertion in slice 01's grid test is the ceiling assertion and nothing else. `${MAX_COLUMNS}` still drives `repeat(N, …)`, the floor sub-pattern, `justify-content: start` and the `overflow-x: auto` `toContain` are byte-for-byte, and both span-class uniqueness guards are untouched; 222 tests across `salesforceNavigator.test.js` and `navigatorSection.test.js` pass
- [x] false positive — the new pin genuinely discriminates. Replayed against the pre-edit stylesheet it is red, and mutating the shipped declaration turns it red on hook `-15`/20rem, on the hook stripped of its fallback, on a bare `30rem`, on a `26rem` fallback under the right hook, on the `--rstk-nav-col-max` seam removed, on the floor drifting to `-14`, and on `repeat(5,`
- [x] false positive — `npm run lint` does reach this file: `eslint .` loads `@salesforce-ux/eslint-plugin-slds`'s flat config re-scoped to `**/lwc/**/*.css` in `eslint.config.js`, and `salesforceNavigator.css` lints with 0 errors and 0 warnings
- [x] false positive — the criteria stated in pixels at named viewports are not observable in jsdom and no test here claims otherwise; criterion 1 says so outright and the rest rest on the stylesheet-text pin plus the design's arithmetic, which re-derives exactly (6×416+112 = 2,608; 6×480+112 = 2,992; 6×160+80+32 = 1,072). Those numbers remain the live-org verifier's, not jest's
- [x] fixed — rewrote both comments to state the mechanism the critic measured: `no-hardcoded-values-slds2` is property-scoped, not value-mapping-scoped, so the raw `26rem` was invisible to it because the rule never checks `grid-template-columns` — not because no hook mapped to the value. `salesforceNavigator.css:41-43` now reads "invisible to `no-hardcoded-values-slds2` not because no hook mapped to it but because the rule is property-scoped and never checks `grid-template-columns` — see the trap on this"; `salesforceNavigator.test.js:805-808` carries the same correction, pointing to the `## Traps` entry (which carries the full probe evidence) rather than restating it. No assertion, selector, declaration or test behaviour changed — `npm run test:unit` (455/455 passed), `npm run lint` (0 warnings) and `npm run lint:slds-gate` (all checks ok) all pass clean.
- [ ] the same false mechanism sits in `spec.md`'s `### The floor and the ceiling` — "a hardcoded sizing value that the linter cannot catch, because no hook maps to it and so `no-hardcoded-values-slds2` never fires" — which is approved design prose rather than this slice's code, so it is handed to the human rather than to a fix pass
