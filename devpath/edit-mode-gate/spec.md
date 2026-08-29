---
type: feature
upstream: []
intent_accepted: true
design_approved: true
---

# Gate Navigator customization behind an edit mode

## Intent
The Navigator's sections are permanently in edit mode: drag surfaces, add-item
affordances and per-section and per-item menus are on the page whether or not the
user intends to customise anything. That makes the page read as unfinished and it
puts visual clutter between the user and the thing they actually came for, which is
getting somewhere fast. Put every customisation control behind an explicit edit
mode, entered from a small affordance in the top right. Out of edit mode the
Navigator is display-only: navigation links, section headings, and the layout
switcher — because choosing which saved layout you are looking at is itself an act
of navigation. Navigation becomes the page's primary purpose and modification
becomes its secondary one.

## Outcomes
- O1 — Out of edit mode the Navigator renders no customisation control: no "New section" button, no per-section "Add items" button, no per-section or per-item overflow menu, and no drag surface
- O2 — An edit affordance sits in the top right and is the only customisation control visible out of edit mode; the layout switcher stays visible and selectable, because choosing a layout is navigation rather than customisation
- O3 — Activating the edit affordance reveals the customisation controls; leaving edit mode hides them again
- O4 — Setting a section's column count is available in edit mode and unavailable out of it
- O5 — Adding and removing items is available in edit mode and unavailable out of it
- O6 — Moving or reordering sections and items is available in edit mode and unavailable out of it, by pointer and by keyboard alike
- O7 — Navigation links are clickable and navigate correctly out of edit mode
- O8 — Customisations saved in edit mode survive leaving edit mode and a page reload
- O9 — Cancelling edit mode restores the canvas to what it was on entry and writes nothing
- O10 — No change to the canvas is written before Save: a change made in edit mode and abandoned without saving does not survive a reload
- O11 — Creating, renaming or deleting a saved layout commits immediately and is not reverted by Cancel
- O12 — Entering and leaving edit mode is announced to a screen reader, and focus lands somewhere deliberate on both transitions

No Outcome ID was retired by this conversation. O1, O4, O5 and O6 were reworded to
name controls that exist — the build has no resize handle, no add-column affordance
and no drag handle — and each still means what it meant, so each keeps its ID. O2
and O8 were narrowed by decisions taken here, for the same reason. O9 through O12
are new, and they exist because the explicit-save decision created requirements the
spec did not previously have.

## Out of scope
- Adding, removing or changing any customisation capability the Navigator already has — this spec changes when the controls are reachable, not what they do
- Changing where or how customisations are stored
- Restyling the navigation content itself beyond removing the controls from the display view
- Undo for a change that has already been saved — Cancel reverts an unsaved editing session, not committed history
- Reverting the creation, renaming or deletion of a saved layout; those commit on the spot and Cancel does not reach them

## Current state
- O1 — Every customisation affordance is permanently in the DOM, and none is hover-revealed: every `:hover` rule in the four stylesheets changes `background-color` only, never `opacity` or `visibility`. The inventory is the layout switcher and "New section" (`salesforceNavigator.html:13-53`); the per-section "Add items" button and overflow menu (`navigatorSection.html:62-98`); the per-item overflow menu (`navigatorItem.html:62-86`); and `draggable="true"` written as a static string on both the section `<article>` and the item anchor. Only the first two are gated at all, behind `lwc:if={canEdit}` — and `canEdit` (`salesforceNavigator.js:907`) is `hasItems && !hasLayoutLoadError`, a data-readiness flag rather than a mode.
- O2 — The top-right exists at the whole-Navigator level only, as `lightning-card`'s `slot="actions"`, and the layout switcher and "New section" already occupy it. There is no per-section header slot: `navigatorSection` builds its own plain `<header>` inside its own shadow root. No pencil, gear or edit icon exists anywhere in the component family.
- O3 — No mode flag exists. `itemDragActive` is the nearest thing and means only "a drag is in flight". State flows `@api` down and `CustomEvent` up — no wire, no shared module, no LMS — so a page-wide flag has an established route to both child components.
- O4 — There is no resize interaction. A section's width is a **column count**, 1-6, chosen from a `lightning-button-menu` entry in that section's overflow menu (`navigatorSection.html:84-92`); pixel width is derived by CSS Grid `minmax()` tracks with "No JavaScript, no `ResizeObserver`, no media query" (`variable-width-sections` `## Design`, merged).
- O5 — There is no add/remove of columns; there is add/remove of **items**. "Add items" dispatches `sectionadditems` up to `handleSectionAddItems`, which imperatively opens `NavigatorItemPicker`, a `LightningModal` mounted on `document.body`. Removal is a menu entry in each item's overflow menu.
- O6 — Reordering is native HTML5 drag-and-drop; the grab surface is the whole card or row, so there is no separable handle to hide. A full keyboard parallel exists alongside it — Space to grab, arrows to move, Space to drop, Escape to cancel — with live-region announcements and explicit focus restoration in `renderedCallback`. Section cards carry `tabindex="0"` to support it. A third route, the item's "Move to…" menu, bypasses dragging entirely.
- O7 — Links are real `<a href>` anchors from `NavigationMixin.GenerateUrl`. `handleClick` calls `preventDefault()` only when a keyboard grab is in flight or the click is unmodified; modifier-clicks return early to the browser. Nothing suppresses a click after a pointer drag — no `isDragging` check, no `pointer-events` rule, no `stopPropagation`. The "links still work" guarantee is structural, delegated to the browser's native drag threshold, so any rewiring of dragging must leave it intact.
- O8 — Every mutation calls `applyLayout(next)`, which sets `storedLayout` and calls `scheduleSave()` (`salesforceNavigator.js:1383-1388`); that debounces 1000 ms, coalescing a burst into one write, then chains onto `saveChain` so writes serialise. The target is a per-user `Navigator_Layout__c` holding the whole layout as one `Layout_JSON__c` blob — column count, section membership and item order all in the same payload. `flushPendingSave()` runs in `disconnectedCallback`; `discardPendingSave()` already exists for the delete-layout path. Nothing is written until the user's first real change.
- O9, O10 — **There is no draft, snapshot, transaction, undo or revert anywhere in this stack.** The only "cancel" is Escape during an in-flight keyboard drag, which works because `reorder` is its own inverse. This is the finding the explicit-save decision rests on: save/cancel is new machinery, not a switch on existing machinery.
- O11 — Creating, renaming and deleting a saved layout go through their own Apex calls (`createLayout`, `renameLayout`, `deleteLayout`) and commit immediately, never touching the debounce. They already flush or discard any pending autosave first.
- O12 — A live region already exists on `salesforceNavigator` (`announcement`, `announcementNonce`, and an `announce()` helper that appends a zero-width space so two identical sentences in a row still read as two announcements). Layout switching, creation, renaming and deletion already announce through it.

**The decision this spec reopens.** `dev-path/personal-navigator-layouts` designed an edit mode and rejected it, as Q14 of design round 2, answered "Agree with your recommendation on all of these" (Jonah, 2026-08-24). Its `## Design` records the reason, and the same sentence is repeated as a comment in the shipped CSS at `navigatorItem.css:39-41`:

> **No edit mode.** HTML5 drag-and-drop already separates a click from a drag — a `click` only fires if no drag occurred — so an item is permanently clickable *and* permanently draggable.

That reasoning is still true of the build. It answers a narrower question than this spec asks — whether permanent dragging breaks clicking, which it does not — and says nothing about what permanent affordances cost visually, which is the cost the Intent names.

**Corpus state.** No contention to check: `git branch -a` shows only `main` and this branch, `scripts/contention.sh` does not exist in this repo, and all three prior specs are merged with `design_approved: true`. No neighbour is holding intent-only.

**Rules that bind an implementation here**, globs run rather than guessed: `lwc-accessible-interactions.md` (every pointer gesture needs a keyboard route *and* a live-region announcement — its own cited failure is this component family shipping keyboard-reachable, screen-reader-silent operations to merge); `lwc-navigation-links.md`, which binds O7 directly; `rstk-lwc-standards.md` (`lwc:if`, prefer `lightning-*`, primitives-only in `event.detail`); `rstk-slds2-ux-standards.md` (`--slds-g-*` hooks with fallback, focus via the four `shadow-outline-focus` hooks); `rstk-preserve-documentation.md`, which binds the superseded CSS comment; `rstk-dry-enforcement.md`, which has no `paths:` and so applies repo-wide; and `lwc-jest-ceilings.md`, which matters more than it looks — jsdom has no real stylesheet and no `DragEvent`, so "renders no customisation control" can only be proven by absence from the DOM, never by a rendered-layout assertion.

**Tests that assert the current always-on behaviour and will fail on any gate:** `navigatorSection.test.js:753-758` (`card.draggable === true`) and `:1154-1159` ("Add items" present); `navigatorItem.test.js:296-300` (`anchor.draggable === true`) and `:640-659` (draggable regardless of `grabbed`); and `salesforceNavigator.test.js:465-578`, which asserts the actions-slot controls appear purely as a function of `canEdit`.

## Design

### Three tiers, and the tier decides everything

The conversation's hardest question turned out not to be *what is a control* but *what
does Cancel reach*. Sorting every act the Navigator offers into three tiers answers
both, and every other decision below falls out of it.

| Tier | Acts | Gated behind edit mode | Written when | Cancel reverts it |
| --- | --- | --- | --- | --- |
| **1 · Canvas** | add/rename/delete a section, set a section's column count, add/remove/rename an item, reorder sections and items | yes | on **Save** | **yes** |
| **2 · Layout lifecycle** | create, rename, delete a *saved layout* | yes | immediately | no |
| **3 · Layout selection** | choose which saved layout is active | **no** | immediately | no |

Tier 3 stays out because choosing which saved layout you are looking at is an act of
navigation — Jonah's words, in `## Evidence`. Tier 2 is gated because naming and
deleting layouts is plainly customisation, but it is not drafted, because each of
those acts already commits through its own Apex call and rolling one back means
undoing DML, which is a different and much larger problem than restoring an
in-memory object. **The seam is real and it is accepted rather than hidden:** a user
can enter edit mode, rename a layout, press Cancel, and find the rename still there.

**The rule a future Navigator control is tested against:** if it changes the contents
of a layout, it is Tier 1. If it changes the set of layouts, it is Tier 2. If it
changes only which one is showing, it is Tier 3. That classification is a convention
this spec establishes and every later Navigator feature inherits; it binds nothing
outside the Navigator, so it is recorded here rather than escalated.

### One page-wide flag, threaded down the route that already exists

`salesforceNavigator` owns a single `isEditing` boolean. Sections and items receive it
as `@api editing`. No new state-sharing mechanism is introduced — `@api` down and
`CustomEvent` up is how everything else in this family already works.

Page-wide rather than per-section, for a structural reason before a preferential one:
there is no per-section header slot, so a per-section toggle means adding a permanent
new control to every section header, which is more standing clutter and directly
against the Intent. "New section", the layout switcher and section reordering are also
page-level acts with no per-section home.

`canEdit` keeps its current meaning — `hasItems && !hasLayoutLoadError` — and is not
renamed. A Tier 1 or Tier 2 control renders when **both** `canEdit` and `isEditing`
hold. The edit affordance itself renders on `canEdit` alone, so a Navigator whose
layout failed to load offers no way into a mode that could not save.

### Controls are absent from the DOM, not hidden

`lwc:if`, never a CSS class that hides. A hidden-but-present control is still in the
tab order and still reachable by a screen reader, so hiding would satisfy the eye and
fail O1. The component already has the precedent: `isRenaming` swaps the anchor out
for a `lightning-input`, and `navigatorItem.test.js:1147-1169` asserts the drag
attribute is genuinely gone during it.

The drag surfaces are the exception, and deliberately so. `draggable` becomes a bound
expression rather than the static string it is today, rendering `draggable="false"`
out of edit mode — the attribute is not a rendered control, it is the explicit
statement that this element is not draggable, which is what a browser and an assistive
technology both need to be told. Three things move with it:

- **The keyboard grab path is gated in JS, not in the template.** `onkeydown` still
  fires on a non-draggable element, so `handleDragKeydown` and `handleCardKeydown`
  return early when not editing. Gating the attribute alone would leave Space-to-grab
  live and O6 unmet for keyboard users.
- **`tabindex` on the section card becomes a getter** returning `0` in edit mode and
  `-1` out of it. A card that cannot be grabbed should not be a tab stop; leaving it
  focusable would add one empty stop per section to every keyboard user's journey
  through a panel whose whole purpose is fast navigation.
- **Nothing changes about `handleClick`.** Its two `preventDefault()` cases stand
  exactly as they are, and no drag-suppression is added to it. Today's guarantee that
  links work is structural — the browser does not fire `click` after a drag — and the
  cheapest way to keep O7 true is to not touch the code that makes it true.

### The draft boundary

Save and cancel are new machinery; the survey found no draft, snapshot or revert
anywhere in this stack. The design keeps that machinery as small as it can be by
building it out of contracts that already exist.

- **Entering.** Snapshot the current layout by round-tripping it through the existing
  `serializeLayout` / `deserializeLayout` pair. Using the persistence contract rather
  than a hand-rolled clone means the snapshot is byte-for-byte what would have been
  stored, so a restore cannot reintroduce a field the payload does not carry.
- **While editing.** `applyLayout` continues to set `storedLayout`, unchanged. The
  suppression goes in **one** place: `scheduleSave()` returns early while `isEditing`,
  which covers all ten `applyLayout` call sites with a single guard. Ten guards at ten
  call sites is exactly what `rstk-dry-enforcement.md` exists to prevent.
- **Save.** Calls the existing `save()` / `persist()` chain, so serialised writes,
  `layoutId` handling and the inline save-error message all keep working untouched.
- **Cancel.** Restores the snapshot into `storedLayout`, calls the already-existing
  `discardPendingSave()`, and leaves edit mode. Writes nothing.
- **Disconnect while editing** discards rather than flushes — the existing
  `flushPendingSave()` in `disconnectedCallback` becomes conditional on not editing.
  Explicit save means nothing is written until the user says so, and that has to hold
  when the user leaves by closing the tab. No `beforeunload` prompt: the component does
  not own the page it sits on inside Salesforce.

**The debounce is neutered, not deleted.** With every mutation behind edit mode and
edit mode suppressing the timer, the 1000 ms autosave can no longer legitimately fire.
Deleting it is nevertheless the wrong move: it is the only thing standing between a
future ungated write and a save storm, and removing it is a larger diff than leaving
it in place behind one guard.

**"Has anything changed" is string equality on the canonical payload** — serialise the
current layout and compare it to the stored snapshot string. Exact, cheap, and it reuses
the contract rather than inventing a dirty-flag protocol that could disagree with what
would actually be written.

### Leaving edit mode with unsaved work

Cancel on an untouched session closes silently. Cancel with unsaved changes confirms
first, and selecting a different layout while editing runs the **same** confirmation
before discarding the draft and switching. One path, two call sites.

The confirmation reuses the component's existing inline prompt idiom
(`openPrompt` / `closePrompt`), which already has an input-less variant in
`PROMPT_DELETE` — deleting a layout asks for confirmation without asking for text, and
a discard prompt is the same shape. This avoids introducing `LightningConfirm` as a
third dialog mechanism alongside the inline prompt and `NavigatorItemPicker`'s
`LightningModal`.

### The top-right, in both states

Out of edit mode: `[ layout switcher ] [ ✏️ ]`. In edit mode:
`[ layout switcher ] [ New section ] [ Cancel ] [ Save ]`.

The pencil is a `lightning-button-icon`, `icon-name="utility:edit"`, with a real
`alternative-text`. It is **replaced** by Save and Cancel rather than joined by them,
so there is exactly one way to leave the mode from the action row. Save takes
`variant="brand"` and sits rightmost, per the SLDS action-row convention that the
primary action is last. All `lightning-*` base components, per `rstk-lwc-standards.md`,
and focus rings come from the four `shadow-outline-focus` hooks rather than a
hand-rolled outline.

The layout switcher is present in both states, but its contents differ: the list of
saved layouts always; the New, Rename and Delete entries only in edit mode. That is the
Tier 2 / Tier 3 split rendered in one control.

### Accessibility

`lwc-accessible-interactions.md` binds hardest here, and its own cited failure is this
component family shipping keyboard-reachable, screen-reader-silent operations to merge.

- **Both transitions announce** through the live region that already exists on
  `salesforceNavigator`, via `announce()` — so the `announcementNonce` zero-width-space
  trick that lets two identical sentences read as two announcements applies for free.
- **Entering edit mode destroys the element that had focus.** The pencil is replaced, so
  focus must be moved explicitly or it falls to `body`. It goes to the first revealed
  control in the action row — "New section" — falling back to Cancel if that control is
  not rendered. Not to Save: a stray Enter must not commit.
- **Leaving returns focus to the pencil**, using the same explicit `renderedCallback`
  focus restoration the component already uses after a keyboard grab.
- **Any in-flight keyboard grab is cleared when edit mode ends.** This is a correctness
  bug rather than a nicety: `renderedCallback` restores focus to a grabbed card by index,
  and a stale `grabbedSectionIndex` pointing at a card that is no longer focusable makes
  that restoration silently no-op.
- **Escape stays owned by the drag.** It cancels an in-flight keyboard grab and does not
  also leave edit mode; one key with two meanings in one mode is a collision, and the
  drag's claim on it is older and more specific.

### The test entry point

**The `@api editing` property on `c-navigator-section` and `c-navigator-item`.**

It is driven from three suites that already exist: `salesforceNavigator` clicks the
pencil and asserts the whole composed gate end to end, and each child suite sets
`editing` directly and asserts its own affordances without the parent. It is preferred
over the alternatives because both children already take `@api` state from the parent
this way — it is an existing boundary, not a new one — and because it survives a
refactor of how the parent decides the flag.

Per `lwc-jest-ceilings.md` these must be attribute- and class-presence assertions.
jsdom has no real stylesheet and no `DragEvent`, so "renders no customisation control"
is provable only as absence from the DOM, which is precisely what the existing
`isRenaming` test already demonstrates.

### What this supersedes

The "No edit mode" decision in `dev-path/personal-navigator-layouts`, and the comment
restating it at `navigatorItem.css:39-41`. `rstk-preserve-documentation.md` binds, so
that comment is **replaced, not deleted** — the new one records that the original
reasoning was correct about clicking and that the mode exists for a visual reason the
original question did not ask about.

## Traps

- **`draggable="false"` is present, not absent.** The one existing "affordance is gone" test asserts the *absence* of the `[draggable]` attribute, because `isRenaming` swaps the whole anchor out. Binding the attribute instead renders `draggable="false"`, so a test copied from that precedent would pass for the wrong reason and then fail when it should not. Assert the value, not the presence.
- **Gating the attribute does not gate the keyboard.** `onkeydown` fires on a non-draggable element. A gate that stops at the template leaves Space-to-grab live and O6 unmet for exactly the users the accessibility rule exists to protect.
- **Entering edit mode destroys the focused element.** Replacing the pencil with Save and Cancel drops focus to `body` unless it is moved explicitly. This is the failure mode that is invisible to a mouse user and immediately obvious to anyone else.
- **The Tier 2 seam.** Rename a layout inside an edit session, press Cancel, and the rename stands. Accepted deliberately; recorded here so it is not later mistaken for a bug.
- **Inherited unchanged from `variable-width-sections`:** `.rstk-nav-sections` carries `overflow-x: auto`, which forces `overflow-y: auto` and makes the canvas a clipping context for every `lightning-button-menu` dropdown inside it — the section menu and every item menu. This was accepted rather than fixed, with a hand-built overlay-portaled menu rejected against `rstk-lwc-standards.md` and `rstk-complexity-guard.md`. Edit mode changes when those menus can be open; it does not change the hazard.
- **A Tier 2 act inside an edit session must not carry the Tier 1 draft with it.** One Tier 2 path writes the *canvas* rather than a name: the rename of a layout the user owns no row for, which commits by creating the row. In edit mode the layout it serialises is the unsaved draft, so the act the design says Cancel cannot reach quietly writes the changes Cancel is supposed to throw away. A test that renames without first changing the canvas is green on it — make a canvas change first, and assert on the payload that was written rather than only on which Apex call was made.
- **An immediate write issued inside another write's round trip is captured against the state before that trip landed.** `captureSaveTarget` reads `this.layoutId` synchronously, so a second act made while a create is in flight is captured as *another* create — two rows for a user who owned none — and one made while a delete is in flight is captured against the row that is about to stop existing. Explicit save is what opens this: the debounce coalesced a burst into one `pendingSave`, and Save and the no-row rename each write immediately and neither coalesces. Every test of these paths resolves Apex instantly, which closes the window before a second act can be made, so each is green whether or not the bug exists. Defer the first call (`deferNextCreate` / `deferNextDelete`), make the second act inside the wait, and assert how many rows the store ends up holding and which one the switcher has checked — not only which Apex call was made.
- **There are three immediate creates in this file, not two, and only two of them go through `commitLayoutNow`.** `createNewLayout` calls `createLayout` directly off `saveChain`, so a coalescing guard that lives inside `commitLayoutNow` is invisible to it: Save or a no-row rename made inside New layout's round trip is still captured with `layoutId: undefined` and still makes a second row. The two observables come apart here, which is what makes a switcher-only assertion look sufficient -- the client's checked entry stays on the new layout and is *correct*, while `store.names()` holds two rows and `store.activeName()` names the abandoned draft, so a reload lands the user on the layout they walked away from. Read the store, not only the screen.
- **Known unverified:** every claim here about how the two states look in a real org is a claim about a build that does not exist yet. The affordance density of the edit-mode action row, and whether `lightning-card`'s actions slot stays legible with four controls in it, are live-org checks rather than things this document settles.

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

Jonah, 2026-08-28, in the design conversation, on whether the layout switcher counts
as a customisation control:

> Layouts makes sense to stay. If navigation is the primary use of the component,
> layout switcher to me feels like a navigation forward use case.

Jonah, 2026-08-28, in the design conversation, choosing against the recommendation to
keep the existing autosave and add no save/cancel:

> No, let's go with explicit save and cancel.

Jonah, 2026-08-28, in the design conversation, on what O4's "column resizing" means:

> I'm assuming column sizing just means number of fields, like number of columns.
