import { LightningElement, wire } from "lwc";
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
 * How long a change waits before it is written. A drag flurry, or six taps
 * down the column-count menu, coalesces into one `update` on one record. It
 * is long enough that a burst is genuinely one save and short enough that a
 * user who changes one thing and closes the tab has already been saved —
 * and `disconnectedCallback` flushes a pending save anyway, so the window is
 * not a place work can be lost.
 */
const AUTOSAVE_DELAY_MS = 1000;

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

  saveTimer;

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
    // A pending debounce must not be dropped on the floor when the user
    // navigates away — that is precisely the "unsaved state to lose" the
    // design says does not exist here.
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
      this.save();
    }
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

    const active = readable.find((row) => row.isActive) || readable[0];
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
   */
  handleSectionAddItems(event) {
    const sectionIndex = event.detail.index;
    const sectionName = this.sectionNameAt(sectionIndex);

    NavigatorItemPicker.open({
      size: "small",
      label: `Add items to ${sectionName}`,
      // Built here because this is the only component that holds both the
      // layout and the live accessible tab list. The picker is handed a list
      // and cannot widen it.
      availableItems: availableTabs(this.layout, this.items),
      sectionName
    }).then((tabId) => {
      this.addChosenItem(sectionIndex, tabId);
    });
  }

  /** The one call site for putting an item into a section. */
  addChosenItem(sectionIndex, tabId) {
    // The picker outlives this component — see `isAttached`. A choice that
    // arrives after the user has left the tab must not schedule a save no
    // `disconnectedCallback` will ever flush.
    if (!this.isAttached) {
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

  scheduleSave() {
    // Nothing is written while the stored layout is unknown. The section
    // menus live in a child component and stay operable, so the change is
    // still applied and still on screen — but a write here would create a
    // rival active layout and displace the one we failed to read, and the
    // alert beside the layout says so.
    if (this.hasLayoutLoadError) {
      return;
    }
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

  save() {
    // Serialised here rather than inside the chained callback so that the
    // payload is the layout as it stood when the debounce fired, not
    // whatever it has become by the time an earlier save resolves.
    const layoutJson = serializeLayout(this.layout);
    this.saveChain = this.saveChain.then(() => this.persist(layoutJson));
    return this.saveChain;
  }

  persist(layoutJson) {
    const call = this.layoutId
      ? updateLayout({
          layoutId: this.layoutId,
          name: this.layoutName,
          layoutJson,
          makeActive: true
        })
      : createLayout({
          name: this.layoutName,
          layoutJson,
          makeActive: true
        });

    return call
      .then((saved) => {
        this.saveErrorMessage = undefined;
        if (saved && saved.layoutId) {
          this.layoutId = saved.layoutId;
        }
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
}
