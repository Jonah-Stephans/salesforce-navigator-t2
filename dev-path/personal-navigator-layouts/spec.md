---
type: feature
upstream: []
intent_accepted: true
design_approved: true
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
the tab. Items can be removed from a layout and added back from a picker of everything the user can
reach, and sections can be renamed, deleted and reordered. A user keeps as many named layouts as
they like and switches between them, and the whole component reads as native platform UI in both
light and dark mode. Every gesture that works with a mouse works from the keyboard.

## Outcomes

- The component renders only tabs the running user can see in the App Launcher's All Items list; a
  tab the user cannot access never appears, and the rendered set is never wider than that list.
- An item whose tab the user has lost access to, or which has been deleted from the org, stops
  rendering without the stored layout being altered; if access is restored the item reappears in its
  original position.
- The component ships a `CustomTab` that surfaces it, and declares itself to the Lightning App
  Builder component palette for both App pages and the Home page.
- A user can create a named section and set its column count between one and six; the section renders
  its items in that number of columns.
- A user can rename a section, delete it, and reorder sections within the layout; deleting a section
  returns its items to the pool of items available to add, rather than discarding them.
- A user can drag an item to a new position within its section, and drag an item from one section
  into another; both placements survive a page reload and a new session.
- A user can remove an item from a layout and add it back from a picker listing every tab they can
  reach that is not already in the layout.
- A user can rename an item to their own wording; the renamed label is displayed in place of the
  Salesforce label, and the item still navigates to the same tab.
- Clicking an item navigates the user to that tab, and the item is a real link — middle-click and
  open-in-new-tab work.
- Every reorder, move, rename, removal and section operation is performable from the keyboard alone,
  with each change announced to a screen reader.
- A user with no layout yet sees every tab they can reach in one seeded section, without a layout
  record being written until they first change something.
- A user can save more than one named layout and switch which one is active; switching re-renders
  the sections, items, column counts and renames belonging to the selected layout.
- Every layout, section, item placement, column count and rename is owned by the individual user. No
  user can see or change another user's layouts through the Navigator or through ordinary record
  access — the store is Private with role-hierarchy access disabled. Users holding `View All Data` /
  `Modify All Data` retain their standard platform-wide visibility, as they do for all org data.
- All colour, spacing and typography come from SLDS 2 global styling hooks, with no hard-coded
  colour values, and the component renders correctly under the Cosmos theme in both light and dark
  mode.
- The repository can mechanically detect a hard-coded colour, spacing or typography value in this
  component's CSS, and a pull request carrying one cannot go green.

## Out of scope

- An administrator-authored org-wide default layout that users start from, together with its admin
  surface, permission gating and publish lifecycle. That is a separate spec, reached by running
  `dev-path:initiate` again.
- Any mechanism that widens the visible tab set beyond the running user's own App Launcher access.
- Sharing, copying or transferring a layout between users.
- Changing the App Launcher itself, or changing the org's own tab labels — a rename is the user's own
  wording, local to their layout.
- Themes other than Cosmos, and any styling route that bypasses SLDS 2 global styling hooks.
- **Placing the tab into any app's navigation, assigning the permission set, and unticking "Grant
  Access Using Hierarchies" on `Navigator_Layout__c`.** None can ship as source —
  `CustomApplication` deploys as a full replace of an app's nav list, `PermissionSetAssignment` is data
  rather than metadata, and the hierarchy flag is not expressible in the Metadata API under any
  spelling. All three are documented admin steps; see `## Design`, *What an administrator must do*.
  **The third is load-bearing for the isolation Outcome**, which the other two are not — it was added
  at Build on 2026-08-24 by the engineer's decision, after slice 03 proved the flag undeployable
  against a live org.
- **Icons on items.** There is no supported route from a tab to an SLDS icon name, and the nav-item
  icon fields were empty in every item observed. Items are text, which is what the All Items list
  this component improves on is already.
- **Portability of the store into a namespaced package.** This spec ships unnamespaced; see
  `## Design`, *The namespace decision*.

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

**Icons have no good answer, which is why the design has none.** There is no supported API returning
an SLDS icon name; `getObjectInfo.themeInfo` gives only a colour and a versioned PNG URL whose path
(`t4v35`) is undocumented and unstable, `lightning-icon`'s `src` will not take a PNG, and
**verified: `iconUrl` and `color` came back null on all 174 nav items** in a fresh scratch org. Items
are text. See `## Out of scope`.

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

**The winner, and the one thing people get wrong about it.** A custom object at OWD Private with
`OwnerId` = the user. Subscriber rows are subscriber data, so it survives a package upgrade natively,
and a Long Text Area holds 131,072 characters. The trap: **"Grant Access Using Hierarchies" must be
unchecked.** With it on — the default — every manager above the owner in the role hierarchy sees
their reports' layouts, which quietly breaks the isolation Outcome.

**Ruled out, and why, so nobody re-proposes them.** *Hierarchy Custom Settings* look like the natural
fit and are the worst option on the list: they have no sharing model at all (`SetupOwnerId` scopes
which row `getInstance()` resolves to, not which rows a user can read), no Long Text Area, and a
shared org-wide cap that takes every other custom-setting-dependent feature down with it. *Platform
Cache* is documented as temporary — session cache expires when the session does, which is this
Outcome's durability requirement exactly inverted. *Custom Metadata Types* are org configuration
written by asynchronous deployment requiring *Customize Application*; a drag that fires a metadata
deployment is not shippable. *A custom field on `User`* is the one real fallback — its edge is
surviving a Developer sandbox refresh — but `User` is a setup sObject, so its DML cannot be mixed
with anything else, and writing it wants *Manage Internal Users*, which collapses safety onto never
forgetting `WHERE Id = :UserInfo.getUserId()`.

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

All four questions Initiate raised were answered at Design, on 2026-08-24. They are recorded here
resolved rather than deleted, because the answers are load-bearing and the reasoning lives in
`## Design`.

- **Where do layouts persist, and must the store survive a package upgrade?** A custom object,
  `Navigator_Layout__c`, one record per layout. Yes, it must survive an upgrade, and it does so
  natively — subscriber rows are subscriber data. See *The store*.
- **Are layouts global to the user, or scoped per placement?** Global. The platform foreclosed the
  alternative: `lightning__Tab` rejects `<property>` outright, server-enforced, so a tab placement
  cannot carry a design-time scope key at all. See *One active layout, everywhere*.
- **What happens when a user loses access to a tab, or it is deleted?** It stops rendering and the
  stored layout is not touched; if access returns, so does the item, in its original position. See
  *Resolution at render time*.
- **What does a user with no layout see on first open?** Every tab they can reach, in one seeded
  section, computed and not persisted until they first change something. See *First open*.

No question remains open at the design gate.

## Design

Decided in conversation with the engineer on 2026-08-24, across two rounds of twenty-two questions.
Every decision below is the engineer's; the reasoning is recorded so a later reader can tell a
choice from an accident.

### The shape of the thing

Four LWCs and one Apex controller.

| Bundle | Owns |
| --- | --- |
| `salesforceNavigator` | the layout switcher, the active layout's state, cross-section moves, autosave |
| `navigatorSection` | one section card: its header menus, its own item ordering, its drop target |
| `navigatorItem` | one item: the anchor, the drag source, the per-item overflow menu |
| `navigatorItemPicker` | the modal for adding items back into a layout |

Plus `navigatorLayoutModel`, a plain ES module with no LWC in it, holding the pure functions —
`reorder`, the seeded-layout builder, the render-time access intersection, and the payload
(de)serialiser. This is where the tests point.

**Why the item is its own component and why that costs something.** Drag events are `composed: true`,
so they cross the shadow boundary, but they arrive **retargeted** — verified under this repo's own
jest setup, a `dragstart` from a div inside a child's shadow root reaches the parent with
`event.target` equal to the host element, not the div. So `draggable` and `data-id` go on the item's
*host*, or the item handles `dragstart` itself and re-emits a `CustomEvent` carrying an explicit
payload. The second is what we do — it keeps the parent from ever needing to see inside a child.

### Enumerating the user's tabs

`getNavItems` from `lightning/uiAppsApi`, wrapped in a single module, `navigatorTabSource`, which is
the only file in the component that knows where tab data comes from.

**This module is Beta and the wrapper is the whole mitigation.** `lightning/uiAppsApi` carries
Salesforce's "not for production use" disclaimer. It was chosen anyway, and the reasoning matters
more than the choice: the GA alternative, `TabDefinition`, gives a stable name but no
`pageReference`, so the component would hand-derive one — and a live org returned **five distinct
`pageReference` types across 174 items, two of which (`standard__cmsPage`,
`standard__directCmpReference`) are not on the documented PageReference Types page at all.** A
hand-derived branch cannot know about those and would mis-navigate them silently. The Beta label is a
supportability risk; hand-derivation is a correctness risk that fails quietly. If this must later
ship on a supported basis, `navigatorTabSource` is the one file that changes, and unsupported tab
kinds must then be **omitted rather than guessed at**.

Pagination is mandatory — `pageSize` caps at 100 and a bare scratch org already returns 174 items.

**Never reach for these two.** `TabDefinition` exists twice: the Object Reference object is
user-scoped, the Tooling API object of the same name returns every tab in the org and requires *View
Setup and Configuration*. And an Apex self-callout to `/ui-api/nav-items` through a Named Credential
runs as the **named principal, not the running user**. Both over-report, and over-reporting is the
one failure mode Outcome 1 exists to prevent.

### Navigation, and why a rename cannot break it

Each item renders as a real `<a href>`, the URL from `NavigationMixin.GenerateUrl`, with `click`
calling `NavigationMixin.Navigate` on the item's stored `pageReference` **verbatim — no branching, no
derivation**. Middle-click and open-in-new-tab therefore work. Salesforce's own sample calls
`preventDefault()` unconditionally; we guard on `evt.metaKey || evt.ctrlKey || evt.shiftKey` and let
the default through, or modifier-clicks are swallowed.

A stored item is `{ id, rename? }` where `id` is the `developerName`. The label rendered is
`rename ?? platformLabel` and the navigation target is resolved from the live tab source by `id`.
**The rename and the target are different fields, so a rename cannot reach the target.** Outcome 5 is
satisfied structurally rather than by care.

### Resolution at render time

Stored ids are intersected against the live accessible set on every render. An item whose tab the
user can no longer reach simply does not render; nothing is written, nothing is deleted, and
restoring access restores the item in place. This is also why the payload stores no labels: an org
relabelling a tab propagates on the next render for free.

### One active layout, everywhere

Layouts are global to the user. The tab placement, an App page placement and a Home page placement
all show the same active layout.

This is not only a simplicity preference. `lightning__Tab` **rejects `<property>` and
`<supportedFormFactors>` outright — server-enforced, confirmed by a failed validation deploy** — so a
tab placement cannot be given a design-time scope key. Per-placement scoping would work on two of the
three surfaces and be impossible on the third.

### The store

```
Navigator_Layout__c          OWD Private, Grant Access Using Hierarchies OFF
  OwnerId                    the user
  Name                       the layout's name
  Is_Active__c               Checkbox
  Sort_Order__c              Number
  Schema_Version__c          Number
  Layout_JSON__c             Long Text Area (131,072)
```

One record per layout. `Layout_JSON__c` holds the sections — each with a name, a column count and an
ordered list of `{ id, rename? }`. No labels, no icons, no pageReferences: everything derivable from
the platform is derived.

**Why a blob and not a normalised model.** For 4 layouts × 6 sections × 12 items, normalising costs
316 records per user against 4 — a 79× difference, ~3.0 GB against ~39 MB at 5,000 users. The DML gap
is worse: one cross-section drag renumbers both sections, so a normalised save is up to 72 upserts
plus a delete pass, against one `update`. And SOQL supports only one level of parent-to-child
subquery from the root, so Layout→Section→Item could not be read in a single rooted query anyway.

**What the blob costs, and the mitigation that is not optional.** The platform will not migrate the
inside of a Long Text Area across a package upgrade. `Schema_Version__c` and a versioned deserialiser
that reads v1 and writes v2 ship **from the first commit**, not when they are first needed. Treat the
JSON shape as a published contract — the second spec, the admin-authored org-wide default layout,
will inherit it.

`Is_Active__c` is enforced by the controller, which clears the flag on the user's other layouts in
the same transaction as it sets it.

**Accepted consequence, written down rather than discovered:** Developer and Developer Pro sandboxes
are configuration-only and exclude custom object records, so every user's layouts vanish on a Dev
sandbox refresh. Partial Copy with a matching template, and Full sandboxes, carry them.

### The namespace decision

`sfdx-project.json` is `"namespace": ""` and stays that way. **This store is therefore not portable
into a namespaced package**: `Navigator_Layout__c` would become `ns__Navigator_Layout__c` and rows
written in orgs that installed the unnamespaced version would not migrate.

This was raised as an altitude stop, because it binds a spec that does not exist yet — the second
spec stores against this same object. The engineer decided it here rather than promoting it. The
constraint, stated so the next person does not discover it the expensive way: **if packaging ever
becomes real, the namespace must be set before a single customer row exists.**

### Data access

One Apex class, `NavigatorLayoutController`, `with sharing`:

- `@AuraEnabled(cacheable=true) getLayouts()` — SOQL `WITH USER_MODE`, and an explicit
  `OwnerId = :UserInfo.getUserId()` predicate regardless. Sharing is defence in depth, never the
  filter.
- `@AuraEnabled saveLayout(...)` — DML with `AccessLevel.USER_MODE`.

Chosen over a split `lightning/uiRecordApi` write plus a separate read because the payload is a blob
rather than a form, and one seam is more assertable than two. **Consequence, flagged now rather than
at Build:** this repo's hook-enforced testing rule requires a `System.runAs` permission test because
the class is `with sharing`, and a 200-record bulk test because it carries DML. The bulk test is an
odd fit for a per-user controller; it is enforced at SubagentStop and is not negotiable.

`sourceApiVersion` moves 66.0 → 67.0, which makes user mode the default rather than something a
scanner has to catch.

### Interaction

**No edit mode.** HTML5 drag-and-drop already separates a click from a drag — a `click` only fires if
no drag occurred — so an item is permanently clickable *and* permanently draggable.

- **Item overflow menu:** Move to…, Rename…, Remove.
- **Section header:** the section name, an **Add items** button opening the picker, and an overflow
  menu carrying Rename section…, Column count (1–6), Delete section.
- **Component header:** the active layout's name as a `lightning-button-menu` listing every layout
  with the active one checked, then New layout…, Rename layout…, Delete layout….
- **Deleting a section** returns its items to the available pool; it does not discard them.
- **Sections reorder** by dragging the card, through the same `reorder` function on a different axis.

**Autosave, debounced ~1s.** A drag flurry coalesces into one `update` on one record. There is no
unsaved state to design, warn about, or lose.

**First open.** A user with no layout record sees one seeded section, "All Items", holding every tab
they can reach. It is **computed, not written** — no record exists until the user's first actual
change. Otherwise every user who opens the tab once generates a row, including those who never
customise, to store something derivable from the platform. The seeded card is long (174 items in a
bare org), which is precisely what All Items looks like today.

### Keyboard access

Salesforce's own `salesforce-ux/dnd-a11y-patterns` is adopted, and it is adopted whole because the
two halves differ:

- **Within a section:** Space to grab, arrows to move, Space to drop, Escape to cancel. An
  `aria-live="assertive"` region announces grab, each move, drop and cancel; an `aria-describedby`
  instruction node is attached **only while grabbed**; Tab is `preventDefault`ed during drag mode.
- **Between sections:** arrow keys deliberately do **not** cross containers. The item's **Move to…**
  menu is the cross-section mechanism, and it is the same menu a mouse user gets.
- `aria-grabbed` / `aria-dropeffect` are **not** used — deprecated in ARIA 1.1+, and the first-party
  reference implementation does not use them either.

Without this, two Outcomes would be mouse-only.

### Styling

Compose from base components (`lightning-card`, `lightning-button-menu`, `lightning-modal`) wherever
one exists — they adopt SLDS 2 automatically, and the only documented way to break that is our own
CSS overriding their internals, which we do not do.

**Dark mode requires no code.** Under Cosmos the colour hooks are authored as CSS `light-dark()` —
`--slds-g-color-surface-1` is `light-dark(#fff, #242424)` — and the platform sets the colour-scheme
class at the root. Two prohibitions follow, both of which would look like diligence: **no
`prefers-color-scheme` media query** (the user's setting is Light / Dark / **System**, and a
hand-rolled query overrides an explicit "Light" choice on a dark OS) and **no JS colour-mode logic**.

**Use semantic hooks only.** 38 colour hooks have no `light-dark()` and stay fixed in dark mode — the
`--slds-g-color-palette-*` ramps, every `*-base-50`/`*-base-100`, `--slds-g-color-accent-container-1`,
the `disabled` family. They pass a "uses a hook" check and behave like a hard-coded colour.
`--slds-c-*` component hooks are unsupported under SLDS 2 **and the linter does not catch them**, so
that one is on review. Our own custom properties are prefixed `--rstk-nav-`.

**Column count is a computed class**, `cols-1` … `cols-6`, each a CSS Grid
`repeat(N, minmax(0, 1fr))`. Not `lightning-layout`, which cannot express 5 columns; and not an
inline style, which the linter would flag — it validates `width` but not `grid-template-columns`.

Focus rings use `--slds-g-shadow-outline-focus-1` and its siblings rather than a hand-rolled outline,
which would fail contrast in one mode.

### Making Outcome 9 verifiable

Outcome 9 is currently unverifiable in this repo: `npm run lint` globs only `**/{aura,lwc}/**/*.js`,
so no CSS or HTML is linted at all. This spec closes that:

1. Add `sldsCssPlugin()` from `@salesforce-ux/eslint-plugin-slds` to the existing flat
   `eslint.config.js`, scoped to `**/lwc/**/*.{css,html}`.
2. Add one `pr-checks.yml` job running `eslint --max-warnings 0`, matching the house style of one
   independent job per entry with the `draft == false` guard.

**`--max-warnings 0` is the load-bearing part.** The linter defaults hard-coded colour values to
severity *warning*, and warnings exit 0 — so the obvious `slds-linter lint` job goes green on a
component made entirely of hex codes.

Two house-rule corrections ship with it, because a rule that fails the lint it encodes will mislead
every future spec:

- `rstk-lwc-standards.md` — "Follow SLDS design tokens" names the deprecated `--lwc-*` mechanism, and
  `lwc-token-to-slds-hook` is an **error**-severity rule. Change to SLDS 2 global styling hooks.
- `rstk-slds2-ux-standards.md` — its examples use bare `var(--hook)`; the linter requires a fallback.
  Adopt the fallback form. Also: `--slds-g-color-border-info-1` does not exist, and the four
  focus-ring hooks are missing from the shadow list.

### What an administrator must do

Neither of these can ship as source, and both are now in `## Out of scope` as admin steps:

1. **Place the tab in an app.** Setup → App Manager → Edit → Navigation Items. `CustomApplication`
   deploys as a **full replace** of an app's nav list — there is no append verb — so shipping one
   would clobber the customer admin's own navigation.
2. **Assign the permission set.** `PermissionSetAssignment` is data, not metadata. The only
   no-admin-action route is profile tab visibility, which this repo's `.forceignore` blocks.
3. **Untick "Grant Access Using Hierarchies" on Navigator Layout.** Setup → Sharing Settings →
   Organization-Wide Defaults. **This one differs from the other two: it is load-bearing for an
   Outcome, not just for reach.** Until it is performed, every manager above a user in the role
   hierarchy can read that user's layouts through ordinary record access, and the isolation Outcome is
   not met in that org.

   Added at Build on 2026-08-24, by the engineer's decision, after slice 03 established against a live
   org at API 67.0 that the flag is not expressible in the Metadata API at all: the server round-trips
   `CustomObject` emitting no hierarchy element, `SharingSettings` carries nothing per-object, and
   dry-run deploys of four candidate element names each failed with the *identical* error a
   deliberately bogus control element produced. It is Setup-only under every spelling.

   **The Navigator itself is safe either way**, which is what makes this a documented step rather than
   a hole: `NavigatorLayoutController.getLayouts()` filters on `OwnerId = :UserInfo.getUserId()`
   explicitly, in addition to running `WITH USER_MODE`, so the component never renders one user's
   layout to another regardless of the sharing setting. The exposure this step closes is through
   reports, list views and the API.

What *does* ship: the `CustomTab` (`<lwcComponent>` pointing straight at the bundle — no Aura
wrapper, so the house ban holds; `<label>` and `<motif>` both required), the `js-meta.xml` with
`<isExposed>true</isExposed>` and all three targets, and a decomposed permission set whose tab
settings land at `permissionsets/<Name>/objectSettings/<TabName>.objectSettings-meta.xml` with
visibility `Visible` (`DefaultOn` is Profile-only and is rejected outright).

### Test entry points

Two, because there are two genuinely different paths.

1. **`c-salesforce-navigator`** — the component, driven through jest with the `lightning/navigation`
   mock and `getNavItems` as an LDS test wire adapter. One test proves Outcomes 5 and 6 together: set
   a rename, assert the rendered text is the custom label **and** that the emitted `pageReference` is
   unchanged.
2. **`navigatorLayoutModel`** — the pure module, for placement maths, seeding, access intersection
   and payload round-tripping. Both the mouse path and the keyboard path call the same `reorder`.

`NavigatorLayoutController` is driven directly by Apex tests under `System.runAs`.

**One-time repo change this requires:** the lwc-recipes `lightning/navigation` mock plus a
`moduleNameMapper` entry, placed at repo-root `test/jest-mocks/` and **not** under `force-app/`, per
this repo's own `.forceignore` convention that the jest harness must never reach a packaged org.
Without it `lightning/navigation` resolves to the built-in stub, whose `Navigate` is a no-op that
records nothing — the repo cannot assert navigation today.

**The honest ceiling.** jsdom has no `DragEvent` and no `DataTransfer`; `getBoundingClientRect()`
returns zeros and `elementFromPoint` throws. The drag *gesture* is not unit-testable. The handlers
and the resulting model are, via a hand-rolled `CustomEvent` with a fake `dataTransfer`. Anything
claiming to test the gesture itself needs a browser driver against a real org, which is not in this
spec.

### Known unverified

- **No API is documented as the backing source of the All Items list.** All Items ≡ *tabs whose tab
  setting is not Hidden for this user* is inferred from a Help article, not stated. Whether
  `getNavItems` matches that predicate exactly should be confirmed empirically against a
  non-administrator before Outcome 1 is called done.
- **Dark mode is itself documented as Beta**, and is not supported in Setup. SLDS 2 is not available
  on Experience Cloud at all — if this component is ever pointed at a site, Outcome 9 is unachievable
  there.
- **`dataTransfer.setDragImage()` was broken under Locker** and it is unconfirmed whether LWS fixed
  it. Only matters if the design later wants to suppress the browser's default drag ghost.

### Next act on the surface

A cheap HTML sketch was agreed for the section header, the item overflow menu, the picker and the
empty-section state — the "what should this do" questions. `dev-path:sketch`, pointed at this slug,
in a parallel session. It does not block the gate, and it is deliberately *not* a facsimile of
Lightning: density and native feel are not in dispute, and a facsimile would only collect feedback on
its own inaccuracies.

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

Engineer (jstephans@rootstock.com), at `dev-path:technical-design`, 2026-08-24, to round 1 (Q1–Q13:
the isolation Outcome's rewording, the admin-step split, first-open seeding, global layout scope,
render-time access resolution, `getNavItems` behind an adapter, the JSON payload shape, the API
version bump, the namespace altitude stop, text-only items, the accessibility pattern, the SLDS lint
gap, and the test entry points):

> "Agree with your recommendation on all of these."

Engineer (jstephans@rootstock.com), at `dev-path:technical-design`, 2026-08-24, to round 2 (Q14–Q22:
no edit mode, the layout switcher, the item picker, the column range, section operations, autosave,
compute-don't-write on first open, one Apex controller, and the sketch detour):

> "Agree with your recommendation on all of these."
