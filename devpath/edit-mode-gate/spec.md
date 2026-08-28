---
type: feature
upstream: []
intent_accepted: true
---

# Gate Navigator customization behind an edit mode

## Intent
The Navigator's sections are permanently in edit mode: resize handles, add-column
affordances and move controls are on the page whether or not the user intends to
customise anything. That makes the page read as unfinished and it puts visual
clutter between the user and the thing they actually came for, which is getting
somewhere fast. Put every customisation control behind an explicit edit mode,
entered from a small affordance in the top right. Out of edit mode the Navigator
is display-only: links and nothing else. Navigation becomes the page's primary
purpose and modification becomes its secondary one.

## Outcomes
- O1 — Out of edit mode the Navigator renders no customisation control: no resize handle, no add-column affordance, no move or reorder handle
- O2 — An edit affordance sits in the top right and is the only customisation control visible out of edit mode
- O3 — Activating the edit affordance reveals the customisation controls; leaving edit mode hides them again
- O4 — Column resizing is available in edit mode and unavailable out of it
- O5 — Adding and removing columns is available in edit mode and unavailable out of it
- O6 — Moving or reordering items is available in edit mode and unavailable out of it
- O7 — Navigation links are clickable and navigate correctly out of edit mode
- O8 — Customisations made in edit mode survive leaving edit mode and a page reload

## Out of scope
- Adding, removing or changing any customisation capability the Navigator already has — this spec changes when the controls are reachable, not what they do
- Changing where or how customisations are stored
- Restyling the navigation content itself beyond removing the controls from the display view

## Open questions
- Is edit mode one page-wide state, or one per section? "the Navigator sections" is plural and "a little pencil in the top right" is singular. — owner: Jonah
- Does leaving edit mode need an explicit save, or do changes apply as they are made? O8 asks only that they survive; it does not choose between the two. — owner: Jonah
- Is there a discard or cancel path out of edit mode, or is exiting always a commit? — owner: Jonah
- Should edit mode persist across page loads for a user who left it on, or does every load start display-only? — owner: Jonah

## Current state
- O1 — Every customisation affordance is permanently in the DOM. Nothing is hover-revealed and
  nothing is CSS-hidden: every `:hover` rule in the four stylesheets changes `background-color`
  only, never `opacity` or `visibility`. Full inventory — layout switcher menu and "New section"
  button (`salesforceNavigator.html:13-53`); per-section "Add items" button, overflow menu
  (Rename… / Column count 1-6 / Delete section) and `draggable="true"` on the card
  (`navigatorSection.html:8,62-98`); per-item overflow menu (Rename… / Remove / Move to…) and
  `draggable="true"` on the anchor (`navigatorItem.html:29,62-86`). Only the first two are gated
  at all, behind `lwc:if={canEdit}` — and `canEdit` (`salesforceNavigator.js:907`) is
  `hasItems && !hasLayoutLoadError`, a data-readiness flag, not a user-controlled mode. The one
  existing precedent for removing a control from the DOM rather than hiding it is `isRenaming`,
  which swaps the anchor for a `lightning-input`; `navigatorItem.test.js:1147-1169` asserts
  `[draggable]` is absent during it.
- O2 — The top-right region exists at the whole-Navigator level only, and it is already occupied.
  `salesforceNavigator` owns the sole `lightning-card`, and the layout switcher and "New section"
  button both sit in its `slot="actions"`, which is where `lightning-card` renders its top-right
  action row. There is no per-section header slot: `navigatorSection` builds its own plain
  `<header>` inside its own shadow root (`navigatorSection.html:20-99`). No pencil, gear, lock or
  edit icon exists anywhere in the component family — the only icon is the card's decorative
  `standard:choice`.
- O3 — No mode flag of any kind exists. The nearest thing is `itemDragActive`
  (`salesforceNavigator.js:853`, passed to `navigatorSection` as an `@api`), which means only
  "an item drag is in flight right now" and resets the instant the drag ends. State flows `@api`
  down and `CustomEvent` up — no wire, no shared module, no LMS. `navigatorItem` fires eleven
  events (`itemdragstart`, `itemgrab`, `itemkeymove`, `itemrename`, `itemremove`, …) and
  `navigatorSection` re-fires `itemremove`, `itemmoveto` and `itemrename` upward under the same
  names with a `sectionIndex` added.
- O4 — There is no resize interaction to gate. Grep for "resize" across the five bundles returns
  zero mechanisms. A section's width is a **column count**, 1-6, chosen from a `lightning-button-menu`
  entry in the section's own overflow menu (`navigatorSection.html:84-92`), applied as a computed
  class. Actual pixel width is derived by CSS Grid `minmax()` tracks — "No JavaScript, no
  `ResizeObserver`, no media query" (`variable-width-sections` `## Design`, merged). There is no
  handle, no pointer listener, and no document- or window-level listener anywhere in these bundles.
- O5 — There is no add/remove of *columns*; what exists is add/remove of **items**. Each section
  header carries an always-rendered "Add items" `<button>` which dispatches `sectionadditems` up to
  `salesforceNavigator.handleSectionAddItems`, which imperatively opens `NavigatorItemPicker` — a
  `LightningModal` mounted on `document.body`, outliving the component that opened it. Removal is a
  `lightning-menu-item value="remove"` in each item's own overflow menu. No standalone "+" icon
  exists; the text button is the persistent affordance.
- O6 — Reordering is native HTML5 drag-and-drop with `draggable="true"` set as a **static string**
  on both the section `<article>` and the item anchor — never bound to an expression. The grab
  surface is the whole card or row; there is no separable drag handle to hide. A full keyboard
  parallel exists alongside it (Space to grab, arrows to move, Space to drop, Escape to cancel) with
  live-region announcements and explicit focus restoration in `renderedCallback` on both components.
  A third route bypasses dragging entirely: the item's "Move to…" menu entries, gated only on more
  than one section existing.
- O7 — Links are real `<a href>` anchors populated from `NavigationMixin.GenerateUrl` in
  `connectedCallback`. `handleClick` calls `preventDefault()` in exactly two cases: a keyboard grab
  is in flight, or the click is unmodified (in which case it navigates imperatively). Ctrl/Cmd/Shift
  clicks return early to the browser. **Nothing suppresses a click after a mouse drag** — there is no
  `isDragging` check, no `pointer-events` rule anywhere, no `stopPropagation`. Click-versus-drag is
  delegated wholly to the browser's native DnD threshold. Today's "links still work" guarantee is
  therefore structural, not app-level, and an edit-mode toggle that rewires dragging must not
  disturb it.
- O8 — Customisations already survive a reload, and the write path is a single choke point. Every
  mutation — resize (column count), add, remove, rename, reorder, section CRUD — calls
  `applyLayout(next)`, which sets `storedLayout` and calls `scheduleSave()`
  (`salesforceNavigator.js:1383-1388`); that debounces 1000 ms, coalescing a burst into one write,
  then chains onto `saveChain` so saves serialise rather than race. The target is a per-user
  `Navigator_Layout__c` record holding the whole layout as one `Layout_JSON__c` blob — column count,
  section membership and item order all in the same payload, at the same level. `flushPendingSave()`
  runs in `disconnectedCallback`. Nothing is written until the user's first real change; a user who
  only looks has no row. **There is no draft, transaction, snapshot, undo, revert or restore-defaults
  concept anywhere in this stack** — the only "cancel" is Escape during an in-flight keyboard drag,
  which works because `reorder` is its own inverse. A save failure surfaces an inline message and
  does not retry; a load failure suppresses all saves and turns `canEdit` false.

**The decision this spec reopens, and its stated reason.** `dev-path/personal-navigator-layouts`
designed an edit mode and rejected it, as Q14 of design round 2, answered "Agree with your
recommendation on all of these" (Jonah, 2026-08-24). Its `## Design` records the reasoning verbatim:

> **No edit mode.** HTML5 drag-and-drop already separates a click from a drag — a `click` only fires
> if no drag occurred — so an item is permanently clickable *and* permanently draggable.

The same sentence is repeated as a comment in the shipped CSS (`navigatorItem.css:39-41`). That
reasoning is sound and still true of the build, and it answers a narrower question than the one this
spec asks: it establishes that permanent draggability costs nothing *functionally*, and says nothing
about what it costs *visually*, which is the cost the Intent names.

**A vocabulary mismatch worth flattening before the design decides anything.** The Outcomes say
"resize handle", "add-column affordance" and "move or reorder handle". None of the three exists as a
distinct widget. What exists is a column-count menu entry, an "Add items" button opening a modal
picker, and a whole-card drag surface with no handle. O1's "renders no customisation control" resolves
to: two header buttons, two overflow menus, and two static `draggable` attributes.

**Corpus state.** No contention to check — `git branch -a` shows only `main` and this branch, all
three prior specs (`personal-navigator-layouts`, `navigator-test-system-mode`,
`variable-width-sections`) are merged and carry `design_approved: true`, and `scripts/contention.sh`
does not exist in this repo. No neighbour is holding intent-only.

**Repo rules that will bind an implementation here**, globs run rather than guessed:
`lwc-accessible-interactions.md` (every mouse gesture needs a keyboard route *and* a live-region
announcement — its own cited failure is exactly this component family shipping silent keyboard
operations to merge); `lwc-navigation-links.md` (real `<a href>`, never `preventDefault` a
modifier-click, a draggable anchor must not navigate on drag) which binds O7 directly;
`rstk-lwc-standards.md` (`lwc:if`, prefer `lightning-*` base components); `rstk-slds2-ux-standards.md`
(`--slds-g-*` hooks only, focus via the four `shadow-outline-focus` hooks) which binds the new
affordance's styling; `lwc-shadow-boundary-layout.md` and `lwc-grid-track-sizing.md` for anything
touching the canvas; and `lwc-jest-ceilings.md`, which matters more than it looks — jsdom has no real
stylesheet and no `DragEvent`, so "no control renders out of edit mode" can only be proven by
attribute and class-name presence, never by a rendered-layout assertion.

**Tests that assert the current always-on behaviour and will therefore fail on any gate:**
`navigatorSection.test.js:753-758` (`card.draggable === true`), `:1154-1159` ("Add items" present),
`navigatorItem.test.js:296-300` (`anchor.draggable === true`), `:640-659` (draggable regardless of
`grabbed`), and the `salesforceNavigator.test.js:465-578` block asserting the actions-slot controls
appear purely as a function of `canEdit`.

**A live hazard the design inherits unchanged.** `variable-width-sections` `## Traps` records that
`.rstk-nav-sections` has `overflow-x: auto`, which forces `overflow-y: auto` and makes the canvas a
clipping context for every `lightning-button-menu` dropdown inside it — the section menu and every
item menu. This was accepted rather than fixed, with a hand-built overlay-portaled menu rejected
against `rstk-lwc-standards.md` and `rstk-complexity-guard.md`. If edit mode changes when those menus
can be open, this is the same hazard, unchanged.

One thread was named and not chased: whether "edit mode" as a name collides with an existing platform
concept the user already sees (FlexiPage edit versus view). It is a naming question, not one the
design rests on.

## Evidence
Jonah, 2026-08-28, verbatim:

> Today I feel like the Navigator sections are always in edit mode, which feels a
> little unpolished. I would like to hide a lot of the user decisioning and user
> interactivity, customizations, that kind of thing, behind an edit mode. Even if
> it's just a little pencil in the top right, when they click on that, then they
> would be able to see all of the options to resize columns and add more columns,
> move things around, that kind of thing. I think it should be display only when
> it's not in edit mode. This will also help clean up a lot of the visual clutter
> that's on the page when the user is just trying to navigate somewhere.
> Basically, as a user, I want my primary experience of the page to be serving the
> purpose of quick navigation and not the primary purpose to be allowing me to
> modify my navigation panel. Modifications should be the secondary purpose.
