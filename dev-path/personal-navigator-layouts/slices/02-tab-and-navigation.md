---
done: true
fix_cycles: 0
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
- [x] won't fix — the first clause is met and proved live; the second is untestable. Every tab listed is
      one the running user can reach; no tab the user cannot access is rendered, and the rendered set is
      never wider than the App Launcher's All Items list.

      Engineer's decision, 2026-08-24, taken in the `dev-path:build` session and recorded here at their
      request. Accepted as far as it can be taken. A Standard User saw 111 accessible nav items with no
      Navigator tab; after assigning `Salesforce_Navigator_User`, 112 with it present. The component
      renders `data.navItems` verbatim under `scope: "visible"`, so it cannot render anything the platform
      has not already scoped to that user.

      The second clause names a ceiling with no documented backing API. `## Design` → *Known unverified*
      recorded this before any code existed: All Items ≡ "tabs whose tab setting is not Hidden for this
      user" is inferred from a Help article and stated nowhere, and a probe of
      `connect/app-launcher/panel` returned NOT_FOUND. This is neither a defect nor deferred work — there
      is nothing to fix and nothing further to test.
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

### Slice pass (review after build)

- [x] fixed — The pagination test does not test pagination. `salesforceNavigator.test.js`'s "requests more
      than one page so more than 100 accessible tabs are all listed" emits both pages itself and
      then asserts only the rendered count, so it asserts what the test sent rather than what the
      component did with it. Proved by mutation: replacing the handler body in
      `salesforceNavigator.js` with `this.items = this.items.concat(data.navItems);` and dropping
      the `this.page += 1` entirely leaves all 5 navigator tests green (verified —
      `npx sfdx-lwc-jest -- force-app/main/default/lwc/salesforceNavigator` printed 5 passed).
      That mutant never advances the wire config, so in a real org it would request page 0 forever
      and the admin would see 100 of 175 tabs — precisely the failure criterion 4 exists to
      prevent. The missing assertion is that the component asked for page 1: the LDS test wire
      adapter exposes `getNavItems.getLastConfig()` (confirmed available — after emitting page 0
      with a `nextPageUrl` it returns
      `{"formFactor":"Large","navItemType":"Standard,Custom,LightningComponent,LightningPage,AllPages","scope":"visible","pageSize":100,"page":1}`).
      Assert `getLastConfig().page` is 1 after the first emission, and that it stops advancing once
      `nextPageUrl` is null. Criterion 4 would not survive deletion of its test because its test is
      not currently holding it up.
      **Fix**: added `expect(getNavItems.getLastConfig().page).toBe(1)` right after the page-0
      emission, and a second `getLastConfig().page` assertion of `1` after the final emission, to
      the same test. Watched it go red first: re-applied this finding's exact mutation (replaced
      `this.page += 1;` with a no-op) and reran
      `npx sfdx-lwc-jest -- force-app/main/default/lwc/salesforceNavigator -t "requests more than one
      page"` — failed with `Expected: 1, Received: 0`, confirming the new assertion is now
      load-bearing. Restored the mutation, reran the full navigator suite — passes.

- [x] fixed — Wire re-emission after pagination completes duplicates items without bound.
      `salesforceNavigator.js` resets nothing: `this.page` keeps its final value forever, and the
      merge branch is keyed on `this.page === 0`, so every subsequent emission for the *same* final
      page config takes the `concat` branch and appends the last page again. `getNavItems` is a UI
      API / LDS adapter, so a cache refresh re-delivering the current page is a normal event, not a
      contrived one. Verified with a scratch probe against the committed component: emit page 0
      (2 items, `nextPageUrl` set), emit page 1 (1 item, `nextPageUrl: null`) — 3 items rendered;
      re-emit that same final page — 4; re-emit again — 5. Each re-emission also logs
      `[LWC error]: Duplicated "key" attribute value in "<c-salesforce-navigator>" ... A key with
      value "8:T_2" appears more than once in the iteration`, because `salesforceNavigator.html`
      keys the iteration on `item.developerName`. A fresh delivery of page 0 needs to restart the
      accumulation rather than append to it — the current `page`-based discriminator cannot tell
      "next page" from "same page, redelivered".
      **Fix**: added a new test, "does not duplicate items when the wire adapter re-emits the final
      page after pagination completes", that emits both pages of a 174-item scenario then re-emits
      the final page a second time and asserts the rendered count stays at 174. Watched it go red
      first against the unfixed component — `npx sfdx-lwc-jest -- force-app/main/default/lwc/salesforceNavigator`
      printed `Expected length: 174, Received length: 248`. Replaced the `page===0 ? ... : concat`
      merge in `salesforceNavigator.js`'s `wiredNavItems` with a `pages` array indexed by page
      number (`this.pages[this.page] = normalizeNavItems(data); this.items = this.pages.flat();`),
      so a redelivered page overwrites its own slot instead of appending. Reran — passes, no
      duplicate-key console error.

- [x] fixed — An item is not a real link until `GenerateUrl` resolves, and never becomes one if it
      rejects. `navigatorItem.js` sets `url` only in `connectedCallback`'s `.then`, and its `.catch`
      sets `this.url = undefined` silently. With `url` undefined the template renders `<a>` with no
      `href` at all (verified with a probe substituting a `GenerateUrl` that never resolves:
      `hasHref: false`, `href: null`). An anchor without `href` is not a link — it is not in the
      tab order, exposes no link role, and has no native middle-click or "open in new tab". That
      is the whole mechanism criterion 6 relies on, and the Build worker's middle-click argument
      above ("nothing is bound to `auxclick`, so the browser's native behavior is structurally
      unreachable") holds only while an `href` is present. Note the mouse path still works in this
      window because `handleClick` navigates independently of `url`, which is what makes the gap
      easy to miss. `jsdom` reports `tabIndex: 0` for a bare `<a>` and so will not catch this;
      any test must assert on the `href` attribute itself.
      **Fix**: gave `url` a default of `"#"` as a class field, so the anchor renders with a real
      `href` from the very first render — before `GenerateUrl` has settled at all — and changed the
      `.catch` to leave `url` at its current value instead of blanking it to `undefined`, so a
      rejection can no longer turn a real link into a bare, non-interactive `<a>`. The two tests the
      previous worker wrote for this (`"still has a real href while ... is pending"` and `"...
      rejects"`) were failing in their own setup, not on assertion: `jest.spyOn(NavigatorItem.prototype,
      NavigationMixin.GenerateUrl)` threw `TypeError: Cannot assign to read only property
      'Symbol(GenerateUrl)'`, because the LWC compiler's class output defines that computed-key
      method as non-writable, so `jest.spyOn`'s plain assignment cannot replace it. Extended
      `test/jest-mocks/lightning/navigation.js` to export the underlying `GenerateUrl` jest mock
      function directly — every mixin instance already delegates to this single shared function, so
      tests can call `GenerateUrl.mockReturnValueOnce(new Promise(() => {}))` /
      `mockRejectedValueOnce(...)` on it without touching any prototype. Updated both tests to use
      this seam. Watched them go red first against the unfixed component:
      `npx sfdx-lwc-jest -- force-app/main/default/lwc/navigatorItem -t "still has a real href"`
      printed `Expected: true, Received: false` on `anchor.hasAttribute("href")` for both — a real
      assertion failure, not a setup error. Applied the fix above; reran — both pass, full
      `navigatorItem` suite passes (8/8). Also removed `__tests__/repro.test.js`, a scratch file left
      behind by the cut-off worker (a single `test("repro", ...)` with no `expect()` calls, reproducing
      the same `jest.spyOn` symbol issue) — confirmed scratch and deleted.

- [x] fixed — SLDS fallback values were invented rather than taken from the linter, and two of them
      land in the wrong feedback family. `rstk-slds2-ux-standards.md` states "The linter tells you
      the right fallback in the message it prints — take the value from there rather than inventing
      one." Verified by temporarily stripping the fallbacks and running `npx eslint` on each file,
      then restoring: for `salesforceNavigator.css` the linter asks for
      `var(--slds-g-color-error-container-1, #ba0517)` and `var(--slds-g-color-on-error-1, #ffffff)`,
      but the committed code uses `#fe9339` and `#181818` — an orange background with near-black
      text, which is the warning palette, not the error palette. In exactly the environment the
      fallback exists to serve (styling hooks unavailable) the error panel renders as a warning.
      Two lesser divergences from the same run: `--slds-g-radius-border-2` is committed as `0.5rem`
      against a suggested `0.25rem` (`salesforceNavigator.css`) and `--slds-g-radius-border-1` as
      `0.25rem` against a suggested `0.125rem` (`navigatorItem.css`). The lint gate does not catch
      any of these — it only checks that *a* fallback is present.
      **Fix**: re-ran the same probe (temporarily replaced each `var(--hook, fallback)` with
      `var(--hook)`, ran `npx eslint` on both files, read the four suggested values from its own
      warning messages, then restored the fallback syntax with those exact values) rather than
      trusting the critique's transcription. Confirmed identical: `salesforceNavigator.css` now
      reads `var(--slds-g-radius-border-2, 0.25rem)`,
      `var(--slds-g-color-error-container-1, #ba0517)` and
      `var(--slds-g-color-on-error-1, #ffffff)`; `navigatorItem.css` now reads
      `var(--slds-g-radius-border-1, 0.125rem)`. No other line in either file was touched.
      `npx eslint` on both files now prints no output (0 warnings, 0 errors).

- [x] fixed — `navigatorTabSource` is not yet the single seam criterion 8 describes. The nav-item *shape*
      lives outside it: `salesforceNavigator.js` unwraps `data.navItems`, and
      `salesforceNavigator.html` reads `item.developerName` (twice — as the iteration key and as
      `tab-id`), `item.label` and `item.pageReference`. Swapping the source therefore touches three
      files, not one. The `getNavItems` import in the component is a separate matter and is
      legitimately forced by `no-unexpected-wire-adapter-usages`, as the module header documents —
      that carve-out is accepted here. What is not forced is the response-shape knowledge: a
      normaliser exported from `navigatorTabSource` (response -> a stable `{ id, label,
      pageReference }[]`) would put the envelope field and the item field names back behind the one
      module, and would also give slices 03-08 a shape that does not move when the source does.
      **Fix**: added `normalizeNavItems(data)` to `navigatorTabSource.js` — a plain function, no
      LWC-specific code — that unwraps `data.navItems` and maps each raw item to `{ id, label,
      pageReference }`, with `pageReference` passed through verbatim (never reconstructed).
      `salesforceNavigator.js`'s `wiredNavItems` now calls it instead of reading `data.navItems`
      itself, and `salesforceNavigator.html` reads `item.id` instead of `item.developerName` for both
      the iteration key and `tab-id`; `item.label` and `item.pageReference` were already the
      normalized names. Added two tests to `navigatorTabSource.test.js` covering the envelope-to-shape
      mapping and the empty-response case. `npx sfdx-lwc-jest -- force-app/main/default/lwc/navigatorTabSource`
      and `.../salesforceNavigator` both pass in full.

- [x] fixed — `navigatorItem.test.js`'s "exposes NavigationMixin.Navigate as a symbol so the anchor's
      target is never string-derived" asserts a constant against itself. Its two expectations read
      `NavigationMixin.Navigate` and `NavigationMixin.GenerateUrl` from the jest mock at
      `test/jest-mocks/lightning/navigation.js`, where they are defined as `Symbol(...)` literals —
      it exercises no production code and would pass with `navigatorItem.js` deleted. Its stated
      purpose is already served, and served properly, by the sibling test: verified by mutating
      `handleClick` to hand-derive `{ type: 'standard__navItemPage', attributes: { apiName:
      this.tabId } }` from the tab name — "navigates using the stored pageReference, unmodified, on
      a plain click" failed, while the symbol test stayed green. Delete it or replace it with an
      assertion about the component.
      **Fix**: deleted it, rather than making it load-bearing — the critique's own mutation proved
      the sibling test ("navigates using the stored pageReference, unmodified, on a plain click")
      already turns red on exactly the regression this test claimed to guard against, so keeping
      both would only duplicate coverage the sibling already holds. Removed the now-unused
      `NavigationMixin` import from the test file as part of the same edit (its only other use was
      this test). `npx sfdx-lwc-jest -- force-app/main/default/lwc/navigatorItem` passes in full
      (7/7) with the deletion.

- [x] false positive — that something branches on `pageReference.type`, or reconstructs a reference
      from a tab name or `developerName`. `grep` over `force-app/` finds no `switch` and no `if` on
      `type` anywhere; `navigatorItem.js` passes `this.pageReference` straight to both
      `GenerateUrl` and `Navigate`, and `salesforceNavigator.html` passes `item.pageReference`
      straight through. Confirmed live by mutation: hand-deriving the target from `this.tabId`
      turns "navigates using the stored pageReference, unmodified" red, so the verbatim path is
      genuinely load-bearing and genuinely guarded.

- [x] false positive — that the modifier-key guard is incomplete with respect to middle-click.
      `navigatorItem.html` binds only `onclick`; there is no `onauxclick` and no `onmousedown`, so
      a middle-click never reaches this component's JS and `evt.button` has nothing to test. The
      Build worker's reasoning above is correct as stated. The dependency on `href` being present
      is a separate finding, recorded above.

- [x] false positive — `--slds-c-*` / `--slds-s-*` / `--lwc-*` / `--sds-*` authoring, a
      `prefers-color-scheme` query, or JS colour-mode logic. `grep` for all six patterns across
      `force-app/` returns nothing. The linter does not catch `--slds-c-*`, so this was checked by
      hand rather than trusted to the gate.

- [x] false positive — that any of the CSS uses one of the 38 colour hooks that carry no
      `light-dark()` and so freeze in dark mode. Checked every colour hook in both stylesheets
      against `@salesforce-ux/sds-metadata`'s `globalStylingHooksMetadata.global`: all four —
      `error-container-1`, `on-error-1`, `border-2`, `surface-container-1`, `surface-container-2`,
      `on-surface-2` — resolve to a `light-dark(...)` value under Cosmos (e.g.
      `--slds-g-color-surface-container-1` is `light-dark(#fff, #242424)`). None is a
      `palette-*`, a `*-base-50`/`*-base-100`, `accent-container-1`, a `disabled` or an
      `accent-light-*`/`accent-dark-*`. Note this is orthogonal to the wrong-fallback finding
      above: the hooks are right, the fallbacks behind two of them are not.

- [x] false positive — that the jest mock or its `moduleNameMapper` entry could reach a packaged
      org. `sfdx-project.json` declares exactly one package directory, `force-app`, and the mock
      lives at repo-root `test/jest-mocks/lightning/navigation.js`, outside it; `.forceignore`
      additionally excludes `**/jest.config.js` and `**/__tests__/**`. The mapper resolves
      correctly — the navigation assertions only pass because the recording mock, not the built-in
      no-op stub, is in use.

- [x] false positive — that the shipped metadata diverges from what the spec verified. Read in
      full: `salesforceNavigator.js-meta.xml` has `<apiVersion>67.0</apiVersion>`,
      `<isExposed>true</isExposed>` and all three targets, with `<supportedFormFactors>` confined
      to a `targetConfig` for `lightning__AppPage,lightning__HomePage` and no `targetConfig` and no
      `<property>` for `lightning__Tab` — matching the spec's "server-enforced, confirmed by a
      failed validation deploy". The `CustomTab` carries `<label>`, `<motif>` and `<lwcComponent>`
      with no Aura wrapper. The decomposed permission set puts tab settings at
      `permissionsets/Salesforce_Navigator_User/objectSettings/Salesforce_Navigator.objectSettings-meta.xml`
      with a root `<PermissionSet>` carrying no `xmlns` and `<visibility>Visible</visibility>`,
      exactly the path and value the spec's *What an administrator must do* specifies.

- [x] false positive — that leaving criterion 3 wholly unticked is the wrong call. Agreed with the
      Build worker's reasoning, and the first half is genuinely established: the component renders
      `data.navItems` verbatim with no client-side filtering of its own, and the request is pinned
      to `scope: "visible"` in `NAV_ITEMS_CONFIG`, so the rendered set is by construction whatever
      the platform already scoped to the running user — corroborated by the live 111 -> 112 delta.
      The second half names the App Launcher's All Items list as the ceiling, and the spec's own
      *Known unverified* records that no API is documented as its backing source. A criterion is
      met or it is not; half-established is not met, and ticking it would assert the unverifiable
      half. Left unticked, as instructed and as deserved.
