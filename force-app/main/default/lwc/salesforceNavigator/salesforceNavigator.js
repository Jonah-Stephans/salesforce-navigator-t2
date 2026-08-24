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
  setSectionColumns
} from "c/navigatorLayoutModel";
import getLayouts from "@salesforce/apex/NavigatorLayoutController.getLayouts";
import createLayout from "@salesforce/apex/NavigatorLayoutController.createLayout";
import updateLayout from "@salesforce/apex/NavigatorLayoutController.updateLayout";

const GENERIC_ERROR_MESSAGE =
  "We could not load your tabs. Try reloading the page.";
const SAVE_ERROR_MESSAGE =
  "We could not save your layout. Your last change may not be kept.";

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
  isLoading = true;

  // Undefined means "this user has never changed anything", which is not the
  // same as an empty layout — one is computed on every render, the other is a
  // stored row with no sections in it.
  storedLayout;
  layoutId;
  layoutName = DEFAULT_LAYOUT_NAME;

  saveTimer;

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
    // Imperative rather than wired: the component holds the layout as its own
    // state from the first change onward, so a cached wire re-emission after a
    // save would only ever fight with what the user is looking at.
    getLayouts()
      .then((rows) => {
        this.adoptActiveLayout(rows);
      })
      .catch(() => {
        // A layout that cannot be read is not a reason to show the user
        // nothing: the seeded layout is a complete, usable Navigator. What
        // must not happen is a save overwriting a stored layout we failed to
        // read, and it cannot — `layoutId` stays undefined, so the next
        // change creates a record rather than updating one blindly.
        this.storedLayout = undefined;
      });
  }

  disconnectedCallback() {
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
    const active = layouts.find((row) => row.isActive) || layouts[0];
    if (!active) {
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
        this.isLoading = false;
      }
    } else if (error) {
      this.isLoading = false;
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
    return resolveLayout(this.layout, this.items);
  }

  get hasError() {
    return Boolean(this.errorMessage);
  }

  get hasSaveError() {
    return Boolean(this.saveErrorMessage);
  }

  get hasItems() {
    return !this.isLoading && !this.hasError && this.items.length > 0;
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
