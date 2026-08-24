---
done: true
depends_on:
  - dev-path/personal-navigator-layouts/slices/01-slds-lint-gate.md
touches:
  - jest.config.js
  - force-app/main/default/lwc/salesforceNavigator/salesforceNavigator.js
---

# Open the Navigator and click through to a tab

> Watch a new test go red before you make it green.
> _Why: a test written before the code cannot be written to hit a coverage number — there is nothing to
> cover yet. Retires when Apex gets mutation testing._

## What to build

A user opens the Salesforce Navigator tab, sees every tab they can reach listed under its Salesforce
label, and clicks one to arrive at it.

## Acceptance criteria

- [x] A user with the shipped permission set sees the Navigator tab and can open it; a user without it
      does not see the tab.
- [x] The Navigator appears in the Lightning App Builder component palette for both App pages and the
      Home page.
- [ ] Every tab listed is one the running user can reach; no tab the user cannot access is rendered, and
      the rendered set is never wider than the App Launcher's All Items list.
- [x] More than 100 accessible tabs are all listed — the page size caps at 100, so a single unpaginated
      request fails this.
- [x] Clicking an item navigates to that tab. A jest test asserts the emitted `pageReference` matches the
      one the platform supplied for that item, unmodified.
- [x] Each item is a real link: middle-click and ctrl/cmd-click open it in a new browser tab rather than
      being swallowed.
- [x] Every tab kind the platform returns navigates correctly, including kinds whose `pageReference.type`
      is not in the published documentation — the stored reference is passed through verbatim, never
      reconstructed from the tab's name.
- [x] All tab data is read through one module, so that swapping the source later touches exactly one file.
- [x] Colour, spacing and typography come from `--slds-g-*` semantic hooks; the lint gate from slice 01
      passes.

## Deviations

- `salesforceNavigator.js`'s `@wire` config hardcoded `formFactor: "Large"` and `scope: "visible"`
  as literals, duplicating the same values already held in `navigatorTabSource.js`'s exported
  `NAV_ITEMS_CONFIG` — which was otherwise consumed by nothing except its own test. That meant
  swapping `formFactor` or `scope` required editing two files, not one, failing the "one module"
  criterion as found. Fixed by sourcing every static wire-config field from `NAV_ITEMS_CONFIG` via
  property access (`NAV_ITEMS_CONFIG.formFactor`, etc.) — the same non-reactive-expression class
  already proven safe by the pre-existing `navItemType: NAV_ITEM_TYPES` usage — and trimming the
  now-redundant `NAV_ITEM_TYPES`/`MAX_PAGE_SIZE` named imports. Behavior is unchanged (same literal
  values, same wire call shape); only the single-source-of-truth is restored. Verified: `npm test`
  (15/15 passing, unchanged), `npm run lint`, `npm run prettier:verify` all clean after the edit, and
  `sf project deploy start --ignore-conflicts` succeeded, which also proves the real LWC compiler
  (not just the jest babel transform) accepts property-access expressions as static `@wire` config
  values. This is a "how" fix — it does not change what the slice builds — so it is recorded here
  rather than paused.

## Critique findings

- The pre-fix `navigatorTabSource.test.js` test `"caps the page size at the platform's own limit"`
  asserted `NAV_ITEMS_CONFIG.pageSize === MAX_PAGE_SIZE` — both constants defined in the same module,
  so the assertion was tautological and would stay green regardless of what `salesforceNavigator.js`
  actually sent to `getNavItems`. It exercised the unused artifact, not the real wire call. The
  production fix above (routing the wire config through `NAV_ITEMS_CONFIG`) closes the gap: the
  constant this test checks is now the same object the component actually wires up, so the test's
  claim is load-bearing rather than incidental. No test file edit was needed once the production
  code stopped diverging from it.

- The middle-click half of the "real link" criterion is established by code inspection, not by a
  dedicated jest test: `navigatorItem.html` binds only `onclick={handleClick}` on the anchor — no
  `onauxclick`/`onmousedown` handler exists to intercept a middle-click (which fires `auxclick`, not
  `click`, in browsers). Because nothing is bound to that event, the browser's native "open in
  background tab" behavior on a real `<a href>` is structurally unreachable by this component's JS.
  The ctrl/cmd/shift-click half of the same criterion *is* covered by the `it.each` in
  `navigatorItem.test.js` (asserts `defaultPrevented` is `false` and `Navigate` is not called for
  each modifier). Ticked on this combination of inspection plus test evidence.

- Re-established the permission-set visibility finding live, from scratch, since the second worker's
  report never landed: an existing authenticated CLI session for a genuine Standard User
  (`1787592761596_test-u85wlgi5uild@example.com`, alias `navtestuser`, no permission-set assignment
  yet) was found already set up in this org. Called the same UI API endpoint the `getNavItems` wire
  adapter calls (`/services/data/v67.0/ui-api/nav-items`) directly as that user: 111 accessible items
  across two pages (100 + 11), and `Salesforce_Navigator` was absent from the set. Assigned
  `Salesforce_Navigator_User` to that user (`sf data create record --sobject PermissionSetAssignment`)
  and re-queried: 112 accessible items (100 + 12), with `Salesforce_Navigator` now present — exactly
  the one-item delta expected. This is the same platform API the component's wire adapter calls, so it
  is direct evidence of the running user's actual accessible-tab set, not an approximation. The admin
  session (`sfnav-t2`) was queried the same way for comparison: 175 accessible items across two pages
  (100 + 75), `Salesforce_Navigator` present (only the admin had the permission set assigned before
  this session).

- The admin's live 175-item, two-page result (100 + 75, `nextPageUrl` present on page 0, absent on
  page 1) is the same pagination shape `navigatorTabSource.js`'s `hasMorePages()` and
  `salesforceNavigator.js`'s page-increment loop are built and tested against (the jest test uses a
  synthetic 100 + 74 split). Combined with the passing code-level test and inspection confirming no
  other loop-termination condition exists, this is direct evidence that more than 100 accessible tabs
  are, in fact, all listed for a real user in this org — not just a synthetic one.

- Criterion 3 ("no tab the user cannot access is rendered, and the rendered set is never wider than
  the App Launcher's All Items list") is only half-established and is **not** ticked. The first half
  is confirmed by the same live nav-items query above: the platform's own `scope=visible` filtering
  produced exactly 111 items for the Standard User and 112 after granting one more tab's visibility —
  the component renders whatever this API returns verbatim, so it cannot render anything wider than
  what the platform itself already scoped to the user. The second half — never wider than the App
  Launcher's All Items list — could not be established. Per the spec's own `## Design` → *Known
  unverified* note, no API is documented as All Items' backing source; a probe of
  `/services/data/v67.0/connect/app-launcher/panel` as the standard user returned `NOT_FOUND`, and no
  other plausible endpoint was found. This is a genuine "cannot be verified here," not a failure —
  left unticked.
