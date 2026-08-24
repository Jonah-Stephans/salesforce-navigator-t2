---
type: feature
upstream: []
intent_accepted: true
---

# Salesforce Navigator — personal tab layouts

## Intent

The App Launcher's All Items list is the only place a user can see everything they can reach, and it
presents that access as one flat, alphabetised list under Salesforce's own labels — so a user who
works across a stable set of tabs pays a search-and-scan cost on every navigation and has no way to
express how they actually group their work. The Salesforce Navigator is a portable Lightning web
component, surfaced through its own tab that can be placed at the front of any app and droppable on
an App or Home page, which shows the same tabs the running user can see in the App Launcher —
scoped to that user's access and never wider — arranged into named sections the user controls. A
section is a card holding a chosen set of items at a chosen column count; items can be dragged
within and between sections, renamed to the user's own wording, and clicked to navigate straight to
the tab. A user keeps as many named layouts as they like and switches between them, and the whole
component reads as native platform UI in both light and dark mode.

## Outcomes

- The component renders only tabs the running user can see in the App Launcher's All Items list; a
  tab the user cannot access never appears, and the rendered set is never wider than that list.
- The component is reachable as its own tab that an administrator can place at the front of any app,
  and is available in the Lightning App Builder component palette for both App pages and the Home
  page.
- A user can create a named section and set its column count; the section renders its items in that
  number of columns.
- A user can drag an item to a new position within its section, and drag an item from one section
  into another; both placements survive a page reload and a new session.
- A user can rename an item to their own wording; the renamed label is displayed in place of the
  Salesforce label, and the item still navigates to the same tab.
- Clicking an item navigates the user to that tab.
- A user can save more than one named layout and switch which one is active; switching re-renders
  the sections, items, column counts and renames belonging to the selected layout.
- Every layout, section, item placement, column count and rename is stored against the individual
  user, and is neither visible to nor alterable by another user.
- All colour, spacing and typography come from SLDS 2 global styling hooks, with no hard-coded
  colour values, and the component renders correctly under the Cosmos theme in both light and dark
  mode.

## Out of scope

- An administrator-authored org-wide default layout that users start from, together with its admin
  surface, permission gating and publish lifecycle. That is a separate spec, reached by running
  `dev-path:initiate` again.
- Any mechanism that widens the visible tab set beyond the running user's own App Launcher access.
- Sharing, copying or transferring a layout between users.
- Changing the App Launcher itself, or changing the org's own tab labels — a rename is the user's own
  wording, local to their layout.
- Themes other than Cosmos, and any styling route that bypasses SLDS 2 global styling hooks.

## Current state

**The repo is greenfield.** `force-app/` holds one file, `.gitkeep`. There is no Apex, no LWC, no
metadata of any kind, and no other spec on any branch — so there is no contention report to read and
no neighbour's intent to avoid building on. Everything below is either what the *platform* already
provides or what this repo's own scaffolding already dictates.

Surveyed 2026-08-24, one researcher per Outcome, dispatched as: tab enumeration (Outcome 1) · tab and
App Builder exposure (Outcome 2) · sections, columns and drag (Outcomes 3–4) · per-user persistence
(Outcome 8) · navigation and rename (Outcomes 5–6) · SLDS 2 and Cosmos (Outcome 9). Findings verified
against a live org or a live toolchain are marked **verified**; the rest are documentation-grounded.

### What this repo already dictates

- `.claude/rules/rstk-slds2-ux-standards.md` is a written SLDS 2 house standard: `--slds-g-*` hooks
  only, the surface / surface-container / on-surface stacking, spacing hooks (4-point grid) for
  margin and padding but *sizing* hooks (8-point grid) for width and height, `radius-border-2` for
  cards, and SLDS 2's breaking change that cards carry no border. Outcome 9 is not greenfield; it has
  a standard to conform to.
- `.claude/rules/rstk-lwc-standards.md` bans new Aura components, bans manually constructed URLs
  ("use `lightning-navigation`"), requires third-party JS via static resource, and requires `lwc:if`.
- `.claude/rules/rstk-testing.md` is hook-enforced at SubagentStop: `Assert.*` with a message as the
  last parameter, `System.assert*` banned, a 200-record bulk test required of any Apex class carrying
  DML, and a `System.runAs` permission test required of any `with sharing` class.
- `.claude/rules/rstk-security.md` is scanner-enforced: all new SOQL `WITH USER_MODE`, all new DML
  `AccessLevel.USER_MODE`.
- `.github/workflows/pr-checks.yml` runs five jobs on non-draft pull requests, including the jest
  suite and a no-debug-statements grep over added `force-app` lines. The deploy gate is **declared
  but unexercised** — the repo holds no CI org credential and the workflow annotates itself so the
  skip cannot be read as a pass.
- `.forceignore` excludes `**.profile-meta.xml`, which forecloses the profile route to tab
  visibility and forces permission sets.
- `sfdx-project.json` is `sourceApiVersion 66.0`, `"namespace": ""`, and sets
  `decomposePermissionSetBeta2` — which changes the on-disk shape of any permission set this spec
  ships.
- `npm run lint` globs only `**/{aura,lwc}/**/*.js`. **No CSS or HTML in this repo is linted at all.**
- `jest.config.js` carries no `moduleNameMapper`, so `lightning/navigation` resolves to the
  sfdx-lwc-jest built-in stub, whose `Navigate` is a no-op that records nothing. **The repo cannot
  assert navigation today.**

### Outcome 1 — enumerating the user's tabs

**No platform API is documented as the backing source of the App Launcher's All Items list.** Four
candidates exist and they disagree about the same user in the same org. The closest Salesforce
statement is that the "All Tabs" app "honors the user's existing tab visibility settings and is
functionally equivalent to … the All Items menu in Lightning Experience" — which makes All Items
≡ *tabs whose tab setting is not Hidden for this user*. Whether any of these APIs matches that
predicate exactly is **not stated anywhere** and would need empirical confirmation against a
standard user.

| Source | Status | User-scoped | Gives | Misses |
| --- | --- | --- | --- | --- |
| `TabDefinition` (Object Reference) | GA, API 43.0+ | yes, per docs | `Name` (the `standard-Account` form), `Label`, `SobjectName`, `IsCustom`, `Url`, the `IsAvailableIn*` flags | no icon, no colour, no `pageReference` |
| `getNavItems` (`lightning/uiAppsApi`) | **Beta** | yes, runs in the user's session | a ready-made `pageReference`, `itemType`, `objectApiName`, `developerName` | Beta disclaimer; `pageSize` caps at 100 so pagination is mandatory |
| `Schema.describeTabs()` | GA | yes | labels, URLs, icons, colours | **excludes Lightning page tabs** and tabs the user hid via All Tabs (+); walks apps→tabs so a tab in no app is unreachable; duplicates per app |
| `AppMenuItem` | GA | — | the App Launcher's *app* tiles | not tabs at all. Its `Type` picklist is `ConnectedApplication`/`Network`/`ServiceProvider`/`TabSet` |

**Two traps worth carrying forward.**

- `TabDefinition` **exists twice**. The Object Reference object is user-scoped. The Tooling API object
  of the same name "returns all tabs available in the org" and requires *View Setup and
  Configuration* since API 45.0. Conflating them breaks this Outcome silently and in the
  over-reporting direction.
- An Apex self-callout to `/ui-api/nav-items` through a Named Credential runs as the **named
  principal, not the running user**, so it over-reports for the same reason. Only the wire adapter is
  genuinely user-scoped.

**A divergence between two researchers, unresolved and material.** The enumeration researcher
reported that `Schema.DescribeTabResult` has no `getName()`, making it a poor navigation key. The
navigation researcher **verified against a live org** that `getName()` does exist and returns
`standard-Account` / `standard-home` — despite being absent from the published Apex Reference method
list. Treat `getName()` as real but undocumented, which is its own risk.

### Outcomes 5–6 — navigating, and what a rename must not touch

**Verified against a live org (174 nav items, API v66.0): every nav item carries its own populated
`pageReference`, spanning five types** — `standard__objectPage` (152), `standard__navItemPage` (12),
`standard__namedPage` (5), `standard__cmsPage` (3), `standard__directCmpReference` (2). **Two of
those five are not on the documented PageReference Types page at all.** Any hand-derived branch would
silently break those tabs.

The practical branch rule, corrected by live data, is **object tab vs. not** — not custom vs.
standard. The platform does emit `standard__navItemPage` for standard *non-object* tabs
(`standard-ActionHub`, `standard-ShieldHome`), but never for an object tab; `Account` gets
`standard__objectPage` with `actionName: 'home'`.

Consequence for the rename Outcome: if the stored item keeps `developerName` plus the user's rename
and renders `customLabel ?? platformLabel`, then the rename touches a display field only and the
navigation target is a separate untouched field. The Outcome is then structurally safe rather than
safe by care.

`NavigationMixin.GenerateUrl` supports real `<a href>` anchors with client-side navigation on plain
click. Salesforce's own sample calls `preventDefault()` unconditionally, so honouring
ctrl/cmd/shift-click requires guarding on `evt.metaKey || evt.ctrlKey || evt.shiftKey`.

**Icons have no good answer.** There is no supported API returning an SLDS icon name. `getObjectInfo`'s
`themeInfo` carries exactly two fields, `color` and a versioned PNG `iconUrl` — deriving
`standard:account` means parsing an undocumented internal path (`t4v35`). `lightning-icon`'s `src`
accepts only a static-resource SVG sprite fragment, not a PNG URL. And **verified: `iconUrl` and
`color` came back null on all 174 nav items** in a fresh scratch org, so the nav-items icon fields are
not dependable. Naive `standard:` + lowercased API name breaks often (`Product2`→`product`,
`Order`→`orders`, `Asset`→`asset_object`), and custom objects get an unpredictable `custom:customNN`.

### Outcomes 3–4 — sections, columns and dragging

- **Lightning Web Security is current and does not restrict drag and drop.** All 137 distortions in
  `@locker/distortion` were reviewed; the only DnD-adjacent entry is `DataTransfer.moz*`, Firefox-only.
  `DragEvent`, `DataTransfer.setData/getData`, `effectAllowed`, `dropEffect` and pointer events are
  untouched.
- **Event retargeting is real — verified** under this repo's own jest setup. A composed `dragstart`
  from a div inside a child component's shadow root arrives at the parent with
  `event.target.tagName === 'C-DND-ITEM'`, the host, not the div. So `draggable` and `data-id` belong
  on the item component's *host*, or the item handles `dragstart` itself and re-emits a `CustomEvent`
  with an explicit payload.
- **`dataTransfer.getData()` returns `""` during `dragover`** in every browser, by the HTML spec's
  protected mode. Drop-target highlighting that reads `dataTransfer` on `dragover` silently gets
  nothing. Keep authoritative drag state in JS and use `setData` only as the browser handshake.
- **Third-party DnD libraries are a dead end.** LWC's own architect closed the dragula issue as
  wont-fix — the library "doesn't recognize shadow DOM encapsulation." Adopting one requires
  `lwc:dom="manual"`, which means hand-building every item's DOM and forfeiting LWC templating, and
  the library mutates DOM order behind LWC's back.
- **There is no Salesforce DnD primitive.** No `lightning/dragAndDrop` module, no base component.
  And SLDS's drag classes are nearly empty: `.slds-is-draggable` has exactly one rule in the whole
  design system, scoped to `.slds-app-launcher__tile`; `.slds-is-grabbed` only applies inside a
  dueling list or picklist; `.slds-has-drag*` only inside a file-selector dropzone. Putting these on a
  card yields zero styling.
- **Accessibility has a first-party answer** — `salesforce-ux/dnd-a11y-patterns`, by Salesforce's own
  accessibility lead. Reorder *within* a list is Space to grab, arrows to move, Space to drop, Escape
  to cancel, with an `aria-live="assertive"` region and an `aria-describedby` instruction node
  attached only while grabbed. Moving *between* lists uses a **different** pattern: arrow keys
  deliberately do not cross containers, and each item instead gets a **Move button opening a menu of
  destination lists**. `aria-grabbed`/`aria-dropeffect` are deprecated in ARIA 1.1+ and the reference
  implementation does not use them.
- **Dynamic column count does not require inline styles**, and should not use them. `lightning-layout`
  cannot express 5 or 7 columns (`size` is a 1–12 integer span). CSS Grid with a computed class name
  (`cols-1` … `cols-6`) is the cleanest route and, notably, `grid-template-columns` and `repeat()`
  are **not** in the SLDS linter's validated-property list — whereas an inline `style="width: 33%"`
  **would** be flagged, because `width` is. The styling rule actively pushes toward computed classes.

### Outcome 8 — where layouts live

**The Outcome cannot be literally satisfied as written.** "Neither visible to nor alterable by another
user" holds against peers but not against an administrator: `Modify All Data` ships on the System
Administrator profile and ignores sharing entirely, and an admin can additionally log in as the user,
report on the object, or run a Data Export. Shield Platform Encryption does not close this — it
decrypts for anyone holding *View Encrypted Data*. No store on this platform is invisible to an org
admin. The one option that is — browser `localStorage` — fails the Outcome in the opposite direction,
because it is scoped to a browser profile rather than a user: two people sharing a kiosk share
layouts, and a new machine, an incognito window or an LWS configuration change loses everything
silently.

Ranked, with the reasoning:

1. **Custom object, OWD Private, `OwnerId` = the user, one record per layout carrying a JSON payload.**
   Survives a package upgrade natively (subscriber rows are subscriber data). Long Text Area holds
   131,072 characters. One thing people forget: **uncheck "Grant Access Using Hierarchies"** — with
   it on, which is the default, every manager above the owner sees their reports' layouts.
2. **Platform Cache session partition in front of it** — optional, only if latency proves a problem,
   never the source of truth.
3. **Custom field on `User`** — viable fallback whose one real edge is surviving a Developer sandbox
   refresh, where a custom object's rows do not. Loses on mixed DML (`User` is a setup sObject),
   on permissions (writing User records wants *Manage Internal Users*, so safety collapses onto never
   forgetting `WHERE Id = :UserInfo.getUserId()`), and on one-blob-for-all-layouts.
4. **`localStorage`** — first-paint optimisation only, never the store.
5. **Hierarchy Custom Settings — rule out.** They look right and are the worst option. There is *no*
   isolation: `SetupOwnerId` scopes which row `getInstance()` resolves to, not which rows a user can
   read, and "protected" only bites inside a managed package. No Long Text Area (255 characters per
   Text field). And a shared org-wide cap that takes every other custom-setting-dependent feature in
   the org down with it when it blows.
6. **Platform Cache as the store — rule out.** Session cache expires when the session does, which is
   precisely the Outcome's durability requirement inverted; org cache is org-wide and readable by any
   Apex in the namespace.
7. **Custom Metadata Types — rule out.** Org configuration, written by asynchronous *deployment* via
   the Apex Metadata API, requiring *Customize Application*. A drag that fires a metadata deployment
   is not shippable. No per-user dimension exists.

**The shape question, with the arithmetic.** For 4 layouts × 6 sections × 12 items:

| Model | records/user | 5,000 users |
| --- | --- | --- |
| Fully normalised Layout→Section→Item | 316 | 1,580,000 records / ~3.0 GB |
| One record per layout + JSON payload | 4 | 20,000 records / ~39 MB |

A 79× record-count difference, and the DML gap is worse: one drag across sections renumbers both, so
a normalised save is up to 72 upserts plus a delete pass, versus one `update`. SOQL also supports only
one level of parent-to-child subquery from the root, so Layout→Section→Item cannot be fetched in a
single rooted query. The blob's cost is that the platform will not migrate the inside of a Long Text
Area across a package upgrade — which is why a `Schema_Version__c` field and a versioned deserializer
are not optional if the blob is chosen.

**One storage decision that also answers an open question.** Store only `{id, order, col?, rename?}`
per item and resolve labels live from the tab metadata on every render. An org relabelling a tab then
propagates automatically, and "what happens when a user loses access to a tab" is answered at render
time by intersecting stored ids against the live accessible set — never by mutating stored data.
Which is what Outcome 1 requires anyway.

**Known consequence to accept or reject:** Developer and Developer Pro sandboxes are
configuration-only and exclude custom object records, so every user's layouts vanish on a Dev sandbox
refresh. Partial Copy (with a matching template) and Full sandboxes carry them.

### Outcome 9 — SLDS 2, Cosmos and dark mode

**Dark mode is free, and the component must do nothing to get it.** Confirmed from Salesforce's own
shipped metadata rather than prose: `@salesforce-ux/sds-metadata` carries 503 global hooks, each with
an `slds` (SLDS 1) and a `cosmos` (SLDS 2) value, and under Cosmos the colour hooks are authored as
the CSS `light-dark()` function — `--slds-g-color-surface-1` is `light-dark(#fff, #242424)`. 275 of
the 503 use it. The platform sets a colour-scheme class at the root (`slds-color-scheme--light`,
`--dark`, `--system`) and `light-dark()` resolves off it. Spacing, sizing, font-scale, radius and
shadow hooks are deliberately mode-invariant.

Two things the component must therefore **not** do: no `prefers-color-scheme` media query — the
user's setting is Light / Dark / **System**, and a hand-rolled query would override an explicit
"Light" choice on a dark OS — and no JS colour-mode logic of any kind.

**But using a hook is necessary and not sufficient. 38 colour hooks have no `light-dark()`** and stay
fixed in dark mode: every `--slds-g-color-palette-*-50`, every `*-base-50`/`*-base-100`,
`--slds-g-color-accent-container-1`, the `disabled` family, `accent-light-*`/`accent-dark-*`, and
`--slds-g-color-border-success-1/2`. They look like compliance and behave like a hard-coded colour.
Author against the semantic hooks only.

Namespaces: `--slds-g-*` is the only authoring target. **`--slds-c-*` component hooks are unsupported
under SLDS 2** per the LWC Developer Guide, and 210 of them are in `deprecatedStylingHooks.json` —
and the linter does **not** catch their use. `--slds-s-*` (110 shared/scoped hooks) is Salesforce-owned
and read-only. `--lwc-*` / `--sds-*` are deprecated, and `lwc-token-to-slds-hook` is an **error**.
Our own custom properties must not use the `--slds`/`--sds` prefix.

**The linter exists and has a CI trap.** `@salesforce-ux/slds-linter` v1.2.1 (built on
`@salesforce-ux/eslint-plugin-slds`; the older `stylelint-plugin-slds` is stale and superseded). Run
against a deliberately dirty component it **caught** hex values, the `white` keyword, `font-weight:
bold`, `1px` borders, `--lwc-*`, `--sds-*`, deprecated hooks, `.slds-card__header` overrides,
double-dash BEM, and bare `var()` without a fallback. It **missed** `box-shadow` with literal
`rgba(0,0,0,…)`, `!important`, `background-image: url(...)`, `filter: invert()`, and `--slds-c-*`
entirely. **Hard-coded colour values are severity *warning* by default, and warnings exit 0** — so a
naive `slds-linter lint` job goes green on a component made entirely of hex codes. The two routes
that work, both verified: fold `sldsCssPlugin()` into this repo's existing flat `eslint.config.js`
and run `eslint --max-warnings 0`, or emit SARIF and fail on a non-zero result count.

**Base components adopt SLDS 2 automatically** — "no action required… the only exception is if you
applied custom CSS overrides." Composing from `lightning-card` etc. is the cheapest route to native
appearance, and the failure mode is entirely self-inflicted.

**CSS custom properties traverse shadow boundaries** (confirmed in the LWC Developer Guide), which is
the whole reason the global-hook model reaches into every component regardless of synthetic vs native
shadow DOM.

**Divergences from this repo's own rule files, found by the researcher:**

- `rstk-lwc-standards.md` says "Follow SLDS design tokens for colors, spacing, and typography."
  Design tokens are the deprecated `--lwc-*` mechanism and `lwc-token-to-slds-hook` is an
  **error**-severity rule. That line is wrong as written.
- `rstk-slds2-ux-standards.md` shows bare `var(--slds-g-color-on-surface-1)` throughout; the linter
  fires `no-slds-var-without-fallback` on every one of them and wants
  `var(--slds-g-color-on-surface-1, #747474)`. A genuine house-rule-versus-tool conflict that has to
  be settled before any CSS is written.
- `--slds-g-color-border-info-1` does not exist, despite the house rule asserting every feedback
  state has a border variant. Neither does `--slds-g-color-neutral-100` (Trailhead's own dark-mode
  module recommends it); the real hook is `--slds-g-color-neutral-base-100`.
- The house rule lists `--slds-g-shadow-1..4` but omits the four focus-ring hooks
  (`--slds-g-shadow-outline-focus-1`, `-inset-focus-1`, `-outset-focus-1`,
  `-inset-inverse-focus-1`) — which are exactly the ones a keyboard-driven Navigator needs.
- The four-weight font restriction is house policy, not a platform constraint; the linter's own
  autofix suggests `--slds-g-font-weight-bold`, which the house rule does not list.

**Enablement, which gates any visual verification:** Setup → Themes and Branding → activate Salesforce
Cosmos, tick "Let users enable Dark Mode", then each user picks a Color Mode. SLDS 2 went GA in
Winter '26 and is on by default for new orgs. **Dark mode is documented as Beta**, and is not
supported in Setup. SLDS 2 is **not available on Experience Cloud** at all.

### Outcome 2 — the tab and the App Builder palette

**Verified by validate-only dry-run deploys against a live scratch org at API 66.0**, including
deliberately broken variants to make the server state its own requirements. The whole set validated
*Succeeded*.

- **`CustomTab` points directly at an LWC** via `<lwcComponent>` — no Aura wrapper, no FlexiPage
  required, which keeps the house ban on new Aura components intact. `<label>` is **required**
  (the Metadata API doc claims it is "for web tabs only" — that is wrong for LWC tabs) and `<motif>`
  is **required**. `<lwcComponent>` takes the bare bundle name, and the filename *is* the tab API
  name — the same string the permission set and `standard__navItemPage` both reference.
- **`js-meta.xml`** needs `<isExposed>true</isExposed>` plus all three targets: `lightning__Tab`,
  `lightning__AppPage`, `lightning__HomePage`. `<apiVersion>` is mandatory since Spring '25.
- **`targetConfigs` are asymmetric, and the asymmetry is server-enforced.** `lightning__Tab` rejects
  both `<property>` and `<supportedFormFactors>`; App page and Home page accept both and can share
  one `targetConfig`. Every declared property must have a matching `@api` in the JS.
- **"At the front of any app" cannot ship as source.** `CustomApplication` deploys as a *full replace*
  of the nav list — there is no append verb — so shipping `standard__Sales.app-meta.xml` would clobber
  whatever navigation the customer's admin configured. And "any app" is unbounded, so it cannot be
  enumerated in source anyway. This is an admin step in Setup → App Manager → Navigation Items.
- **Permission sets are the only shippable visibility route**, since `.forceignore` excludes profiles.
  Because `decomposePermissionSetBeta2` is on, this is not one file: the tab settings land in
  `permissionsets/<Name>/objectSettings/<TabName>.objectSettings-meta.xml` — named after the *tab*,
  in a directory called `objectSettings` even though a tab is not an object — with a root
  `<PermissionSet>` element carrying no `xmlns`. `PermissionSetTabVisibility` accepts only `None`,
  `Available`, `Visible`; `DefaultOn` is Profile-only and is rejected outright.
- **A seam between the Outcome and what source can deliver:** a permission set still has to be
  *assigned*, and `PermissionSetAssignment` is data, not metadata. The only mechanism that turns a tab
  on for every user with no admin action is profile tab visibility, which `.forceignore` blocks. So
  "available to any user" bottoms out in a documented admin step.
- **A tab gets materially less context than an App page.** `lightning__Tab` renders the component
  directly with no FlexiPage wrapper: no App Builder page for admins to configure, no sibling
  components, no component visibility filters, no design-time properties at all, no form-factor
  gating, and **no `recordId`**. The only page-level context is `CurrentPageReference`, which on a tab
  is `{type: 'standard__navItemPage', attributes: {apiName: '<TabName>'}, state: {…}}`.

### Testing — what can actually be asserted

**Verified against this repo's real toolchain** (`@salesforce/sfdx-lwc-jest@7.9.0` → jsdom 20.0.3):

- The drag *interaction* is **not** unit-testable. `DragEvent`, `DataTransfer`, `DataTransferItem`,
  `PointerEvent` and `ResizeObserver` are all undefined; `getBoundingClientRect()` returns zeros;
  `document.elementFromPoint` throws. jsdom will never simulate a real dragstart→dragover→drop.
- But more works than folklore suggests. A hand-rolled `CustomEvent('dragstart', {bubbles, composed})`
  with a fake `dataTransfer` defined via `Object.defineProperty` **does** fire the declarative
  `ondragstart` binding, and `event.target.dataset.id`, `currentTarget`, `preventDefault()` and
  `draggable` reflection all behave correctly. The payload round-tripped through a fake
  `dataTransfer` from `dragstart` to `drop`.
- `@lwc/jest-preset` loads `@lwc/synthetic-shadow` by default, so tests run in the same synthetic-shadow
  mode as Lightning Experience and **retargeting reproduces faithfully in jest**.
- The reorder *logic* is trivially testable as a pure function, and that is where the seam belongs.
- **Navigation is the most assertable seam in the component, and it needs a one-time setup this repo
  does not have.** Adding the lwc-recipes `lightning/navigation` mock plus a `moduleNameMapper` entry
  makes `getNavigateCalledWith()` available, at which point one test proves Outcomes 5 and 6
  together: set a rename, assert the rendered text is the custom label *and* that the emitted
  `pageReference` is unchanged. `lightning/uiAppsApi` also ships a stub (`getNavItems` as
  `createLdsTestWireAdapter`), so tab data can be emitted into the wire in the same test. The mock
  belongs at repo-root `test/jest-mocks/`, not under `force-app/`, per this repo's own `.forceignore`
  convention that the jest harness must never reach a packaged org.

## Open questions

- Where does a user's set of layouts persist, and does that store need to survive a package upgrade?
  — owner: engineer, at Design.
- Are layouts global to the user across every placement of the component, or scoped per app or per
  placement? The arriving text says a user switches between layouts, but not whether the tab
  placement and a Home-page placement share one active layout. — owner: engineer, at Design.
- What happens to an item already saved in a section when the user loses access to that tab, or the
  tab is deleted from the org? — owner: engineer, at Design.
- What does a user with no layout yet see on first open — an empty Navigator they populate, or every
  accessible item in one starting section? — owner: engineer, at Design. Note that the org-wide
  default layout, which is the natural answer, is explicitly the second spec and cannot be depended
  on here.

## Evidence

Engineer (jstephans@rootstock.com), typed at `dev-path:initiate`, 2026-08-24:

> "The App Launcher's All Items list is the only place a user can see everything they can reach, and
> it presents that access as one flat, alphabetised list under Salesforce's own labels. A user who
> works across a stable set of tabs pays a search-and-scan cost on every navigation and has no way
> to express how they actually group their work."

> "The Salesforce Navigator is a portable Lightning web component — surfaced through its own tab
> that can be placed at the front of any app, and droppable on an App or Home page — which shows
> the same tabs the running user can see in the App Launcher, scoped to that user's access and never
> wider, arranged into named sections the user controls."

> "A section is a card holding a chosen set of items at a chosen column count; items can be dragged
> within and between sections, renamed to the user's own wording, and clicked to navigate straight
> to the tab. A user keeps as many named layouts as they like and switches between them."

> "It is styled with SLDS 2 global styling hooks under the Cosmos theme so it reads as native
> platform UI in both light and dark mode."

> "This spec is the personal-layout Navigator. An administrator authoring an org-wide default layout
> that users start from is a separate design with its own admin surface, permission gating and
> publish lifecycle; it is a second spec, reached by running dev-path:initiate again. There is no
> upstream entry on this spec to carry across to it."
