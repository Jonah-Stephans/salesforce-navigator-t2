import { LightningElement, wire } from "lwc";
// The device class the canvas grid's `Small` stand-down keys off — see
// `## Design`'s "Form factor, not viewport width" in
// devpath/variable-width-sections/spec.md. A width-keyed media query cannot
// tell a phone from a zoomed-in desktop, since both narrow the viewport in
// CSS pixels; FORM_FACTOR is a platform-reported device class that zooming
// does not change, which is exactly the distinction this stand-down needs.
import FORM_FACTOR from "@salesforce/client/formFactor";
// getNavItems is imported directly from its platform module, rather than
// through c/navigatorTabSource, because Salesforce's own eslint config
// (no-unexpected-wire-adapter-usages) restricts it to appearing only as the
// literal first argument of an @wire decorator — see the note in
// navigatorTabSource.js. Everything else about the source — its config
// shape, the pagination math, and the reasoning behind the choice — still
// lives in that one file.
import { getNavItems } from "lightning/uiAppsApi";
import {
  NAV_ITEMS_CONFIG,
  hasMorePages,
  normalizeNavItems
} from "c/navigatorTabSource";
import {
  buildSeededLayout,
  resolveLayout,
  serializeLayout,
  deserializeLayout,
  addSection,
  renameSection,
  deleteSection,
  setSectionColumns,
  reorder,
  moveItemWithinSection,
  moveItemBetweenSections,
  moveSection,
  renameItem,
  removeItem,
  availableTabs,
  addItemToSection
} from "c/navigatorLayoutModel";
import NavigatorItemPicker from "c/navigatorItemPicker";
import getLayouts from "@salesforce/apex/NavigatorLayoutController.getLayouts";
import createLayout from "@salesforce/apex/NavigatorLayoutController.createLayout";
import updateLayout from "@salesforce/apex/NavigatorLayoutController.updateLayout";
import activateLayout from "@salesforce/apex/NavigatorLayoutController.activateLayout";
import renameLayout from "@salesforce/apex/NavigatorLayoutController.renameLayout";
import deleteLayout from "@salesforce/apex/NavigatorLayoutController.deleteLayout";

const GENERIC_ERROR_MESSAGE =
  "We could not load your tabs. Try reloading the page.";
const SAVE_ERROR_MESSAGE =
  "We could not save your layout. Your last change may not be kept.";

/**
 * Shown when `getLayouts` itself fails. It has to say more than "something
 * went wrong", because the consequence is specific: the Navigator on screen is
 * the seeded one, and nothing the user changes now will be written.
 * Suppressing the write is the point — a create made without a successful read
 * passes `makeActive: true`, and the controller clears `Is_Active__c` on the
 * user's other layouts, so the real layout we failed to read would be
 * deactivated and (until the switcher slice) unreachable.
 *
 * Reloading is the right advice *here* and only here: a failed call is
 * transient, so the next attempt may well succeed.
 */
const LAYOUT_LOAD_ERROR_MESSAGE =
  "We could not load your saved layout, so this is the default arrangement. " +
  "Reload the page before changing anything — changes are not being saved.";

/**
 * Shown when the read succeeded but reported a row it could not read. This is
 * a different failure from the one above and needs different words, because
 * the *remedy* is different. That row is at a schema version this package does
 * not know, or its payload was hand-edited into something that is not a
 * payload; either way every reload reproduces it identically, so telling the
 * user to reload is telling them to repeat the one thing that cannot work.
 * What they can act on is handing the reason to somebody who can remove or
 * repair the row — so `unreadableReason`, which the controller took the
 * trouble to produce and which names the schema version, is surfaced rather
 * than discarded.
 */
function unreadableLayoutMessage(reason) {
  const detail = reason ? " Details for your administrator: " + reason : "";
  return (
    "One of your saved layouts cannot be read by this version of the " +
    "Navigator, so this is the default arrangement and changes are not being " +
    "saved. Reloading will not help — ask your administrator to remove or " +
    "repair that layout." +
    detail
  );
}

/**
 * The layout a user gets when they first change something. They have not
 * named a layout at this point — naming and switching between several is a
 * later slice — so the first record needs a name and this is it.
 */
const DEFAULT_LAYOUT_NAME = "My Navigator";
const NEW_SECTION_NAME = "New section";

/**
 * The name a layout created from the menu gets if the user commits an empty
 * box. A layout with no name at all would be an unreachable entry in the very
 * menu it has to be selected from.
 */
const NEW_LAYOUT_NAME = "New layout";

/**
 * The layout menu's own vocabulary. The three actions are fixed strings and a
 * layout is `layout:<id>`, so a Salesforce id can never collide with an action
 * — and the prefix is stripped in exactly one place, below.
 */
const LAYOUT_VALUE_PREFIX = "layout:";
const NEW_LAYOUT = "new-layout";
const RENAME_LAYOUT = "rename-layout";
const DELETE_LAYOUT = "delete-layout";

/**
 * Which of the menu's four dialogs is open, or none. It is one field rather
 * than four booleans so that two cannot be open at once, and it is
 * transient UI state that never reaches the store — opening a dialog and
 * cancelling it writes nothing, which is this spec's oldest settled rule.
 *
 * **`PROMPT_DISCARD` joins the other three as of this slice.** It is the
 * shared "you have unsaved work" confirmation behind all four places that can
 * throw a Tier 1 draft away — Cancel, switching to a different saved layout,
 * New layout and Delete layout — reusing this same field and the
 * `openPrompt`/`closePrompt` idiom rather than adding a third dialog
 * mechanism beside this one and the item picker's `LightningModal`. It is the
 * same input-less shape `PROMPT_DELETE` already is.
 */
const PROMPT_NEW = "new";
const PROMPT_RENAME = "rename";
const PROMPT_DELETE = "delete";
const PROMPT_DISCARD = "discard";

/**
 * What `pendingDiscardAction.type` names once the discard prompt is open —
 * which of the four call sites asked for it, and therefore what confirming
 * actually does. New layout and Delete layout reuse `NEW_LAYOUT` and
 * `DELETE_LAYOUT` above rather than a second pair of near-identical
 * constants, so the action tag always names the same write it stands in for.
 */
const DISCARD_CANCEL = "cancel";
const DISCARD_SWITCH = "switch";

/**
 * Told to the user before any of the four acts throws an unsaved Tier 1
 * change away. One shared sentence rather than four: the fact worth stating
 * is always the same one, and each call site's own control already says what
 * happens once the change is gone.
 */
const DISCARD_PROMPT_MESSAGE =
  "You have unsaved changes. Discard them and continue?";

const SWITCH_ERROR_MESSAGE =
  "We could not switch layouts. The layout on screen is the one that is still active.";

/**
 * How long a change waits before it is written. A drag flurry, or six taps
 * down the column-count menu, coalesces into one `update` on one record. It
 * is long enough that a burst is genuinely one save and short enough that a
 * user who changes one thing and closes the tab has already been saved —
 * and `disconnectedCallback` flushes a pending save anyway, so the window is
 * not a place work can be lost.
 */
const AUTOSAVE_DELAY_MS = 1000;

/**
 * What the live region says about each edit-mode transition.
 *
 * Both transitions are announced, not just the entry: leaving is the half a
 * screen reader user cannot see happen, and the two exits mean different
 * things — one wrote, the other did not — so they do not share a sentence.
 * "Nothing was saved" is true of a Cancel whether or not anything was changed,
 * which is why it is worded as a fact about the write rather than about the
 * changes.
 */
const ENTER_EDIT_ANNOUNCEMENT =
  "Edit mode on. Customise your Navigator, then press Save.";
const SAVE_EDIT_ANNOUNCEMENT = "Changes saved. Edit mode off.";
const CANCEL_EDIT_ANNOUNCEMENT = "Edit mode off. Nothing was saved.";

/**
 * Sixth pass, Jonah's decision (2026-08-31): the writing controls disable
 * while one of their own acts is outstanding, so a screen reader user is told
 * why Save/New layout/Rename layout/Delete layout just stopped responding
 * rather than left to wonder. Named explicitly rather than left generic
 * ("Saving…") because the four are exactly what `isWriteLocked` disables —
 * see it and `beginWrite`.
 */
const WRITE_LOCK_ANNOUNCEMENT =
  "Saving. Save, New layout, Rename layout and Delete layout are unavailable until this finishes.";

/**
 * Where focus goes on the render that follows an edit-mode transition, and the
 * selectors it goes to.
 *
 * Entering destroys the element that had focus — the affordance is replaced by
 * Save and Cancel rather than joined by them — so focus has to be moved
 * explicitly or it falls to `document.body`. The entry selector names two
 * controls and `querySelector` resolves them in *document order*, so it reads
 * as "the first revealed control in the action row, or Cancel if New section is
 * not rendered". Never Save: a stray Enter on the control that has just taken
 * focus must not commit the session.
 *
 * **`lock` is the sixth pass's addition.** Committing New layout, Rename
 * layout or Delete layout closes the inline prompt (`closePrompt()`) without
 * restoring focus anywhere, and none of those three acts leaves edit mode —
 * so the control the user just pressed is gone and focus would otherwise fall
 * to `document.body`, the exact hazard Trap 3 names at the pencil. It goes to
 * the layout switcher, since that is the control that opened the prompt in
 * the first place. Save is the exception among the four writing controls: it
 * always calls `leaveEditMode()` in the same handler, and that assigns
 * `EDIT_FOCUS_LEAVE` *after* `beginWrite` would have assigned `lock` — so the
 * later write wins and Save's own press still restores focus to the pencil,
 * unchanged from before this pass.
 */
const EDIT_FOCUS_ENTER = "enter";
const EDIT_FOCUS_LEAVE = "leave";
const EDIT_FOCUS_LOCK = "lock";
const EDIT_ENTRY_FOCUS_SELECTOR =
  ".rstk-nav-new-section, .rstk-nav-edit-cancel";
const EDIT_AFFORDANCE_SELECTOR = ".rstk-nav-edit";
const WRITE_LOCK_FOCUS_SELECTOR = ".rstk-nav-layout-menu";
const EDIT_FOCUS_SELECTORS = {
  [EDIT_FOCUS_ENTER]: EDIT_ENTRY_FOCUS_SELECTOR,
  [EDIT_FOCUS_LEAVE]: EDIT_AFFORDANCE_SELECTOR,
  [EDIT_FOCUS_LOCK]: WRITE_LOCK_FOCUS_SELECTOR
};

/**
 * The same distinguisher `navigatorSection` carries for the item axis, for
 * the same reason on this one: a live region is read when its content
 * changes, LWC writes nothing for an unchanged bound string, and two
 * identical sentences in a row would therefore be one announcement. U+200B
 * ZERO WIDTH SPACE, toggled on and off, makes consecutive writes textually
 * distinct while adding nothing a screen reader voices. See the fuller note
 * on ANNOUNCEMENT_NONCE in navigatorSection.js.
 */
const ANNOUNCEMENT_NONCE = "\u200B";

/**
 * The one form factor the six-track canvas stands down for (see the note on
 * the `FORM_FACTOR` import above). `Medium` and `Large` both get the
 * six-track grid; only `Small` collapses to the single full-width track.
 */
const SMALL_FORM_FACTOR = "Small";

/**
 * The Navigator tab's top-level component. It owns the active layout's state
 * and its autosave; a section owns its own header and its own grid.
 *
 * Two things here are load-bearing.
 *
 * **A user who has only ever looked has no layout record.** `this.storedLayout`
 * stays undefined until the user's first actual change, and until then the
 * rendered layout is computed by `buildSeededLayout` from the tabs the
 * platform reports. Writing on first open would generate a row for every user
 * who ever opens the tab, to store something derivable from the platform.
 *
 * **Creation and update are separate calls, and the client keeps the id.** The
 * Apex controller refuses a null id on `updateLayout` on purpose; this side
 * matches it by branching on whether it holds an id, and by recording the id
 * the create returns *before* the next save runs — see `saveChain`.
 */
export default class SalesforceNavigator extends LightningElement {
  page = 0;
  items = [];
  errorMessage;
  saveErrorMessage;
  layoutLoadErrorMessage;

  // Two separate "still arriving" facts, because they finish independently
  // and *both* have to be finished before anything is safe to change. Tabs:
  // a change made mid-pagination seeds `All Items` from the pages received so
  // far and freezes a partial list into the store. Layout: a change made
  // before `getLayouts` lands is overwritten when it lands.
  isLoadingTabs = true;
  hasLoadedLayout = false;

  // Undefined means "this user has never changed anything", which is not the
  // same as an empty layout — one is computed on every render, the other is a
  // stored row with no sections in it.
  storedLayout;
  layoutId;
  layoutName = DEFAULT_LAYOUT_NAME;

  /**
   * Every layout the running user owns — `{layoutId, name, layoutJson}` each —
   * as the store last reported it. The menu is rendered from this and a switch
   * reads the target's payload out of it, so switching costs no second read.
   *
   * **Which of them is active is not a field here.** It is `this.layoutId`, one
   * value, so "exactly one layout is active" is not something this component
   * can get wrong by forgetting to clear a flag: there is no second flag to
   * clear. The server enforces the same invariant in its own store and hands
   * the whole list back after every switch and delete, so a disagreement is
   * settled by the store rather than by this cache.
   */
  layouts = [];

  // Which of the layout menu's four dialogs is open. Transient, and
  // deliberately nowhere near the store — see the PROMPT_* constants.
  layoutPrompt;
  draftLayoutName = "";

  /**
   * What confirming the discard prompt actually does — `{ type, ... }`, only
   * set while `layoutPrompt === PROMPT_DISCARD`. `type` is one of
   * `DISCARD_CANCEL`, `DISCARD_SWITCH`, `NEW_LAYOUT` or `DELETE_LAYOUT`;
   * `DISCARD_SWITCH` also carries `layoutId`, and `NEW_LAYOUT` also carries
   * the `name` the user had already typed before the prompt intervened.
   * Cleared by `closePrompt()` along with everything else transient about a
   * dialog, so it cannot outlive the prompt that set it.
   */
  pendingDiscardAction;

  /**
   * Whether the user is customising rather than navigating. One page-wide
   * boolean, owned here and passed down as `@api editing` by the later slices
   * that gate the section and item affordances — page-wide rather than
   * per-section because there is no per-section header slot to hang a toggle
   * from, and because "New section", the layout switcher and section
   * reordering are page-level acts with no per-section home anyway.
   *
   * It is a mode, and `canEdit` is a readiness flag; the two are not the same
   * fact and neither replaces the other. A Tier 1 or Tier 2 control renders
   * when both hold. The affordance itself renders on `canEdit` alone.
   */
  isEditing = false;

  /**
   * The canvas as it stood when edit mode was entered, or undefined out of it.
   *
   * `json` is the serialised payload, taken through `serializeLayout` rather
   * than a hand-rolled clone: it is byte-for-byte what a save would have
   * written, so a restore cannot reintroduce a field the stored payload does
   * not carry, and "has anything changed" is exact string equality against it
   * rather than a dirty-flag protocol that could disagree with the write.
   *
   * `wasStored` records whether the user owned a stored layout at that moment.
   * Restoring `json` unconditionally would turn "has never changed anything"
   * — `storedLayout === undefined`, the single fact this component uses to
   * mean it — into "has a stored layout", by way of a Cancel that is supposed
   * to write nothing and change nothing.
   */
  editSnapshot;

  /**
   * Which edit-mode transition owes focus a home on the next render, if any.
   * A one-shot hand-off in the same shape as `cardFocusIndex`, and for the
   * same reason: the control focus must land on does not exist until the
   * render that reveals it.
   */
  editFocusTarget;

  /**
   * How many of the four writing acts — Save, New layout, Rename layout,
   * Delete layout — have an outstanding round trip right now. Backs
   * `isWriteLocked`, which the template disables all four controls on: the
   * sixth pass's lockout, and now the primary guard against the "two rows for
   * one user" class of race — see `creatingLayout` for the backstop this
   * stands in front of, which stays rather than being removed.
   *
   * A counter, not a boolean, because `beginWrite`/`endWrite` are called at
   * each act's own external entry point (not inside `commitLayoutNow`, whose
   * internal wait-and-retry can itself take a moment) and a defensive floor
   * of zero in `endWrite` means a stray extra call can never make it negative
   * and hold the lockout open past its own act finishing.
   */
  writeInFlight = 0;

  saveTimer;

  /**
   * The change waiting for its debounce, as `{layoutId, name, layoutJson}`,
   * captured **when the change was made** rather than when the timer fires.
   *
   * That difference is the whole of it. `this.layoutId` and `this.storedLayout`
   * both move when an activation, a create or a delete resolves, and an
   * activation round trip that completes inside the 1s window is the *ordinary*
   * case rather than the rare one. A target read at timer-fire time would
   * therefore describe the layout the user had just been moved to, carrying the
   * payload of the layout they had moved from — losing the edit and overwriting
   * a second layout with foreign content in the same call. Capturing here means
   * a change belongs to the layout it was made on from the instant it is made,
   * whatever resolves in between.
   */
  pendingSave;

  // Whether this instance is still in the document. Every other write path in
  // this file is driven by a template event and so cannot fire after
  // disconnect; the picker is the exception, because `LightningModal.open`
  // mounts it on `document.body` and it therefore outlives the Navigator. A
  // choice made after the user has left the tab would otherwise start a 1s
  // autosave timer that `disconnectedCallback` has already come and gone for
  // — precisely the hazard `@lwc/lwc/no-async-operation` names.
  isAttached = false;

  // What kind of drag is in flight, and where it started. Held here rather
  // than in a section because only this component sees both kinds: a drop
  // landing on a section card can mean "put this section here" or "put this
  // item in that section", and the difference is which drag began.
  //
  // Not recoverable from the drop event instead: `dataTransfer.getData()`
  // returns "" during `dragover` in every browser by the HTML spec's
  // protected mode, so `setData` is a handshake with the browser and never a
  // channel back to us.
  dragKind;
  dragSectionIndex;

  // Which item, within `dragSectionIndex`, is being dragged. Needed only for
  // the cross-section move: a drop inside the *same* section is resolved by
  // that section on its own, but a drop into a different one arrives here with
  // no memory of what left, because the section the item came from never sees
  // the drop.
  dragItemIndex;

  // A keyboard drag of a whole section card. This lives here, and not in the
  // section, for a mechanical reason: reordering the sections changes every
  // section's index and therefore its key, so the child components are
  // rebuilt on each arrow press and any state they held would be gone. The
  // announcement and the focus restoration have to survive that too.
  grabbedSectionIndex;
  grabbedSectionOrigin;

  /**
   * This component's live region. It carries two kinds of announcement, and
   * both belong here rather than in a section for the same reason: the gesture
   * outlives the card. A section reorder rebuilds every card, and a
   * cross-section move destroys the item component in the section it left —
   * an announcement made from either place would be destroyed as it was made.
   * Announcements about an item's position *within* one section stay in that
   * section, because nothing there is rebuilt.
   */
  announcement = "";

  // Flipped on every announcement so that two identical sentences in a row
  // are still two distinct strings — see ANNOUNCEMENT_NONCE above.
  announcementNonce = "";

  // Where focus has to land on the *next* render, for the two gestures that
  // end a keyboard drag. It cannot be inferred from `grabbedSectionIndex`,
  // because ending the drag is exactly what clears that: a cancel performs a
  // real reorder back to the origin, which destroys and rebuilds the card the
  // user was holding, and by the time that render arrives there is no grab
  // left to read a target from. Without this the user is dropped on
  // `document.body` with no focus anywhere in the page.
  cardFocusIndex;

  // Saves run one after another rather than in parallel. Without this, two
  // changes a second apart on a user with no record yet would each see a null
  // `layoutId` and each call `createLayout`, leaving the user with two
  // layouts and the second silently deactivating the first. Chaining means
  // the id the create returns is already recorded when the next save decides
  // which call to make.
  saveChain = Promise.resolve();

  /**
   * The most recent create still waiting on its round trip for a user who
   * owned no row when it started, or `undefined` once none is outstanding —
   * `{ promise, distinct }`, not a bare promise, because the wait needs an
   * identity to fold correctly rather than by accident.
   *
   * `captureSaveTarget` reads `this.layoutId` synchronously, and for a user
   * with no row that stays `undefined` until a create resolves and
   * `rememberSaved` (or `createNewLayout`'s own success handler) adopts the
   * id it returns — so a second immediate write made inside that window
   * would otherwise be captured with `layoutId: undefined` too, exactly as
   * the first one was, and become a second `createLayout` rather than the
   * update it should be.
   *
   * **`distinct` is what tells "a create for the layout I am writing" from
   * "some other layout's create".** `commitLayoutNow`'s own create (Save, or
   * a no-row rename that is itself the first write) leaves it unset: it is
   * the same implicit, still-rowless layout a later write on this same no-row
   * user is addressed to, so a second such write should wait for it and land
   * as an update of the row it creates. `createNewLayout`'s create sets it
   * `true`: "New layout" always makes its own, separate row, seeded from
   * scratch, regardless of who else is creating one — it is never the layout
   * a *different* write is addressed to. An overridden write (only
   * `renameCurrentLayout`'s no-row branch passes one) is addressed to a
   * specific entry snapshot, not to "whichever layout is current", so it must
   * not wait on a `distinct` create and fold into it — that would recapture
   * against the distinct layout's own id and name once the wait cleared,
   * silently losing the act the override was for. It instead falls through
   * and makes its own row, honouring both acts. A bare write (Save) carries
   * no identity of its own — it means "whatever is on screen" — so it always
   * waits, `distinct` or not, and recaptures fresh once the wait clears.
   *
   * **Three call sites touch this field, not two.** `commitLayoutNow` both
   * reads it (to wait) and writes it (for its own create) — see it for how
   * the wait is used to fold a second write onto the row the first one is
   * creating. `createNewLayout` only writes it, tagged `distinct: true`.
   *
   * **Both writers clear their own entry, and only their own.** An
   * overridden write that falls through past a `distinct` create (the case
   * just above) overwrites this field with its own entry while the
   * `distinct` create is still in flight — two creates are then
   * outstanding for one slot. Each writer's clear checks the field still
   * holds the object *that write* put there (`this.creatingLayout ===
   * mine`) before setting it back to `undefined`, so whichever create
   * settles first can only ever clear its own entry, never the other
   * writer's still-open one. Without that check, the first to settle wipes
   * the second's entry out from under it, and the next immediate write
   * sees no create in flight and makes a row of its own instead of
   * waiting — closed by the fix to slice 01's finding 1.
   *
   * **Sixth pass: this mechanism is now the backstop, not the primary
   * guard.** `isWriteLocked` disables all four writing controls while any one
   * of them has a round trip outstanding, and `handleEditSave` and
   * `handleLayoutMenuSelect` both re-check it in the handler, not only in the
   * template — so a second write can no longer be *issued* while a first is
   * in flight, which is the precondition every interleaving this field
   * unwinds depends on. This field, `distinct`, the ownership checks on both
   * writers' clears, and the wait in `commitLayoutNow` all stay: they are
   * defence-in-depth behind the lockout, not superseded by it, per
   * `.claude/rules/rstk-preserve-defensive-checks.md` and the same argument
   * `## Design`'s "The draft boundary" already makes about the debounce —
   * neutered, not deleted. Nothing here is claimed dead by construction; that
   * claim has been made about this file three times before this pass and was
   * wrong twice.
   */
  creatingLayout;

  // Indexed by page number rather than appended to, so that a wire
  // re-emission for a page already received (an LDS cache refresh
  // redelivering the current, possibly final, page — a normal event for a
  // UI API adapter) overwrites that page's slot instead of duplicating it.
  // `this.page` alone cannot tell "next page" from "same page, redelivered"
  // once pagination has finished advancing, but the page number a response
  // belongs to can.
  pages = [];

  connectedCallback() {
    this.isAttached = true;
    // Imperative rather than wired: the component holds the layout as its own
    // state from the first change onward, so a cached wire re-emission after a
    // save would only ever fight with what the user is looking at.
    getLayouts()
      .then((rows) => {
        this.adoptActiveLayout(rows);
        this.hasLoadedLayout = true;
      })
      .catch(() => {
        // A layout that cannot be read is not a reason to show the user
        // nothing: the seeded layout is a complete, usable Navigator, and it
        // still navigates. What must not happen is the user's real layout
        // being *displaced* by what they do next. `layoutId` stays undefined,
        // so the next change would call `createLayout(makeActive: true)`, and
        // the controller clears `Is_Active__c` on every other layout the
        // owner has — leaving the layout we failed to read deactivated and,
        // with no switcher until a later slice, unreachable. Overwrite was
        // never the hazard here; displacement is, and it costs the user the
        // same thing. So the failure is announced and the autosave is
        // suppressed until a read succeeds.
        //
        // The message is fixed rather than reduced from the server's, because
        // what the user needs told is the consequence — this is not your
        // layout and nothing is being saved — and that is the same whatever
        // the cause was.
        this.storedLayout = undefined;
        this.layoutLoadErrorMessage = LAYOUT_LOAD_ERROR_MESSAGE;
        this.hasLoadedLayout = true;
      });
  }

  disconnectedCallback() {
    this.isAttached = false;
    // Mid-edit, the user has unsaved work by design and leaving the page is
    // not consent to write it. Explicit save means nothing is written until
    // the user says so, and that has to hold when they say nothing at all and
    // close the tab — so this discards rather than flushes. There is no
    // `beforeunload` prompt to go with it: this component does not own the
    // page it sits on inside Salesforce.
    //
    // **Belt to the braces, and knowingly so.** No timer can actually be armed
    // in this state: `handleEditStart` flushes any pending pre-edit save on the
    // way in, and `scheduleSave` arms nothing while editing. So this branch is
    // unreachable by construction today and no test can distinguish it from an
    // unconditional flush. It is kept because the fact it depends on lives in
    // two other methods, and the cost of it being wrong is a user's unsaved
    // draft written to their layout without them asking.
    if (this.isEditing) {
      this.discardPendingSave();
      return;
    }
    // Out of edit mode a pending debounce must not be dropped on the floor
    // when the user navigates away — that is precisely the "unsaved state to
    // lose" the autosave design says does not exist there.
    this.flushPendingSave();
  }

  /**
   * Adopts the user's active layout, if they have one. `getLayouts` returns
   * the payload already upgraded to the current schema by the controller;
   * `deserializeLayout` is still the only route in on this side, so a payload
   * that somehow arrived at another shape is normalised rather than trusted.
   */
  adoptActiveLayout(rows) {
    const layouts = rows || [];

    // A row the controller could not read comes back flagged rather than
    // taking the whole call down with it, so the user's *other* layouts are
    // still usable. It cannot be adopted, and it must not be displaced
    // either: a save now would pass `makeActive: true` and clear its flag, so
    // the same suppression the failed-read path uses applies here. The
    // *wording* is not the same, though — this failure does not go away on a
    // reload, and the row's own reason is what an administrator needs.
    const unreadable = layouts.find((row) => row.isReadable === false);
    if (unreadable) {
      this.layoutLoadErrorMessage = unreadableLayoutMessage(
        unreadable.unreadableReason
      );
    }
    const readable = layouts.filter((row) => row.isReadable !== false);
    this.layouts = readable.map(SalesforceNavigator.cachedLayout);

    const active = SalesforceNavigator.activeRowIn(readable);
    if (!active) {
      return;
    }
    // Defence in depth against the window this component no longer opens:
    // nothing is interactive until `hasLoadedLayout`, so there is no change
    // to clobber by the time this runs. `adoptActiveLayout` should not depend
    // on the template to be safe, though — assigning `storedLayout` over a
    // change the user has already made and seen is silent data loss.
    if (this.storedLayout !== undefined) {
      return;
    }
    this.layoutId = active.layoutId;
    this.layoutName = active.name || DEFAULT_LAYOUT_NAME;
    this.storedLayout = deserializeLayout(active.layoutJson);
  }

  /**
   * Which of the store's readable rows this component shows. **One definition,
   * shared by the load path and the switch/delete path**, so the two cannot
   * disagree about a store that has readable rows with none of them flagged.
   *
   * The controller no longer produces that state itself — `createLayout`
   * activates the row it creates when the owner has no active one, so "exactly
   * one active" holds in the store. It is still reachable *here*, though, and
   * by a route the server cannot close: when the active row is one this package
   * cannot read, it is filtered out before this runs and the rows left carry no
   * flag. Falling back to the first of them shows the user a layout they own
   * rather than the seeded arrangement they do not.
   *
   * `readable[0]` is undefined for an empty list, which is the first-open state
   * and is the caller's to interpret — `adoptFromStore` adopts it as one and
   * `adoptActiveLayout` leaves the seeded layout computed.
   */
  static activeRowIn(readable) {
    return readable.find((row) => row.isActive) || readable[0];
  }

  /**
   * One layout as this component caches it. `isActive` is deliberately dropped
   * on the way in: which layout is active is `this.layoutId` and nothing else,
   * so there is no second copy of that fact to fall out of step with the first.
   */
  static cachedLayout(row) {
    return {
      layoutId: row.layoutId,
      name: row.name || DEFAULT_LAYOUT_NAME,
      layoutJson: row.layoutJson
    };
  }

  // -------------------------------------------------------------------
  // The layout switcher.
  //
  // **Not one method with a nullable id.** The previous project shipped a
  // single `saveLayout(layoutId, …)` in which null meant "make me a new one"
  // to the client and "update the one that loads on arrival" to the server,
  // and New layout renamed and overwrote the existing layout in the running
  // org. Creating, switching, renaming and deleting are four calls here
  // because they are four intentions, and three of the four carry no payload
  // at all — so there is nothing for a switch or a rename to write onto the
  // wrong row even if it named one.
  // -------------------------------------------------------------------

  /**
   * The menu's entries: every layout the user owns, with the active one
   * checked, then the three actions.
   *
   * A user who has never changed anything owns no row, and yet is looking at a
   * layout — the seeded one. It gets an entry with an empty id, which
   * `switchToLayout` refuses like any other id that names nothing, so the entry
   * reports state without being a route to anywhere.
   */
  get layoutChoices() {
    const choices = this.layouts.map((row) => ({
      value: `${LAYOUT_VALUE_PREFIX}${row.layoutId}`,
      label: row.name,
      checked: row.layoutId === this.layoutId
    }));
    if (!this.layoutId) {
      choices.unshift({
        value: LAYOUT_VALUE_PREFIX,
        label: this.layoutName,
        checked: true
      });
    }
    return choices;
  }

  /**
   * Whether Delete layout… is offered. It is not, for a user who has no row:
   * there is nothing to delete, and a menu entry that cannot do what it says
   * is worse than an absent one.
   */
  get canDeleteLayout() {
    return Boolean(this.layoutId);
  }

  get isNamingLayout() {
    return (
      this.layoutPrompt === PROMPT_NEW || this.layoutPrompt === PROMPT_RENAME
    );
  }

  get isConfirmingLayoutDelete() {
    return this.layoutPrompt === PROMPT_DELETE;
  }

  get isConfirmingDiscard() {
    return this.layoutPrompt === PROMPT_DISCARD;
  }

  get discardPromptMessage() {
    return DISCARD_PROMPT_MESSAGE;
  }

  get layoutPromptLabel() {
    return this.layoutPrompt === PROMPT_NEW
      ? "Name for the new layout"
      : `Rename ${this.layoutName}`;
  }

  get layoutPromptCommitLabel() {
    return this.layoutPrompt === PROMPT_NEW ? "Create layout" : "Rename layout";
  }

  /**
   * Names the layout, because every other layout the user owns survives and a
   * confirmation reading "Are you sure?" does not say which one is about to
   * go. The consequence is stated too: what they are left with, so that
   * deleting the last one is not a surprise.
   */
  get layoutDeleteMessage() {
    return this.layouts.length > 1
      ? `Delete ${this.layoutName}? Your other layouts are not affected.`
      : `Delete ${this.layoutName}? You will go back to seeing every tab you can reach in one section.`;
  }

  handleLayoutMenuSelect(event) {
    const value = event.detail.value;

    // Tier 2 is gated behind edit mode in the template — the three
    // `lwc:if={isEditing}` entries above it — and `handleEditStart` already
    // re-checks `canEdit` for the same reason: a template gate is not a
    // guarantee about a handler. Tier 3 (`layout:…`) is deliberately not
    // included here; choosing which layout is showing is navigation, not
    // customisation, and stays reachable whatever `isEditing` is.
    //
    // **`isWriteLocked` joins the re-check as of the sixth pass, for the same
    // "template gate is not a guarantee about a handler" reasoning.** The
    // `disabled` attribute on these three `lightning-menu-item`s is the
    // visible half of the lockout; this is the half that holds even if that
    // attribute is ever bypassed. It is what makes New layout and Rename
    // layout unable to open a *second* prompt while one of the four writing
    // acts already has a round trip outstanding — see `isWriteLocked`.
    if (
      (value === NEW_LAYOUT ||
        value === RENAME_LAYOUT ||
        value === DELETE_LAYOUT) &&
      (!this.isEditing || this.isWriteLocked)
    ) {
      return;
    }

    if (value === NEW_LAYOUT) {
      this.openPrompt(PROMPT_NEW, "");
      return;
    }
    if (value === RENAME_LAYOUT) {
      this.openPrompt(PROMPT_RENAME, this.layoutName);
      return;
    }
    if (value === DELETE_LAYOUT) {
      if (this.canDeleteLayout) {
        this.openPrompt(PROMPT_DELETE, "");
      }
      return;
    }
    if (value.startsWith(LAYOUT_VALUE_PREFIX)) {
      const layoutId = value.slice(LAYOUT_VALUE_PREFIX.length);
      // Tier 3 stays reachable whatever `isEditing` is — see above — but a
      // switch made *while editing* silently overwrote an unsaved Tier 1
      // draft before this slice: `switchToLayout`'s own `adoptFromStore`
      // replaces `storedLayout` and re-takes the entry snapshot, which is
      // exactly how a Cancel-worthy change disappears with no chance to keep
      // it. Asking first, through the same discard prompt Cancel uses, is
      // this slice's fourth call site for one shared confirmation.
      if (this.isEditing && this.hasUnsavedCanvasChanges) {
        this.openDiscardPrompt({ type: DISCARD_SWITCH, layoutId });
        return;
      }
      this.switchToLayout(layoutId);
    }
  }

  /** Opening a dialog is not a change. Nothing here writes, and nothing may. */
  openPrompt(prompt, draft) {
    this.draftLayoutName = draft;
    this.layoutPrompt = prompt;
  }

  /**
   * Opens the shared discard-confirmation prompt — reusing `openPrompt` and
   * `PROMPT_DISCARD`'s input-less shape rather than a fifth dialog mechanism
   * — and records what confirming it should do. See `pendingDiscardAction`.
   */
  openDiscardPrompt(action) {
    this.pendingDiscardAction = action;
    this.openPrompt(PROMPT_DISCARD, "");
  }

  handleLayoutPromptCancel() {
    this.closePrompt();
  }

  /**
   * Confirms the discard prompt: the unsaved Tier 1 draft is thrown away —
   * whichever of the four call sites asked for that is what actually does
   * the throwing away, by re-running the act that was interrupted to ask —
   * and `pendingDiscardAction` is consumed so a stray second confirm click
   * cannot replay it.
   */
  handleDiscardConfirm() {
    const action = this.pendingDiscardAction;
    this.pendingDiscardAction = undefined;
    this.closePrompt();
    if (!action) {
      return;
    }
    if (action.type === DISCARD_CANCEL) {
      this.cancelEditsNow();
    } else if (action.type === DISCARD_SWITCH) {
      this.switchToLayout(action.layoutId);
    } else if (action.type === NEW_LAYOUT) {
      this.createNewLayout(action.name);
    } else if (action.type === DELETE_LAYOUT) {
      this.deleteCurrentLayout();
    }
  }

  closePrompt() {
    this.layoutPrompt = undefined;
    this.draftLayoutName = "";
    this.pendingDiscardAction = undefined;
  }

  handleLayoutNameChange(event) {
    // Tracked, never dispatched: renaming on every keystroke would put a
    // half-typed name into the store, and into the menu under the caret.
    this.draftLayoutName = event.detail.value;
  }

  handleLayoutNameCommit() {
    const name = (this.draftLayoutName || "").trim();
    const prompt = this.layoutPrompt;
    this.closePrompt();

    if (prompt === PROMPT_NEW) {
      const layoutName = name || NEW_LAYOUT_NAME;
      // New layout replaces the canvas wholesale with a freshly seeded one
      // (`createNewLayout` writes `buildSeededLayout(this.items)`, not the
      // draft) and then re-takes the entry snapshot — so an unsaved Tier 1
      // change is simply gone, with nothing left to Cancel back to, unless
      // this asks first. Third of this slice's four call sites for the one
      // shared discard prompt.
      if (this.hasUnsavedCanvasChanges) {
        this.openDiscardPrompt({ type: NEW_LAYOUT, name: layoutName });
        return;
      }
      this.createNewLayout(layoutName);
      return;
    }
    if (prompt === PROMPT_RENAME) {
      this.renameCurrentLayout(name);
    }
  }

  handleLayoutPromptKeydown(event) {
    if (event.key === "Escape") {
      this.closePrompt();
    }
  }

  handleLayoutDeleteConfirm() {
    this.closePrompt();
    // Deleting the active layout adopts whatever the store says replaces it
    // (`deleteCurrentLayout` -> `adoptFromStore` -> `resnapshotEdit`), which
    // is the same "the draft is simply gone" hazard New layout has above —
    // the fourth and last of this slice's four call sites.
    if (this.hasUnsavedCanvasChanges) {
      this.openDiscardPrompt({ type: DELETE_LAYOUT });
      return;
    }
    this.deleteCurrentLayout();
  }

  /**
   * Switches to one of the user's other layouts.
   *
   * **A pending change is flushed first, and it carries its own layout's id.**
   * This is the exact seam the previous project's bug lived at, from the client
   * side: a debounced save that fired *after* `this.layoutId` had moved would
   * write the layout the user was looking at onto the layout they had just
   * switched to. `save()` captures the id, the name and the payload together
   * at the moment the change is queued, and the flush goes onto the same chain
   * this switch does — so the write lands on the layout the change was made on
   * whatever order things resolve in.
   *
   * The store's answer is adopted rather than the request: `activateLayout`
   * returns every layout with the flags as they now stand, so a client that
   * asked for a layout the store refused is corrected instead of painting a
   * layout the store does not agree is active.
   */
  switchToLayout(layoutId) {
    if (!layoutId || layoutId === this.layoutId) {
      return;
    }
    this.flushPendingSave();
    this.saveChain = this.saveChain
      .then(() => activateLayout({ layoutId }))
      .then((rows) => {
        this.saveErrorMessage = undefined;
        this.adoptFromStore(rows);
        this.announce(`Switched to ${this.layoutName}.`);
      })
      .catch((error) => {
        this.saveErrorMessage = SalesforceNavigator.reduceError(
          error,
          SWITCH_ERROR_MESSAGE
        );
      });
  }

  /**
   * Creates a layout beside the ones the user already has and switches to it.
   *
   * It is seeded exactly as a first open is — every tab the user can reach in
   * one section — rather than started empty. An empty new layout is the blank
   * screen this slice's delete criterion exists to avoid, arrived at from the
   * other direction, and a user who wants fewer items has Remove; a user
   * looking at an empty card has nothing to work from.
   */
  createNewLayout(name) {
    this.flushPendingSave();
    const layoutJson = serializeLayout(buildSeededLayout(this.items));
    // Whether this call's own create is the one `commitLayoutNow` needs to
    // see. A user who already owns a row keeps `this.layoutId` truthy for
    // the whole round trip below — it only changes at the very end, when the
    // `.then` reassigns it to the *new* layout's id — so `commitLayoutNow`'s
    // `!this.layoutId` check is already false for that user throughout, and
    // `creatingLayout` would go unread. See `creatingLayout` for why this is
    // a write-only use of the field here.
    const wasRowless = !this.layoutId;
    // Sixth pass: New layout is one of the four writing controls the lockout
    // disables while any of them has a round trip outstanding. Branched off
    // `created` with its own `.finally()` rather than folded into the
    // `.then()`/`.catch()` above or into what gets assigned to
    // `this.saveChain` below — a second subscriber on the same promise runs
    // on its own schedule and cannot change when `this.saveChain` itself
    // settles, so every other write already chained onto it keeps the exact
    // timing it had before this pass.
    this.beginWrite();
    const created = this.saveChain
      .then(() => createLayout({ name, layoutJson, makeActive: true }))
      .then((saved) => {
        this.saveErrorMessage = undefined;
        if (!saved || !saved.layoutId) {
          return;
        }
        this.layouts = this.layouts.concat([
          SalesforceNavigator.cachedLayout({ ...saved, layoutJson })
        ]);
        this.layoutId = saved.layoutId;
        this.layoutName = saved.name || name;
        this.storedLayout = deserializeLayout(layoutJson);
        this.resnapshotEdit();
        this.announce(`${this.layoutName} created and now showing.`);
      })
      .catch((error) => {
        this.saveErrorMessage = SalesforceNavigator.reduceError(
          error,
          SAVE_ERROR_MESSAGE
        );
      });
    created.finally(() => this.endWrite());
    this.saveChain = created;
    if (wasRowless) {
      // Cleared only if this call's own entry is still the one in the
      // field — see `creatingLayout`. An overridden write that falls
      // through past this `distinct` create (`renameCurrentLayout`'s
      // no-row branch, racing this one) overwrites the field with its own
      // entry before this create resolves; clearing unconditionally here
      // would wipe that write's still-open entry out from under it.
      const mine = {
        promise: created.then(() => {
          if (this.creatingLayout === mine) {
            this.creatingLayout = undefined;
          }
        }),
        distinct: true
      };
      this.creatingLayout = mine;
    }
  }

  /**
   * Renames the layout on screen. `renameLayout` carries no payload, so a
   * rename cannot reach the sections it is a name for.
   *
   * A user with no row yet has nothing to rename on the server, and naming
   * their layout is a real change — so it goes through the ordinary autosave,
   * which creates the row under the new name. Cancelling still writes nothing,
   * because a cancel never reaches here.
   *
   * **A rename the server refuses is taken back off the screen.** The new name
   * is shown immediately, because a rename that waited a round trip to appear
   * would feel broken — but left standing after a rejection it would be a name
   * the store does not hold, in the button and in the menu, and the next
   * unrelated autosave would carry it to `updateLayout` and make it real. So
   * the previous name is restored on failure, and the store's own answer is
   * adopted on success, which is what every other path in this file does.
   */
  renameCurrentLayout(name) {
    if (!name || name === this.layoutName) {
      return;
    }

    if (!this.layoutId) {
      const sessionSnapshot = this.editSnapshot;
      this.layoutName = name;
      this.applyLayout(this.layout);
      // Tier 2 commits on the spot, and this is the one Tier 2 act that has no
      // Apex call of its own: a user with no row is renamed by the write that
      // creates the row, which is the autosave — and in edit mode the autosave
      // writes nothing. Left to the debounce the rename would sit behind a
      // Save it is not supposed to wait for, and be thrown away by a Cancel
      // that is not supposed to reach it.
      //
      // `commitLayoutNow` addresses this write to the entry snapshot rather
      // than to `this.layout`, so the row it creates can never carry a Tier 1
      // draft. Once that write lands, the row holds exactly the snapshot's
      // payload — the same thing a Cancel would restore — so the snapshot's
      // `wasStored` moves from false to true: a Cancel after this point must
      // restore *to* the row the user now owns, not erase it back to
      // `undefined` on a user who by then owns one.
      // Sixth pass: this is one of the two paths that reach `commitLayoutNow`
      // (the other is Save), and Rename layout is one of the four writing
      // controls the lockout disables while any of them has a round trip
      // outstanding. Wrapped around `commitLayoutNow`'s own return value,
      // never around `commitLayoutNow` itself — it already covers its own
      // internal wait-and-retry, since that call does not settle until every
      // recursion has. `commitLayoutNow` can return `undefined` only when
      // `hasLayoutLoadError` holds, which cannot be true in edit mode; the
      // fallback costs one line and removes any dependence on that chain
      // holding forever.
      this.beginWrite();
      const committed = this.commitLayoutNow(
        sessionSnapshot ? sessionSnapshot.json : undefined
      );
      (committed || Promise.resolve()).finally(() => this.endWrite());
      this.announce(`Layout renamed to ${name}.`);
      if (sessionSnapshot && committed) {
        committed.then(() => {
          if (this.layoutId && this.editSnapshot === sessionSnapshot) {
            this.editSnapshot = { ...sessionSnapshot, wasStored: true };
          }
        });
      }
      return;
    }

    const layoutId = this.layoutId;
    const previousName = this.layoutName;
    this.adoptLayoutName(layoutId, name);
    // Sixth pass, same reasoning as the no-row branch above and as
    // `createNewLayout`: branched off `renamed` with its own `.finally()`
    // rather than folded into the chain assigned to `this.saveChain`, so this
    // pass changes nothing about when `this.saveChain` itself settles.
    this.beginWrite();
    const renamed = this.saveChain
      .then(() => renameLayout({ layoutId, name }))
      .then((saved) => {
        this.saveErrorMessage = undefined;
        this.adoptLayoutName(layoutId, (saved && saved.name) || name);
        this.announce(`Layout renamed to ${name}.`);
      })
      .catch((error) => {
        this.adoptLayoutName(layoutId, previousName);
        this.saveErrorMessage = SalesforceNavigator.reduceError(
          error,
          SAVE_ERROR_MESSAGE
        );
      });
    renamed.finally(() => this.endWrite());
    this.saveChain = renamed;
  }

  /**
   * Puts one layout's name to `name` — everywhere this component holds it.
   *
   * The menu button follows **only while that layout is still the one on
   * screen**. If the user has switched since, `this.layoutName` is a different
   * layout's name and is not this rename's to touch, whether the rename
   * succeeded or was refused.
   */
  adoptLayoutName(layoutId, name) {
    this.layouts = this.layouts.map((row) => {
      return row.layoutId === layoutId ? { ...row, name } : row;
    });
    if (this.layoutId === layoutId) {
      this.layoutName = name;
    }
  }

  /**
   * Deletes the layout on screen and adopts whatever the store says the user
   * is left with — which layout succeeds a deleted active one is the
   * controller's decision, not this component's, so the two cannot disagree
   * about it.
   *
   * A pending change is **discarded** rather than flushed: writing a payload to
   * a row that is about to be deleted is work with no reader, and if it failed
   * it would report a save error about a layout that no longer exists.
   */
  deleteCurrentLayout() {
    const layoutId = this.layoutId;
    if (!layoutId) {
      return;
    }
    this.discardPendingSave();
    // Sixth pass, same reasoning as the other three writing controls:
    // branched off `deleted` with its own `.finally()`, so this pass changes
    // nothing about when `this.saveChain` itself settles for whatever is
    // chained onto it next.
    this.beginWrite();
    const deleted = this.saveChain
      .then(() => deleteLayout({ layoutId }))
      .then((rows) => {
        this.saveErrorMessage = undefined;
        this.adoptFromStore(rows);
        this.announce(`Layout deleted. Now showing ${this.layoutName}.`);
      })
      .catch((error) => {
        this.saveErrorMessage = SalesforceNavigator.reduceError(
          error,
          SAVE_ERROR_MESSAGE
        );
      });
    deleted.finally(() => this.endWrite());
    this.saveChain = deleted;
  }

  /**
   * Takes the store's own picture of the user's layouts — which one is active
   * included — after a switch or a delete.
   *
   * An empty list is the first-open state and is adopted as one: no id, no
   * stored layout, and `this.layout` computes the seeded arrangement again.
   * That is the right screen for a user who has just deleted their only
   * layout, and it writes nothing, so they are back to owning no row exactly
   * as they were before they first customised anything.
   */
  adoptFromStore(rows) {
    const readable = (rows || []).filter((row) => row.isReadable !== false);
    this.layouts = readable.map(SalesforceNavigator.cachedLayout);

    const active = SalesforceNavigator.activeRowIn(readable);
    if (!active) {
      this.layoutId = undefined;
      this.layoutName = DEFAULT_LAYOUT_NAME;
      this.storedLayout = undefined;
      this.resnapshotEdit();
      return;
    }
    this.layoutId = active.layoutId;
    this.layoutName = active.name || DEFAULT_LAYOUT_NAME;
    this.storedLayout = deserializeLayout(active.layoutJson);
    this.resnapshotEdit();
  }

  // `page` is the only reactive piece of the wire config — LWC's wire
  // adapter reactivity tracks direct field reassignment of the values named
  // by a `'$fieldName'` config property, not values derived inside a getter
  // or a spread of an object field.
  @wire(getNavItems, {
    formFactor: NAV_ITEMS_CONFIG.formFactor,
    navItemType: NAV_ITEMS_CONFIG.navItemType,
    scope: NAV_ITEMS_CONFIG.scope,
    pageSize: NAV_ITEMS_CONFIG.pageSize,
    page: "$page"
  })
  wiredNavItems({ data, error }) {
    if (data) {
      this.errorMessage = undefined;
      this.pages[this.page] = normalizeNavItems(data);
      this.items = this.pages.flat();

      if (hasMorePages(data)) {
        this.page += 1;
      } else {
        this.isLoadingTabs = false;
      }
    } else if (error) {
      this.isLoadingTabs = false;
      this.items = [];
      this.errorMessage = SalesforceNavigator.reduceError(
        error,
        GENERIC_ERROR_MESSAGE
      );
    }
  }

  /**
   * `fallback` is a parameter because the two failure paths are not the same
   * failure: "we could not load your tabs" is wrong wording for a save that
   * was refused, and a user told to reload the page after a failed save would
   * be told to discard the change.
   */
  static reduceError(error, fallback) {
    if (Array.isArray(error?.body)) {
      return error.body.map((e) => e.message).join(", ") || fallback;
    }
    if (typeof error?.body?.message === "string") {
      return error.body.message;
    }
    return fallback;
  }

  /**
   * The stored layout, or the seeded one for a user who has never changed
   * anything. Computed rather than assigned, so that "no record yet" stays a
   * single fact — `storedLayout === undefined` — instead of a seeded object
   * sitting in state that a later reader could mistake for stored data and
   * write back.
   */
  get layout() {
    return this.storedLayout || buildSeededLayout(this.items);
  }

  /**
   * The render-time access intersection, on every render. A stored item whose
   * tab the running user can no longer reach is simply absent from what this
   * returns; `this.layout` is untouched, which is why restoring access
   * restores the item in its original position and why an autosave triggered
   * by some unrelated change cannot quietly prune it.
   */
  get sections() {
    const resolved = resolveLayout(this.layout, this.items);
    return resolved.map((section) => ({
      ...section,
      isGrabbed: section.index === this.grabbedSectionIndex,
      // Where an item in this section could go: every *other* section. Worked
      // out here because this is the only component that knows there is more
      // than one section — a section knows nothing of its siblings, and an
      // item knows nothing of anything. A section is deliberately absent from
      // its own items' menus: "move this to where it already is" is not an
      // offer, and the drag path refuses the same move for the same reason.
      moveTargets: resolved
        .filter((other) => other.index !== section.index)
        .map((other) => ({ value: String(other.index), label: other.name }))
    }));
  }

  /** Whether an item drag is in flight, which is the sections' cue to show a drop target. */
  get isItemDragActive() {
    return this.dragKind === "item";
  }

  /**
   * The class list bound to the canvas grid in salesforceNavigator.html.
   * `FORM_FACTOR` is read once, from the platform, not from anything this
   * component measures about its own container, so it cannot be changed by
   * resizing or zooming a desktop window (that is the whole reason it was
   * chosen over a media query — see the design). `rstk-nav-sections` always
   * applies; `rstk-nav-sections_small` only joins it on the `Small` form
   * factor, and it is that second class, in salesforceNavigator.css, that
   * collapses the six-track grid to a single full-width track and overrides
   * every section's `.rstk-nav-section_span-N` back down to one.
   */
  get sectionsCanvasClass() {
    return FORM_FACTOR === SMALL_FORM_FACTOR
      ? "rstk-nav-sections rstk-nav-sections_small"
      : "rstk-nav-sections";
  }

  /**
   * Still arriving, and therefore not yet safe to change. Both halves count:
   * a partially paginated tab list would seed `All Items` short, and a layout
   * still in flight would land on top of whatever the user did meanwhile.
   * A wire error outranks it, or a failed tab load would spin forever behind
   * the spinner instead of saying so.
   */
  get isLoading() {
    return !this.hasError && (this.isLoadingTabs || !this.hasLoadedLayout);
  }

  get hasError() {
    return Boolean(this.errorMessage);
  }

  get hasSaveError() {
    return Boolean(this.saveErrorMessage);
  }

  get hasLayoutLoadError() {
    return Boolean(this.layoutLoadErrorMessage);
  }

  get hasItems() {
    return !this.isLoading && !this.hasError && this.items.length > 0;
  }

  /**
   * Whether a change may be made at all. Everything that writes hangs off
   * this: the tab list is complete, so a seed is the whole list; the stored
   * layout has arrived, so nothing will land on top of the change; and the
   * read succeeded, so a save cannot displace a layout we could not read.
   */
  get canEdit() {
    return this.hasItems && !this.hasLayoutLoadError;
  }

  get isEmpty() {
    return !this.isLoading && !this.hasError && this.items.length === 0;
  }

  // -------------------------------------------------------------------
  // Edit mode.
  //
  // Three tiers of act, and the tier decides everything about it. **Tier 1**
  // is the canvas — sections, column counts, items, order. It is gated behind
  // this mode, it is held unwritten until Save, and Cancel reverts it.
  // **Tier 2** is the set of saved layouts — create, rename, delete. It is
  // gated too, because naming and deleting layouts is plainly customisation,
  // but it is not drafted: each of those acts commits through its own Apex
  // call, and rolling one back means undoing DML rather than restoring an
  // in-memory object. **Tier 3** is which saved layout is showing, which is
  // navigation and is not gated at all.
  //
  // The seam that leaves is real and is accepted rather than hidden: a user
  // can enter edit mode, rename a layout, press Cancel, and find the rename
  // still there. The rule a later Navigator control is tested against: if it
  // changes the contents of a layout it is Tier 1; if it changes the set of
  // layouts it is Tier 2; if it changes only which one is showing it is
  // Tier 3.
  // -------------------------------------------------------------------

  handleEditStart() {
    // `canEdit` gates the affordance in the template as well. Asked again here
    // because a mode that cannot save is the one state this must not enter,
    // and a template gate is not a guarantee about a handler.
    if (!this.canEdit || this.isEditing) {
      return;
    }
    // Everything made before this moment belongs to the autosave, not to the
    // draft. A change made a moment ago is still sitting in its debounce, and
    // leaving it there would put a write the user was already promised behind
    // a Save they have not pressed yet — and hand Cancel a change it has no
    // business reverting. Flushing here makes the boundary exact: the snapshot
    // below is what is stored, so "restore what was on screen on entry" and
    // "restore what the store holds" are the same sentence.
    this.flushPendingSave();
    this.editSnapshot = this.captureEditSnapshot();
    this.isEditing = true;
    this.editFocusTarget = EDIT_FOCUS_ENTER;
    this.announce(ENTER_EDIT_ANNOUNCEMENT);
  }

  /**
   * Writes the session's work and leaves.
   *
   * Nothing is written when nothing changed, which is not an optimisation: a
   * user who has only ever looked owns no layout row, and a Save that wrote
   * regardless would create one for anybody who opened the mode and closed it
   * again. The comparison is exact string equality on the canonical payload,
   * so it agrees with the write by construction.
   *
   * **The announcement follows the write, not the button pressed.** A Save
   * with nothing to write leaves edit mode having written nothing — the same
   * as a Cancel — so it says exactly what Cancel says rather than claiming a
   * save that did not happen. `CANCEL_EDIT_ANNOUNCEMENT` is already worded as
   * a fact about the write rather than about the changes; reusing it here
   * holds Save to that same standard instead of inventing a second sentence
   * that says the same thing.
   *
   * **Re-checks `isWriteLocked` on the way in, the same reasoning already
   * applied to `handleEditStart`'s `canEdit` re-check: a template gate — the
   * `disabled` attribute on the Save button — is not a guarantee about a
   * handler.** This is what actually closes the race the sixth pass exists
   * for, not the attribute; see `isWriteLocked`.
   */
  handleEditSave() {
    if (this.isWriteLocked) {
      return;
    }
    const wroteChanges = this.hasUnsavedCanvasChanges;
    if (wroteChanges) {
      this.beginWrite();
      const written = this.commitLayoutNow();
      // `commitLayoutNow` only returns `undefined` when `hasLayoutLoadError`
      // holds, which cannot be true here — reaching Save requires having
      // been in edit mode, which requires `canEdit`, which requires
      // `!hasLayoutLoadError` — but the fallback costs one line and removes
      // any dependence on that chain holding forever.
      (written || Promise.resolve()).finally(() => this.endWrite());
    }
    this.leaveEditMode();
    this.announce(
      wroteChanges ? SAVE_EDIT_ANNOUNCEMENT : CANCEL_EDIT_ANNOUNCEMENT
    );
  }

  /**
   * Cancel, pressed. An untouched session closes silently — there is nothing
   * a confirmation would be protecting. A session with unsaved canvas changes
   * asks first, through the shared discard prompt: the first of this slice's
   * four call sites for it.
   */
  handleEditCancel() {
    if (this.hasUnsavedCanvasChanges) {
      this.openDiscardPrompt({ type: DISCARD_CANCEL });
      return;
    }
    this.cancelEditsNow();
  }

  /**
   * Throws the session's work away and leaves. Writes nothing, and un-writes
   * nothing: a Tier 2 act committed during the session is not this to reach.
   * Run either directly by `handleEditCancel`, when there was nothing to ask
   * about, or by `handleDiscardConfirm`, once the user has said yes.
   */
  cancelEditsNow() {
    // The same belt-and-braces as `disconnectedCallback`'s, and unreachable
    // for the same reason: nothing arms a timer while editing. Kept because it
    // is the difference between a Cancel that writes nothing and a Cancel that
    // writes the draft it has just thrown off the screen.
    this.discardPendingSave();
    this.restoreEditSnapshot();
    this.leaveEditMode();
    this.announce(CANCEL_EDIT_ANNOUNCEMENT);
  }

  /** The canvas as it stands, in the shape `restoreEditSnapshot` reads back. */
  captureEditSnapshot() {
    return {
      json: serializeLayout(this.layout),
      wasStored: this.storedLayout !== undefined
    };
  }

  restoreEditSnapshot() {
    const snapshot = this.editSnapshot;
    if (!snapshot) {
      return;
    }
    this.storedLayout = snapshot.wasStored
      ? deserializeLayout(snapshot.json)
      : undefined;
  }

  /**
   * Re-takes the snapshot after a Tier 2 act has replaced the canvas wholesale.
   *
   * Creating a layout, deleting one and switching to one all put a *different*
   * layout on screen and all commit on the spot. A Cancel that then restored
   * the snapshot taken before one of them would paint the previous layout's
   * sections onto the layout now showing, and hold them there as unwritten
   * draft — reverting a Tier 1 change the user never made, onto a row the
   * revert was never about. No-op out of edit mode, which is why the two call
   * sites can be unconditional.
   */
  resnapshotEdit() {
    if (!this.isEditing) {
      return;
    }
    this.editSnapshot = this.captureEditSnapshot();
  }

  /**
   * Whether Save has anything to write. String equality on the canonical
   * payload — exact, cheap, and it reuses the persistence contract rather than
   * inventing a dirty flag that could disagree with what would be written.
   */
  get hasUnsavedCanvasChanges() {
    if (!this.editSnapshot) {
      return false;
    }
    return serializeLayout(this.layout) !== this.editSnapshot.json;
  }

  /**
   * Whether any of the four writing acts — Save, New layout, Rename layout,
   * Delete layout — has an outstanding round trip. The template disables all
   * four on this, whichever one is actually in flight: the point is that a
   * *second* layout operation cannot be issued inside the first's round trip,
   * not only that the same one cannot be pressed twice.
   */
  get isWriteLocked() {
    return this.writeInFlight > 0;
  }

  /**
   * Call at each of the four writing acts' own entry point — `handleEditSave`,
   * `createNewLayout`, both branches of `renameCurrentLayout`, and
   * `deleteCurrentLayout` — never inside `commitLayoutNow` itself. Wrapping
   * the outer call is what makes this safe to add without touching
   * `commitLayoutNow`'s own wait-and-retry: whatever it returns does not
   * settle until every internal recursion has, so a `.finally(() =>
   * this.endWrite())` on the outer call's own return value already covers the
   * whole window regardless of how many times it recurses, with no risk of
   * this counter going stale mid-wait.
   *
   * Also owns the two accessibility obligations that come with disabling a
   * control the user just pressed: an announcement, since a screen reader
   * user gets no other signal that the four controls just went quiet, and a
   * focus hand-off, since New layout, Rename layout and Delete layout all
   * close the inline prompt they were pressed from (`closePrompt()`) without
   * restoring focus, and none of the three leaves edit mode — see
   * `EDIT_FOCUS_LOCK`. Save is the exception: it always calls `leaveEditMode`
   * in the same handler, and that assigns `EDIT_FOCUS_LEAVE` after this
   * assigns `EDIT_FOCUS_LOCK`, so the later write wins and Save keeps
   * returning focus to the pencil, unchanged.
   *
   * The announcement is gated to the 0→1 transition only, so a call made
   * while another is already outstanding — which `isWriteLocked` and the
   * handler-side re-checks below mean should not happen from a real user
   * gesture, but this stays cheap insurance against announcing "unavailable"
   * twice in a row for one busy period.
   */
  beginWrite() {
    this.writeInFlight += 1;
    if (this.writeInFlight === 1) {
      this.announce(WRITE_LOCK_ANNOUNCEMENT);
    }
    this.editFocusTarget = EDIT_FOCUS_LOCK;
  }

  /** The other half of `beginWrite`. Clears on failure exactly as it does on success — both reach this the same way, through `.finally()` on the act's own promise, never through its `.then()` alone. */
  endWrite() {
    this.writeInFlight = Math.max(0, this.writeInFlight - 1);
  }

  leaveEditMode() {
    this.isEditing = false;
    this.editSnapshot = undefined;
    this.editFocusTarget = EDIT_FOCUS_LEAVE;
    // A Tier 2 prompt is customisation UI and has no business outliving the
    // mode that revealed it: the "New layout…" / "Rename layout…" input and
    // the "Delete layout…" confirmation render on `hasItems`, not on
    // `isEditing`, so leaving edit mode by either route — Save or Cancel —
    // would otherwise leave one standing, with its commit and its confirm
    // button both still wired to act. Closing it here, in the one place edit
    // mode ends, removes the prompt from the DOM outright rather than adding
    // an `isEditing` re-check to each of its two handlers — one guard instead
    // of two, per `rstk-dry-enforcement.md`, and it also fixes the case a
    // handler-side check alone would not: the stale dialog itself, which a
    // screen reader would otherwise still announce as open.
    this.closePrompt();
    // Any keyboard grab still in flight ends with the mode. This is a
    // correctness bug rather than a nicety: `renderedCallback` restores focus
    // to a grabbed card *by index*, and a stale grab pointing at a card that
    // is no longer grabbable makes that restoration silently fight the
    // hand-off above for the same render.
    this.releaseSectionGrab();
    this.cardFocusIndex = undefined;
  }

  // -------------------------------------------------------------------
  // Section operations. Each one hands the whole job to a pure function in
  // navigatorLayoutModel and then schedules a save — there is no layout
  // arithmetic in this file at all.
  // -------------------------------------------------------------------

  handleAddSection() {
    this.applyLayout(addSection(this.layout, NEW_SECTION_NAME));
  }

  handleSectionRename(event) {
    this.applyLayout(
      renameSection(this.layout, event.detail.index, event.detail.name)
    );
  }

  handleSectionColumns(event) {
    this.applyLayout(
      setSectionColumns(this.layout, event.detail.index, event.detail.columns)
    );
  }

  handleSectionDelete(event) {
    this.applyLayout(deleteSection(this.layout, event.detail.index));
  }

  // -------------------------------------------------------------------
  // Reordering. Every path below — an item dropped by a mouse, an item walked
  // by arrow keys, a section card dragged, a section card walked — ends at
  // one of exactly two call sites, `moveItemWithin` and `moveSectionTo`, and
  // both of those hand the arithmetic to `navigatorLayoutModel`. There is no
  // placement maths in this file, and no second copy of it anywhere.
  // -------------------------------------------------------------------

  /**
   * The one call site for a change of item order, whatever asked for it.
   *
   * `from` and `to` are positions in the list on screen, which is the resolved
   * list — an item whose tab the user cannot reach is absent from it, so those
   * positions are not positions in `this.layout`. `this.items` travels with
   * the layout for exactly that reason, and the model does the translation;
   * see the note on the seam in `navigatorLayoutModel`.
   */
  moveItemWithin(sectionIndex, from, to) {
    this.applyLayout(
      moveItemWithinSection(this.layout, this.items, sectionIndex, from, to)
    );
  }

  /** The one call site for a change of section order. */
  moveSectionTo(from, to) {
    this.applyLayout(moveSection(this.layout, from, to));
  }

  /**
   * Both the mouse and the keyboard arrive here — the section works out
   * *which* item goes *where* and this applies it, so neither input route
   * has a placement rule of its own to disagree with the other about.
   */
  handleItemMove(event) {
    const { sectionIndex, from, to } = event.detail;
    this.moveItemWithin(sectionIndex, from, to);
  }

  /**
   * The one call site for a move of an item out of one section and into
   * another, whatever asked for it — a drag or the Move to… menu. The
   * placement is `moveItemBetweenSections`, which does it with the same
   * `reorder` the within-section move uses; there is no placement maths here.
   *
   * `fromIndex` and `toIndex` are positions on screen, so `this.items` goes
   * with the layout — see `moveItemWithin` above. `itemLabelAt` reads the
   * *resolved* list with the *resolved* index, which is why the announcement
   * names the item the user actually chose.
   */
  moveItemBetween(fromSection, fromIndex, toSection, toIndex) {
    // Read before the layout changes underneath them. Naming the destination
    // is the point of the announcement — "moved" on its own tells a screen
    // reader user that something happened and not where it went — and after
    // `applyLayout` the item is no longer at `fromIndex`.
    const label = this.itemLabelAt(fromSection, fromIndex);
    const destination = this.sectionNameAt(toSection);

    this.applyLayout(
      moveItemBetweenSections(
        this.layout,
        this.items,
        fromSection,
        fromIndex,
        toSection,
        toIndex
      )
    );
    this.announce(`${label} moved to ${destination}.`);
  }

  /** The Move to… menu's route in. The drag's route in is `handleSectionDrop`. */
  handleItemMoveTo(event) {
    const { fromSection, fromIndex, toSection } = event.detail;
    // The menu names a section and not a slot, so no destination index is
    // passed and the item goes to the end of that section.
    this.moveItemBetween(fromSection, fromIndex, toSection, undefined);
  }

  /**
   * The one call site for a change of an item's wording, and it is a change of
   * *wording* only: `renameItem` writes `rename` and never `id`, so nothing
   * here can reach the `pageReference` the item navigates to. The rename is
   * also local to this user's own layout row — the store is per-user and the
   * controller filters on `OwnerId` — and nothing on this path writes tab
   * metadata, so no other user's view of the tab and no org label changes.
   *
   * `index` is a position on screen, so `this.items` travels with the layout,
   * exactly as it does for the two move axes — see `moveItemWithin`.
   *
   * Announced from here rather than from the section, and for one reason the
   * section could not work around: when a rename is *cleared*, the wording the
   * item goes back to is the platform's, which is not a thing the section
   * knows until after the parent has applied the change. Reading the resolved
   * label on either side of `applyLayout` names both.
   *
   * **A commit that stores nothing is not applied and not announced.** The
   * item's own guard can only compare the draft against the wording it is
   * shown under, so an empty box committed on an item that has *no* rename
   * still arrives here — asking for the Salesforce label it already has. Left
   * unguarded that schedules a write, which for a user who has only ever
   * looked is the gesture that creates their layout row, against slice 03's
   * criterion; and it announces "Accounts renamed to Accounts." Comparing the
   * payload the change would produce against the current one settles it for
   * every route at once, rather than adding a second rule about wording that
   * would have to agree with the model's.
   */
  handleItemRename(event) {
    const { sectionIndex, index, rename } = event.detail;
    const next = renameItem(
      this.layout,
      this.items,
      sectionIndex,
      index,
      rename
    );
    if (serializeLayout(next) === serializeLayout(this.layout)) {
      return;
    }

    const before = this.itemLabelAt(sectionIndex, index);
    this.applyLayout(next);
    this.announce(
      `${before} renamed to ${this.itemLabelAt(sectionIndex, index)}.`
    );
  }

  // -------------------------------------------------------------------
  // Taking an item out of the layout, and putting one back.
  //
  // The two are inverses and neither keeps a record of anything: an item
  // lives in a layout and nowhere else, so removing it is a deletion from one
  // section and adding it is an insertion into another, with `availableTabs`
  // — the accessible set minus whatever is already placed — as the whole of
  // the "what is there to add" question. That is also why deleting a section
  // returns its items to the picker for free rather than needing a rule of
  // its own: the ids it held stop being anywhere, which is exactly the
  // condition `availableTabs` selects on.
  // -------------------------------------------------------------------

  /**
   * The one call site for taking an item out of the layout.
   *
   * `index` is a position on screen, so `this.items` travels with the layout
   * and `removeItem` does the translation — see `moveItemWithin`. It matters
   * more here than anywhere else on that axis: removing "the item at visible
   * position 2" has to remove the item the user is looking at, and a stored
   * id they cannot currently reach must survive untouched in its own stored
   * position, which is what makes restoring access restore it in place.
   *
   * Both labels are read *before* `applyLayout`, because after it the item is
   * not in the resolved list to be named from.
   */
  handleItemRemove(event) {
    const { sectionIndex, index } = event.detail;
    const label = this.itemLabelAt(sectionIndex, index);
    const from = this.sectionNameAt(sectionIndex);

    const next = removeItem(this.layout, this.items, sectionIndex, index);
    // The same payload-equality guard the rename uses, and for the same
    // reason: a gesture that stores nothing must not schedule a write, or a
    // user who has only ever looked gets a layout row out of it. A removal
    // that names no item on screen is exactly that gesture.
    if (serializeLayout(next) === serializeLayout(this.layout)) {
      return;
    }
    this.applyLayout(next);
    this.announce(`${label} removed from ${from}.`);
  }

  /**
   * Opens the picker for one section, and adds whatever it comes back with.
   *
   * **The section index is captured here and used when the modal resolves**,
   * rather than re-derived at that point: the picker is told the section's
   * *name*, for the heading and for what it calls its entries, and nothing
   * about where the item lands travels through it. So there is no route by
   * which the picker could place an item in a section other than the one it
   * was opened from.
   *
   * **Opening writes nothing, and neither does cancelling.** `open()` resolves
   * with `undefined` when the user cancels or presses Escape — the base
   * component's own gesture — and the guard below is on the resolved value,
   * so the whole of "the user looked and changed their mind" reaches no
   * `applyLayout` at all. That is slice 03's criterion, which a picker that
   * applied unconditionally would break from a new direction.
   *
   * **The edit session is captured here too, not only the section index.**
   * `NavigatorItemPicker` is a `LightningModal`, which outlives this
   * component's own idea of "still editing" — it is mounted on
   * `document.body` and this file asserts nothing about a real browser's
   * modal/focus-trap guarantee that a user cannot act behind it. The button
   * that opens it renders only under `editing`, but the *write* happens when
   * the promise resolves, arbitrarily later, and `this.editSnapshot` at that
   * moment is what tells "still this session" from every other case:
   * `isEditing` alone cannot, because Cancel and Save both leave it `false`,
   * a fresh entry leaves it `true` again with a *different* snapshot object,
   * and a Tier 2 act mid-session (`resnapshotEdit`) replaces the canvas and
   * re-takes the snapshot without ever leaving edit mode at all. See
   * `addChosenItem`'s own guard.
   */
  handleSectionAddItems(event) {
    const sectionIndex = event.detail.index;
    const sectionName = this.sectionNameAt(sectionIndex);
    const session = this.editSnapshot;

    NavigatorItemPicker.open({
      size: "small",
      label: `Add items to ${sectionName}`,
      // Built here because this is the only component that holds both the
      // layout and the live accessible tab list. The picker is handed a list
      // and cannot widen it.
      availableItems: availableTabs(this.layout, this.items),
      sectionName
    }).then((tabId) => {
      this.addChosenItem(sectionIndex, tabId, session);
    });
  }

  /**
   * The one call site for putting an item into a section.
   *
   * **`session` must still be the live one.** A bare `!this.isEditing` check
   * is not enough: it passes for a picker opened in a session that has since
   * ended by Cancel and been followed by an unrelated re-entry, silently
   * landing an old choice on a canvas the user never made it against. Every
   * other case a bare check would get wrong — the mode having ended by Cancel
   * or by Save, or a Tier 2 act mid-session replacing the canvas — falls out
   * of the same one comparison, because each of them either leaves
   * `isEditing` false or gives `editSnapshot` a new identity. No Tier 1
   * mutation may reach `applyLayout` once the session that opened the picker
   * is no longer the one on screen.
   */
  addChosenItem(sectionIndex, tabId, session) {
    // The picker outlives this component — see `isAttached`. A choice that
    // arrives after the user has left the tab must not schedule a save no
    // `disconnectedCallback` will ever flush.
    if (!this.isAttached) {
      return;
    }
    if (!this.isEditing || this.editSnapshot !== session) {
      return;
    }
    if (!tabId) {
      return;
    }
    const next = addItemToSection(this.layout, this.items, sectionIndex, tabId);
    if (serializeLayout(next) === serializeLayout(this.layout)) {
      return;
    }
    this.applyLayout(next);
    // Read *after* the change, because the item is not in the resolved list
    // until it has been added — the mirror of the removal above.
    this.announce(
      `${this.tabLabelOf(tabId)} added to ${this.sectionNameAt(sectionIndex)}.`
    );
  }

  /** What Salesforce currently calls a tab, read from the live source. */
  tabLabelOf(tabId) {
    const tab = this.items.find((candidate) => candidate.id === tabId);
    return tab ? tab.label : "";
  }

  itemLabelAt(sectionIndex, itemIndex) {
    const section = this.sections[sectionIndex];
    const item = section ? section.items[itemIndex] : undefined;
    return item ? item.label : "";
  }

  handleItemDragStart(event) {
    this.dragKind = "item";
    this.dragSectionIndex = event.detail.sectionIndex;
    this.dragItemIndex = event.detail.index;
  }

  handleSectionDragStart(event) {
    this.dragKind = "section";
    this.dragSectionIndex = event.detail.index;
  }

  /**
   * A drop landing on a section — its card, or one of its items with no drag
   * of that section's own behind it. It means one of two entirely different
   * things depending on which drag began, and this is the only component that
   * knows which.
   */
  handleSectionDrop(event) {
    const from = this.dragSectionIndex;
    const fromIndex = this.dragItemIndex;
    const kind = this.dragKind;
    this.clearDrag();

    const to = event.detail.index;

    if (kind === "item") {
      // A drop back onto the section the item came from leaves the layout
      // exactly as it was, and — the part that matters — writes nothing. The
      // order is identical either way, so without this guard the only visible
      // consequence would be a save the user did not ask for. The model
      // refuses the same move independently; this is the half that keeps the
      // autosave out of it. Mirrors the section axis's guard below.
      if (from === undefined || from === to) {
        return;
      }
      // `itemIndex` is present when the drop landed on one of the destination's
      // items and absent when it landed on the card itself, which is exactly
      // the difference between "put it here" and "put it in there".
      this.moveItemBetween(from, fromIndex, to, event.detail.itemIndex);
      return;
    }

    if (kind !== "section" || from === undefined) {
      return;
    }
    if (from === to) {
      return;
    }
    this.moveSectionTo(from, to);
  }

  handleSectionDragEnd() {
    this.clearDrag();
  }

  clearDrag() {
    this.dragKind = undefined;
    this.dragSectionIndex = undefined;
    this.dragItemIndex = undefined;
  }

  // The keyboard equivalent for a whole section card. Same four gestures as
  // an item — Space, arrows, Space, Escape — and the same rule that each
  // arrow press is applied as it happens, so Escape is a real move back to
  // the origin rather than the discarding of an uncommitted preview.

  handleSectionGrab(event) {
    const index = event.detail.index;
    this.grabbedSectionIndex = index;
    this.grabbedSectionOrigin = index;
    this.announce(
      `${this.sectionNameAt(index)} grabbed. ${this.sectionPositionOf(index)}.`
    );
  }

  handleSectionKeyMove(event) {
    const from = event.detail.index;
    const landed = this.sectionLandingIndex(from, from + event.detail.delta);
    const name = this.sectionNameAt(from);

    this.grabbedSectionIndex = landed;
    // Announced even when nothing moved: at either end, silence would leave
    // a screen reader user unable to tell a key that did not register from
    // one that had nowhere to go. Two presses at the same end produce the
    // same sentence, and an unchanged string is no DOM write and therefore
    // no announcement — which is why this goes through `announce`
    // rather than assigning the field directly. See ANNOUNCEMENT_NONCE.
    this.announce(`${name} moved. ${this.sectionPositionOf(landed)}.`);

    if (landed !== from) {
      this.moveSectionTo(from, landed);
    }
  }

  handleSectionKeyDrop(event) {
    const index = event.detail.index;
    this.announce(
      `${this.sectionNameAt(index)} dropped. ${this.sectionPositionOf(index)}.`
    );
    // A drop performs no reorder, so this card survives the render — but the
    // grab is still being released, so the same hand-off the cancel needs is
    // recorded here rather than relying on that happening to stay true.
    this.cardFocusIndex = index;
    this.releaseSectionGrab();
  }

  handleSectionKeyCancel(event) {
    const from = event.detail.index;
    const origin = this.grabbedSectionOrigin;
    const name = this.sectionNameAt(from);
    const landed = origin === undefined ? from : origin;

    if (origin !== undefined && origin !== from) {
      this.moveSectionTo(from, origin);
    }
    this.announce(
      `Move cancelled. ${name} returned. ${this.sectionPositionOf(landed)}.`
    );
    // Recorded *before* the grab is released, and consumed on the render the
    // reorder above schedules — which is the render that destroys the card
    // the user was holding.
    this.cardFocusIndex = landed;
    this.releaseSectionGrab();
  }

  releaseSectionGrab() {
    this.grabbedSectionIndex = undefined;
    this.grabbedSectionOrigin = undefined;
  }

  announce(message) {
    this.announcementNonce = this.announcementNonce ? "" : ANNOUNCEMENT_NONCE;
    this.announcement = message + this.announcementNonce;
  }

  /**
   * Where a section moving from `from` to `to` actually lands, computed by
   * the same `reorder` that will be applied. Calling the model rather than
   * repeating its clamp is the point: an announcement that disagreed with the
   * move would be worse than none, because it would be believed.
   */
  sectionLandingIndex(from, to) {
    const positions = this.sections.map((_section, index) => index);
    return reorder(positions, from, to).indexOf(from);
  }

  sectionNameAt(index) {
    const section = this.sections[index];
    return section ? section.name : "";
  }

  sectionPositionOf(index) {
    return `Position ${index + 1} of ${this.sections.length}`;
  }

  /**
   * A section reorder changes every section's key, so LWC rebuilds the cards
   * and focus goes with the node that was destroyed. A grabbed card whose
   * focus has gone is one a keyboard user can neither move again, drop, nor
   * cancel — the drag becomes unfinishable.
   */
  renderedCallback() {
    // Focus follows the layout dialog, or the gesture is mouse-only: the menu
    // entry that opened it is gone from the DOM by the time it renders, so a
    // keyboard user would otherwise be left with focus on nothing.
    this.focusLayoutPrompt();

    // The same hand-off for the two edit-mode transitions, and for the same
    // reason: each destroys the control the user just activated.
    this.focusEditTransition();

    // A live grab wins, because it is re-asserted on every render for as long
    // as the drag lasts; `cardFocusIndex` is the one-shot hand-off the two
    // gestures that *end* a drag leave behind, and it is consumed here
    // whether or not it was used, so it cannot outlive the render it was set
    // for and steal focus from something else later.
    const target =
      this.grabbedSectionIndex === undefined
        ? this.cardFocusIndex
        : this.grabbedSectionIndex;
    this.cardFocusIndex = undefined;
    if (target === undefined) {
      return;
    }
    const cards = this.template.querySelectorAll("c-navigator-section");
    const grabbed = cards[target];
    if (grabbed && this.template.activeElement !== grabbed) {
      grabbed.focusCard();
    }
  }

  /**
   * Puts focus where an edit-mode transition left it owing. Consumed whether
   * or not it was used, so a hand-off cannot outlive the render it was set for
   * and steal focus from something else later — the same one-shot discipline
   * `cardFocusIndex` carries, and for the same reason.
   */
  focusEditTransition() {
    const transition = this.editFocusTarget;
    if (!transition) {
      return;
    }
    this.editFocusTarget = undefined;
    const selector = EDIT_FOCUS_SELECTORS[transition];
    const control = selector ? this.template.querySelector(selector) : null;
    if (control && this.template.activeElement !== control) {
      control.focus();
    }
  }

  focusLayoutPrompt() {
    if (!this.isNamingLayout) {
      return;
    }
    const input = this.template.querySelector(".rstk-nav-layout-prompt__input");
    if (input && this.template.activeElement !== input) {
      input.focus();
    }
  }

  /**
   * The one place a change becomes stored state. Note what `this.layout`
   * returns on the *first* change: the seeded layout. So a user's first edit
   * persists the seeded arrangement plus that edit, which is exactly what
   * they are looking at — the seeding is not lost by never having been
   * written.
   */
  applyLayout(next) {
    this.storedLayout = next;
    this.scheduleSave();
  }

  /**
   * Which layout is being written, and what to. Captured **at the moment of
   * the change** rather than when the write runs — see `pendingSave` for why
   * that difference is the whole of it — and shared by the debounced path and
   * the two paths that write immediately, so the three cannot disagree about
   * what a save is addressed to.
   *
   * `layoutJson` defaults to the canvas as it stands, which is right for every
   * caller except one: `commitLayoutNow`, mid-edit-session, passes the entry
   * snapshot's payload instead, because "the canvas as it stands" is the Tier
   * 1 draft there — see it for why that distinction exists at all.
   */
  captureSaveTarget(layoutJson = serializeLayout(this.layout)) {
    return {
      layoutId: this.layoutId,
      name: this.layoutName,
      layoutJson
    };
  }

  /**
   * Writes the layout as it stands, now, instead of when a debounce would have
   * fired. `flushPendingSave` cannot do this job: it is a no-op unless a timer
   * is already armed, and in edit mode no timer is ever armed.
   *
   * **"As it stands" is not always `this.layout`, so a caller may override
   * it.** `handleEditSave` calls this with nothing, and there "as it stands"
   * rightly means the current canvas — that write is Save committing the Tier
   * 1 draft the user asked to keep. `renameCurrentLayout`'s no-row branch is
   * different: it is a Tier 2 act, and while editing `this.layout` is that
   * same Tier 1 draft, not what Save would write, because the user has not
   * pressed Save. Committing the draft there the moment a layout is named
   * would carry it to the server behind Cancel's back, which is exactly the
   * write explicit-save exists to prevent — so that caller passes the entry
   * snapshot's payload instead, the canvas as it was and as Cancel would
   * restore it.
   *
   * Returns the save chain so a caller that needs to know when *this*
   * particular write has landed — `renameCurrentLayout`'s no-row branch,
   * to flip `editSnapshot.wasStored` once the row it creates exists — can
   * wait on it.
   *
   * **A create still in flight is made visible to the next call, here and
   * nowhere else.** All three of this file's immediate creates reach this
   * one field: Save and `renameCurrentLayout`'s no-row branch both reach the
   * server *through* this method, and `createNewLayout` — which creates its
   * own, separate row directly off `saveChain` rather than through here —
   * writes the same field for this method's benefit. One shared flag rather
   * than a second one set at the third call site, per
   * `rstk-dry-enforcement.md`. Without it, a second call made before the
   * first create's round trip lands would read `this.layoutId` as still
   * `undefined` — precisely as the first call did — and be captured as
   * another create, leaving the user with two rows and the server's active
   * flag on whichever one lands last. `creatingLayout` names that window: a
   * call made inside it waits for the in-flight create and then calls itself
   * again, so it captures *after* `this.layoutId` is known and lands as an
   * update of the row the first call is creating, never as a second row —
   * **for a create the wait may correctly fold into.** See `creatingLayout`
   * for `distinct`, the flag that says whether it may.
   *
   * **An overridden call never folds into a `distinct` create.**
   * `renameCurrentLayout`'s no-row branch is the one caller that passes
   * `layoutJson`, and doing so means this write is addressed to a specific
   * entry snapshot — a specific act — not to "whichever layout is current".
   * `createNewLayout`'s create is a different act making a different,
   * separate layout; waiting for it and then recapturing would read
   * `this.layoutId` and `this.layoutName` as *its* id and *its* name, which
   * by then they are, and silently turn the override's write into a no-op
   * update of a row it was never addressed to — the act it carried erased
   * rather than committed. So an overridden call falls through instead and
   * makes its own row, addressed to what it was always addressed to: two
   * acts, two rows, both honoured. A bare call (`Save`, `layoutJson` left
   * `undefined`) carries no such identity — it means "whatever is on
   * screen" — so it always waits, `distinct` or not, and recaptures fresh
   * once the wait clears: `captureSaveTarget`'s own default reads
   * `this.layout` fresh regardless of what replaced it while waiting.
   */
  commitLayoutNow(layoutJson) {
    if (this.hasLayoutLoadError) {
      return undefined;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    // **Seventh pass: a surviving mutant across the whole suite, not a bug.**
    // No test in the file discriminates this branch any more — short-
    // circuiting this guard to `if (false)` leaves all 535 tests green — because
    // `isWriteLocked` (see it and `beginWrite`) now refuses a second of the
    // four writing controls before either one can reach here, and two
    // immediate creates racing for the same rowless user is the only
    // precondition this branch exists to arbitrate. Preserved anyway, as
    // defence in depth, per `.claude/rules/rstk-preserve-defensive-checks.md`
    // — not claimed dead by construction, only unproven by the current suite.
    if (!this.layoutId && this.creatingLayout) {
      const inFlight = this.creatingLayout;
      if (layoutJson === undefined || !inFlight.distinct) {
        return inFlight.promise.then(() => {
          // Re-resolves an override against `this.editSnapshot` fresh
          // rather than replaying the value handed in before the wait.
          // **Live, not dead — a prior pass claimed this could not
          // discriminate because "the only thing that ever moves
          // `editSnapshot.json` mid-session is `resnapshotEdit`," and that
          // enumeration was wrong.** Two other things move it: re-entering
          // edit mode re-takes the snapshot on every entry
          // (`handleEditStart`'s `captureEditSnapshot()`), and for a user
          // whose `storedLayout` is `undefined` the snapshot is built from
          // `this.items`, which the tab wire can redeliver on an LDS cache
          // refresh — an ordinary event for a UI API adapter, per the
          // comment on `wiredNavItems` above. A second no-row rename that
          // waits on the first's still-open create can clear that wait
          // after a Cancel, a wire redelivery and a re-entry have moved
          // the snapshot out from under it; replaying the value captured
          // when the wait started would then write a superseded canvas.
          // Re-reading `this.editSnapshot` here is what keeps the write
          // addressed to the entry snapshot as it stands *now*, not as it
          // stood when this call was made.
          //
          // **That liveness predates the lockout and is superseded now, not
          // corrected.** The re-entry/wire-redelivery route above needed two
          // of `creatingLayout`'s writers to hold an entry at once, and
          // `isWriteLocked` forecloses that at the handler level before a
          // second writing control can even be attempted. No test in the
          // suite discriminates this ternary today — collapsing it to a bare
          // `layoutJson` leaves all 535 green — and the lockout is what
          // stands in front of it now. Preserved as defence in depth per
          // `.claude/rules/rstk-preserve-defensive-checks.md`, not deleted;
          // not claimed dead by construction, only unproven by the current
          // suite.
          const resolvedOverride =
            layoutJson !== undefined && this.editSnapshot
              ? this.editSnapshot.json
              : layoutJson;
          return this.commitLayoutNow(resolvedOverride);
        });
      }
      // Else: `inFlight` is a distinct act's create (`createNewLayout`'s),
      // and this call carries an override — a specific act of its own. Fall
      // through and make this write's own row rather than folding onto one
      // it was never addressed to.
    }
    this.pendingSave = this.captureSaveTarget(layoutJson);
    const isCreate = !this.pendingSave.layoutId;
    const result = this.save();
    if (isCreate) {
      // Same ownership check as `createNewLayout`'s writer — see
      // `creatingLayout` — so this create's resolution cannot clear a
      // different write's still-open entry out from under it.
      const mine = {
        promise: result.then(() => {
          if (this.creatingLayout === mine) {
            this.creatingLayout = undefined;
          }
        })
      };
      this.creatingLayout = mine;
      return mine.promise;
    }
    return result;
  }

  scheduleSave() {
    // Nothing is written while the stored layout is unknown. The section
    // menus live in a child component and stay operable, so the change is
    // still applied and still on screen — but a write here would create a
    // rival active layout and displace the one we failed to read, and the
    // alert beside the layout says so.
    if (this.hasLayoutLoadError) {
      return;
    }
    // **The whole of the explicit-save suppression, in one place.** Every
    // Tier 1 mutation reaches the store through `applyLayout`, and
    // `applyLayout` reaches the timer through here — so one guard covers all
    // ten call sites. Ten guards at ten call sites is exactly what
    // `.claude/rules/rstk-dry-enforcement.md` exists to prevent.
    //
    // The debounce is neutered by this, not deleted. With every mutation
    // behind edit mode it can no longer legitimately fire — but it is the only
    // thing standing between a future ungated write and a save storm, and
    // removing it is a larger diff than leaving it behind one guard.
    if (this.isEditing) {
      return;
    }
    // **Which layout is being written is decided here — at the moment of the
    // change — and carried to the call.** See `pendingSave`. A burst
    // overwrites it, which is exactly what the debounce coalescing means: the
    // last change in a burst is the state the layout is in.
    this.pendingSave = this.captureSaveTarget();
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }
    // `@lwc/lwc/no-async-operation` exists because a timer can outlive the
    // component that started it and then touch a destroyed instance. The
    // debounce this Outcome asks for cannot be expressed without one, and the
    // exact hazard the rule names is closed above and below: a pending timer
    // is cleared in `disconnectedCallback`, and its work is run there instead
    // rather than abandoned.
    // eslint-disable-next-line @lwc/lwc/no-async-operation
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, AUTOSAVE_DELAY_MS);
  }

  /**
   * Writes a pending change now instead of when its debounce would have fired,
   * onto the same chain everything else uses. Called before a switch and before
   * the component goes away — in both cases there is about to be no later
   * moment at which the timer could usefully fire.
   */
  flushPendingSave() {
    if (!this.saveTimer) {
      return;
    }
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
  }

  /**
   * Drops a pending change without writing it. Only the delete path uses this:
   * a payload written to a row that is about to be deleted has no reader, and
   * a failure would report a save error about a layout that no longer exists.
   */
  discardPendingSave() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    this.pendingSave = undefined;
  }

  /**
   * Puts the change that is waiting onto the save chain.
   *
   * This is the exact seam the previous project's bug lived at. Reading
   * `this.layoutId` here — or inside the chained callback — instead of taking
   * the target `scheduleSave` captured would mean a save queued while looking
   * at one layout, and firing after the user switched, writes the first
   * layout's sections onto the second: the same "one row, two meanings"
   * failure the controller closed on its own side, reopened from the client.
   * The id, the name and the payload are one value taken at one moment, and
   * that moment is when the user made the change.
   */
  save() {
    const target = this.pendingSave;
    this.pendingSave = undefined;
    if (!target) {
      return this.saveChain;
    }
    this.saveChain = this.saveChain.then(() => this.persist(target));
    return this.saveChain;
  }

  /**
   * Whether a write may still be addressed to this layout.
   *
   * `this.layouts` is the store's own answer about what the user owns, replaced
   * wholesale after every switch and every delete, and it is the list the menu
   * is drawn from — so "write only to a layout the menu still lists" needs no
   * second piece of bookkeeping that could fall out of step with the first.
   * Nothing has to remember which ids were deleted, and no number of deletes
   * makes the rule weaker.
   *
   * Asked here at the call rather than when the change was made, and that is
   * the point: `saveChain` puts a delete ahead of anything a later timer
   * queues, so by the time this runs the store has already answered. A delete
   * the store **refused** leaves the row listed, and the change is written
   * normally rather than being lost with it.
   */
  stillExists(layoutId) {
    return this.layouts.some((row) => row.layoutId === layoutId);
  }

  persist(target) {
    // A change made while the delete of its own layout was in flight.
    // `discardPendingSave` covers a change made *before* the gesture; the round
    // trip after it is a window in which `this.layoutId` still names the doomed
    // row, so the change is captured against an id that is about to name
    // nothing. `updateLayout` refuses it and the user is told a save failed —
    // about the layout they had just asked to be rid of, beside a screen
    // already showing its successor. That is exactly the failure
    // `discardPendingSave` exists to prevent, so it is the same rule, applied
    // on the far side of the call as well as the near one. Nothing is lost: the
    // change was made on a layout that no longer exists.
    if (target.layoutId && !this.stillExists(target.layoutId)) {
      return Promise.resolve();
    }

    // **Which layout is active is asked as late as possible, and the id is
    // asked as early as possible — and the asymmetry is the point.** *Where*
    // this payload goes was settled when the change was made, so it is
    // captured. *Whether that layout is the one on screen* is a fact about now:
    // a save queued before a switch and resolving after it must write its
    // payload to the layout it was made on without dragging the active flag
    // back there. A late answer here cannot reach the wrong row, because the
    // row is already decided.
    //
    // **The create branch asks the same question its neighbours already ask,
    // rather than assuming yes.** A create's row has no id yet to compare, so
    // "is this still the one on screen" reads as "is the screen still
    // undecided" — `this.layoutId === undefined` — which is exactly the fact
    // `rememberSaved` checks one step later to decide whether to adopt this
    // row as current at all. Hard-coding `true` here let two creates racing
    // for the same rowless user (this one, and a distinct act's own, e.g.
    // `createNewLayout`) both claim the active flag, and the last to land on
    // the server won regardless of which one `this.layoutId` had already
    // moved on to — the same "one row, two meanings" failure this file exists
    // to keep shut, reached a fourth way.
    const isCurrent = target.layoutId
      ? target.layoutId === this.layoutId
      : this.layoutId === undefined;

    const call = target.layoutId
      ? updateLayout({
          layoutId: target.layoutId,
          name: target.name,
          layoutJson: target.layoutJson,
          makeActive: isCurrent
        })
      : createLayout({
          name: target.name,
          layoutJson: target.layoutJson,
          makeActive: isCurrent
        });

    return call
      .then((saved) => {
        this.saveErrorMessage = undefined;
        this.rememberSaved(target, saved);
      })
      .catch((error) => {
        // Reported beside the layout rather than in place of it: the user's
        // work is still on screen and still correct, and replacing it with an
        // error panel would lose the one copy of the change that failed to
        // save. `layoutId` is deliberately left as it was — a failed update
        // must not become a create on the next change.
        this.saveErrorMessage = SalesforceNavigator.reduceError(
          error,
          SAVE_ERROR_MESSAGE
        );
      });
  }

  /**
   * Records what the store now holds for the layout that was just written, so
   * that switching away and back shows the change without a second read.
   *
   * **A create adopts its id only while this component is still showing the
   * layout that was created.** If the user has switched since, adopting it
   * would point every later save at a layout they are no longer looking at,
   * which is the trap this file exists to keep shut, arrived at by a third
   * route. `target.layoutId` being absent is what makes the call a create;
   * `this.layoutId` being absent is what makes the created layout still the
   * one on screen. Both are required.
   */
  rememberSaved(target, saved) {
    const savedId = saved && saved.layoutId ? saved.layoutId : target.layoutId;
    if (!savedId) {
      return;
    }

    const row = {
      layoutId: savedId,
      name: target.name,
      layoutJson: target.layoutJson
    };
    const known = this.layouts.some(
      (existing) => existing.layoutId === savedId
    );
    this.layouts = known
      ? this.layouts.map((existing) => {
          return existing.layoutId === savedId ? row : existing;
        })
      : this.layouts.concat([row]);

    // **Seventh pass: a surviving mutant now, not corrected.** Two creates
    // racing for the same rowless user — the precondition this guard exists
    // to arbitrate — is exactly what `isWriteLocked` forecloses before either
    // one reaches `persist` at all, so no test in the suite discriminates
    // this guard any more: collapsing it to `if (!target.layoutId)` leaves
    // all 535 green. The lockout is what stands in front of the race this
    // guard was written for; kept as defence in depth per
    // `.claude/rules/rstk-preserve-defensive-checks.md` — not claimed dead by
    // construction, only unproven by the current suite.
    if (!target.layoutId && this.layoutId === undefined) {
      this.layoutId = savedId;
    }
  }
}
