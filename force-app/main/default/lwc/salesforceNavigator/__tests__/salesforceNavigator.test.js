import { createElement } from "lwc";
import SalesforceNavigator from "c/salesforceNavigator";
import { getNavItems } from "lightning/uiAppsApi";
import { getNavigateCalledWith } from "lightning/navigation";
// The picker is a `lightning-modal`, and that module has no stub at all in
// sfdx-lwc-jest. The mock at test/jest-mocks/lightning/modal.js **mounts the
// real component** rather than standing in for it, so the assertions below
// about what the picker lists, what a search finds and what a click on an
// entry does are driven against the component that ships.
import { getOpenModals, resetModals, configOf } from "lightning/modal";
import { MAX_PAGE_SIZE, NAV_ITEMS_CONFIG } from "c/navigatorTabSource";
import {
  SCHEMA_VERSION,
  reorder,
  MIN_COLUMNS,
  MAX_COLUMNS
} from "c/navigatorLayoutModel";
import getLayouts from "@salesforce/apex/NavigatorLayoutController.getLayouts";
import createLayout from "@salesforce/apex/NavigatorLayoutController.createLayout";
import updateLayout from "@salesforce/apex/NavigatorLayoutController.updateLayout";
import activateLayout from "@salesforce/apex/NavigatorLayoutController.activateLayout";
import renameLayout from "@salesforce/apex/NavigatorLayoutController.renameLayout";
import deleteLayout from "@salesforce/apex/NavigatorLayoutController.deleteLayout";
import { readFileSync } from "fs";
import { join } from "path";

// The Apex seam. Without these, `@lwc/jest-transformer` substitutes a plain
// function returning `Promise.resolve()` that records nothing — the same
// shape of gap the repo already closed for `lightning/navigation`, and it
// would make every assertion below about *what was saved* unwritable.
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.getLayouts",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.createLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.updateLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.activateLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.renameLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.deleteLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);

// Five distinct pageReference types were verified against a live org (174
// nav items, API v66.0), two of which — standard__cmsPage and
// standard__directCmpReference — are not on the documented PageReference
// Types page at all. Only one item is exercised end to end here; the point
// is that whichever type the platform sent is what gets navigated to.
const ACCOUNT_ITEM = {
  developerName: "Account",
  label: "Accounts",
  pageReference: {
    type: "standard__objectPage",
    attributes: { objectApiName: "Account", actionName: "home" },
    state: {}
  }
};

const ACTION_HUB_ITEM = {
  developerName: "standard-ActionHub",
  label: "Action Plans",
  pageReference: {
    type: "standard__navItemPage",
    attributes: { apiName: "standard-ActionHub" },
    state: {}
  }
};

const CONTACT_ITEM = {
  developerName: "Contact",
  label: "Contacts",
  pageReference: {
    type: "standard__objectPage",
    attributes: { objectApiName: "Contact", actionName: "home" },
    state: {}
  }
};

const EXISTING_LAYOUT_ID = "a0X000000000001AAA";
const CREATED_LAYOUT_ID = "a0X000000000002AAA";

// One second, matching the component's debounce. Named here rather than
// repeated so a test cannot silently start advancing past a debounce it was
// meant to be sitting inside.
const AUTOSAVE_DELAY_MS = 1000;

function buildItem(index) {
  return {
    developerName: `Custom_Tab_${index}`,
    label: `Custom Tab ${index}`,
    pageReference: {
      type: "standard__navItemPage",
      attributes: { apiName: `Custom_Tab_${index}` },
      state: {}
    }
  };
}

function createNavigator() {
  const element = createElement("c-salesforce-navigator", {
    is: SalesforceNavigator
  });
  document.body.appendChild(element);
  return element;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Items now live inside `c-navigator-section`, and under
 * `@lwc/synthetic-shadow` — which the jest preset loads, so retargeting
 * reproduces faithfully — a parent's `shadowRoot` query cannot see into a
 * child's. This walks the section shadow roots so the assertions themselves
 * stay exactly what they were when items were rendered flat.
 */
function queryItems(element) {
  return Array.from(
    element.shadowRoot.querySelectorAll("c-navigator-section")
  ).flatMap((section) =>
    Array.from(section.shadowRoot.querySelectorAll("c-navigator-item"))
  );
}

function querySections(element) {
  return Array.from(element.shadowRoot.querySelectorAll("c-navigator-section"));
}

/**
 * Every section's item labels on screen, in order, as one array per section.
 * `queryItems` flattens the sections away, which is fine for a within-section
 * reorder and useless for a move *between* sections — the whole question there
 * is which section an item ended up in.
 */
function itemLabelsBySection(element) {
  return querySections(element).map((section) =>
    Array.from(section.shadowRoot.querySelectorAll("c-navigator-item")).map(
      (item) => item.label
    )
  );
}

/** The section headers on screen, in order — the whole Navigator at a glance. */
function sectionNames(element) {
  return querySections(element).map(
    (section) => section.shadowRoot.querySelector("h2").textContent
  );
}

/** The layout the component last sent to Apex, parsed back out of the call. */
/**
 * What a screen reader would voice and a sighted user could see, which is the
 * announcement with every zero-width character taken out of it. The
 * distinguisher that makes a repeated announcement a *new* one is only allowed
 * to live in this gap.
 */
function spoken(text) {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

function lastSavedLayout(apexMock) {
  const calls = apexMock.mock.calls;
  return JSON.parse(calls[calls.length - 1][0].layoutJson);
}

/** Drives one section's overflow menu the way a user would. */
function selectSectionMenuItem(element, sectionIndex, value) {
  const section = querySections(element)[sectionIndex];
  section.shadowRoot
    .querySelector("lightning-button-menu")
    .dispatchEvent(new CustomEvent("select", { detail: { value } }));
}

/**
 * A change to the layout, used as the mutation vehicle wherever a test's
 * actual subject is the save chain's debounce/coalescing/id-handling
 * behaviour rather than any particular control. Chosen over item removal
 * because, like `columns-N`, it can be repeated on the same target with a
 * fresh distinct value each time.
 *
 * Item rename is gated behind edit mode as of slice 04, and `scheduleSave`
 * itself returns early while editing — so a test of the *debounce* has to
 * run out of edit mode, which is exactly where the item's own menu no longer
 * renders at all. This dispatches the `itemrename` the menu would have
 * dispatched directly on the item element instead of opening that (now
 * edit-mode-only) menu, which is what lets these tests keep running out of
 * edit mode. It works unchanged whether or not the fixture can even *reach*
 * edit mode — the two `hasLayoutLoadError` fixtures below have no edit
 * affordance at all — because it never touches the item's own rendered UI,
 * only the event the parent's listeners already respond to regardless of
 * what produced it. Doing this keeps these tests pinning the debounce as the
 * backstop `## Design` calls it — against a *future* ungated write — rather
 * than as a route a user can still reach today.
 */
async function renameFirstItem(element, sectionIndex, value) {
  const item =
    querySections(element)[sectionIndex].shadowRoot.querySelector(
      "c-navigator-item"
    );
  item.dispatchEvent(
    new CustomEvent("itemrename", { detail: { index: 0, rename: value } })
  );
  await flush();
}

/** One rename in a burst: made, rendered, and 100ms of the debounce spent. */
async function burstItemRename(element, value) {
  await renameFirstItem(element, 0, value);
  jest.advanceTimersByTime(100);
}

async function settleAutosave() {
  jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
  await flush();
  await flush();
}

// The four controls the action row can hold. Each is queried by its own class
// rather than by tag: `lightning-button` alone used to name exactly one button
// on this page and now names three, so a bare tag selector would silently
// resolve to whichever the template happens to order first.
const EDIT_AFFORDANCE = "lightning-button-icon.rstk-nav-edit";
const NEW_SECTION_BUTTON = "lightning-button.rstk-nav-new-section";
const EDIT_SAVE_BUTTON = "lightning-button.rstk-nav-edit-save";
const EDIT_CANCEL_BUTTON = "lightning-button.rstk-nav-edit-cancel";

/** Everything in `lightning-card`'s actions slot, in the order it renders. */
function actionRow(element) {
  return Array.from(element.shadowRoot.querySelectorAll('[slot="actions"]'));
}

/** Enters edit mode the way a user does — through the affordance in the top right. */
async function enterEditMode(element) {
  element.shadowRoot.querySelector(EDIT_AFFORDANCE).click();
  await flush();
}

/** Presses Save. Two flushes, because the write goes onto the save chain. */
async function saveEdits(element) {
  element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).click();
  await flush();
  await flush();
}

/**
 * The confirm button on the shared discard-confirmation prompt, or `null`
 * when it is not open. Shared with the dedicated tests of that prompt below,
 * which look the same way for "Keep editing" by its own label.
 */
function discardConfirmButton(element) {
  return (
    Array.from(
      element.shadowRoot.querySelectorAll(
        ".rstk-nav-layout-prompt lightning-button"
      )
    ).find((button) => button.label === "Discard changes") || null
  );
}

/** The decline half of the same prompt — stays editing, throws nothing away. */
function keepEditingButton(element) {
  return (
    Array.from(
      element.shadowRoot.querySelectorAll(
        ".rstk-nav-layout-prompt lightning-button"
      )
    ).find((button) => button.label === "Keep editing") || null
  );
}

/**
 * Presses Cancel the way a user does. If the session is untouched this ends
 * it on the spot; if there is an unsaved canvas change, the shared discard-
 * confirmation prompt opens first, and this confirms it — `cancelEdits`
 * always means "the user successfully cancelled", whichever route that took.
 * The prompt's own asking-versus-declining behaviour has its own dedicated
 * tests, which press the two buttons directly rather than through here.
 */
async function cancelEdits(element) {
  element.shadowRoot.querySelector(EDIT_CANCEL_BUTTON).click();
  await flush();
  const confirmDiscard = discardConfirmButton(element);
  if (confirmDiscard) {
    confirmDiscard.click();
    await flush();
  }
}

/** Presses New section, which only exists in edit mode. */
async function addSection(element) {
  element.shadowRoot.querySelector(NEW_SECTION_BUTTON).click();
  await flush();
}

/**
 * Every element the component moves focus to, in order.
 *
 * `element.shadowRoot.activeElement` is the right assertion for a section card,
 * which is a real `<article tabindex="0">`, and it is useless for the action
 * row: those are `lightning-*` base components, which sfdx-lwc-jest replaces
 * with stubs rendering nothing focusable, so a perfectly deliberate `focus()`
 * leaves `activeElement` null. Both edit-mode transitions also focus a control
 * that does not exist until the render revealing it, so an instance spy cannot
 * be installed in advance either. The call itself is what is left to assert,
 * and it is what this records. See `.claude/rules/lwc-jest-ceilings.md`.
 */
function recordFocusMoves() {
  const moved = [];
  jest
    .spyOn(HTMLElement.prototype, "focus")
    .mockImplementation(function record() {
      moved.push(this);
    });
  return moved;
}

describe("c-salesforce-navigator", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    getLayouts.mockResolvedValue([]);
    createLayout.mockResolvedValue({
      layoutId: CREATED_LAYOUT_ID,
      name: "My Navigator",
      isActive: true
    });
    updateLayout.mockResolvedValue({
      layoutId: EXISTING_LAYOUT_ID,
      name: "My Navigator",
      isActive: true
    });
    // `jest.clearAllMocks()` clears recorded calls but leaves implementations
    // in place, so a fake store installed by one test would otherwise still be
    // answering in the next. Re-declaring the default here is what keeps each
    // test's store its own.
    activateLayout.mockResolvedValue([]);
    renameLayout.mockResolvedValue({});
    deleteLayout.mockResolvedValue([]);
  });

  afterEach(async () => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    // Removing the element runs `disconnectedCallback`, which flushes any
    // save still sitting in the debounce. That save's promise chain must be
    // allowed to settle *here*, before `clearAllMocks` — otherwise its
    // `createLayout` call lands in the next test's microtask queue, on a
    // mock that has already been cleared, and shows up there as a save that
    // test never made.
    jest.runOnlyPendingTimers();
    await flush();
    await flush();
    jest.useRealTimers();
    jest.clearAllMocks();
    // `clearAllMocks` empties a spy's recorded calls but leaves it installed.
    // `recordFocusMoves` spies on a *shared prototype*, so one left in place
    // would swallow every later test's focus() call — including the section
    // card focus restoration, which asserts on activeElement.
    jest.restoreAllMocks();
  });

  it("renders every tab the wire adapter returns, under its platform label", async () => {
    const element = createNavigator();
    getNavItems.emit({
      navItems: [ACCOUNT_ITEM, ACTION_HUB_ITEM]
    });
    await flush();

    const items = queryItems(element);
    expect(items).toHaveLength(2);
    expect(items[0].label).toBe(ACCOUNT_ITEM.label);
    expect(items[1].label).toBe(ACTION_HUB_ITEM.label);
  });

  it("passes each item's stored pageReference through to its child unmodified", async () => {
    const element = createNavigator();
    getNavItems.emit({
      navItems: [ACCOUNT_ITEM]
    });
    await flush();

    const item = queryItems(element)[0];
    expect(item.pageReference).toEqual(ACCOUNT_ITEM.pageReference);
  });

  it("navigates to the platform-supplied pageReference, unmodified, when an item is clicked", async () => {
    const element = createNavigator();
    getNavItems.emit({
      navItems: [ACCOUNT_ITEM]
    });
    await flush();

    const item = queryItems(element)[0];
    const anchor = item.shadowRoot.querySelector("a");
    anchor.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true })
    );

    expect(getNavigateCalledWith().pageReference).toEqual(
      ACCOUNT_ITEM.pageReference
    );
  });

  it("requests more than one page so more than 100 accessible tabs are all listed", async () => {
    // Verified against a live org: the platform's response carries no total
    // `count` field at all — `nextPageUrl` present vs. absent is the actual
    // pagination signal, so that is what this test drives rather than a
    // `count` the platform never returns.
    const firstPage = Array.from({ length: MAX_PAGE_SIZE }, (_, i) =>
      buildItem(i)
    );
    const secondPage = Array.from({ length: 74 }, (_, i) =>
      buildItem(MAX_PAGE_SIZE + i)
    );
    const totalCount = firstPage.length + secondPage.length;

    const element = createNavigator();
    getNavItems.emit({
      navItems: firstPage,
      nextPageUrl:
        "/services/data/v67.0/ui-api/nav-items?formFactor=Large&page=1&pageSize=100"
    });
    await flush();

    // The component must actually have asked the wire adapter for the next
    // page — not merely rendered whatever the test handed it, which is all
    // the assertion below this one can tell us on its own. Asserted against
    // the whole config object, not just `.page`, so that `formFactor`,
    // `navItemType`, `scope` and `pageSize` diverging from NAV_ITEMS_CONFIG
    // (the single source of truth the "one module" criterion relies on) is
    // caught here too — in particular `scope: "visible"`, which is the
    // entire mechanism behind the claim that the component cannot render a
    // tab the running user cannot reach.
    expect(getNavItems.getLastConfig()).toEqual({
      ...NAV_ITEMS_CONFIG,
      page: 1
    });

    getNavItems.emit({ navItems: secondPage, nextPageUrl: null });
    await flush();

    const items = queryItems(element);
    expect(items).toHaveLength(totalCount);
    // And it must stop advancing once the platform reports no further page.
    expect(getNavItems.getLastConfig().page).toBe(1);
  });

  it("does not duplicate items when the wire adapter re-emits the final page after pagination completes", async () => {
    // An LDS cache refresh can redeliver the current page's config at any
    // time — that is a normal event for a UI API adapter, not a contrived
    // one, and it must not grow the rendered list.
    const firstPage = Array.from({ length: MAX_PAGE_SIZE }, (_, i) =>
      buildItem(i)
    );
    const secondPage = Array.from({ length: 74 }, (_, i) =>
      buildItem(MAX_PAGE_SIZE + i)
    );
    const totalCount = firstPage.length + secondPage.length;

    const element = createNavigator();
    getNavItems.emit({
      navItems: firstPage,
      nextPageUrl:
        "/services/data/v67.0/ui-api/nav-items?formFactor=Large&page=1&pageSize=100"
    });
    getNavItems.emit({ navItems: secondPage, nextPageUrl: null });
    await flush();

    let items = queryItems(element);
    expect(items).toHaveLength(totalCount);

    getNavItems.emit({ navItems: secondPage, nextPageUrl: null });
    await flush();

    items = queryItems(element);
    expect(items).toHaveLength(totalCount);
  });

  it("shows a user-facing message rather than a blank panel when the wire adapter errors", async () => {
    const element = createNavigator();
    getNavItems.error({ message: "insufficient access" }, 403, "Forbidden");
    await flush();

    const alert = element.shadowRoot.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(queryItems(element)).toHaveLength(0);
  });

  describe("first open", () => {
    it("shows every reachable tab in one section named All Items", async () => {
      const element = createNavigator();
      getNavItems.emit({
        navItems: [ACCOUNT_ITEM, ACTION_HUB_ITEM, CONTACT_ITEM]
      });
      await flush();

      const sections = querySections(element);
      expect(sections).toHaveLength(1);
      expect(sections[0].shadowRoot.querySelector("h2").textContent).toBe(
        "All Items"
      );
      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Accounts",
        "Action Plans",
        "Contacts"
      ]);
    });

    it("writes no layout record for a user who has only ever looked", async () => {
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();
      // Well past the autosave debounce — nothing scheduled it, so nothing
      // fires. A component that persisted the seeded layout on mount would
      // generate a row for every user who ever opens the tab, to store what
      // the platform already knows.
      await settleAutosave();

      expect(queryItems(element)).toHaveLength(2);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });
  });

  describe("before the Navigator is ready to be changed", () => {
    /** A `getLayouts` the test holds open, so the in-flight window is real. */
    function heldOpenLayouts() {
      let settle;
      const promise = new Promise((resolve) => {
        settle = resolve;
      });
      getLayouts.mockReturnValue(promise);
      return settle;
    }

    /**
     * Hands back the callback the component registered on `getLayouts`, so a
     * test can deliver a layout to `adoptActiveLayout` more than once. The
     * component calls `getLayouts()` exactly once and a promise settles
     * exactly once, so there is no other way to create the condition the
     * guard inside `adoptActiveLayout` exists for — and the guard must hold
     * on its own rather than because the template happens to be gated.
     */
    function capturedLayoutResolution() {
      let deliver;
      getLayouts.mockReturnValue({
        then(onFulfilled) {
          deliver = onFulfilled;
          return { catch() {} };
        }
      });
      return (rows) => deliver(rows);
    }

    function storedRow(layoutId, sectionName) {
      return {
        layoutId,
        name: "My Navigator",
        isActive: true,
        isReadable: true,
        layoutJson: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          sections: [{ name: sectionName, columns: 2, items: [] }]
        })
      };
    }

    it("never assigns over a layout the user is already looking at and has changed", async () => {
      // The other half of the pair the template gate is one half of. The
      // template can only stop `adoptActiveLayout` running *before* the user
      // has anything to change; the guard inside it is what stops a second
      // resolution landing on top of a change they have already made and
      // seen, which is silent data loss.
      const deliver = capturedLayoutResolution();
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      deliver([storedRow(EXISTING_LAYOUT_ID, "Daily work")]);
      await flush();
      expect(sectionNames(element)).toEqual(["Daily work"]);

      await enterEditMode(element);
      await addSection(element);
      expect(sectionNames(element)).toEqual(["Daily work", "New section"]);

      deliver([storedRow("a0X000000000009AAA", "Rival")]);
      await flush();

      expect(sectionNames(element)).toEqual(["Daily work", "New section"]);
    });

    it("offers nothing to change until the stored layout has arrived, so the fetch cannot discard a change", async () => {
      // The window this closes: `getLayouts` is fired without being awaited,
      // and `adoptActiveLayout` assigns `storedLayout` unconditionally. A
      // change made while the fetch was in flight was overwritten by the
      // fetch landing, and the autosave then wrote the pre-change layout
      // back — the user's work gone, with no message.
      const settle = heldOpenLayouts();
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      // The affordance, not "New section": the pencil is now the only
      // customisation control that renders out of edit mode, so it is the one
      // thing whose absence means nothing can be changed yet. Asserting the
      // absence of "New section" here would pass on any build at all, because
      // it is absent out of edit mode whatever the load has done.
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).toBeNull();
      expect(querySections(element)).toHaveLength(0);

      settle([
        {
          layoutId: EXISTING_LAYOUT_ID,
          name: "My Navigator",
          isActive: true,
          layoutJson: JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            sections: [{ name: "Daily work", columns: 2, items: [] }]
          })
        }
      ]);
      await flush();

      expect(sectionNames(element)).toEqual(["Daily work"]);
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      await enterEditMode(element);
      expect(
        element.shadowRoot.querySelector(NEW_SECTION_BUTTON)
      ).not.toBeNull();
      await cancelEdits(element);

      // And the fetch landing is not itself a change.
      await settleAutosave();
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("tells the user when their stored layout could not be read, and saves nothing until it can", async () => {
      // A failed read used to say nothing at all, and the next change called
      // `createLayout(makeActive: true)` — which clears `Is_Active__c` on the
      // user's other layouts. Their real layout was deactivated and, with no
      // switcher in this slice, unreachable.
      getLayouts.mockRejectedValue({ body: { message: "Read timed out" } });

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      const alert = element.shadowRoot.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      expect(alert.textContent).toContain("could not load your saved layout");

      // The seeded Navigator is still there to look at and navigate from.
      expect(queryItems(element)).toHaveLength(2);
      // But nothing may be written: a create here would displace the layout
      // we failed to read — so there is no way into the mode that could write.
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).toBeNull();
      // Stronger than attempting a change and checking nothing saved: there
      // is no control left to attempt one with at all, section-level or
      // otherwise.
      expect(
        querySections(element)[0].shadowRoot.querySelector(
          "lightning-button-menu"
        )
      ).toBeNull();
      expect(
        querySections(element)[0].shadowRoot.querySelector(
          ".rstk-nav-section__add"
        )
      ).toBeNull();
      // The item's own overflow menu is gated the same way as of slice 04,
      // and for the same reason: `canEdit` false means no way into the mode
      // that could write, at every level of the canvas.
      expect(
        querySections(element)[0]
          .shadowRoot.querySelector("c-navigator-item")
          .shadowRoot.querySelector("lightning-button-menu")
      ).toBeNull();
      // Stronger still: actually attempt the change the item's own gated menu
      // would have made, so `scheduleSave`'s own `hasLayoutLoadError` early
      // return stays pinned by a real mutation rather than only by the
      // controls being absent. `renameFirstItem` dispatches the event
      // directly on the item, so it reaches this guard whether or not edit
      // mode is reachable at all.
      await renameFirstItem(element, 0, "Renamed");
      await settleAutosave();

      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("offers no New section button until every page of tabs has arrived", async () => {
      // `New section` sat in `slot="actions"`, outside the isLoading/hasItems
      // gate. Clicking it after page 1 of 2 froze a seed of only the pages
      // received so far into the store; the rest were in no section, and this
      // slice ships no picker to get them back.
      const firstPage = Array.from({ length: MAX_PAGE_SIZE }, (_, i) =>
        buildItem(i)
      );
      const secondPage = [
        buildItem(MAX_PAGE_SIZE),
        buildItem(MAX_PAGE_SIZE + 1)
      ];

      const element = createNavigator();
      getNavItems.emit({
        navItems: firstPage,
        nextPageUrl:
          "/services/data/v67.0/ui-api/nav-items?formFactor=Large&page=1&pageSize=100"
      });
      await flush();

      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).toBeNull();

      getNavItems.emit({ navItems: secondPage, nextPageUrl: null });
      await flush();

      await enterEditMode(element);
      await addSection(element);
      await saveEdits(element);

      // Every reachable tab, not just the pages that had arrived.
      expect(lastSavedLayout(createLayout).sections[0].items).toHaveLength(
        firstPage.length + secondPage.length
      );
    });
  });

  describe("a layout row this version cannot read", () => {
    // What `getLayouts` returns for a row whose payload the controller could
    // not read: flagged rather than raised, with no `layoutJson` at all and
    // the reason it could not be read. The client half of that contract is
    // what this block holds down.
    const UNREADABLE_ACTIVE_ROW = {
      layoutId: "a0X000000000003AAA",
      name: "Written by a newer Navigator",
      isActive: true,
      schemaVersion: 99,
      isReadable: false,
      unreadableReason:
        "This layout was saved at schema version 99, which this version of the Navigator cannot read.",
      layoutJson: null
    };

    const READABLE_ROW = {
      layoutId: EXISTING_LAYOUT_ID,
      name: "My Navigator",
      isActive: false,
      isReadable: true,
      layoutJson: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        sections: [
          { name: "Daily work", columns: 2, items: [{ id: "Account" }] }
        ]
      })
    };

    it("adopts the readable layout beside it rather than the unreadable active one", async () => {
      // The unreadable row is the *active* one, so a client that did not
      // filter it out would adopt it — and `deserializeLayout(null)` is a
      // layout with no sections, so every tab the user has would vanish from
      // the screen with nothing said about it.
      getLayouts.mockResolvedValue([READABLE_ROW, UNREADABLE_ACTIVE_ROW]);

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      expect(sectionNames(element)).toEqual(["Daily work"]);
      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Accounts"
      ]);
    });

    it("says so, names what an administrator needs, and saves nothing", async () => {
      getLayouts.mockResolvedValue([READABLE_ROW, UNREADABLE_ACTIVE_ROW]);

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      const alert = element.shadowRoot.querySelector('[role="alert"]');
      expect(alert).not.toBeNull();
      // Not the reload wording: every reload reproduces this row, so telling
      // the user to reload is telling them to do the one thing that cannot
      // work. What they can act on is handing the reason to an administrator.
      expect(alert.textContent).not.toContain("Reload the page");
      expect(alert.textContent).toContain("administrator");
      expect(alert.textContent).toContain(
        UNREADABLE_ACTIVE_ROW.unreadableReason
      );

      // And no write, because every write this component makes passes
      // `makeActive: true` and would deactivate the row it cannot read.
      // Stronger than attempting a change and checking nothing saved: there
      // is no control left to attempt one with at all, section-level or
      // otherwise.
      expect(
        querySections(element)[0].shadowRoot.querySelector(
          "lightning-button-menu"
        )
      ).toBeNull();
      expect(
        querySections(element)[0].shadowRoot.querySelector(
          ".rstk-nav-section__add"
        )
      ).toBeNull();
      // The item's own overflow menu is gated the same way as of slice 04,
      // and for the same reason: `canEdit` false means no way into the mode
      // that could write, at every level of the canvas.
      expect(
        querySections(element)[0]
          .shadowRoot.querySelector("c-navigator-item")
          .shadowRoot.querySelector("lightning-button-menu")
      ).toBeNull();
      // Stronger still: actually attempt the change the item's own gated menu
      // would have made, so `scheduleSave`'s own `hasLayoutLoadError` early
      // return stays pinned by a real mutation rather than only by the
      // controls being absent. `renameFirstItem` dispatches the event
      // directly on the item, so it reaches this guard whether or not edit
      // mode is reachable at all.
      await renameFirstItem(element, 0, "Renamed");
      await settleAutosave();

      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
      // The change is still on screen, and the Navigator is not empty.
      expect(sectionNames(element)).toEqual(["Daily work"]);
    });

    it("keeps the reload wording for a read that merely failed", async () => {
      // The two conditions are not the same failure. A rejected read is
      // transient, so reloading is the right advice; an unreadable row
      // reproduces forever, so it is not.
      getLayouts.mockRejectedValue({ body: { message: "Read timed out" } });

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      const alert = element.shadowRoot.querySelector('[role="alert"]');
      expect(alert.textContent).toContain("Reload the page");
      expect(alert.textContent).not.toContain("administrator");
    });
  });

  describe("sections, names and column counts", () => {
    async function navigatorWithTabs() {
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();
      return element;
    }

    it("creates a new section on request, alongside the seeded one", async () => {
      const element = await navigatorWithTabs();

      await enterEditMode(element);
      await addSection(element);

      const names = querySections(element).map(
        (section) => section.shadowRoot.querySelector("h2").textContent
      );
      expect(names).toEqual(["All Items", "New section"]);
    });

    it("renames the section the user renamed, and saves the new name", async () => {
      const element = await navigatorWithTabs();

      await enterEditMode(element);
      selectSectionMenuItem(element, 0, "rename");
      await flush();
      const section = querySections(element)[0];
      const input = section.shadowRoot.querySelector("lightning-input");
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: "Daily work" } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();

      expect(
        querySections(element)[0].shadowRoot.querySelector("h2").textContent
      ).toBe("Daily work");

      await saveEdits(element);
      expect(lastSavedLayout(createLayout).sections[0].name).toBe("Daily work");
    });

    it("deletes the section the user deleted, and saves the layout without it", async () => {
      const element = await navigatorWithTabs();
      await enterEditMode(element);
      await addSection(element);
      expect(querySections(element)).toHaveLength(2);

      selectSectionMenuItem(element, 0, "delete");
      await flush();

      const names = querySections(element).map(
        (section) => section.shadowRoot.querySelector("h2").textContent
      );
      expect(names).toEqual(["New section"]);

      await saveEdits(element);
      expect(
        lastSavedLayout(createLayout).sections.map((section) => section.name)
      ).toEqual(["New section"]);
    });

    it.each([1, 2, 3, 4, 5, 6])(
      "renders the section in %i columns once the user chooses that count, and stores it",
      async (columns) => {
        // A no-op edit-mode Save writes nothing at all (see "writes no
        // layout record for a user who opened edit mode, changed nothing and
        // pressed Save" below), so the layout has to start at a column count
        // other than the one being chosen this iteration, or the pass
        // landing on the seeded default of 3 would have nothing to save.
        const startColumns =
          columns === MIN_COLUMNS ? MAX_COLUMNS : MIN_COLUMNS;
        getLayouts.mockResolvedValue([
          {
            layoutId: EXISTING_LAYOUT_ID,
            name: "My Navigator",
            isActive: true,
            layoutJson: JSON.stringify({
              schemaVersion: SCHEMA_VERSION,
              sections: [
                {
                  name: "All Items",
                  columns: startColumns,
                  items: [{ id: "Account" }, { id: "Contact" }]
                }
              ]
            })
          }
        ]);
        const element = await navigatorWithTabs();

        await enterEditMode(element);
        selectSectionMenuItem(element, 0, `columns-${columns}`);
        await flush();

        const section = querySections(element)[0];
        const grid = section.shadowRoot.querySelector("ul");
        expect(grid.className).toContain(`cols-${columns}`);
        // The card's own footprint in the canvas grid follows the same
        // column count — this is what makes the section's width follow how
        // many field columns it holds, rather than every card stretching to
        // the same full width regardless. Asserted on `section` itself, the
        // `<c-navigator-section>` host and `.rstk-nav-sections`'s actual
        // direct child — not on the `<article>` inside its shadow root,
        // which the canvas grid never lays out and which carried no span
        // class this component could ever style with `grid-column`.
        expect(section.className).toContain(`rstk-nav-section_span-${columns}`);
        // And only that one — a host carrying two of the mutually-exclusive
        // rstk-nav-section_span-1…-6 classes renders at whichever the
        // stylesheet happens to order last, and a toContain check alone
        // stays green on it. Run at every column count, not a single pinned
        // one, so a duplicate emitted for only some counts cannot hide
        // behind the one case a narrower guard would have checked. Same
        // shape as navigatorSection.test.js's cols-N uniqueness guard
        // (lines 199-204).
        const appliedSpans = section.className
          .split(/\s+/)
          .filter((name) => /^rstk-nav-section_span-\d+$/.test(name));
        expect(appliedSpans).toEqual([`rstk-nav-section_span-${columns}`]);

        await saveEdits(element);
        // `updateLayout`, not `createLayout`: the fixture now starts from an
        // existing stored layout so every iteration has something to change
        // away from — see the comment above.
        expect(lastSavedLayout(updateLayout).sections[0].columns).toBe(columns);
      }
    );
  });

  describe("the sections canvas — width follows columns, side by side", () => {
    // Rendered width is not assertable in jest: jsdom applies no stylesheet
    // and getBoundingClientRect() returns zeros, and row packing is the
    // browser's own CSS Grid auto-placement rather than arithmetic this
    // repo owns — the design is explicit that packing is verified in a real
    // org, not in jest. What jest *can* pin is the stylesheet that ships:
    // the six-track template with its floor and its ceiling, grid-auto-flow
    // doing the packing, overflow-x scrolling once the floor binds, and
    // justify-content keeping the canvas at the left edge once a track hits
    // its ceiling. This is the repo's existing answer for CSS facts jsdom
    // cannot observe — see navigatorSection.test.js's own cols-N stylesheet
    // pin.
    it("lays the canvas out as a six-track grid bounded by a floor and a ceiling", () => {
      const css = readFileSync(
        join(__dirname, "..", "salesforceNavigator.css"),
        "utf8"
      );

      const rule = css.match(/\.rstk-nav-sections\s*\{[^}]*\}/);
      expect(rule).not.toBeNull();
      const body = rule[0];

      expect(body).toContain("display: grid");
      // Driven off MAX_COLUMNS rather than a literal 6: the six tracks here
      // are the CSS's own copy of the same maximum navigatorLayoutModel.js
      // and NavigatorLayoutController.cls each keep — see the trap on the
      // three of them moving in lockstep. A hard-coded `6` in this regex
      // would stay green if the maximum ever moved and the CSS did not.
      //
      // Both the floor and the ceiling are SLDS styling hooks, each carrying
      // its own fallback of the length it used to be hard-coded to —
      // `--slds-g-sizing-13` (10rem) and `--slds-g-sizing-16` (30rem). The
      // ceiling used to be a raw `26rem`, invisible to
      // `no-hardcoded-values-slds2` not because no hook mapped to it but
      // because the rule is property-scoped and never checks
      // `grid-template-columns` — see the trap on this; this regex
      // requires the tokenised form exactly, so a raw length sneaking back
      // into the ceiling — or the wrong hook, or a hook missing its fallback
      // — fails it. Both sit behind the `--rstk-nav-col-min` /
      // `--rstk-nav-col-max` override seam, unchanged.
      expect(body).toMatch(
        new RegExp(
          `grid-template-columns:\\s*repeat\\(\\s*${MAX_COLUMNS}\\s*,\\s*minmax\\(\\s*var\\(--rstk-nav-col-min,\\s*var\\(--slds-g-sizing-13,\\s*10rem\\)\\s*\\)\\s*,\\s*var\\(--rstk-nav-col-max,\\s*var\\(--slds-g-sizing-16,\\s*30rem\\)\\s*\\)\\s*\\)\\s*\\)`
        )
      );
      expect(body).toContain("grid-auto-flow: row");
      expect(body).toContain("justify-content: start");
      // gap and padding are both load-bearing beyond layout: padding is what
      // keeps a section card's box-shadow from clipping against the scroll
      // container's own edge (see the trap on overflow-x coercing overflow-y
      // to auto), and both feed this slice's 1,072px scroll-threshold
      // arithmetic (6 floor tracks + 5 gaps + 2 padding sides). Neither was
      // pinned before; deleting either stayed green under every other
      // assertion here.
      expect(body).toContain("gap: var(--slds-g-spacing-4, 1rem)");
      expect(body).toContain("padding: var(--slds-g-spacing-4, 1rem)");
      expect(body).toContain("overflow-x: auto");
    });

    it("defines a real grid-column span, on this stylesheet, for every column count the menu offers", () => {
      // The mirror of navigatorSection.test.js's cols-N stylesheet pin, but
      // for the span rules — which live here, beside the grid they size,
      // rather than in navigatorSection.css. Driven off MIN_COLUMNS/MAX_COLUMNS
      // for the same reason navigatorSection.test.js's own span coverage was:
      // a hard-coded 1..6 would stay green if the range ever moved and this
      // file's rules did not move with it.
      const css = readFileSync(
        join(__dirname, "..", "salesforceNavigator.css"),
        "utf8"
      );

      for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns += 1) {
        expect(css).toMatch(
          new RegExp(
            `\\.rstk-nav-section_span-${columns}\\s*\\{[^}]*grid-column:\\s*span\\s*${columns}`
          )
        );
      }
    });

    it("puts the section's span class on .rstk-nav-sections's own direct children, not merely somewhere inside them", async () => {
      // This is the trap Finding 1 named: a class-name check on the inner
      // `<article>`, or a stylesheet-text pin, both stay green whether or not
      // the span class ever reaches an actual child of the grid. Before the
      // fix, `.rstk-nav-sections`'s direct children — the `<c-navigator-section>`
      // hosts — carried no class at all, so this failed; the class was being
      // written one shadow root too deep to matter.
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      const canvas = element.shadowRoot.querySelector(".rstk-nav-sections");
      expect(canvas).not.toBeNull();

      const directChildren = Array.from(canvas.children);
      expect(directChildren).toHaveLength(1);
      expect(directChildren[0].tagName.toLowerCase()).toBe(
        "c-navigator-section"
      );
      // The seeded layout's one section holds every reachable tab at
      // DEFAULT_COLUMNS (3) — see navigatorLayoutModel.js.
      expect(directChildren[0].className).toContain("rstk-nav-section_span-3");
      // And only that one — a host carrying two of the mutually-exclusive
      // rstk-nav-section_span-1…-6 classes renders at whichever the
      // stylesheet happens to order last, six tracks wide whatever its
      // column count, and a toContain check alone stays green on it. The
      // same shape as navigatorSection.test.js's cols-N uniqueness guard
      // (lines 199-204), applied here where the span class actually reaches
      // a grid child.
      const appliedSpans = directChildren[0].className
        .split(/\s+/)
        .filter((name) => /^rstk-nav-section_span-\d+$/.test(name));
      expect(appliedSpans).toEqual(["rstk-nav-section_span-3"]);
    });
  });

  describe("the sections canvas on a phone (Small form factor stands the mechanism down)", () => {
    // O8's whole content: on `Small`, the canvas is stood down to a single
    // full-width track and every section spans it, restoring today's shipped
    // behaviour rather than the six-track mechanism above. `## Design`'s own
    // "Test entry points" note applies here exactly as it does to that
    // mechanism: rendered width is not assertable in jest, so what these
    // tests pin is the stylesheet that ships and the one DOM-observable fact
    // this mechanism produces — which class reaches the canvas element —
    // not the pixels that class then produces in a real browser. Whether the
    // canvas actually carries that class on the `Small` form factor itself
    // is covered in salesforceNavigator.smallFormFactor.test.js, a separate
    // file for one mechanical reason: `@salesforce/client/formFactor` is
    // resolved once, when this module is first required, and every other
    // test in this file already depends on it resolving to its unmocked
    // fallback of "Large" — so a form factor override belongs in a file of
    // its own rather than disturbing that shared assumption here.
    it("collapses the canvas to a single full-width track under .rstk-nav-sections.rstk-nav-sections_small, with no floor to overflow and no scroll container", () => {
      const css = readFileSync(
        join(__dirname, "..", "salesforceNavigator.css"),
        "utf8"
      );

      // The compound selector is load-bearing, not stylistic: written as
      // `.rstk-nav-sections_small` alone it is (0,1,0), the same
      // specificity as `.rstk-nav-sections`'s own six-track rule, and wins
      // only because it happens to sit later in this file — moving either
      // block silently brings the six-track template back on `Small`. The
      // compound form is (0,2,0) and wins irrespective of source order. A
      // lone `.rstk-nav-sections_small { … }` rule — even one carrying the
      // right declarations — fails this match.
      const rule = css.match(
        /\.rstk-nav-sections\.rstk-nav-sections_small\s*\{[^}]*\}/
      );
      expect(rule).not.toBeNull();
      // `minmax(0, 1fr)` carries no floor, unlike the six-track template
      // above, so nothing here can overflow the container horizontally.
      expect(rule[0]).toContain("grid-template-columns: minmax(0, 1fr)");
      // And the canvas is put back to not being a scroll container at all
      // on this form factor, rather than merely one with nothing to
      // scroll: `.rstk-nav-sections`'s inherited `overflow-x: auto` forces
      // `overflow-y` to `auto` too, which makes the canvas a clipping
      // context for every dropdown inside it — a property the pre-spec
      // canvas O8 restores never had. `overflow: visible` undoes both axes.
      expect(rule[0]).toContain("overflow: visible");
    });

    it("overrides every span-N rule back down to span 1 while .rstk-nav-sections_small is in force, for every column count the menu offers", () => {
      // Driven off MIN_COLUMNS/MAX_COLUMNS rather than a literal 1..6, for
      // the same reason the six-track pin above is: a hard-coded range would
      // stay green if the maximum ever moved and this override did not move
      // with it. Left un-overridden, a span greater than 1 against the
      // single explicit column of .rstk-nav-sections_small would ask the
      // grid to generate implicit tracks to hold it — sized by
      // grid-auto-columns, not this 1fr track — rather than collapsing to
      // one full-width row.
      const css = readFileSync(
        join(__dirname, "..", "salesforceNavigator.css"),
        "utf8"
      );

      const rule = css.match(
        /\.rstk-nav-sections_small\s*>\s*\.rstk-nav-section_span-1[\s\S]*?\{[^}]*\}/
      );
      expect(rule).not.toBeNull();
      const block = rule[0];

      for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns += 1) {
        expect(block).toContain(
          `.rstk-nav-sections_small > .rstk-nav-section_span-${columns}`
        );
      }
      expect(block).toMatch(/grid-column:\s*span\s*1\b/);
    });

    it("introduces no @media query anywhere in this stylesheet", () => {
      // The trap this closes: a width-keyed breakpoint cannot tell a phone
      // from a zoomed-in desktop, and the zoomed-in desktop is exactly the
      // case the design wants the horizontal scroll bar from (slice 01),
      // not this single-track stand-down. FORM_FACTOR is the only mechanism
      // permitted to choose between them.
      const css = readFileSync(
        join(__dirname, "..", "salesforceNavigator.css"),
        "utf8"
      );
      // Comments are stripped first, so a mention of the string "@media" in
      // prose — such as this file's own comment explaining why one was not
      // used — cannot make this assertion pass without checking anything.
      const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
      expect(withoutComments).not.toMatch(/@media/);
    });

    it("does not put the small-form-factor class on the canvas under this file's own default form factor", async () => {
      // Every other test in this file renders with no
      // `@salesforce/client/formFactor` mock in place, which falls back to
      // this module's own default of "Large" — so this is what every one of
      // those tests' canvas already looks like, asserted directly here
      // rather than only implied by the rest of the file passing.
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      const canvas = element.shadowRoot.querySelector(".rstk-nav-sections");
      expect(canvas).not.toBeNull();
      expect(canvas.className).not.toContain("rstk-nav-sections_small");
    });

    it("does not put the small-form-factor class on the canvas when the viewport narrows under zoom, on the Large form factor", async () => {
      // Acceptance criterion 5's own regression: zooming in on a desktop
      // narrows the viewport in CSS pixels exactly as a phone's viewport is
      // narrow, so a mechanism that reads `window.innerWidth` at all —
      // whether instead of FORM_FACTOR or OR'd alongside it — would
      // mistake one for the other here. `window.innerWidth` is writable in
      // jsdom (default 1024); this sets it well under any plausible phone
      // breakpoint while the form factor stays this file's default, "Large".
      const originalInnerWidth = window.innerWidth;
      window.innerWidth = 375;
      try {
        const element = createNavigator();
        getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
        await flush();

        const canvas = element.shadowRoot.querySelector(".rstk-nav-sections");
        expect(canvas).not.toBeNull();
        expect(canvas.className).not.toContain("rstk-nav-sections_small");
      } finally {
        window.innerWidth = originalInnerWidth;
      }
    });
  });

  describe("surviving a reload", () => {
    it("renders the stored sections, names and column counts rather than the seeded layout", async () => {
      getLayouts.mockResolvedValue([
        {
          layoutId: EXISTING_LAYOUT_ID,
          name: "My Navigator",
          isActive: true,
          schemaVersion: SCHEMA_VERSION,
          layoutJson: JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            sections: [
              { name: "Daily work", columns: 5, items: [{ id: "Contact" }] },
              { name: "Occasional", columns: 1, items: [{ id: "Account" }] }
            ]
          })
        }
      ]);

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      const sections = querySections(element);
      expect(
        sections.map(
          (section) => section.shadowRoot.querySelector("h2").textContent
        )
      ).toEqual(["Daily work", "Occasional"]);
      expect(sections[0].shadowRoot.querySelector("ul").className).toContain(
        "cols-5"
      );
      expect(sections[1].shadowRoot.querySelector("ul").className).toContain(
        "cols-1"
      );
      // And the stored order, not the platform's alphabetical one.
      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Contacts",
        "Accounts"
      ]);
    });

    it("prefers the user's active layout over the first one they own", async () => {
      getLayouts.mockResolvedValue([
        {
          layoutId: "a0X000000000009AAA",
          name: "Old",
          isActive: false,
          layoutJson: JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            sections: [{ name: "Stale", columns: 1, items: [] }]
          })
        },
        {
          layoutId: EXISTING_LAYOUT_ID,
          name: "Current",
          isActive: true,
          layoutJson: JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            sections: [{ name: "Live", columns: 2, items: [] }]
          })
        }
      ]);

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM] });
      await flush();

      expect(
        querySections(element).map(
          (section) => section.shadowRoot.querySelector("h2").textContent
        )
      ).toEqual(["Live"]);
    });
  });

  describe("autosave", () => {
    async function navigatorWithTabs() {
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();
      return element;
    }

    it("saves nothing at all until the debounce elapses", async () => {
      const element = await navigatorWithTabs();

      await renameFirstItem(element, 0, "Renamed once");
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
      await flush();

      expect(createLayout).not.toHaveBeenCalled();
    });

    it("coalesces a burst of rapid changes into one save carrying the last of them", async () => {
      const element = await navigatorWithTabs();

      // Five changes 100ms apart — well inside one debounce window, and
      // written out rather than looped because each has to be awaited and
      // `no-await-in-loop` is on.
      await burstItemRename(element, "Renamed 2");
      await burstItemRename(element, "Renamed 3");
      await burstItemRename(element, "Renamed 4");
      await burstItemRename(element, "Renamed 5");
      await burstItemRename(element, "Renamed 6");
      await settleAutosave();

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).not.toHaveBeenCalled();
      // One save, and it is the *last* change — a debounce that fired on the
      // leading edge would save "Renamed 2" and lose the other four changes.
      expect(lastSavedLayout(createLayout).sections[0].items[0].rename).toBe(
        "Renamed 6"
      );
    });

    it("updates the record the first change created rather than creating a second one", async () => {
      // The trap this guards is the one the controller's two-method split
      // exists for: a client that keeps sending "save" without the id it was
      // given ends up with a new record per change, or worse, silently
      // overwriting whichever layout the server picked.
      const element = await navigatorWithTabs();

      await renameFirstItem(element, 0, "Renamed 2");
      await settleAutosave();
      expect(createLayout).toHaveBeenCalledTimes(1);

      await renameFirstItem(element, 0, "Renamed 3");
      await settleAutosave();

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout.mock.calls[0][0].layoutId).toBe(CREATED_LAYOUT_ID);
      expect(lastSavedLayout(updateLayout).sections[0].items[0].rename).toBe(
        "Renamed 3"
      );
    });

    it("updates the layout it loaded, by that layout's own id, and never creates", async () => {
      getLayouts.mockResolvedValue([
        {
          layoutId: EXISTING_LAYOUT_ID,
          name: "My Navigator",
          isActive: true,
          layoutJson: JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            sections: [
              { name: "Daily work", columns: 2, items: [{ id: "Account" }] }
            ]
          })
        }
      ]);
      const element = await navigatorWithTabs();

      await renameFirstItem(element, 0, "Renamed");
      await settleAutosave();

      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout.mock.calls[0][0].layoutId).toBe(EXISTING_LAYOUT_ID);
    });

    it("never asks the controller to update a null id", async () => {
      const element = await navigatorWithTabs();

      await renameFirstItem(element, 0, "Renamed 2");
      await settleAutosave();
      await renameFirstItem(element, 0, "Renamed 3");
      await settleAutosave();

      for (const call of updateLayout.mock.calls) {
        expect(call[0].layoutId).toBeTruthy();
      }
    });

    it("saves the seeded arrangement along with the first change, so seeding is not lost", async () => {
      const element = await navigatorWithTabs();

      await enterEditMode(element);
      await addSection(element);
      await saveEdits(element);

      const saved = lastSavedLayout(createLayout);
      expect(saved.schemaVersion).toBe(SCHEMA_VERSION);
      expect(saved.sections.map((section) => section.name)).toEqual([
        "All Items",
        "New section"
      ]);
      expect(saved.sections[0].items.map((item) => item.id)).toEqual([
        "Account",
        "Contact"
      ]);
    });

    it("flushes a pending save when the component goes away, rather than dropping it", async () => {
      const element = await navigatorWithTabs();

      await renameFirstItem(element, 0, "Renamed");
      document.body.removeChild(element);
      await flush();

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(lastSavedLayout(createLayout).sections[0].items[0].rename).toBe(
        "Renamed"
      );
    });

    it("keeps the user's change on screen, and its id, when the save is refused", async () => {
      createLayout.mockRejectedValue({
        body: {
          message: "That layout no longer exists, or does not belong to you."
        }
      });
      const element = await navigatorWithTabs();

      await renameFirstItem(element, 0, "Renamed");
      await settleAutosave();

      const item =
        querySections(element)[0].shadowRoot.querySelector("c-navigator-item");
      expect(item.label).toBe("Renamed");
      expect(
        element.shadowRoot.querySelector('[role="alert"]').textContent
      ).toContain("does not belong to you");
    });
  });

  describe("reordering", () => {
    // Three tabs, so a move has a genuine middle and two ends. Driven at the
    // lowest level a test here can reach — a real KeyboardEvent on the
    // anchor, or a hand-rolled drag CustomEvent on it — so the whole chain
    // runs: item handler, section, parent, model, payload.
    const THREE = [ACCOUNT_ITEM, ACTION_HUB_ITEM, CONTACT_ITEM];
    const STORED_IDS = THREE.map((item) => item.developerName);

    // Enters edit mode as part of mounting: pointer dragging and the
    // keyboard grab-move-drop-cancel path are both gated behind it as of
    // slice 05, and every test in this describe drives one gesture or the
    // other. `enterEditMode` also arms `saveEdits` as the one route left to
    // persist a change made here — `scheduleSave`'s own debounce is
    // suppressed while editing, per `## Design`.
    async function navigatorWithThree() {
      const element = createNavigator();
      getNavItems.emit({ navItems: THREE });
      await flush();
      await enterEditMode(element);
      return element;
    }

    function anchorAt(element, index) {
      return queryItems(element)[index].shadowRoot.querySelector("a");
    }

    function grabbedAnchor(element) {
      const item = queryItems(element).find((each) => each.grabbed === true);
      return item ? item.shadowRoot.querySelector("a") : undefined;
    }

    // jsdom 20 defines no DragEvent and no DataTransfer, so nothing here
    // claims to test the browser's dragstart -> dragover -> drop sequence.
    // What it does test is that the handlers wired to those events move the
    // right item to the right place and write the result.
    function dragEvent(type) {
      const event = new CustomEvent(type, {
        bubbles: true,
        cancelable: true,
        composed: true
      });
      Object.defineProperty(event, "dataTransfer", {
        value: {
          store: {},
          setData(format, value) {
            this.store[format] = String(value);
          },
          getData(format) {
            return this.store[format] || "";
          }
        }
      });
      return event;
    }

    function press(anchor, key) {
      anchor.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      );
    }

    function savedItemIds(apexMock, sectionIndex = 0) {
      return lastSavedLayout(apexMock).sections[sectionIndex].items.map(
        (item) => item.id
      );
    }

    async function dragItem(element, from, to) {
      anchorAt(element, from).dispatchEvent(dragEvent("dragstart"));
      anchorAt(element, to).dispatchEvent(dragEvent("dragover"));
      anchorAt(element, to).dispatchEvent(dragEvent("drop"));
      await flush();
    }

    async function walkItem(element, from, steps) {
      press(anchorAt(element, from), " ");
      await flush();
      for (let step = 0; step < Math.abs(steps); step += 1) {
        press(grabbedAnchor(element), steps > 0 ? "ArrowRight" : "ArrowLeft");
        // Sequential on purpose, which is why `no-await-in-loop` does not
        // apply: each arrow press has to be applied and re-rendered before
        // the next one can be aimed at the item's new position. Running them
        // concurrently would press four keys at one position.
        // eslint-disable-next-line no-await-in-loop
        await flush();
      }
      press(grabbedAnchor(element), " ");
      await flush();
    }

    /**
     * Every source and destination in a three-item section, minus the
     * no-op moves — an item dropped where it already is changes nothing and
     * is therefore never written, so there is no payload to compare.
     */
    const MOVES = STORED_IDS.flatMap((_id, from) =>
      STORED_IDS.map((__id, to) => [from, to]).filter(([f, t]) => f !== t)
    );

    async function freshNavigator() {
      jest.clearAllMocks();
      createLayout.mockResolvedValue({ layoutId: CREATED_LAYOUT_ID });
      getLayouts.mockResolvedValue([]);
      return navigatorWithThree();
    }

    it("does not grab an item on Space out of edit mode, and writes nothing", async () => {
      // The composed counterpart of navigatorItem's own unit test: mounted
      // without `enterEditMode`, so this is the state every user starts in.
      const element = createNavigator();
      getNavItems.emit({ navItems: THREE });
      await flush();

      press(anchorAt(element, 0), " ");
      await flush();

      expect(queryItems(element).map((item) => item.grabbed)).toEqual([
        false,
        false,
        false
      ]);
      // The section axis's counterpart of this test asserts the live region
      // on both halves of criterion 2 — no grab and no announcement. This
      // one only checked the flags: a gate that suppressed the grab but
      // still announced would have passed it.
      expect(
        querySections(element)[0].shadowRoot.querySelector("[aria-live]")
          .textContent
      ).toBe("");
      await settleAutosave();
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("moves a dragged item to its new position and writes that order", async () => {
      const element = await navigatorWithThree();

      await dragItem(element, 0, 2);

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Action Plans",
        "Contacts",
        "Accounts"
      ]);

      await saveEdits(element);
      expect(savedItemIds(createLayout)).toEqual([
        "standard-ActionHub",
        "Contact",
        "Account"
      ]);
    });

    it.each(MOVES)(
      "writes the same order for a move from %i to %i whether it was dragged or typed",
      async (from, to) => {
        // The criterion behind this is that one function does the placement.
        // Two paths that agreed on one example could still be two
        // implementations, so every source and destination in the section is
        // required to write the same payload by mouse, by keyboard, and by
        // the model's own `reorder`.
        const dragged = await freshNavigator();
        await dragItem(dragged, from, to);
        await saveEdits(dragged);
        const byMouse = savedItemIds(createLayout);
        document.body.removeChild(dragged);

        const typed = await freshNavigator();
        await walkItem(typed, from, to - from);
        await saveEdits(typed);
        const byKeyboard = savedItemIds(createLayout);
        document.body.removeChild(typed);

        const byModel = reorder(STORED_IDS, from, to);
        expect(byMouse).toEqual(byModel);
        expect(byKeyboard).toEqual(byModel);
      }
    );

    it("still shows the moved item in its new position after a reload", async () => {
      // The criterion is about a page reload and a fresh login, and what
      // reaches a fresh login is the payload. This drags, takes what was
      // actually written, and mounts a second Navigator on it — which is what
      // a reload is, since nothing else survives.
      const element = await navigatorWithThree();
      await dragItem(element, 2, 0);
      await saveEdits(element);
      const written = createLayout.mock.calls[0][0].layoutJson;
      document.body.removeChild(element);
      jest.clearAllMocks();

      getLayouts.mockResolvedValue([
        {
          layoutId: EXISTING_LAYOUT_ID,
          name: "My Navigator",
          isActive: true,
          schemaVersion: SCHEMA_VERSION,
          layoutJson: written
        }
      ]);
      const reloaded = await navigatorWithThree();

      expect(queryItems(reloaded).map((item) => item.label)).toEqual([
        "Contacts",
        "Accounts",
        "Action Plans"
      ]);
    });

    it("still shows a keyboard-moved item in its new position after a reload", async () => {
      // The remount above drives the mouse path. Every other keyboard
      // assertion in this file stops at `savedItemIds`, which reads the
      // payload that was *sent* to Apex — and a test that asserts what was
      // sent is not a test of what was stored. This one takes what was
      // actually written, mounts a second Navigator on it, and asserts what
      // that renders.
      const element = await navigatorWithThree();
      await walkItem(element, 2, -2);
      await saveEdits(element);
      const written = createLayout.mock.calls[0][0].layoutJson;
      document.body.removeChild(element);
      jest.clearAllMocks();

      getLayouts.mockResolvedValue([
        {
          layoutId: EXISTING_LAYOUT_ID,
          name: "My Navigator",
          isActive: true,
          schemaVersion: SCHEMA_VERSION,
          layoutJson: written
        }
      ]);
      const reloaded = await navigatorWithThree();

      expect(queryItems(reloaded).map((item) => item.label)).toEqual([
        "Contacts",
        "Accounts",
        "Action Plans"
      ]);
    });

    it("puts the item back where it started when the drag is cancelled with Escape", async () => {
      const element = await navigatorWithThree();

      press(anchorAt(element, 0), " ");
      await flush();
      press(grabbedAnchor(element), "ArrowRight");
      await flush();
      press(grabbedAnchor(element), "ArrowRight");
      await flush();
      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Action Plans",
        "Contacts",
        "Accounts"
      ]);

      press(grabbedAnchor(element), "Escape");
      await flush();

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Accounts",
        "Action Plans",
        "Contacts"
      ]);
      // A cancelled drag that lands back on the order the session started
      // with is byte-identical to the entry snapshot, so Save — explicit
      // now, rather than a debounce that would have fired regardless — has
      // nothing to write. Before explicit save this asserted that the
      // eventual autosave persisted the reverted order; the equivalent claim
      // now is the stronger one available under the new model: a cancelled
      // drag leaves no write behind at all, not even a redundant one.
      await saveEdits(element);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("keeps a dropped move, so a second Space is not a cancel", async () => {
      // The other half of the Escape test. Without it, an implementation
      // that treated every release as a cancel would pass the one above.
      const element = await navigatorWithThree();

      await walkItem(element, 0, 2);

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Action Plans",
        "Contacts",
        "Accounts"
      ]);
      await saveEdits(element);
      expect(savedItemIds(createLayout)).toEqual([
        "standard-ActionHub",
        "Contact",
        "Account"
      ]);
    });

    it("holds focus on the grabbed item across a move", async () => {
      const element = await navigatorWithThree();

      press(anchorAt(element, 0), " ");
      await flush();
      press(grabbedAnchor(element), "ArrowRight");
      await flush();

      const grabbed = queryItems(element).find((item) => item.grabbed === true);
      expect(grabbed.label).toBe("Accounts");
      expect(grabbed.shadowRoot.activeElement).not.toBeNull();
    });

    it("uses neither aria-grabbed nor aria-dropeffect anywhere in the tree", async () => {
      const element = await navigatorWithThree();
      press(anchorAt(element, 0), " ");
      await flush();

      const attributes = [element.shadowRoot]
        .concat(querySections(element).map((each) => each.shadowRoot))
        .concat(queryItems(element).map((each) => each.shadowRoot))
        .flatMap((root) => Array.from(root.querySelectorAll("*")))
        .flatMap((node) => Array.from(node.attributes).map((at) => at.name));

      expect(attributes).not.toContain("aria-grabbed");
      expect(attributes).not.toContain("aria-dropeffect");
      // The assertion is only worth anything if it is looking at real
      // attributes at all.
      expect(attributes).toContain("aria-describedby");
    });

    describe("the sections themselves", () => {
      const TWO_SECTIONS = {
        layoutId: EXISTING_LAYOUT_ID,
        name: "My Navigator",
        isActive: true,
        schemaVersion: SCHEMA_VERSION,
        layoutJson: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          sections: [
            { name: "First", columns: 2, items: [{ id: "Account" }] },
            { name: "Second", columns: 3, items: [{ id: "Contact" }] },
            { name: "Third", columns: 1, items: [] }
          ]
        })
      };

      // Enters edit mode as part of mounting: section pointer dragging and
      // the section keyboard grab-move-drop-cancel path are both gated
      // behind it as of slice 05, and every test below drives the card as a
      // draggable or keyboard-grabbable thing. `saveEdits`, not
      // `settleAutosave`, is therefore the route these tests use to persist
      // a change — `scheduleSave`'s debounce is suppressed while editing.
      async function navigatorWithSections() {
        getLayouts.mockResolvedValue([TWO_SECTIONS]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();
        await enterEditMode(element);
        return element;
      }

      function cardAt(element, index) {
        return querySections(element)[index].shadowRoot.querySelector(
          "article"
        );
      }

      function savedSectionNames() {
        return lastSavedLayout(updateLayout).sections.map(
          (section) => section.name
        );
      }

      it("does not grab a section card on Space out of edit mode, and writes nothing", async () => {
        // Mounted without `enterEditMode`, so this is the state every user
        // starts in — the composed counterpart of navigatorSection's own
        // unit test.
        getLayouts.mockResolvedValue([TWO_SECTIONS]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();

        expect(sectionNames(element)).toEqual(["First", "Second", "Third"]);
        expect(
          element.shadowRoot.querySelector("[aria-live]").textContent
        ).toBe("");
        await settleAutosave();
        expect(updateLayout).not.toHaveBeenCalled();
      });

      it("reorders the sections when a section card is dragged onto another", async () => {
        const element = await navigatorWithSections();

        cardAt(element, 2).dispatchEvent(
          new CustomEvent("dragstart", { bubbles: true, cancelable: true })
        );
        cardAt(element, 0).dispatchEvent(
          new CustomEvent("drop", { bubbles: true, cancelable: true })
        );
        await flush();

        expect(sectionNames(element)).toEqual(["Third", "First", "Second"]);
        await saveEdits(element);
        expect(savedSectionNames()).toEqual(["Third", "First", "Second"]);
      });

      it("still shows the reordered sections after a reload", async () => {
        const element = await navigatorWithSections();
        cardAt(element, 2).dispatchEvent(
          new CustomEvent("dragstart", { bubbles: true, cancelable: true })
        );
        cardAt(element, 0).dispatchEvent(
          new CustomEvent("drop", { bubbles: true, cancelable: true })
        );
        await flush();
        await saveEdits(element);
        const written = updateLayout.mock.calls[0][0].layoutJson;
        document.body.removeChild(element);
        jest.clearAllMocks();

        getLayouts.mockResolvedValue([
          { ...TWO_SECTIONS, layoutJson: written }
        ]);
        const reloaded = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();

        expect(sectionNames(reloaded)).toEqual(["Third", "First", "Second"]);
      });

      it("still shows keyboard-reordered sections after a reload", async () => {
        // The section axis's own keyboard remount, for the same reason as the
        // item axis's: `savedSectionNames` reads what was sent, not what was
        // stored and read back.
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();
        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })
        );
        await flush();
        cardAt(element, 1).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();
        await saveEdits(element);

        const written = updateLayout.mock.calls[0][0].layoutJson;
        document.body.removeChild(element);
        jest.clearAllMocks();

        getLayouts.mockResolvedValue([
          { ...TWO_SECTIONS, layoutJson: written }
        ]);
        const reloaded = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();

        expect(sectionNames(reloaded)).toEqual(["Second", "First", "Third"]);
      });

      it("reorders the sections from the keyboard, and cancels on Escape", async () => {
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();

        const announcer = element.shadowRoot.querySelector("[aria-live]");
        expect(announcer.getAttribute("aria-live")).toBe("assertive");
        expect(announcer.getAttribute("aria-atomic")).toBe("true");
        expect(announcer.textContent).toContain("First");
        expect(announcer.textContent).toMatch(/position 1 of 3/i);

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })
        );
        await flush();
        expect(sectionNames(element)).toEqual(["Second", "First", "Third"]);
        expect(
          element.shadowRoot.querySelector("[aria-live]").textContent
        ).toMatch(/position 2 of 3/i);

        cardAt(element, 1).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
        );
        await flush();

        expect(sectionNames(element)).toEqual(["First", "Second", "Third"]);
        expect(
          element.shadowRoot.querySelector("[aria-live]").textContent
        ).toMatch(/cancelled/i);
        // A cancelled section drag that lands back on the entry order is
        // byte-identical to the edit-session snapshot, so Save has nothing
        // to write — the stronger, and now available, form of the claim
        // this asserted before explicit save: that a cancelled drag does not
        // leave a stale write behind, up to and including a redundant one.
        await saveEdits(element);
        expect(createLayout).not.toHaveBeenCalled();
        expect(updateLayout).not.toHaveBeenCalled();
      });

      it("reorders the sections when a dragged card is dropped on another card's item", async () => {
        // The positive half of the forwarding path, and the mechanism that
        // makes a whole card a drop target rather than only its margins: an
        // item covers most of a card's surface, so a section dragged onto
        // another card lands on an *item* far more often than on the article.
        // The item stops the native drop (`handleDrop` calls
        // `stopPropagation`), so `handleCardDrop` never sees it — the only
        // route from here to a section reorder is `handleItemDrop`'s
        // `from === undefined` branch forwarding it upward as a `sectiondrop`.
        // The two section-drag tests above both drop on the article itself and
        // never touch this branch.
        const element = await navigatorWithSections();

        cardAt(element, 2).dispatchEvent(
          new CustomEvent("dragstart", { bubbles: true, cancelable: true })
        );
        queryItems(element)[0]
          .shadowRoot.querySelector("a")
          .dispatchEvent(dragEvent("drop"));
        await flush();

        expect(sectionNames(element)).toEqual(["Third", "First", "Second"]);
        await saveEdits(element);
        expect(savedSectionNames()).toEqual(["Third", "First", "Second"]);
      });

      it("moves no card the user never picked up after an abandoned section drag", async () => {
        // `dragend` fires whether or not the drop landed anywhere. If the
        // parent did not clear its drag state there, the stale
        // `dragKind === "section"` would still be sitting in place — and an
        // item drop with no source of its own is forwarded upward as a
        // section drop, which is the mechanism that makes a whole card a drop
        // target. The two together would move a card nobody picked up.
        const element = await navigatorWithSections();

        cardAt(element, 2).dispatchEvent(
          new CustomEvent("dragstart", { bubbles: true, cancelable: true })
        );
        cardAt(element, 2).dispatchEvent(
          new CustomEvent("dragend", { bubbles: true, cancelable: true })
        );
        await flush();

        queryItems(element)[0]
          .shadowRoot.querySelector("a")
          .dispatchEvent(dragEvent("drop"));
        await flush();

        expect(sectionNames(element)).toEqual(["First", "Second", "Third"]);
        // Pressing Save is what makes this discriminating rather than
        // vacuous: `scheduleSave`'s debounce is suppressed while editing
        // regardless of what the abandoned drag left behind, so a
        // `settleAutosave` here would pass whether or not the abandon logic
        // actually cleared the stale drag state.
        await saveEdits(element);
        expect(updateLayout).not.toHaveBeenCalled();
        expect(createLayout).not.toHaveBeenCalled();
      });

      it("writes nothing when a section card is dropped back on itself", async () => {
        // Mounted out of edit mode, deliberately not through
        // `navigatorWithSections`. In edit mode, `saveEdits`'s
        // `hasUnsavedCanvasChanges` guard finds a byte-identical canvas and
        // swallows the write on its own, regardless of whether the
        // short-circuit below fired — the same shape trap 273 names. Out of
        // edit mode the debounce isn't suppressed and carries no content
        // check of its own, so `settleAutosave` is what actually pins the
        // short-circuit: delete `if (from === to) { return; }` from
        // `handleSectionDrop` and this reddens, because the redundant
        // `applyLayout` it would otherwise call arms the debounce on a
        // layout identical to the stored one.
        getLayouts.mockResolvedValue([TWO_SECTIONS]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();

        cardAt(element, 1).dispatchEvent(
          new CustomEvent("dragstart", { bubbles: true, cancelable: true })
        );
        cardAt(element, 1).dispatchEvent(
          new CustomEvent("drop", { bubbles: true, cancelable: true })
        );
        await flush();

        expect(sectionNames(element)).toEqual(["First", "Second", "Third"]);
        await settleAutosave();
        expect(updateLayout).not.toHaveBeenCalled();
        expect(createLayout).not.toHaveBeenCalled();
      });

      it("re-announces a repeated arrow press on a card rather than writing nothing", async () => {
        // The section axis has the same live-region hazard as the item axis:
        // two identical presses at the top of the list produce the same
        // sentence, and an unchanged string is no DOM write and therefore no
        // announcement.
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();
        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true })
        );
        await flush();

        const region = element.shadowRoot.querySelector("[aria-live]");
        const first = region.textContent;
        expect(first).toMatch(/position 1 of 3/i);

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true })
        );
        await flush();

        expect(region.textContent).toMatch(/position 1 of 3/i);
        expect(region.textContent).not.toBe(first);
        // And, as on the item axis, the distinguisher is silent and invisible:
        // the two are the same sentence once the zero-width characters are
        // stripped. The nonce is injected into user-facing announcement text
        // on every arrow press, so a distinguisher that is actually voiced
        // would be heard on every one of them.
        expect(spoken(region.textContent)).toBe(spoken(first));
      });

      it("holds focus on the grabbed card across a section move", async () => {
        // A section reorder changes every section's key, so LWC destroys and
        // rebuilds the card the user is holding. Without focus being put back
        // the drag becomes unfinishable — the user can neither move again,
        // drop, nor cancel.
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();
        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })
        );
        await flush();

        expect(sectionNames(element)).toEqual(["Second", "First", "Third"]);
        const moved = querySections(element)[1];
        expect(element.shadowRoot.activeElement).toBe(moved);
        expect(moved.shadowRoot.activeElement).toBe(cardAt(element, 1));
      });

      it("leaves focus on the origin card when a section move is cancelled", async () => {
        // The cancel performs a real reorder back to the origin, which
        // destroys the card the user was holding just as an arrow press does.
        // Releasing the grab before that render lands would leave focus
        // nowhere at all, stranding a keyboard user on document.body.
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();
        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })
        );
        await flush();
        cardAt(element, 1).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
        );
        await flush();

        expect(sectionNames(element)).toEqual(["First", "Second", "Third"]);
        expect(document.activeElement).not.toBe(document.body);
        const restored = querySections(element)[0];
        expect(element.shadowRoot.activeElement).toBe(restored);
        expect(restored.shadowRoot.activeElement).toBe(cardAt(element, 0));
      });

      it("does not take focus back on a later render once the cancel has been served", async () => {
        // `cardFocusIndex` is a *one-shot* hand-off: it exists for exactly the
        // render the cancel's own reorder schedules, and is consumed there
        // whether or not it was used. Without the clear it never expires, and
        // every later grab-free render — a getNavItems re-emission, a column
        // change, a save-error message — re-runs the hand-off and yanks focus
        // back to that card from wherever the user has since put it.
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();
        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })
        );
        await flush();
        cardAt(element, 1).dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", cancelable: true })
        );
        await flush();
        expect(element.shadowRoot.activeElement).toBe(
          querySections(element)[0]
        );

        // The user moves on and puts focus somewhere else entirely.
        cardAt(element, 0).blur();
        expect(element.shadowRoot.activeElement).toBeNull();

        // Something unrelated re-renders the Navigator. An LDS cache refresh
        // redelivering the final page is an ordinary event for a UI API
        // adapter, not a contrived one.
        getNavItems.emit({ navItems: THREE, nextPageUrl: null });
        await flush();

        expect(element.shadowRoot.activeElement).toBeNull();
      });

      it("keeps a section drop, so a second Space is not a cancel", async () => {
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();
        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true })
        );
        await flush();
        cardAt(element, 1).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();

        expect(sectionNames(element)).toEqual(["Second", "First", "Third"]);
        await saveEdits(element);
        expect(savedSectionNames()).toEqual(["Second", "First", "Third"]);
      });

      it("attaches the section instruction text only while a card is grabbed", async () => {
        const element = await navigatorWithSections();

        expect(cardAt(element, 0).hasAttribute("aria-describedby")).toBe(false);

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();

        expect(cardAt(element, 0).hasAttribute("aria-describedby")).toBe(true);

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();

        expect(cardAt(element, 0).hasAttribute("aria-describedby")).toBe(false);
      });

      it("moves a dragged item into the section it was dropped on, not the card it was dropped on", async () => {
        // The counterpart of the section-axis test above: the same gesture on
        // an *item* drag must move the item, and must not move a card the user
        // never picked up.
        const element = await navigatorWithSections();
        const first = queryItems(element)[0].shadowRoot.querySelector("a");
        const second = queryItems(element)[1].shadowRoot.querySelector("a");

        first.dispatchEvent(dragEvent("dragstart"));
        second.dispatchEvent(dragEvent("drop"));
        await flush();

        expect(sectionNames(element)).toEqual(["First", "Second", "Third"]);
        expect(itemLabelsBySection(element)).toEqual([
          [],
          ["Accounts", "Contacts"],
          []
        ]);
      });
    });

    /**
     * Cross-section movement — a different pattern from the within-section
     * reorder above, and deliberately so. Arrow keys do not cross a section
     * boundary; the item's Move to… menu does, and it is the same menu a
     * mouse user gets.
     *
     * Note what is and is not reachable here. The menu, the announcement, the
     * same-section refusal and the payload that results are ordinary DOM and
     * ordinary events, so all of them are driven end to end. The drag
     * *gesture* is not: jsdom 20 defines no DragEvent and no DataTransfer, so
     * the drag tests below drive the handlers those events are bound to and
     * claim nothing about the browser firing them.
     */
    describe("moving an item into another section", () => {
      const CROSS_SECTION_LAYOUT = {
        layoutId: EXISTING_LAYOUT_ID,
        name: "My Navigator",
        isActive: true,
        schemaVersion: SCHEMA_VERSION,
        layoutJson: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          sections: [
            {
              name: "Selling",
              columns: 2,
              items: [
                { id: "Account", rename: "Clients" },
                { id: "standard-ActionHub" }
              ]
            },
            { name: "Support", columns: 3, items: [{ id: "Contact" }] }
          ]
        })
      };

      async function navigatorWithTwoSections() {
        getLayouts.mockResolvedValue([CROSS_SECTION_LAYOUT]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();
        return element;
      }

      function itemsIn(element, sectionIndex) {
        return Array.from(
          querySections(element)[sectionIndex].shadowRoot.querySelectorAll(
            "c-navigator-item"
          )
        );
      }

      function menuOf(element, sectionIndex, itemIndex) {
        return itemsIn(element, sectionIndex)[
          itemIndex
        ].shadowRoot.querySelector("lightning-button-menu");
      }

      /**
       * The destinations on one item's menu. Filtered rather than taken whole,
       * because the overflow menu carries this item's other actions too —
       * Rename… since slice 06 — so every `lightning-menu-item` in it is no
       * longer a place to move to.
       */
      function menuEntries(element, sectionIndex, itemIndex) {
        return Array.from(
          itemsIn(element, sectionIndex)[itemIndex].shadowRoot.querySelectorAll(
            "lightning-menu-item"
          )
        ).filter((entry) => entry.value.startsWith("move-to-"));
      }

      function savedIds(apexMock, sectionIndex) {
        return lastSavedLayout(apexMock).sections[sectionIndex].items.map(
          (item) => item.id
        );
      }

      /** Picks a destination from an item's Move to… menu, by its label. */
      async function chooseDestination(
        element,
        sectionIndex,
        itemIndex,
        label
      ) {
        const entry = menuEntries(element, sectionIndex, itemIndex).find(
          (each) => each.label === label
        );
        menuOf(element, sectionIndex, itemIndex).dispatchEvent(
          new CustomEvent("select", { detail: { value: entry.value } })
        );
        await flush();
      }

      /**
       * The same two sections, but `Selling` stores a third id the tab source
       * does not return. Every other fixture in this suite stores only ids
       * `getNavItems` reports, which makes the position an item is *rendered*
       * at and the position it is *stored* at the same number everywhere — and
       * a component that confused the two indistinguishable from one that did
       * not.
       */
      const WITHDRAWN_LAYOUT = {
        ...CROSS_SECTION_LAYOUT,
        layoutJson: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          sections: [
            {
              name: "Selling",
              columns: 2,
              items: [
                { id: "Account" },
                { id: "standard-ActionHub" },
                { id: "Contact" }
              ]
            },
            { name: "Support", columns: 3, items: [] }
          ]
        })
      };

      /** Two of the three tabs: `Account` is stored, and out of reach. */
      async function navigatorWithAWithdrawnTab() {
        getLayouts.mockResolvedValue([WITHDRAWN_LAYOUT]);
        const element = createNavigator();
        getNavItems.emit({ navItems: [ACTION_HUB_ITEM, CONTACT_ITEM] });
        await flush();
        return element;
      }

      it("moves the item the user picked, not the one sharing its stored position", async () => {
        const element = await navigatorWithAWithdrawnTab();
        await enterEditMode(element);
        expect(itemLabelsBySection(element)).toEqual([
          ["Action Plans", "Contacts"],
          []
        ]);

        // The first item on screen. It is stored second.
        await chooseDestination(element, 0, 0, "Support");

        expect(itemLabelsBySection(element)).toEqual([
          ["Contacts"],
          ["Action Plans"]
        ]);

        await saveEdits(element);
        // `Account` is still first in `Selling`, so restoring access still
        // restores it in its original position.
        expect(savedIds(updateLayout, 0)).toEqual(["Account", "Contact"]);
        expect(savedIds(updateLayout, 1)).toEqual(["standard-ActionHub"]);
      });

      it("drags the item the user picked up, not the one sharing its stored position", async () => {
        // Mounted in edit mode as of this spec's third fix pass: the drop
        // lands on the destination card's own `<article>`
        // (`handleCardDrop`), which is now gated on `editing` — the fourth
        // of the family's four `dragover`/`drop` handlers to carry that
        // guard. This test's own subject, resolving the dragged item by
        // identity rather than by its rendered position, is an in-edit-mode
        // concern regardless.
        const element = await navigatorWithAWithdrawnTab();
        await enterEditMode(element);
        const dragged = itemsIn(element, 0)[0].shadowRoot.querySelector("a");

        dragged.dispatchEvent(dragEvent("dragstart"));
        querySections(element)[1]
          .shadowRoot.querySelector("article")
          .dispatchEvent(dragEvent("drop"));
        await flush();

        expect(itemLabelsBySection(element)).toEqual([
          ["Contacts"],
          ["Action Plans"]
        ]);
      });

      it("reorders the item the user picked up when an earlier one is out of reach", async () => {
        // Pre-existing from slice 04: the within-section reorder runs the
        // same rendered index into the same stored layout. Fixed at the same
        // seam, so it is pinned here.
        const element = await navigatorWithAWithdrawnTab();
        await enterEditMode(element);

        press(itemsIn(element, 0)[0].shadowRoot.querySelector("a"), " ");
        await flush();
        press(grabbedAnchor(element), "ArrowRight");
        await flush();
        press(grabbedAnchor(element), " ");
        await flush();

        expect(itemLabelsBySection(element)).toEqual([
          ["Contacts", "Action Plans"],
          []
        ]);

        await saveEdits(element);
        expect(savedIds(updateLayout, 0)).toEqual([
          "Account",
          "Contact",
          "standard-ActionHub"
        ]);
      });

      it("does not tell a screen reader the move was cancelled when a grabbed item is moved", async () => {
        // Reachable with a mouse: `handleClick` blocks navigation mid-grab but
        // not focus, and the menu button is a sibling of the anchor. The
        // section's vanish-detection sees the item leave its list and cannot,
        // on its own, tell "moved away" from "withdrawn".
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);

        press(itemsIn(element, 0)[1].shadowRoot.querySelector("a"), " ");
        await flush();

        await chooseDestination(element, 0, 1, "Support");

        const sectionRegion = querySections(
          element
        )[0].shadowRoot.querySelector(".rstk-nav-section__announcer");
        expect(spoken(sectionRegion.textContent)).toBe(
          "Action Plans grabbed. Position 2 of 2."
        );
        expect(
          spoken(
            element.shadowRoot.querySelector(".rstk-nav-announcer").textContent
          )
        ).toBe("Action Plans moved to Support.");
        expect(queryItems(element).some((item) => item.grabbed)).toBe(false);
      });

      it("keeps a grab on the item being held when a sibling is moved out from under it", async () => {
        // Reachable in exactly the way the case above is, and by a *different*
        // item's menu: nothing blocks a sibling's Move to… menu mid-grab. The
        // list the grab counts along renumbers underneath it, so a grab held by
        // position lands on an item the user never picked up — or falls off the
        // end and is falsely reported as cancelled while it is still on screen,
        // contradicting the parent's own announcement about a different item.
        getLayouts.mockResolvedValue([
          {
            ...CROSS_SECTION_LAYOUT,
            layoutJson: JSON.stringify({
              schemaVersion: SCHEMA_VERSION,
              sections: [
                {
                  name: "Selling",
                  columns: 2,
                  items: [
                    { id: "Account" },
                    { id: "standard-ActionHub" },
                    { id: "Contact" }
                  ]
                },
                { name: "Support", columns: 3, items: [] }
              ]
            })
          }
        ]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();
        await enterEditMode(element);

        // Hold the last of the three.
        press(itemsIn(element, 0)[2].shadowRoot.querySelector("a"), " ");
        await flush();

        // Move the *first* one out, from its own menu.
        await chooseDestination(element, 0, 0, "Support");

        expect(itemLabelsBySection(element)).toEqual([
          ["Action Plans", "Contacts"],
          ["Accounts"]
        ]);
        expect(
          queryItems(element)
            .filter((item) => item.grabbed)
            .map((item) => item.label)
        ).toEqual(["Contacts"]);

        const sectionRegion = querySections(
          element
        )[0].shadowRoot.querySelector(".rstk-nav-section__announcer");
        expect(spoken(sectionRegion.textContent)).toBe(
          "Contacts grabbed. Position 3 of 3."
        );
        expect(
          spoken(
            element.shadowRoot.querySelector(".rstk-nav-announcer").textContent
          )
        ).toBe("Accounts moved to Support.");
      });

      it("leaves one copy of a tab when a hand-edited layout already listed it in the destination", async () => {
        // Not producible by any gesture this Navigator ships, and this is the
        // first operation that could turn a cross-section duplicate into a
        // within-section one — which LWC will not render, because the two
        // entries share a `key`.
        getLayouts.mockResolvedValue([
          {
            ...CROSS_SECTION_LAYOUT,
            layoutJson: JSON.stringify({
              schemaVersion: SCHEMA_VERSION,
              sections: [
                {
                  name: "Selling",
                  columns: 2,
                  items: [{ id: "Account" }, { id: "standard-ActionHub" }]
                },
                {
                  name: "Support",
                  columns: 3,
                  items: [{ id: "Account" }, { id: "Contact" }]
                }
              ]
            })
          }
        ]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();
        await enterEditMode(element);

        await chooseDestination(element, 0, 0, "Support");

        expect(itemLabelsBySection(element)).toEqual([
          ["Action Plans"],
          ["Contacts", "Accounts"]
        ]);

        await saveEdits(element);
        expect(savedIds(updateLayout, 1)).toEqual(["Contact", "Account"]);
      });

      it("offers every other section on an item's menu, and never the item's own", async () => {
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);

        expect(menuEntries(element, 0, 0).map((entry) => entry.label)).toEqual([
          "Support"
        ]);
        expect(menuEntries(element, 1, 0).map((entry) => entry.label)).toEqual([
          "Selling"
        ]);
      });

      it("moves the item to the section a keyboard user picks, and writes it", async () => {
        // The whole cross-section route without a mouse anywhere in it: a
        // menu, chosen by its label, on an item that is a plain link.
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);

        await chooseDestination(element, 0, 1, "Support");

        expect(itemLabelsBySection(element)).toEqual([
          ["Clients"],
          ["Contacts", "Action Plans"]
        ]);

        await saveEdits(element);
        expect(savedIds(updateLayout, 0)).toEqual(["Account"]);
        expect(savedIds(updateLayout, 1)).toEqual([
          "Contact",
          "standard-ActionHub"
        ]);
      });

      it("moves an item out of the second section as readily as out of the first", async () => {
        // The mirror of the test above, and it is here because every
        // single-section fixture makes "this section" and "section 0" the same
        // string: a component that reported a constant index would be
        // invisible without a move that starts somewhere else.
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);

        await chooseDestination(element, 1, 0, "Selling");

        expect(itemLabelsBySection(element)).toEqual([
          ["Clients", "Action Plans", "Contacts"],
          []
        ]);
      });

      it("still shows a menu-moved item in its new section after a reload", async () => {
        // A remount on the payload that was actually written is what a reload
        // is, since nothing else survives one.
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);
        await chooseDestination(element, 0, 1, "Support");
        await saveEdits(element);

        const written = updateLayout.mock.calls[0][0].layoutJson;
        document.body.removeChild(element);
        jest.clearAllMocks();

        getLayouts.mockResolvedValue([
          { ...CROSS_SECTION_LAYOUT, layoutJson: written }
        ]);
        const reloaded = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();

        expect(itemLabelsBySection(reloaded)).toEqual([
          ["Clients"],
          ["Contacts", "Action Plans"]
        ]);
      });

      it("announces the move to a screen reader, naming the section it went to", async () => {
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);

        await chooseDestination(element, 0, 1, "Support");

        const region = element.shadowRoot.querySelector(".rstk-nav-announcer");
        expect(spoken(region.textContent)).toBe(
          "Action Plans moved to Support."
        );
      });

      it("keeps the item's own rename when it changes section", async () => {
        // The rename is the user's own wording and has nothing to do with
        // where the item sits, so crossing a boundary must not drop it.
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);

        await chooseDestination(element, 0, 0, "Support");

        expect(itemLabelsBySection(element)).toEqual([
          ["Action Plans"],
          ["Contacts", "Clients"]
        ]);
        await saveEdits(element);
        expect(lastSavedLayout(updateLayout).sections[1].items).toEqual([
          { id: "Contact" },
          { id: "Account", rename: "Clients" }
        ]);
      });

      it("offers no destination at all when the layout has only one section", async () => {
        // Nowhere to move to, so nothing that offers to. The menu itself stays
        // — it carries Rename… as well, and the seeded layout is a single
        // section, so withholding the whole menu here would put renaming out
        // of reach of every user who has never made a second one.
        getLayouts.mockResolvedValue([]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();
        await enterEditMode(element);

        expect(sectionNames(element)).toEqual(["All Items"]);
        queryItems(element).forEach((item) => {
          expect(
            item.shadowRoot.querySelector("lightning-button-menu")
          ).not.toBeNull();
          expect(
            Array.from(
              item.shadowRoot.querySelectorAll("lightning-menu-item")
            ).filter((entry) => entry.value.startsWith("move-to-"))
          ).toEqual([]);
        });
      });

      it("drops the item at the position it was dropped at, not at the end", async () => {
        // In edit mode, unlike its "on the card rather than on an item"
        // sibling below: the landing spot here is another item's own anchor,
        // and as of this slice's fix pass that anchor's `dragover`/`drop` are
        // gated on `editing` the same way the card's own drop target is, so
        // out of edit mode this drop no longer reaches anything to position.
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);
        const dragged = itemsIn(element, 0)[1].shadowRoot.querySelector("a");
        const landing = itemsIn(element, 1)[0].shadowRoot.querySelector("a");

        dragged.dispatchEvent(dragEvent("dragstart"));
        landing.dispatchEvent(dragEvent("dragover"));
        landing.dispatchEvent(dragEvent("drop"));
        await flush();

        expect(itemLabelsBySection(element)).toEqual([
          ["Clients"],
          ["Action Plans", "Contacts"]
        ]);
      });

      it("puts the item at the end when it is dropped on the card rather than on an item", async () => {
        // Mounted in edit mode as of this spec's third fix pass:
        // `handleCardDrop` is now gated on `editing`, matching the item's
        // own `handleDrop` and `handleDragOver`, and the card's own
        // `handleCardDragOver` — the fourth of the family's four
        // `dragover`/`drop` handlers to carry that guard.
        const element = await navigatorWithTwoSections();
        await enterEditMode(element);
        const dragged = itemsIn(element, 0)[0].shadowRoot.querySelector("a");

        dragged.dispatchEvent(dragEvent("dragstart"));
        querySections(element)[1]
          .shadowRoot.querySelector("article")
          .dispatchEvent(dragEvent("drop"));
        await flush();

        expect(itemLabelsBySection(element)).toEqual([
          ["Action Plans"],
          ["Contacts", "Clients"]
        ]);
      });

      it("does not move an item across sections when dropped on another item out of edit mode, and writes nothing", async () => {
        // Finding 1 of the third fix pass, pinned at the composed level
        // rather than only on an isolated `c-navigator-item`. The prior
        // pass's own composed-level probe found that gating only the item's
        // `handleDrop` (and leaving `handleCardDrop` ungated) closed nothing
        // here: with `handleDrop` returning before its `stopPropagation()`,
        // a drop on this anchor still bubbled to the section's own
        // `<article>` and was read there instead, at the end position
        // rather than the dropped-on one, but still a write. Both gaps are
        // closed now — `stopPropagation()` fires unconditionally in
        // `handleDrop`, and `handleCardDrop` is gated the same way as the
        // other three `dragover`/`drop` handlers in the family — so this
        // gesture, run entirely out of edit mode, must move nothing and
        // write nothing.
        const element = await navigatorWithTwoSections();
        const dragged = itemsIn(element, 0)[1].shadowRoot.querySelector("a");
        const landing = itemsIn(element, 1)[0].shadowRoot.querySelector("a");

        dragged.dispatchEvent(dragEvent("dragstart"));
        landing.dispatchEvent(dragEvent("dragover"));
        landing.dispatchEvent(dragEvent("drop"));
        await flush();
        await settleAutosave();

        expect(itemLabelsBySection(element)).toEqual([
          ["Clients", "Action Plans"],
          ["Contacts"]
        ]);
        expect(updateLayout).not.toHaveBeenCalled();
        expect(createLayout).not.toHaveBeenCalled();
      });

      it("writes nothing when an item is dropped back into the section it came from", async () => {
        // Criterion 7. Asserted on the *write* rather than on the order,
        // because the order is identical either way — which is exactly why a
        // missing guard would be invisible on screen.
        const element = await navigatorWithTwoSections();
        const dragged = itemsIn(element, 0)[0].shadowRoot.querySelector("a");

        dragged.dispatchEvent(dragEvent("dragstart"));
        querySections(element)[0]
          .shadowRoot.querySelector("article")
          .dispatchEvent(dragEvent("drop"));
        await flush();
        await settleAutosave();

        expect(itemLabelsBySection(element)).toEqual([
          ["Clients", "Action Plans"],
          ["Contacts"]
        ]);
        expect(updateLayout).not.toHaveBeenCalled();
      });

      it("tells the sections an item drag is in flight, and only while it is", async () => {
        // The drop-target affordance needs two facts, and this is the half the
        // parent owns: a section cannot tell an item drag from a section drag,
        // because it never sees both.
        const element = await navigatorWithTwoSections();
        const dragged = itemsIn(element, 0)[0].shadowRoot.querySelector("a");

        expect(
          querySections(element).map((section) => section.itemDragActive)
        ).toEqual([false, false]);

        dragged.dispatchEvent(dragEvent("dragstart"));
        await flush();
        expect(
          querySections(element).map((section) => section.itemDragActive)
        ).toEqual([true, true]);

        dragged.dispatchEvent(dragEvent("dragend"));
        await flush();
        expect(
          querySections(element).map((section) => section.itemDragActive)
        ).toEqual([false, false]);
      });

      it("does not tell the sections an item drag is in flight when a card is dragged", async () => {
        const element = await navigatorWithTwoSections();

        querySections(element)[0]
          .shadowRoot.querySelector("article")
          .dispatchEvent(
            new CustomEvent("dragstart", { bubbles: true, cancelable: true })
          );
        await flush();

        expect(
          querySections(element).map((section) => section.itemDragActive)
        ).toEqual([false, false]);
      });
    });
  });

  /**
   * Calling a tab what you call it.
   *
   * The whole of this is ordinary DOM and ordinary events — a menu entry, an
   * input, a commit — so unlike the drag axis there is no gesture ceiling here
   * and every criterion is driven end to end: item handler, section, parent,
   * model, payload, and a remount on the payload that was actually written.
   *
   * The load-bearing one is the first test below, which is the pairing the
   * design named: a rename changes the wording on screen and does not change
   * where the item goes, asserted in one go. It can be asserted at all because
   * this repo carries the lwc-recipes `lightning/navigation` mock, whose
   * `getNavigateCalledWith()` records what the component actually navigated to.
   */
  describe("renaming an item", () => {
    const THREE = [ACCOUNT_ITEM, ACTION_HUB_ITEM, CONTACT_ITEM];

    function storedLayout(sections) {
      return {
        layoutId: EXISTING_LAYOUT_ID,
        name: "My Navigator",
        isActive: true,
        layoutJson: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          sections
        })
      };
    }

    /** One section, `Account` under the user's own wording. */
    const RENAMED = storedLayout([
      {
        name: "Daily work",
        columns: 3,
        items: [{ id: "Account", rename: "Clients" }, { id: "Contact" }]
      }
    ]);

    // Enters edit mode as part of mounting: an item's own rename is gated
    // behind it as of slice 04, and most tests in this describe drive that
    // menu at some point — this is the behavioural suite for the rename
    // itself (wording, payload shape, reload, clearing), not the debounce
    // mechanism, so there is no reason for most of them to stay out of edit
    // mode. Navigation and the payload each item renders are unaffected by
    // `isEditing` either way, so the handful of tests here that never touch
    // the menu — the navigation/rename-target test, the org-tab-relabel
    // test, and the no-other-layout test — are not disturbed by mounting
    // this way either; the redelivery test is the one exception and mounts
    // inline instead, out of edit mode, because its subject is the debounce
    // itself.
    async function navigatorOn(layout, navItems = THREE) {
      getLayouts.mockResolvedValue(layout ? [layout] : []);
      const element = createNavigator();
      getNavItems.emit({ navItems });
      await flush();
      await enterEditMode(element);
      return element;
    }

    function itemsIn(element, sectionIndex) {
      return Array.from(
        querySections(element)[sectionIndex].shadowRoot.querySelectorAll(
          "c-navigator-item"
        )
      );
    }

    function itemAt(element, sectionIndex, itemIndex) {
      return itemsIn(element, sectionIndex)[itemIndex];
    }

    /** What is actually painted, not what the property says. */
    function renderedLabel(element, sectionIndex, itemIndex) {
      return itemAt(element, sectionIndex, itemIndex)
        .shadowRoot.querySelector("a")
        .textContent.trim();
    }

    async function openRename(element, sectionIndex, itemIndex) {
      itemAt(element, sectionIndex, itemIndex)
        .shadowRoot.querySelector("lightning-button-menu")
        .dispatchEvent(
          new CustomEvent("select", { detail: { value: "rename" } })
        );
      await flush();
      return itemAt(element, sectionIndex, itemIndex).shadowRoot.querySelector(
        "lightning-input"
      );
    }

    /** The whole gesture, exactly as a user performs it. */
    async function renameTo(element, sectionIndex, itemIndex, wording) {
      const input = await openRename(element, sectionIndex, itemIndex);
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: wording } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();
    }

    function savedItems(apexMock, sectionIndex = 0) {
      return lastSavedLayout(apexMock).sections[sectionIndex].items;
    }

    it("shows the user's own wording and still navigates to exactly the same tab", async () => {
      // The two criteria the design said one test should prove together. The
      // rename and the navigation target are different fields of the stored
      // item, so this is a structural fact rather than a lucky one — and it is
      // asserted against the platform's own pageReference, which is the same
      // object an item with no rename would navigate to.
      const element = await navigatorOn(RENAMED);

      expect(renderedLabel(element, 0, 0)).toBe("Clients");
      expect(renderedLabel(element, 0, 0)).not.toBe(ACCOUNT_ITEM.label);

      itemAt(element, 0, 0)
        .shadowRoot.querySelector("a")
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(getNavigateCalledWith().pageReference).toEqual(
        ACCOUNT_ITEM.pageReference
      );
    });

    it("navigates to the same tab it did before a rename made in this session", async () => {
      // The live half of the same pairing: not a rename that arrived in a
      // payload, but one the user has just typed.
      const element = await navigatorOn(RENAMED);
      const anchor = () => itemAt(element, 0, 1).shadowRoot.querySelector("a");

      anchor().dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const before = getNavigateCalledWith().pageReference;

      await renameTo(element, 0, 1, "People I know");
      expect(renderedLabel(element, 0, 1)).toBe("People I know");
      anchor().dispatchEvent(new MouseEvent("click", { bubbles: true }));

      expect(getNavigateCalledWith().pageReference).toEqual(before);
      expect(getNavigateCalledWith().pageReference).toEqual(
        CONTACT_ITEM.pageReference
      );
    });

    it("renames an item from its overflow menu, in place of the Salesforce label", async () => {
      // From the seeded layout, which is the state every user starts in — one
      // section, so this also pins that the menu is reachable there at all.
      const element = await navigatorOn(undefined, [ACCOUNT_ITEM]);

      expect(sectionNames(element)).toEqual(["All Items"]);
      // The entry has to be *there*: every step below drives the menu's own
      // `select`, which a menu with nothing in it would emit just as happily.
      expect(
        Array.from(
          itemAt(element, 0, 0).shadowRoot.querySelectorAll(
            "lightning-menu-item"
          )
        ).map((entry) => entry.value)
      ).toContain("rename");

      await renameTo(element, 0, 0, "Clients");

      expect(renderedLabel(element, 0, 0)).toBe("Clients");
    });

    it("writes the rename beside the id, and nothing else about the item", async () => {
      const element = await navigatorOn(RENAMED);

      await renameTo(element, 0, 1, "People");
      await saveEdits(element);

      expect(savedItems(updateLayout)).toEqual([
        { id: "Account", rename: "Clients" },
        { id: "Contact", rename: "People" }
      ]);
      // No label, no pageReference, no icon — the payload stores nothing the
      // platform can be asked for, which is what makes an org relabelling
      // free.
      expect(Object.keys(savedItems(updateLayout)[1]).sort()).toEqual([
        "id",
        "rename"
      ]);
    });

    it("still shows the rename after a reload", async () => {
      // A remount on the payload that was actually written is what a reload
      // is, since nothing else survives one — and the store is per-user and
      // owner-filtered, so a fresh login reads back this same row.
      const element = await navigatorOn(RENAMED);
      await renameTo(element, 0, 1, "People");
      await saveEdits(element);

      const written = updateLayout.mock.calls[0][0].layoutJson;
      document.body.removeChild(element);
      jest.clearAllMocks();

      const reloaded = await navigatorOn({ ...RENAMED, layoutJson: written });

      expect(itemsIn(reloaded, 0).map((item) => item.label)).toEqual([
        "Clients",
        "People"
      ]);
    });

    it("returns the item to its Salesforce label when the rename is cleared", async () => {
      const element = await navigatorOn(RENAMED);

      await renameTo(element, 0, 0, "");

      expect(renderedLabel(element, 0, 0)).toBe("Accounts");
      await saveEdits(element);
      // Cleared is the key's absence, not an empty string sitting in the
      // payload — asserted as an exact key set, because `toEqual` alone would
      // not tell `{id}` from `{id, rename: ""}` if the value were undefined.
      expect(savedItems(updateLayout)[0]).toEqual({ id: "Account" });
      expect(Object.keys(savedItems(updateLayout)[0])).toEqual(["id"]);
    });

    it("keeps the cleared item under its Salesforce label after a reload", async () => {
      const element = await navigatorOn(RENAMED);
      await renameTo(element, 0, 0, "");
      await saveEdits(element);

      const written = updateLayout.mock.calls[0][0].layoutJson;
      document.body.removeChild(element);
      jest.clearAllMocks();

      const reloaded = await navigatorOn({ ...RENAMED, layoutJson: written });

      expect(itemsIn(reloaded, 0).map((item) => item.label)).toEqual([
        "Accounts",
        "Contacts"
      ]);
    });

    it("creates no layout row when an empty box is committed on an item with no rename", async () => {
      // The other door onto "wording committed unchanged reports nothing at
      // all". Emptying the box on an item that has no rename asks for the
      // Salesforce label it already has, so it stores nothing — and a gesture
      // that stores nothing must not be what creates a layout row for a user
      // who has only ever looked, which slice 03 has a criterion against. Nor
      // is there anything to announce: "Accounts renamed to Accounts."
      //
      // Runs out of edit mode, unlike every other test in this describe: the
      // guard under test sits upstream of `scheduleSave`, comparing the
      // canvas before and after. In edit mode, Save's own "nothing to write"
      // check (`hasUnsavedCanvasChanges`) would report the same "nothing
      // written" outcome whether or not that upstream guard exists — a no-op
      // rename leaves the serialised layout identical either way, so Save
      // would refuse to write regardless — which is exactly the vacuous-pass
      // shape trap 273 warns about. Dispatching `itemrename` directly on the
      // item, the way `renameFirstItem` does, is what keeps this test out of
      // edit mode without going through the now-gated menu.
      getLayouts.mockResolvedValue([]);
      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM] });
      await flush();

      itemAt(element, 0, 0).dispatchEvent(
        new CustomEvent("itemrename", { detail: { index: 0, rename: "" } })
      );
      await flush();
      await settleAutosave();

      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
      expect(renderedLabel(element, 0, 0)).toBe("Accounts");
      expect(
        spoken(
          element.shadowRoot.querySelector(".rstk-nav-announcer").textContent
        )
      ).toBe("");
    });

    it("clears the rename when the user types the platform label into a renamed item", async () => {
      // The same end state as emptying the box, reached by the other route,
      // and it must be stored the same way — otherwise this item quietly loses
      // criterion 6 while an unrenamed one keeps it under identical
      // keystrokes. The consequence is deliberate: typing the platform label
      // is a second way to clear a rename.
      const element = await navigatorOn(RENAMED);
      expect(renderedLabel(element, 0, 0)).toBe("Clients");

      await renameTo(element, 0, 0, "Accounts");

      expect(renderedLabel(element, 0, 0)).toBe("Accounts");
      await saveEdits(element);
      expect(savedItems(updateLayout)[0]).toEqual({ id: "Account" });
      expect(Object.keys(savedItems(updateLayout)[0])).toEqual(["id"]);
    });

    it("picks up a change to the org's own tab label, with no write at all", async () => {
      // The payload stores no labels, so this costs nothing: the item is
      // resolved against the live tab source on every render.
      //
      // Stays out of edit mode, unlike its neighbours in this describe, and
      // is mounted inline rather than through this describe's `navigatorOn`
      // (which enters edit mode as part of mounting): the hazard this test
      // pins is a wire redelivery arming the debounce, which is a claim about
      // `scheduleSave` itself, not about the now-gated menu. Asserting this
      // in edit mode would be satisfied by `scheduleSave`'s own `isEditing`
      // guard whether or not the redelivery guard exists — the same
      // vacuous-pass shape trap 273 warns about — so the negative assertion
      // has to be made where autosave is actually live.
      getLayouts.mockResolvedValue([RENAMED]);
      const element = createNavigator();
      getNavItems.emit({ navItems: THREE });
      await flush();
      expect(renderedLabel(element, 0, 1)).toBe("Contacts");

      getNavItems.emit({
        navItems: [
          ACCOUNT_ITEM,
          { ...CONTACT_ITEM, label: "People" },
          ACTION_HUB_ITEM
        ],
        nextPageUrl: null
      });
      await flush();

      expect(renderedLabel(element, 0, 1)).toBe("People");
      // And the renamed item is not disturbed by the relabelling of another.
      expect(renderedLabel(element, 0, 0)).toBe("Clients");

      await settleAutosave();
      expect(updateLayout).not.toHaveBeenCalled();
      expect(createLayout).not.toHaveBeenCalled();
    });

    it("leaves the org's tab label alone for anyone without this layout", async () => {
      // The rename is the user's own wording, held in their own layout row.
      // A Navigator that reads no layout — which is what any other user's
      // first open is — shows the platform's label for the same tab.
      const element = await navigatorOn(RENAMED);
      expect(renderedLabel(element, 0, 0)).toBe("Clients");
      document.body.removeChild(element);
      jest.clearAllMocks();

      const somebodyElse = await navigatorOn(undefined);

      expect(renderedLabel(somebodyElse, 0, 0)).toBe("Accounts");
    });

    it("renames the item the user picked when an earlier one is out of reach", async () => {
      // The resolved-versus-stored seam. `Account` is stored first and is not
      // in the accessible set, so the first item on screen is `Action Plans` —
      // and a rename that ran the rendered index into the stored list would
      // label a tab the user cannot see and leave theirs alone.
      const element = await navigatorOn(
        storedLayout([
          {
            name: "Daily work",
            columns: 3,
            items: [
              { id: "Account" },
              { id: "standard-ActionHub" },
              { id: "Contact" }
            ]
          }
        ]),
        [ACTION_HUB_ITEM, CONTACT_ITEM]
      );

      await renameTo(element, 0, 0, "Plans");

      expect(itemsIn(element, 0).map((item) => item.label)).toEqual([
        "Plans",
        "Contacts"
      ]);
      await saveEdits(element);
      expect(savedItems(updateLayout)).toEqual([
        { id: "Account" },
        { id: "standard-ActionHub", rename: "Plans" },
        { id: "Contact" }
      ]);
    });

    it("renames an item in the second section as readily as in the first", async () => {
      // Every other fixture here would make "this section" and "section 0" the
      // same number, and a chain that reported a constant would be invisible.
      const element = await navigatorOn(
        storedLayout([
          { name: "Selling", columns: 3, items: [{ id: "Account" }] },
          { name: "Support", columns: 3, items: [{ id: "Contact" }] }
        ])
      );

      await renameTo(element, 1, 0, "People");

      expect(itemLabelsBySection(element)).toEqual([["Accounts"], ["People"]]);
      await saveEdits(element);
      expect(savedItems(updateLayout, 0)).toEqual([{ id: "Account" }]);
      expect(savedItems(updateLayout, 1)).toEqual([
        { id: "Contact", rename: "People" }
      ]);
    });

    it("announces the rename to a screen reader, naming both wordings", async () => {
      const element = await navigatorOn(RENAMED);

      await renameTo(element, 0, 1, "People");

      const region = element.shadowRoot.querySelector(".rstk-nav-announcer");
      expect(spoken(region.textContent)).toBe("Contacts renamed to People.");
    });

    it("announces a cleared rename by the label the item goes back to", async () => {
      const element = await navigatorOn(RENAMED);

      await renameTo(element, 0, 0, "");

      const region = element.shadowRoot.querySelector(".rstk-nav-announcer");
      expect(spoken(region.textContent)).toBe("Clients renamed to Accounts.");
    });
  });

  describe("losing and regaining access to a tab", () => {
    const STORED_THREE = {
      layoutId: EXISTING_LAYOUT_ID,
      name: "My Navigator",
      isActive: true,
      layoutJson: JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        sections: [
          {
            name: "Daily work",
            columns: 3,
            items: [
              { id: "Account" },
              { id: "Contact" },
              { id: "standard-ActionHub" }
            ]
          }
        ]
      })
    };

    it("stops rendering an item the user can no longer reach", async () => {
      getLayouts.mockResolvedValue([STORED_THREE]);

      const element = createNavigator();
      // Contact is gone from the platform's accessible set.
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, ACTION_HUB_ITEM] });
      await flush();

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Accounts",
        "Action Plans"
      ]);
    });

    it("releases a keyboard grab when the grabbed item stops rendering", async () => {
      // The access-loss path and the drag path meet here. An item held from
      // the keyboard can vanish underneath the drag, and if the grab is not
      // released with it the section believes a drag is in flight forever:
      // nothing carries `grabbed`, focus is nowhere, and the live region is
      // left reading a grab that ended.
      getLayouts.mockResolvedValue([STORED_THREE]);
      const element = createNavigator();
      getNavItems.emit({
        navItems: [ACCOUNT_ITEM, CONTACT_ITEM, ACTION_HUB_ITEM]
      });
      await flush();
      await enterEditMode(element);

      const section = querySections(element)[0];
      queryItems(element)[2]
        .shadowRoot.querySelector("a")
        .dispatchEvent(
          new KeyboardEvent("keydown", {
            key: " ",
            bubbles: true,
            cancelable: true
          })
        );
      await flush();

      const region = section.shadowRoot.querySelector("[aria-live]");
      expect(region.textContent).toMatch(/grabbed/i);

      // Access to the held tab is lost while it is being held.
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, CONTACT_ITEM] });
      await flush();

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Accounts",
        "Contacts"
      ]);
      expect(region.textContent).not.toMatch(/grabbed/i);
      expect(region.textContent).toMatch(/no longer available/i);
      // And it names what vanished. "The move ended" is not something to tell
      // a screen reader user without saying what it was about — which is the
      // whole reason `grabbedItemLabel` is kept alongside the id, since by the
      // time this sentence is needed the item itself is gone from the list.
      expect(region.textContent).toContain("Action Plans");

      // And the section is not stuck: a fresh grab is accepted, which it
      // would not be while it still believed it was holding something.
      queryItems(element)[0]
        .shadowRoot.querySelector("a")
        .dispatchEvent(
          new KeyboardEvent("keydown", {
            key: " ",
            bubbles: true,
            cancelable: true
          })
        );
      await flush();

      expect(queryItems(element).map((item) => item.grabbed)).toEqual([
        true,
        false
      ]);
    });

    it("releases a keyboard grab whose item vanishes from an index that stays in range", async () => {
      // The discriminating case for `releaseGrabIfItemGone`, and the one its
      // docblock is about: the *identity* test, not the index one. The test
      // above holds the last of three, so losing it also pushes the index past
      // the end of the list and a bare `grabbedItemIndex < items.length` catches
      // it too. Here the held item is the **first** of three, so after it goes
      // index 0 is still a perfectly real position — and an index-only check
      // silently transfers the grab to the neighbour and leaves the live region
      // reading a grab on an item that is gone.
      getLayouts.mockResolvedValue([STORED_THREE]);
      const element = createNavigator();
      getNavItems.emit({
        navItems: [ACCOUNT_ITEM, CONTACT_ITEM, ACTION_HUB_ITEM]
      });
      await flush();
      await enterEditMode(element);

      const section = querySections(element)[0];
      queryItems(element)[0]
        .shadowRoot.querySelector("a")
        .dispatchEvent(
          new KeyboardEvent("keydown", {
            key: " ",
            bubbles: true,
            cancelable: true
          })
        );
      await flush();

      const region = section.shadowRoot.querySelector("[aria-live]");
      expect(region.textContent).toMatch(/grabbed/i);

      // Access to the held tab — the first one — is lost while it is held.
      getNavItems.emit({ navItems: [CONTACT_ITEM, ACTION_HUB_ITEM] });
      await flush();

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Contacts",
        "Action Plans"
      ]);
      // No surviving item inherits the grab.
      expect(queryItems(element).map((item) => item.grabbed)).toEqual([
        false,
        false
      ]);
      expect(region.textContent).not.toMatch(/grabbed/i);
      expect(region.textContent).toMatch(/no longer available/i);
      expect(region.textContent).toContain("Accounts");
    });

    it("leaves the stored layout carrying the lost item, even across a save", async () => {
      // The sharpest form of this criterion: the item is not rendered, then
      // the user changes something else and the autosave runs. If the render
      // -time intersection were a mutation of stored state instead, this save
      // would quietly write the pruned list and the item would never come
      // back.
      getLayouts.mockResolvedValue([STORED_THREE]);

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, ACTION_HUB_ITEM] });
      await flush();

      await enterEditMode(element);
      selectSectionMenuItem(element, 0, "columns-5");
      await flush();
      await saveEdits(element);

      expect(lastSavedLayout(updateLayout).sections[0].items).toEqual([
        { id: "Account" },
        { id: "Contact" },
        { id: "standard-ActionHub" }
      ]);
    });

    it("restores the item in its original position when access returns", async () => {
      getLayouts.mockResolvedValue([STORED_THREE]);

      const element = createNavigator();
      getNavItems.emit({ navItems: [ACCOUNT_ITEM, ACTION_HUB_ITEM] });
      await flush();
      expect(queryItems(element)).toHaveLength(2);

      // Access comes back — the same stored layout, a wider accessible set.
      getNavItems.emit({
        navItems: [ACCOUNT_ITEM, ACTION_HUB_ITEM, CONTACT_ITEM],
        nextPageUrl: null
      });
      await flush();

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Accounts",
        "Contacts",
        "Action Plans"
      ]);
    });
  });

  describe("removing an item and adding it back", () => {
    const THREE = [ACCOUNT_ITEM, ACTION_HUB_ITEM, CONTACT_ITEM];

    function storedLayout(sections) {
      return {
        layoutId: EXISTING_LAYOUT_ID,
        name: "My Navigator",
        isActive: true,
        layoutJson: JSON.stringify({ schemaVersion: SCHEMA_VERSION, sections })
      };
    }

    /**
     * Two sections, so "which section did it land in" is a real question —
     * and one reachable tab, `Contact`, deliberately left out of both, so the
     * picker has something to offer. A fixture in which everything is already
     * placed cannot tell a picker that lists the right thing from one that
     * lists nothing at all.
     */
    const TWO_SECTIONS = storedLayout([
      { name: "Selling", columns: 3, items: [{ id: "Account" }] },
      { name: "Support", columns: 2, items: [{ id: "standard-ActionHub" }] }
    ]);

    // Mounts only — it does not enter edit mode. Folding `enterEditMode` in
    // here once shadowed `handleItemRemove`'s payload-equality guard: every
    // "writes nothing" assertion in this describe was satisfied by
    // `scheduleSave`'s `isEditing` early return rather than by the guard
    // under test, because a removal that names no item on screen was always
    // driven from inside edit mode. Tests that reach for "Add items", the
    // section's own overflow menu, Save, or — as of slice 04 — the item's
    // own overflow menu, call `enterEditMode` themselves.

    async function navigatorOn(layout, navItems = THREE) {
      getLayouts.mockResolvedValue(layout ? [layout] : []);
      const element = createNavigator();
      getNavItems.emit({ navItems });
      await flush();
      return element;
    }

    function itemsIn(element, sectionIndex) {
      return Array.from(
        querySections(element)[sectionIndex].shadowRoot.querySelectorAll(
          "c-navigator-item"
        )
      );
    }

    function itemAt(element, sectionIndex, itemIndex) {
      return itemsIn(element, sectionIndex)[itemIndex];
    }

    /** Drives one item's own overflow menu, the way a user reaches Remove. */
    function selectItemMenuItem(element, sectionIndex, itemIndex, value) {
      itemAt(element, sectionIndex, itemIndex)
        .shadowRoot.querySelector("lightning-button-menu")
        .dispatchEvent(new CustomEvent("select", { detail: { value } }));
    }

    /** The entries the item's menu actually offers, as a user reads them. */
    function itemMenuEntries(element, sectionIndex, itemIndex) {
      return Array.from(
        itemAt(element, sectionIndex, itemIndex).shadowRoot.querySelectorAll(
          "lightning-menu-item"
        )
      ).map((entry) => [entry.value, entry.label]);
    }

    function addButtonOf(element, sectionIndex) {
      // A hand-rolled `<button>`, not a `lightning-button`: the section names
      // itself in assistive text inside the button's own content, which is
      // where a button's accessible name comes from.
      return querySections(element)[sectionIndex].shadowRoot.querySelector(
        "button.rstk-nav-section__add"
      );
    }

    /** The picker the parent mounted, if it mounted one. */
    function pickerOf() {
      const modals = getOpenModals();
      return modals[modals.length - 1];
    }

    function pickerEntries(picker) {
      return Array.from(
        picker.shadowRoot.querySelectorAll("button.rstk-nav-picker__item")
      );
    }

    function pickerLabels(picker) {
      return pickerEntries(picker).map((entry) => entry.textContent.trim());
    }

    /** Opens the picker the way a user does: the section's own button. */
    async function openPicker(element, sectionIndex) {
      addButtonOf(element, sectionIndex).dispatchEvent(
        new CustomEvent("click")
      );
      await flush();
      return pickerOf();
    }

    function announcementOf(element) {
      return spoken(
        element.shadowRoot.querySelector(".rstk-nav-announcer").textContent
      );
    }

    afterEach(() => {
      resetModals();
    });

    it("takes an item out of the layout when Remove is chosen from its menu", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      // The entry has to be findable, not merely respondable-to — slice 06's
      // row 16 is the reason this assertion is here and not implied.
      expect(itemMenuEntries(element, 0, 0)).toContainEqual([
        "remove",
        "Remove"
      ]);

      selectItemMenuItem(element, 0, 0, "remove");
      await flush();

      expect(itemLabelsBySection(element)).toEqual([[], ["Action Plans"]]);
    });

    it("removes the item the user chose, out of the second section as readily as the first", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);

      selectItemMenuItem(element, 1, 0, "remove");
      await flush();

      expect(itemLabelsBySection(element)).toEqual([["Accounts"], []]);
    });

    it("writes the removal, and a reload shows the item still gone", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);

      selectItemMenuItem(element, 1, 0, "remove");
      await flush();
      await saveEdits(element);

      expect(lastSavedLayout(updateLayout).sections[1].items).toEqual([]);

      // What a reload is: a second Navigator mounted on the payload that was
      // actually written.
      const written = updateLayout.mock.calls.at(-1)[0].layoutJson;
      document.body.removeChild(element);
      const reloaded = await navigatorOn(
        storedLayout(JSON.parse(written).sections)
      );

      expect(itemLabelsBySection(reloaded)).toEqual([["Accounts"], []]);
    });

    it("announces the removal, naming the item and the section it left", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);

      selectItemMenuItem(element, 1, 0, "remove");
      await flush();

      expect(announcementOf(element)).toBe(
        "Action Plans removed from Support."
      );
    });

    it("removes the item the user can see when an earlier one is out of reach", async () => {
      // The fixture shape the suite had nowhere before slice 05's critique:
      // a stored id absent from `getNavItems`, sitting before the one being
      // removed. Removing "visible position 0" must remove what the user can
      // see, not the stored entry at index 0.
      const element = await navigatorOn(
        storedLayout([
          {
            name: "Selling",
            columns: 3,
            items: [
              { id: "Contact" },
              { id: "Account" },
              { id: "standard-ActionHub" }
            ]
          }
        ]),
        [ACCOUNT_ITEM, ACTION_HUB_ITEM]
      );
      expect(itemLabelsBySection(element)).toEqual([
        ["Accounts", "Action Plans"]
      ]);
      await enterEditMode(element);

      selectItemMenuItem(element, 0, 0, "remove");
      await flush();
      await saveEdits(element);

      // `Contact` is unreachable and must survive untouched, in place.
      expect(lastSavedLayout(updateLayout).sections[0].items).toEqual([
        { id: "Contact" },
        { id: "standard-ActionHub" }
      ]);
      expect(itemLabelsBySection(element)).toEqual([["Action Plans"]]);
    });

    it("tells a user who has emptied a section that it is empty and how to fill it", async () => {
      const element = await navigatorOn(
        storedLayout([
          { name: "Selling", columns: 3, items: [{ id: "Account" }] }
        ])
      );
      await enterEditMode(element);

      selectItemMenuItem(element, 0, 0, "remove");
      await flush();

      const empty = querySections(element)[0].shadowRoot.querySelector(
        ".rstk-nav-section__empty"
      );
      expect(empty).not.toBeNull();
      expect(empty.textContent).toContain("no items");
      expect(empty.textContent).toContain("Add items");
      expect(addButtonOf(element, 0)).not.toBeNull();
    });

    it("says only that the section is empty once Save leaves it that way out of edit mode", async () => {
      // The display-only counterpart to the test above. The Add items button
      // this message used to name unconditionally is itself gated behind edit
      // mode (this slice's own subject), so out of edit mode the sentence
      // must not send the user after a control that is not on screen. Save,
      // not Cancel: Cancel would restore the removed item along with
      // everything else the session touched, and the section would not be
      // empty to look at any more.
      const element = await navigatorOn(
        storedLayout([
          { name: "Selling", columns: 3, items: [{ id: "Account" }] }
        ])
      );
      await enterEditMode(element);
      selectItemMenuItem(element, 0, 0, "remove");
      await flush();
      await saveEdits(element);

      const empty = querySections(element)[0].shadowRoot.querySelector(
        ".rstk-nav-section__empty"
      );
      expect(empty).not.toBeNull();
      expect(empty.textContent).toContain("no items");
      expect(empty.textContent).not.toContain("Add items");
      expect(addButtonOf(element, 0)).toBeNull();
    });

    it("opens a picker from the section header listing every reachable tab not in the layout", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);

      const picker = await openPicker(element, 0);

      expect(picker).toBeDefined();
      // `Account` and `standard-ActionHub` are placed — in *different*
      // sections, so this also pins that the list is built across the whole
      // layout and not only the section the picker was opened from.
      expect(pickerLabels(picker)).toEqual(["Contacts"]);
    });

    it("never lists a tab the running user cannot reach", async () => {
      // `Contact` is stored nowhere and is also absent from `getNavItems`, so
      // it is not the picker's to offer. This is Outcome 1's one failure mode
      // — over-reporting — driven end to end.
      const element = await navigatorOn(
        storedLayout([
          { name: "Selling", columns: 3, items: [{ id: "Account" }] }
        ]),
        [ACCOUNT_ITEM, ACTION_HUB_ITEM]
      );
      await enterEditMode(element);

      const picker = await openPicker(element, 0);

      expect(pickerLabels(picker)).toEqual(["Action Plans"]);
    });

    it("lists items under their Salesforce label, never under a rename in the layout", async () => {
      const element = await navigatorOn(
        storedLayout([
          {
            name: "Selling",
            columns: 3,
            items: [{ id: "Account", rename: "Clients" }]
          }
        ])
      );
      // The rename is on screen, so the layout really does carry one.
      expect(itemLabelsBySection(element)).toEqual([["Clients"]]);
      await enterEditMode(element);

      const picker = await openPicker(element, 0);

      expect(pickerLabels(picker)).toEqual(["Action Plans", "Contacts"]);
    });

    it("finds an item in the picker by typing part of its label", async () => {
      const element = await navigatorOn(
        storedLayout([{ name: "Selling", columns: 3, items: [] }])
      );
      await enterEditMode(element);
      const picker = await openPicker(element, 0);
      expect(pickerLabels(picker)).toHaveLength(3);

      picker.shadowRoot
        .querySelector("lightning-input")
        .dispatchEvent(
          new CustomEvent("change", { detail: { value: "Plan" } })
        );
      await flush();

      expect(pickerLabels(picker)).toEqual(["Action Plans"]);
    });

    it("adds the chosen item to the section the picker was opened from", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 1);

      pickerEntries(picker)[0].click();
      await flush();

      expect(itemLabelsBySection(element)).toEqual([
        ["Accounts"],
        ["Action Plans", "Contacts"]
      ]);
    });

    it("adds to the first section as readily as to the second", async () => {
      // A parent that always added to section 0 would pass every assertion
      // driven from section 0 — slice 05's row 13 on this axis.
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 0);

      pickerEntries(picker)[0].click();
      await flush();

      expect(itemLabelsBySection(element)).toEqual([
        ["Accounts", "Contacts"],
        ["Action Plans"]
      ]);
    });

    it("writes the addition, and a reload shows the item still there", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 1);

      pickerEntries(picker)[0].click();
      await flush();
      await saveEdits(element);

      expect(lastSavedLayout(updateLayout).sections[1].items).toEqual([
        { id: "standard-ActionHub" },
        { id: "Contact" }
      ]);

      const written = updateLayout.mock.calls.at(-1)[0].layoutJson;
      document.body.removeChild(element);
      const reloaded = await navigatorOn(
        storedLayout(JSON.parse(written).sections)
      );

      expect(itemLabelsBySection(reloaded)).toEqual([
        ["Accounts"],
        ["Action Plans", "Contacts"]
      ]);
    });

    it("announces the addition, naming the item and the section it landed in", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 1);

      pickerEntries(picker)[0].click();
      await flush();

      expect(announcementOf(element)).toBe("Contacts added to Support.");
    });

    it("offers an item removed earlier back, and adds it to where it is asked for", async () => {
      // The round trip the criterion names, driven as one gesture chain.
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      selectItemMenuItem(element, 0, 0, "remove");
      await flush();
      expect(itemLabelsBySection(element)).toEqual([[], ["Action Plans"]]);

      const picker = await openPicker(element, 1);
      // The removed item is back on offer, alongside the one that was never
      // placed.
      expect(pickerLabels(picker)).toEqual(["Accounts", "Contacts"]);

      pickerEntries(picker)[0].click();
      await flush();

      expect(itemLabelsBySection(element)).toEqual([
        [],
        ["Action Plans", "Accounts"]
      ]);
    });

    it("offers a deleted section's items back rather than discarding them", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);

      selectSectionMenuItem(element, 1, "delete");
      await flush();
      expect(sectionNames(element)).toEqual(["Selling"]);

      const picker = await openPicker(element, 0);

      // `Action Plans` was Support's only item. Deleting Support did not
      // discard it — it is on offer again.
      expect(pickerLabels(picker)).toEqual(["Action Plans", "Contacts"]);
    });

    it("adds a deleted section's item back into a surviving section", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      selectSectionMenuItem(element, 1, "delete");
      await flush();

      const picker = await openPicker(element, 0);
      pickerEntries(picker)[0].click();
      await flush();
      await saveEdits(element);

      expect(itemLabelsBySection(element)).toEqual([
        ["Accounts", "Action Plans"]
      ]);
      expect(lastSavedLayout(updateLayout).sections).toHaveLength(1);
      expect(lastSavedLayout(updateLayout).sections[0].items).toEqual([
        { id: "Account" },
        { id: "standard-ActionHub" }
      ]);
    });

    it("writes nothing when the picker is merely opened", async () => {
      // Slice 03's criterion: no layout record exists for a user who has only
      // ever looked. Opening a picker is looking. `getLayouts` returns nothing
      // here, so a write would be a `createLayout` — the exact gesture that
      // generates a row for a user who never customised anything.
      const element = await navigatorOn(undefined);
      await enterEditMode(element);

      const picker = await openPicker(element, 0);
      await settleAutosave();

      expect(picker).toBeDefined();
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("writes nothing when the picker is cancelled", async () => {
      const element = await navigatorOn(undefined);
      await enterEditMode(element);
      const picker = await openPicker(element, 0);

      picker.shadowRoot
        .querySelector("lightning-button.rstk-nav-picker__cancel")
        .dispatchEvent(new CustomEvent("click"));
      await flush();
      await settleAutosave();

      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("writes nothing when a removal names no item on screen", async () => {
      // The payload-equality guard in `handleItemRemove` is what stops a
      // gesture that stores nothing from creating a layout row for a user who
      // has only ever looked — slice 03's criterion. Nothing drove that
      // gesture before: every removal in the suite names a real item, so
      // `removeItem` always changed something and the guard never had to hold.
      // `getLayouts` returns nothing here, so a write would be a
      // `createLayout` — the row that must not exist.
      const element = await navigatorOn(undefined);
      const before = itemLabelsBySection(element);

      querySections(element)[0].dispatchEvent(
        new CustomEvent("itemremove", {
          bubbles: true,
          composed: true,
          detail: { sectionIndex: 0, index: 9 }
        })
      );
      await flush();
      await settleAutosave();

      expect(itemLabelsBySection(element)).toEqual(before);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("writes nothing when the picker closes with a falsy value that is not undefined", async () => {
      // Cancel and Escape both hand back `undefined`, and the payload-equality
      // guard swallows those on its own. This drives the other falsy shape a
      // real close can carry — an entry whose `data-id` is the empty string,
      // which is what a tab with a blank developer name produces. That one the
      // equality guard cannot swallow: an empty id *is* in the accessible set,
      // so `addItemToSection` would happily store `{id: ""}` and the layout
      // would change, and an item the user cannot navigate to would be in it.
      // `addChosenItem`'s `if (!tabId)` is the only thing standing there. (A
      // *stored* layout rather than the seeded one, because the seed places
      // every reachable tab, so a user with no layout is offered nothing at
      // all and this route cannot be driven against them.)
      const element = await navigatorOn(
        TWO_SECTIONS,
        THREE.concat([
          {
            developerName: "",
            label: "Blank",
            pageReference: {
              type: "standard__navItemPage",
              attributes: { apiName: "" },
              state: {}
            }
          }
        ])
      );
      await enterEditMode(element);
      const before = itemLabelsBySection(element);

      const picker = await openPicker(element, 0);
      const blank = pickerEntries(picker).find(
        (entry) => entry.dataset.id === ""
      );
      expect(blank).toBeDefined();
      blank.dispatchEvent(new CustomEvent("click"));
      await flush();
      await settleAutosave();

      expect(itemLabelsBySection(element)).toEqual(before);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("schedules no autosave when the picker resolves after the Navigator has gone", async () => {
      // `LightningModal.open` mounts the picker on `document.body`, outside
      // this component's tree, so it outlives the Navigator. A user who leaves
      // the Navigator tab with the picker open and then chooses an item runs
      // `applyLayout` -> `scheduleSave` on a destroyed instance, starting a 1s
      // timer that `disconnectedCallback` has already come and gone for. This
      // is the only write path in the file not driven by a template event, and
      // therefore the only one that can fire after disconnect.
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 0);

      // Leaving edit mode first (silently — nothing has changed yet) so the
      // disconnect below happens out of edit mode. `scheduleSave` already
      // returns early while editing, for a reason unrelated to this test's
      // subject; if editing stayed on, `jest.getTimerCount()` would read 0
      // for that reason regardless of whether the disconnected-instance guard
      // below fired at all, proving nothing.
      await cancelEdits(element);

      document.body.removeChild(element);
      expect(jest.getTimerCount()).toBe(0);

      pickerEntries(picker)[0].dispatchEvent(new CustomEvent("click"));
      await flush();

      // The hazard is the *timer*, not only the call: nothing is left running
      // that no `disconnectedCallback` will flush.
      expect(jest.getTimerCount()).toBe(0);
      await settleAutosave();
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    /**
     * Inherited from slice 01's critique: `handleSectionAddItems` gates the
     * button on `editing`, but the write happens when the picker's promise
     * *resolves* — arbitrarily later — and the original guard on
     * `addChosenItem` checked only `isAttached`, not the mode. Walked exactly
     * as the finding describes: enter edit mode, open the picker, press
     * Cancel while it is still open (nothing else has changed, so it closes
     * silently), then choose an entry from the still-open picker. Reachable
     * in a real org only because `lightning/modal` is a real modal with its
     * own backdrop and focus trap — a platform guarantee this suite cannot
     * assert — but this mock, per the note on the import above, mounts the
     * real picker component, so the choice really does still land here.
     */
    it("does not write when a chosen item resolves after Cancel has ended the session that opened the picker", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 0);
      const before = itemLabelsBySection(element);

      await cancelEdits(element);

      pickerEntries(picker)[0].dispatchEvent(new CustomEvent("click"));
      await flush();

      // Nothing changed on screen, and no debounce armed to write it later —
      // the same two-part proof the disconnected-instance test above uses,
      // since a stray timer is the hazard even when the eventual write does
      // not land immediately.
      expect(itemLabelsBySection(element)).toEqual(before);
      expect(jest.getTimerCount()).toBe(0);
      await settleAutosave();
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    /**
     * The half of the same finding a bare `!this.isEditing` guard would still
     * miss: Cancel ends the session the picker was opened in, but re-entering
     * edit mode starts a *new* one, and `isEditing` reads `true` throughout —
     * a mode check alone cannot tell the two apart. The stale picker's choice
     * must not land on the session that replaced the one it was opened for.
     */
    it("does not let a stale picker's choice land on a different, later edit session", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 0);

      await cancelEdits(element);
      await enterEditMode(element);
      const before = itemLabelsBySection(element);

      pickerEntries(picker)[0].dispatchEvent(new CustomEvent("click"));
      await flush();

      expect(itemLabelsBySection(element)).toEqual(before);
      await settleAutosave();
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("adds nothing and writes nothing when Escape closes the picker", async () => {
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const before = itemLabelsBySection(element);
      const picker = await openPicker(element, 0);

      picker.shadowRoot.querySelector("lightning-input").dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Escape",
          bubbles: true,
          composed: true
        })
      );
      await flush();
      await settleAutosave();

      expect(itemLabelsBySection(element)).toEqual(before);
      expect(updateLayout).not.toHaveBeenCalled();
      expect(createLayout).not.toHaveBeenCalled();
    });

    it("says there is nothing to add when every reachable tab is already placed", async () => {
      const element = await navigatorOn(
        storedLayout([
          {
            name: "Selling",
            columns: 3,
            items: [
              { id: "Account" },
              { id: "Contact" },
              { id: "standard-ActionHub" }
            ]
          }
        ])
      );
      await enterEditMode(element);

      const picker = await openPicker(element, 0);

      expect(pickerEntries(picker)).toHaveLength(0);
      expect(picker.shadowRoot.textContent).toContain("already");
    });

    it("names the dialog after the section it was opened from", async () => {
      // `label` is the dialog's accessible name in the real platform, and it
      // is base-class config rather than an `@api` property of the picker —
      // so nothing asserted that it survived the trip until the mock stopped
      // dropping it. Section 1, not 0, so "names the section" is
      // distinguishable from "names the first one".
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 1);

      expect(configOf(picker).label).toBe("Add items to Support");
      expect(configOf(picker).size).toBe("small");
    });

    it("puts the picker in a real lightning-modal rather than a hand-rolled panel", async () => {
      // The design says compose from base components where one exists —
      // they adopt SLDS 2 automatically, and the dialog semantics, the focus
      // trap and Escape are the platform's rather than ours. A div dressed up
      // as a dialog would pass every click-driven assertion above.
      const element = await navigatorOn(TWO_SECTIONS);
      await enterEditMode(element);
      const picker = await openPicker(element, 0);

      expect(
        picker.shadowRoot.querySelector("lightning-modal-header")
      ).not.toBeNull();
      expect(
        picker.shadowRoot.querySelector("lightning-modal-body")
      ).not.toBeNull();
      expect(
        picker.shadowRoot.querySelector("lightning-modal-footer")
      ).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Keeping more than one layout and switching between them.
  //
  // **Every assertion in this block is about what the store holds
  // afterwards**, never about which Apex method was called with what. That is
  // this slice's whole subject: the failure it exists to prevent is a client
  // sending a plausible call and the server writing it to the wrong row, and a
  // suite asserting the call stays green throughout that. So the Apex mocks
  // below are not stubs returning fixed values — they are a small in-memory
  // store that behaves the way `NavigatorLayoutController` does, and the
  // assertions read `store.rows`.
  //
  // The fixture is three layouts with **the active one in the middle**. One
  // layout cannot tell "the active one" from "the only one", and an active
  // layout at position 0 cannot tell it from "the first one" — either would
  // pass a switcher wired to the wrong record.
  // -------------------------------------------------------------------

  describe("switching between layouts", () => {
    const FIRST_ID = "a0X000000000011AAA";
    const SECOND_ID = "a0X000000000012AAA";
    const THIRD_ID = "a0X000000000013AAA";

    const NAV_ITEMS = [ACCOUNT_ITEM, CONTACT_ITEM, ACTION_HUB_ITEM];

    /** A payload whose section name, column count and rename are all distinct. */
    function payload(sectionName, columns, items) {
      return JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        sections: [{ name: sectionName, columns, items }]
      });
    }

    const SELLING = payload("Selling", 2, [
      { id: "Account", rename: "Clients" }
    ]);
    const SUPPORT = payload("Support", 4, [{ id: "Contact" }]);
    const ADMIN = payload("Admin", 1, [{ id: "standard-ActionHub" }]);

    function threeRows() {
      return [
        {
          layoutId: FIRST_ID,
          name: "Selling",
          isActive: false,
          isReadable: true,
          layoutJson: SELLING
        },
        {
          layoutId: SECOND_ID,
          name: "Support",
          isActive: true,
          isReadable: true,
          layoutJson: SUPPORT
        },
        {
          layoutId: THIRD_ID,
          name: "Admin",
          isActive: false,
          isReadable: true,
          layoutJson: ADMIN
        }
      ];
    }

    /**
     * A stand-in for `Navigator_Layout__c` that enforces what the controller
     * enforces: exactly one active row, a create that sits beside what is
     * already there, and a delete that hands the active flag to the layout
     * taking the deleted one's place. Assertions read from it.
     */
    function installStore(rows) {
      const store = {
        rows: rows.map((row) => ({ ...row })),
        of(layoutId) {
          return store.rows.find((row) => row.layoutId === layoutId);
        },
        activeName() {
          const active = store.rows.filter((row) => row.isActive);
          return active.length === 1
            ? active[0].name
            : `${active.length} active`;
        },
        payloadOf(layoutId) {
          const row = store.of(layoutId);
          return row ? row.layoutJson : undefined;
        },
        names() {
          return store.rows.map((row) => row.name);
        }
      };

      function makeActiveOnly(layoutId) {
        store.rows.forEach((row) => {
          row.isActive = row.layoutId === layoutId;
        });
      }
      function copies() {
        return store.rows.map((row) => ({ ...row }));
      }
      function refuse() {
        return Promise.reject(
          new Error("That layout no longer exists, or does not belong to you.")
        );
      }

      getLayouts.mockImplementation(() => Promise.resolve(copies()));

      updateLayout.mockImplementation(
        ({ layoutId, name, layoutJson, makeActive }) => {
          const row = store.of(layoutId);
          if (!row) {
            return refuse();
          }
          row.name = name;
          row.layoutJson = layoutJson;
          if (makeActive) {
            makeActiveOnly(layoutId);
          }
          return Promise.resolve({ ...row });
        }
      );

      createLayout.mockImplementation(({ name, layoutJson, makeActive }) => {
        const row = {
          layoutId: `a0X0000000000${20 + store.rows.length}AAA`,
          name,
          layoutJson,
          isActive: false,
          isReadable: true
        };
        store.rows.push(row);
        if (makeActive) {
          makeActiveOnly(row.layoutId);
        }
        return Promise.resolve({ ...row });
      });

      activateLayout.mockImplementation(({ layoutId }) => {
        if (!store.of(layoutId)) {
          return refuse();
        }
        makeActiveOnly(layoutId);
        return Promise.resolve(copies());
      });

      /**
       * Holds the next switch open until the caller lets it go, so a change can
       * be made *while a switch is in flight*. Every other test here resolves
       * Apex instantly, and instant resolution hides the one ordering the
       * previous project actually shipped a bug in.
       */
      store.deferNextActivation = () => {
        const answer = activateLayout.getMockImplementation();
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        activateLayout.mockImplementationOnce((args) =>
          gate.then(() => answer(args))
        );
        return release;
      };

      /**
       * The same, for a create. A change made *while a create is in flight* is
       * the one interleaving that reaches `rememberSaved`'s create-adoption
       * guard: the change belongs to a user who had no row, so it is a create
       * of its own, and by the time it lands the layout on screen is the one
       * the other create made.
       */
      store.deferNextCreate = () => {
        const answer = createLayout.getMockImplementation();
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        createLayout.mockImplementationOnce((args) =>
          gate.then(() => answer(args))
        );
        return release;
      };

      renameLayout.mockImplementation(({ layoutId, name }) => {
        const row = store.of(layoutId);
        if (!row) {
          return refuse();
        }
        row.name = name;
        return Promise.resolve({ ...row });
      });

      deleteLayout.mockImplementation(({ layoutId }) => {
        const at = store.rows.findIndex((row) => row.layoutId === layoutId);
        if (at === -1) {
          return refuse();
        }
        const wasActive = store.rows[at].isActive;
        store.rows = store.rows.filter((row) => row.layoutId !== layoutId);
        if (wasActive && store.rows.length > 0) {
          makeActiveOnly(
            store.rows[Math.min(at, store.rows.length - 1)].layoutId
          );
        }
        return Promise.resolve(copies());
      });

      /**
       * The same, for a delete. A change made *while a delete is in flight* is
       * the one interleaving `discardPendingSave` cannot reach: it fires at the
       * gesture, and the round trip that follows is a window in which
       * `this.layoutId` still names the row that is about to go.
       */
      store.deferNextDelete = () => {
        const answer = deleteLayout.getMockImplementation();
        let release;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        deleteLayout.mockImplementationOnce((args) =>
          gate.then(() => answer(args))
        );
        return release;
      };

      return store;
    }

    async function navigatorOnStore(store, navItems = NAV_ITEMS) {
      const element = createNavigator();
      getNavItems.emit({ navItems });
      await flush();
      await flush();
      expect(store.rows.length).toBeGreaterThanOrEqual(0);
      return element;
    }

    function layoutMenu(element) {
      return element.shadowRoot.querySelector("lightning-button-menu");
    }

    function layoutMenuEntries(element) {
      return Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      ).map((entry) => ({
        value: entry.value,
        label: entry.label,
        checked: entry.checked === true
      }));
    }

    /**
     * Whether the switcher's `value` entry is `disabled` right now — a
     * separate helper from `layoutMenuEntries` rather than a new key added to
     * it, because that function's return shape is asserted with `toEqual`
     * against object literals elsewhere in this file and a new key would
     * break every one of them for a fact they are not about.
     */
    function menuItemDisabled(element, value) {
      const item = Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      ).find((entry) => entry.value === value);
      return item ? item.disabled === true : undefined;
    }

    function selectLayoutMenu(element, value) {
      layoutMenu(element).dispatchEvent(
        new CustomEvent("select", { detail: { value } })
      );
    }

    async function switchToLayout(element, layoutId) {
      selectLayoutMenu(element, `layout:${layoutId}`);
      await settleAutosave();
    }

    /** The column count actually painted, read off the grid's class. */
    function renderedColumns(element, sectionIndex) {
      const grid =
        querySections(element)[sectionIndex].shadowRoot.querySelector("ul");
      return Number(/cols-(\d)/.exec(grid.className)[1]);
    }

    function promptInput(element) {
      return element.shadowRoot.querySelector(".rstk-nav-layout-prompt__input");
    }

    function promptButton(element, label) {
      return Array.from(
        element.shadowRoot.querySelectorAll(
          ".rstk-nav-layout-prompt lightning-button"
        )
      ).find((button) => button.label === label);
    }

    async function typeLayoutName(element, name) {
      const input = promptInput(element);
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: name } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await settleAutosave();
    }

    // ---------------------------------------------------------------
    // Listing, and what the active layout renders as
    // ---------------------------------------------------------------

    it("lists every layout the user owns with the active one checked, and the active one is neither the only one nor the first", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      // The Tier 3 half of the switcher, which is what renders out of edit
      // mode: every layout the user owns, with the active one checked.
      // Creating, renaming and deleting are Tier 2 and are gated — see
      // "entering and leaving edit mode" for the entries that join these.
      expect(layoutMenuEntries(element)).toEqual([
        { value: `layout:${FIRST_ID}`, label: "Selling", checked: false },
        { value: `layout:${SECOND_ID}`, label: "Support", checked: true },
        { value: `layout:${THIRD_ID}`, label: "Admin", checked: false }
      ]);
      expect(layoutMenu(element).label).toBe("Support");
    });

    it("renders the sections, items, column counts and renames of the active layout, not of the first one", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      expect(sectionNames(element)).toEqual(["Support"]);
      expect(itemLabelsBySection(element)).toEqual([["Contacts"]]);
      expect(renderedColumns(element, 0)).toBe(4);
    });

    // ---------------------------------------------------------------
    // Switching
    // ---------------------------------------------------------------

    it("switching re-renders the selected layout's sections, items, column counts and renames", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      await switchToLayout(element, FIRST_ID);

      expect(sectionNames(element)).toEqual(["Selling"]);
      expect(itemLabelsBySection(element)).toEqual([["Clients"]]);
      expect(renderedColumns(element, 0)).toBe(2);
      expect(store.activeName()).toBe("Selling");
    });

    it("switching leaves every other layout in the store exactly as it was", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      await switchToLayout(element, THIRD_ID);

      expect(store.payloadOf(FIRST_ID)).toBe(SELLING);
      expect(store.payloadOf(SECOND_ID)).toBe(SUPPORT);
      expect(store.payloadOf(THIRD_ID)).toBe(ADMIN);
      expect(store.names()).toEqual(["Selling", "Support", "Admin"]);
    });

    it("switching writes no payload at all, so it cannot rewrite the layout it switches to", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      await switchToLayout(element, THIRD_ID);

      // The switch has to have actually happened, or "no payload was written"
      // is true of a test that never switched at all.
      expect(store.activeName()).toBe("Admin");
      expect(updateLayout).not.toHaveBeenCalled();
      expect(createLayout).not.toHaveBeenCalled();
    });

    it("switching away and back restores the first layout's own renames and column count from the store", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      await switchToLayout(element, FIRST_ID);
      await switchToLayout(element, SECOND_ID);

      expect(sectionNames(element)).toEqual(["Support"]);
      expect(renderedColumns(element, 0)).toBe(4);
      expect(store.payloadOf(FIRST_ID)).toBe(SELLING);
    });

    it("no sequence of switches leaves two layouts active or none", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      for (const id of [THIRD_ID, FIRST_ID, FIRST_ID, SECOND_ID, THIRD_ID]) {
        // eslint-disable-next-line no-await-in-loop
        await switchToLayout(element, id);
        expect(store.rows.filter((row) => row.isActive)).toHaveLength(1);
      }
      expect(store.activeName()).toBe("Admin");
    });

    it("the display follows the store rather than the request, so a client that asked for the wrong layout is corrected", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      // The server refuses the id and the store is unchanged; the component
      // must not paint a layout the store does not say is active.
      await switchToLayout(element, "a0X000000000099AAA");

      expect(store.activeName()).toBe("Support");
      expect(sectionNames(element)).toEqual(["Support"]);
    });

    it("selecting the layout that is already active changes nothing and calls nothing", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      await switchToLayout(element, SECOND_ID);

      expect(activateLayout).not.toHaveBeenCalled();
      expect(store.activeName()).toBe("Support");
    });

    it("a change still in the debounce is written to the layout it was made on, not to the one switched to", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      // An item rename is gated behind edit mode as of this slice, same as a
      // section-level change. `renameFirstItem` dispatches the `itemrename`
      // event directly on the item element rather than opening its (now
      // gated) menu, which is what still lets it stand in here — out of
      // edit mode, where this test stays throughout — for "some canvas
      // mutation"; the debounce/race behaviour under test does not care
      // which act armed it.
      await renameFirstItem(element, 0, "Renamed");
      // Switched inside the debounce window, before the save has fired.
      await switchToLayout(element, THIRD_ID);

      expect(
        JSON.parse(store.payloadOf(SECOND_ID)).sections[0].items[0].rename
      ).toBe("Renamed");
      expect(store.payloadOf(THIRD_ID)).toBe(ADMIN);
      expect(store.activeName()).toBe("Admin");
    });

    /**
     * The previous project's bug, in the one ordering that still reaches it
     * after every switch flushes its debounce: a change made *while a switch is
     * in flight*. `this.layoutId` moves when the switch resolves, so a save
     * that read it at write time rather than at queue time would put the layout
     * the user was looking at onto the layout they had just moved to.
     *
     * Every other test in this block resolves Apex instantly, which is exactly
     * why none of them can tell the two apart — the switch is over before the
     * change is made. This one holds the switch open.
     */
    it("a change made while a switch is still in flight is written to the layout it was made on", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      const releaseSwitch = store.deferNextActivation();

      selectLayoutMenu(element, `layout:${THIRD_ID}`);
      await flush();

      // Still looking at Support, because the switch has not landed.
      expect(sectionNames(element)).toEqual(["Support"]);
      await renameFirstItem(element, 0, "Renamed");
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flush();

      releaseSwitch();
      await settleAutosave();

      expect(
        JSON.parse(store.payloadOf(SECOND_ID)).sections[0].items[0].rename
      ).toBe("Renamed");
      expect(store.payloadOf(THIRD_ID)).toBe(ADMIN);
      expect(store.activeName()).toBe("Admin");
      expect(sectionNames(element)).toEqual(["Admin"]);
    });

    /**
     * The same ordering the other way round, and it is the **ordinary** case
     * rather than the rare one: the activation round trip completes *inside*
     * the 1s debounce window, so `this.layoutId` and `this.storedLayout` have
     * both already moved by the time the timer fires.
     *
     * The order below is the order a browser uses — a resolved promise's
     * continuations run before any timer does — and it is deliberately not the
     * order `settleAutosave` uses, which advances the timer first and so can
     * never see an Apex call land ahead of a pending debounce.
     */
    it("a change made while a switch is in flight survives the switch landing before the debounce fires", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      const releaseSwitch = store.deferNextActivation();

      selectLayoutMenu(element, `layout:${THIRD_ID}`);
      await flush();

      // Still looking at Support, because the switch has not landed.
      expect(sectionNames(element)).toEqual(["Support"]);
      await renameFirstItem(element, 0, "Renamed");

      // The switch lands first. Microtasks, then timers.
      releaseSwitch();
      await flush();
      await flush();
      expect(sectionNames(element)).toEqual(["Admin"]);

      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flush();
      await flush();

      expect(
        JSON.parse(store.payloadOf(SECOND_ID)).sections[0].items[0].rename
      ).toBe("Renamed");
      expect(store.payloadOf(THIRD_ID)).toBe(ADMIN);
      expect(store.activeName()).toBe("Admin");
    });

    /**
     * What flushing the pending save at the *start* of a switch buys, now that
     * the change carries its own layout's id whenever it fires. A change made
     * on the layout switched *to*, still inside the first change's debounce
     * window, replaces the pending change — so an unflushed one is not merely
     * late, it is gone with no trace and no error.
     */
    it("a change still in the debounce is written before the switch, so a change made on the layout switched to cannot displace it", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);

      await renameFirstItem(element, 0, "Renamed on Support");

      // Switched inside the debounce window, before the save has fired.
      selectLayoutMenu(element, `layout:${THIRD_ID}`);
      await flush();
      await flush();
      await flush();
      expect(sectionNames(element)).toEqual(["Admin"]);

      // A second change, still inside the first one's window.
      await renameFirstItem(element, 0, "Renamed on Admin");
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flush();
      await flush();

      expect(
        JSON.parse(store.payloadOf(SECOND_ID)).sections[0].items[0].rename
      ).toBe("Renamed on Support");
      expect(
        JSON.parse(store.payloadOf(THIRD_ID)).sections[0].items[0].rename
      ).toBe("Renamed on Admin");
    });

    /**
     * The one state in which the store has rows the client can read and none of
     * them flagged. The controller does not produce it — `createLayout`
     * activates the row it creates when the owner has nothing else active — but
     * no server rule can close this route, because the flag is on a row *this
     * package cannot read*, and unreadable rows are filtered out on this side
     * before the flag is looked for. The load path and the switch/delete path
     * have to agree about it, or the same store paints two different screens.
     */
    it("a store whose active layout is one this version cannot read still shows a layout the user owns, not the seeded one", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      deleteLayout.mockResolvedValueOnce([
        {
          layoutId: FIRST_ID,
          name: "Selling",
          isActive: false,
          isReadable: true,
          layoutJson: SELLING
        },
        {
          layoutId: THIRD_ID,
          name: "Admin",
          isActive: true,
          isReadable: false,
          unreadableReason: "schema version 9"
        }
      ]);

      selectLayoutMenu(element, "delete-layout");
      await flush();
      promptButton(element, "Delete layout").click();
      await settleAutosave();

      expect(sectionNames(element)).toEqual(["Selling"]);
      expect(layoutMenu(element).label).toBe("Selling");
    });

    /**
     * Once Tier 2 requires edit mode, this can no longer be a race against a
     * *live* debounce: entering edit mode is a precondition for reaching
     * "delete-layout" at all, and entering it is exactly what stops a Tier 1
     * change from ever arming a debounce in the first place. What survives of
     * the original claim is the outcome — a canvas change made and then its
     * layout deleted, inside the same session, writes nothing — proven here
     * by `scheduleSave`'s `isEditing` guard rather than by `persist`'s
     * `stillExists` check, which this interleaving can no longer reach.
     */
    it("a change made and then its layout deleted, inside the same edit session, writes nothing", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      selectLayoutMenu(element, "delete-layout");
      await flush();
      promptButton(element, "Delete layout").click();
      await flush();
      // The canvas change made above means Delete layout's own confirm now
      // opens the shared discard prompt instead of deleting on the spot —
      // slice 02's widening of the same confirmation to this call site.
      promptButton(element, "Discard changes").click();
      await settleAutosave();

      expect(updateLayout).not.toHaveBeenCalled();
      expect(store.names()).toEqual(["Selling", "Admin"]);
      expect(store.activeName()).toBe("Admin");
    });

    /**
     * The delete itself is unaffected by an edit session in progress: it
     * still commits on the spot, still adopts the store's own answer about
     * which layout replaces the one removed, and still reports no save error,
     * because nothing was attempted. Once Tier 2 requires edit mode, a canvas
     * change made while the delete's round trip is in flight is a Tier 1
     * draft rather than a pending debounce — `scheduleSave`'s `isEditing`
     * guard is what keeps it unwritten now, not `persist`'s `stillExists`
     * check, which this interleaving can no longer reach.
     */
    it("a canvas change made while its layout is being deleted is written nowhere and reports no save error", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);
      const releaseDelete = store.deferNextDelete();

      selectLayoutMenu(element, "delete-layout");
      await flush();
      promptButton(element, "Delete layout").click();
      await flush();

      // Still looking at Support, because the delete has not landed.
      expect(sectionNames(element)).toEqual(["Support"]);
      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      // The delete lands first. Microtasks, then timers.
      releaseDelete();
      await flush();
      await flush();
      expect(sectionNames(element)).toEqual(["Admin"]);

      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
      await flush();
      await flush();

      expect(updateLayout).not.toHaveBeenCalled();
      expect(store.names()).toEqual(["Selling", "Admin"]);
      expect(store.activeName()).toBe("Admin");
      expect(element.shadowRoot.querySelector('[role="alert"]')).toBeNull();
    });

    /**
     * Re-review finding C. Narrowing the race above to `scheduleSave`'s
     * `isEditing` guard dropped the suite's only coverage of `persist`'s
     * `stillExists` early return — and that guard is still reachable, just
     * not through the autosave. Save is an immediate write and does not check
     * `isEditing`: pressed while this layout's own delete is still in flight,
     * it captures `target.layoutId` as the doomed row, and by the time it
     * runs, `adoptFromStore` has already dropped that row from
     * `this.layouts`. Disabling `stillExists` here calls `updateLayout` on a
     * layout that no longer exists and reports a save error about it.
     */
    it("a Save that lands after its own layout has been deleted writes nothing and reports no save error", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      const releaseDelete = store.deferNextDelete();

      selectLayoutMenu(element, "delete-layout");
      await flush();
      promptButton(element, "Delete layout").click();
      await flush();
      // The canvas change above means this confirm opens the shared discard
      // prompt rather than deleting on the spot — slice 02's widening of the
      // same confirmation to this call site.
      promptButton(element, "Discard changes").click();
      await flush();

      // Still looking at Support — the delete has not landed — and Save is
      // pressed on it while the delete is in flight.
      expect(sectionNames(element)).toEqual(["Support"]);
      await saveEdits(element);

      releaseDelete();
      await flush();
      await flush();
      await flush();

      expect(sectionNames(element)).toEqual(["Admin"]);
      expect(updateLayout).not.toHaveBeenCalled();
      expect(store.names()).toEqual(["Selling", "Admin"]);
      expect(store.activeName()).toBe("Admin");
      expect(element.shadowRoot.querySelector('[role="alert"]')).toBeNull();
    });

    /**
     * `rememberSaved`'s create-adoption guard does not need a Tier 1 autosave
     * to reach — one from *New layout*, one from an ordinary Tier 1 autosave
     * racing it was the pairing the fix pass measured, and once Tier 2
     * requires edit mode that specific pairing cannot happen any more: a
     * Tier 1 change made during this wait is a draft held by the same
     * session, never an autosave of its own. **Re-review correction:** that
     * is not the only pairing, and the fix pass's conclusion — that the
     * guard is therefore unreachable by any user path — does not follow from
     * it. `createNewLayout` does not leave edit mode, so a user can press
     * Save on the draft it is replacing while its own create is still in
     * flight; the test below this one reaches the guard through exactly
     * that pairing. What this test proves is narrower and still true: the
     * screen shows nothing of the new layout until the write actually lands.
     */
    it("a new layout being created does not show on screen until the write lands", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);
      const releaseCreate = store.deferNextCreate();

      selectLayoutMenu(element, "new-layout");
      await flush();
      const input = promptInput(element);
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: "Weekly review" } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();

      // Nothing on the server yet: the create has not landed.
      expect(store.names()).toEqual([]);

      releaseCreate();
      await flush();
      await flush();
      await flush();

      expect(store.names()).toEqual(["Weekly review"]);
      expect(
        layoutMenuEntries(element)
          .filter((entry) => entry.checked)
          .map((entry) => entry.label)
      ).toEqual(["Weekly review"]);
    });

    /**
     * Re-review finding B. `rememberSaved`'s create-adoption guard
     * (`!target.layoutId && this.layoutId === undefined`) is live, not dead.
     * `createNewLayout` does not leave edit mode, so a user can press Save —
     * an immediate write — on the draft it is replacing while its own create
     * is still in flight. That Save is captured with `layoutId: undefined`,
     * exactly as New layout's own create was, and by the time it lands
     * `this.layoutId` already names the layout New layout created. With the
     * guard intact the switcher's checked entry stays on New layout's row;
     * collapsed to `if (!target.layoutId)`, adopting the Save's id
     * unconditionally would move it back onto the draft the user has already
     * moved on from.
     */
    it("a Save that lands after New layout does not move the active layout back to the draft it replaced", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      const releaseCreate = store.deferNextCreate();

      selectLayoutMenu(element, "new-layout");
      await flush();
      const input = promptInput(element);
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: "Weekly review" } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();
      // The canvas change above means committing the name opens the shared
      // discard prompt rather than creating on the spot — slice 02's
      // widening of the same confirmation to this call site.
      discardConfirmButton(element).click();
      await flush();

      // The abandoned draft, saved while New layout's create is still in
      // flight.
      await saveEdits(element);

      releaseCreate();
      await flush();
      await flush();
      await flush();
      await flush();
      await flush();

      expect(
        layoutMenuEntries(element)
          .filter((entry) => entry.checked)
          .map((entry) => entry.label)
      ).toEqual(["Weekly review"]);
    });

    /**
     * Re-review, the finding above's own re-review. The test above proves the
     * switcher's checked entry stays correct, and that is not the whole of
     * the damage: `createNewLayout` calls `createLayout` directly off
     * `saveChain` rather than through `commitLayoutNow`, so it never set
     * `creatingLayout`, and a Save made inside its round trip was still
     * captured with `layoutId: undefined` — a second row, with the server's
     * active flag on it, while the switcher's checked entry (read from
     * `this.layoutId`, guarded separately by `rememberSaved`) stayed right.
     * Reading the store, not only the screen, is what catches it.
     */
    it("a Save that lands after New layout does not create a second row on the server", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      const releaseCreate = store.deferNextCreate();

      selectLayoutMenu(element, "new-layout");
      await flush();
      const input = promptInput(element);
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: "Weekly review" } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();
      // The canvas change above means committing the name opens the shared
      // discard prompt rather than creating on the spot — slice 02's
      // widening of the same confirmation to this call site.
      discardConfirmButton(element).click();
      await flush();

      // The abandoned draft, saved while New layout's create is still in
      // flight.
      await saveEdits(element);

      releaseCreate();
      await flush();
      await flush();
      await flush();
      await flush();
      await flush();

      // One row, not two, and the server's own active flag agrees with it —
      // not only the switcher's checked entry, which stayed right even on
      // the unfixed code.
      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(store.names()).toEqual(["Weekly review"]);
      expect(store.activeName()).toBe("Weekly review");
    });

    /**
     * Superseded by the sixth pass's lockout (Jonah's decision, 2026-08-31).
     * This test used to pin the *coalescing* mechanism's correctness under an
     * overlap the client used to allow — a no-row rename made while New
     * layout's own create was still open landed as its own, separate row
     * rather than silently folding into it. `isWriteLocked` now closes that
     * overlap outright: Rename layout is one of the four writing controls it
     * disables — the `disabled` attribute in the template and the
     * handler-side re-check in `handleLayoutMenuSelect` both — for as long as
     * *any* of the four has a round trip outstanding, so the rename prompt
     * cannot even be opened until New layout's create lands. What remains
     * true and reachable is checked instead: the attempt does nothing while
     * locked, and once New layout's create settles, that is the layout on
     * screen — renaming it renames that one row, not a second.
     *
     * The mutation this test used to catch — `rememberSaved`'s create-
     * adoption guard, `!target.layoutId && this.layoutId === undefined`,
     * collapsed to `if (!target.layoutId)` — needs two creates racing for the
     * same rowless user to discriminate at all, and the lockout is exactly
     * what makes that pairing unreachable now; see the corresponding
     * `## Deviations` bullet on whether anything else in this file still
     * discriminates it.
     */
    it("cannot open Rename layout while New layout's create is still open, and renames the layout it created once it lands", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      const releaseCreate = store.deferNextCreate();

      selectLayoutMenu(element, "new-layout");
      await flush();
      const input = promptInput(element);
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: "Weekly review" } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();
      // The canvas change above means committing the name opens the shared
      // discard prompt rather than creating on the spot — slice 02's
      // widening of the same confirmation to this call site.
      discardConfirmButton(element).click();
      await flush();

      // The attempt itself: Rename layout is disabled while New layout's own
      // create is still outstanding, and selecting it does nothing — no
      // prompt opens, and no second `createLayout` is queued behind it.
      expect(menuItemDisabled(element, "rename-layout")).toBe(true);
      selectLayoutMenu(element, "rename-layout");
      await flush();
      expect(promptInput(element)).toBeNull();
      expect(createLayout).toHaveBeenCalledTimes(1);

      releaseCreate();
      await flush();
      await flush();
      await flush();
      await flush();
      await flush();

      // The lock has cleared: Rename layout is available again, and it
      // renames the layout New layout created, since that is what is on
      // screen now.
      expect(menuItemDisabled(element, "rename-layout")).toBe(false);
      selectLayoutMenu(element, "rename-layout");
      await flush();
      await typeLayoutName(element, "Renamed");

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(store.names()).toEqual(["Renamed"]);
      expect(store.activeName()).toBe("Renamed");
    });

    /**
     * Superseded by the sixth pass's lockout (Jonah's decision, 2026-08-31),
     * for the same reason as the test above and for one more of its own. The
     * original scenario needed a no-row rename to land *while* New layout's
     * own create was still open, captured against the abandoned six-column
     * draft a rejected Save had left in `storedLayout` — `isWriteLocked`
     * forecloses the overlap itself, and by the time Rename layout is
     * available again, New layout's own successful create has already
     * replaced the canvas with its own seed (`createNewLayout`'s success
     * handler sets `storedLayout` and re-takes the entry snapshot), so the
     * rejected draft is gone before a rename could ever reach it — there is
     * no sequence left that reaches a rename holding six columns here.
     *
     * What the prior rejection can still affect, and what remains worth
     * checking: that its stale draft does not leak into New layout's own
     * seed. Structurally this cannot happen — `createNewLayout` seeds from
     * `this.items`, the live tab list, never from `this.layout` — but that
     * guarantee is worth a direct assertion rather than an inference from
     * reading the method, and the rejection is what puts a draft in
     * `storedLayout` for it to fail to leak from.
     */
    it("a rejected create's abandoned draft does not leak into a New layout made afterward", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      // A change, then a Save the server rejects: `layoutId` stays
      // undefined and the draft stays in `storedLayout` rather than being
      // replaced by a seed the server never confirmed.
      selectSectionMenuItem(element, 0, "columns-6");
      await flush();
      createLayout.mockRejectedValueOnce(new Error("The save failed."));
      await saveEdits(element);

      // Re-entering takes the abandoned draft as this session's entry
      // snapshot, not the seed.
      await enterEditMode(element);
      expect(renderedColumns(element, 0)).toBe(6);

      selectLayoutMenu(element, "new-layout");
      await flush();
      await typeLayoutName(element, "Weekly review");

      // New layout's own seed, three columns — not the rejected draft's six.
      expect(store.names()).toEqual(["Weekly review"]);
      expect(JSON.parse(store.rows[0].layoutJson).sections[0].columns).toBe(3);
      expect(renderedColumns(element, 0)).toBe(3);

      // The lock has cleared now that New layout's create has landed:
      // Rename layout renames the layout actually on screen.
      expect(menuItemDisabled(element, "rename-layout")).toBe(false);
      selectLayoutMenu(element, "rename-layout");
      await flush();
      await typeLayoutName(element, "Renamed");

      // Two `createLayout` calls total: the rejected one from the earlier
      // Save, and New layout's own successful one — never a third, since the
      // rename above is a with-row rename of the layout New layout created.
      expect(createLayout).toHaveBeenCalledTimes(2);
      expect(store.names()).toEqual(["Renamed"]);
      expect(store.activeName()).toBe("Renamed");
    });

    /**
     * Finding 1, the fifth-pass regression. The single `creatingLayout`
     * slot used to be cleared by whichever create resolved first rather
     * than by its owner: a no-row rename that falls through past New
     * layout's `distinct` create overwrites the field with its own,
     * non-`distinct` entry, and both writers cleared with a bare
     * `this.creatingLayout = undefined` that never checked the field still
     * held their own entry — so when New layout's create settled, it wiped
     * the *rename's* entry while the rename's own create was still open. A
     * Save made in that window then read `!this.layoutId &&
     * !this.creatingLayout`, skipped the wait a bare call is documented to
     * always take, and was captured as a third create.
     *
     * **Superseded by the sixth pass's lockout (Jonah's decision,
     * 2026-08-31), and this is finding 2's own disposition.** Finding 2
     * asked for coverage of `commitLayoutNow`'s ownership check on its own
     * create's clear, walking exactly the sequence this test used to: a
     * no-row rename's create held open, New layout's own create *also*
     * started and refused inside that window, then Save pressed while the
     * rename's create was still open. `isWriteLocked` closes the setup at
     * its second step — New layout is one of the four controls the lockout
     * disables while any of them, including a rename, has a round trip
     * outstanding — so New layout can no longer be attempted at all while
     * the rename's own create is open, refused or not. This is unreachable
     * rather than corrected: no production line inside `commitLayoutNow`
     * changed for this disposition, and the ownership check itself stands
     * exactly as finding 1 left it, as defence in depth behind the lockout
     * rather than the thing now closing the race.
     *
     * What remains true and reachable, walked as far as it still goes: New
     * layout and Save are both genuinely blocked while the rename's own
     * create is open, and once it clears, Save is an ordinary single write
     * — the only shape a write can still take once two cannot overlap.
     */
    it("New layout and Save are both blocked while a no-row rename's create is open, closing the race finding 2 asked for coverage of", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      const releaseRenameCreate = store.deferNextCreate();
      selectLayoutMenu(element, "rename-layout");
      await flush();
      await typeLayoutName(element, "Renamed");

      // New layout, attempted while the rename's own create is still open:
      // blocked, not raced. This is the step finding 2's own probe needed
      // to get past to reach `commitLayoutNow`'s ownership-check race, and
      // it cannot anymore.
      expect(menuItemDisabled(element, "new-layout")).toBe(true);
      selectLayoutMenu(element, "new-layout");
      await flush();
      expect(promptInput(element)).toBeNull();
      expect(createLayout).toHaveBeenCalledTimes(1);

      // Save, attempted in the same window, is blocked the same way — it
      // does nothing rather than waiting to coalesce.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        true
      );
      await saveEdits(element);
      expect(updateLayout).not.toHaveBeenCalled();

      releaseRenameCreate();
      await flush();
      await flush();
      await flush();
      await flush();
      await flush();

      // The lock has cleared: Save now updates the row the rename created
      // — the only write left to make, since the race this finding named
      // has no walkable path to it anymore.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        false
      );
      await saveEdits(element);

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(store.names()).toEqual(["Renamed"]);
      const renamed = store.rows.find((row) => row.name === "Renamed");
      expect(JSON.parse(renamed.layoutJson).sections[0].columns).toBe(6);
    });

    /**
     * Superseded by the sixth pass's lockout (Jonah's decision, 2026-08-31).
     * The original scenario needed a *second* no-row rename to be attempted
     * while the first's own create was still open, so `commitLayoutNow`'s
     * wait-and-recapture branch would re-read `this.editSnapshot` after the
     * wait cleared rather than replay the stale value handed in when the
     * second call was made. `isWriteLocked` forecloses attempting a second
     * Tier 2 act at all while the first has a round trip outstanding — Rename
     * layout disables the instant the first rename's create begins — so that
     * branch has no remaining route through the UI; see the corresponding
     * `## Deviations` bullet. And once the first rename's create has landed,
     * `this.layoutId` is set, so a rename attempted afterward is no longer a
     * no-row rename at all: it is the ordinary with-row path (`renameLayout`,
     * which "carries no payload"), and there is no sequence left in which a
     * *second* no-row rename's payload could ever be built from a snapshot
     * other than the one current when it was made — there is no longer a
     * second no-row rename to be made.
     *
     * What that leaves worth pinning, in place of the original: once a
     * no-row rename's create has landed, a later rename of the same layout
     * changes only its name — the canvas the first rename actually sent
     * survives untouched, whatever the tab list has done since.
     */
    it("a rename made after a no-row rename's create has landed changes only the name, not the canvas it already sent", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      const releaseCreate = store.deferNextCreate();
      selectLayoutMenu(element, "rename-layout");
      await flush();
      await typeLayoutName(element, "First");

      // A second attempt, while the first's create is still open, does
      // nothing: Rename layout is locked.
      expect(menuItemDisabled(element, "rename-layout")).toBe(true);
      selectLayoutMenu(element, "rename-layout");
      await flush();
      expect(promptInput(element)).toBeNull();

      // A tab list change arriving while the create is in flight — a normal
      // event for a UI API adapter, per this file's own comment on
      // `wiredNavItems`.
      getNavItems.emit({ navItems: [ACCOUNT_ITEM] });
      await flush();

      releaseCreate();
      await flush();
      await flush();
      await flush();
      await flush();
      await flush();

      // The lock has cleared, and `this.layoutId` now names the row the
      // first rename created — a second rename is an ordinary with-row
      // rename, not a second no-row create.
      expect(menuItemDisabled(element, "rename-layout")).toBe(false);
      selectLayoutMenu(element, "rename-layout");
      await flush();
      await typeLayoutName(element, "Second");

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(renameLayout).toHaveBeenCalledTimes(1);
      expect(store.names()).toEqual(["Second"]);

      // The name changed; the canvas the first rename actually sent — three
      // items, from before the tab list shrank — did not.
      const row = store.rows.find((existing) => existing.name === "Second");
      expect(JSON.parse(row.layoutJson).sections[0].items).toHaveLength(3);
    });

    it("the chosen layout is still the active one after a reload", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await switchToLayout(element, THIRD_ID);

      // A reload: the component is destroyed and a fresh one reads the store.
      document.body.removeChild(element);
      jest.runOnlyPendingTimers();
      await flush();
      const reloaded = await navigatorOnStore(store);

      expect(layoutMenu(reloaded).label).toBe("Admin");
      expect(sectionNames(reloaded)).toEqual(["Admin"]);
      expect(store.activeName()).toBe("Admin");
    });

    /**
     * The placement criterion, as far as jsdom reaches it. A second component
     * instance stands for a second placement — an App page or a Home page —
     * and it is handed nothing that could scope it differently, because the
     * bundle declares no design-time property at all: `lightning__Tab` rejects
     * `<property>` outright, server-enforced, so a placement key does not
     * exist to differ by. Both read the same per-user store with no placement
     * argument, so both show the same active layout.
     *
     * What this cannot reach is the three placements themselves — a real tab,
     * a real App page and a real Home page in a running org. See the slice's
     * `## Deviations`.
     */
    it("a second placement shows the same active layout, because a layout is scoped to the user and to nothing else", async () => {
      const store = installStore(threeRows());
      const tabPlacement = await navigatorOnStore(store);
      await switchToLayout(tabPlacement, THIRD_ID);

      const appPagePlacement = await navigatorOnStore(store);

      expect(layoutMenu(appPagePlacement).label).toBe("Admin");
      expect(sectionNames(appPagePlacement)).toEqual(["Admin"]);
      expect(sectionNames(tabPlacement)).toEqual(["Admin"]);
      // Neither placement passed anything to the read: the call takes no
      // argument, so there is no seam at which a placement could scope it.
      expect(getLayouts).toHaveBeenCalledWith();
    });

    // ---------------------------------------------------------------
    // Switching while editing, with an unsaved Tier 1 canvas change on
    // screen: the same discard confirmation Cancel uses, at a second call
    // site — `## Design`'s "Leaving edit mode with unsaved work" names this
    // pair explicitly.
    // ---------------------------------------------------------------

    it("switches immediately, without asking, when editing with nothing unsaved", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectLayoutMenu(element, `layout:${THIRD_ID}`);
      await settleAutosave();

      expect(discardConfirmButton(element)).toBeNull();
      expect(store.activeName()).toBe("Admin");
      expect(sectionNames(element)).toEqual(["Admin"]);
    });

    it("asks before discarding when switching layouts while editing with unsaved changes, and declining stays on the layout being edited", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      selectLayoutMenu(element, `layout:${THIRD_ID}`);
      await flush();

      // Asked, not silently switched: still on Support, the change still on
      // screen, and nothing sent to the server.
      expect(
        element.shadowRoot.querySelector('[role="alertdialog"]')
      ).not.toBeNull();
      expect(sectionNames(element)).toEqual(["Support"]);
      expect(activateLayout).not.toHaveBeenCalled();

      keepEditingButton(element).click();
      await flush();

      expect(discardConfirmButton(element)).toBeNull();
      expect(sectionNames(element)).toEqual(["Support"]);
      expect(renderedColumns(element, 0)).toBe(6);
      expect(activateLayout).not.toHaveBeenCalled();
      expect(store.activeName()).toBe("Support");
    });

    it("confirming the discard prompt on a layout switch throws the draft away and switches, by the same route Cancel uses", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      selectLayoutMenu(element, `layout:${THIRD_ID}`);
      await flush();
      discardConfirmButton(element).click();
      await settleAutosave();

      expect(store.activeName()).toBe("Admin");
      expect(sectionNames(element)).toEqual(["Admin"]);
      expect(updateLayout).not.toHaveBeenCalled();
      expect(createLayout).not.toHaveBeenCalled();
      // Tier 3 does not itself decide whether the mode is left; this switch
      // does not, so the action row still shows Save.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON)).not.toBeNull();
    });

    // ---------------------------------------------------------------
    // Creating
    // ---------------------------------------------------------------

    it("a new layout sits beside the existing ones rather than renaming and overwriting one", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectLayoutMenu(element, "new-layout");
      await flush();
      await typeLayoutName(element, "Weekly review");

      expect(store.names()).toEqual([
        "Selling",
        "Support",
        "Admin",
        "Weekly review"
      ]);
      expect(store.payloadOf(SECOND_ID)).toBe(SUPPORT);
      expect(store.activeName()).toBe("Weekly review");
      expect(layoutMenu(element).label).toBe("Weekly review");
    });

    it("a new layout starts from every tab the user can reach, as a first open does", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectLayoutMenu(element, "new-layout");
      await flush();
      await typeLayoutName(element, "Weekly review");

      expect(sectionNames(element)).toEqual(["All Items"]);
      expect(itemLabelsBySection(element)).toEqual([
        ["Accounts", "Contacts", "Action Plans"]
      ]);
    });

    // ---------------------------------------------------------------
    // Renaming
    // ---------------------------------------------------------------

    it("renaming a layout renames that layout in the store and leaves its payload and its neighbours alone", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectLayoutMenu(element, "rename-layout");
      await flush();
      await typeLayoutName(element, "Cases");

      expect(store.names()).toEqual(["Selling", "Cases", "Admin"]);
      expect(store.payloadOf(SECOND_ID)).toBe(SUPPORT);
      expect(store.activeName()).toBe("Cases");
      expect(layoutMenu(element).label).toBe("Cases");
    });

    /**
     * A rename the server refused must not survive on screen. Left standing it
     * is a name the store does not hold, in the button and in the menu — and
     * the next unrelated autosave carries `this.layoutName` to `updateLayout`,
     * so a refused rename would be made real by an edit that had nothing to do
     * with it.
     */
    it("a rename the store refuses is taken back off the screen, and the next unrelated change does not carry it", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      renameLayout.mockRejectedValueOnce(new Error("Refused"));
      await enterEditMode(element);

      selectLayoutMenu(element, "rename-layout");
      await flush();
      await typeLayoutName(element, "Cases");

      expect(layoutMenu(element).label).toBe("Support");
      expect(layoutMenuEntries(element).map((entry) => entry.label)).toEqual([
        "Selling",
        "Support",
        "Admin",
        "New layout…",
        "Rename layout…",
        "Delete layout…"
      ]);

      // A canvas change made in the same session, unrelated to the refused
      // rename, and committed by Save rather than by an autosave — Tier 1
      // writes only happen that way once edit mode is entered.
      selectSectionMenuItem(element, 0, "columns-6");
      await flush();
      await saveEdits(element);

      expect(updateLayout).toHaveBeenCalledWith(
        expect.objectContaining({ layoutId: SECOND_ID, name: "Support" })
      );
      expect(store.names()).toEqual(["Selling", "Support", "Admin"]);
    });

    // ---------------------------------------------------------------
    // Deleting
    // ---------------------------------------------------------------

    it("deleting the active layout leaves the layout that takes its place active and on screen", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectLayoutMenu(element, "delete-layout");
      await flush();
      promptButton(element, "Delete layout").click();
      await settleAutosave();

      expect(store.names()).toEqual(["Selling", "Admin"]);
      expect(store.rows.filter((row) => row.isActive)).toHaveLength(1);
      expect(store.activeName()).toBe("Admin");
      expect(sectionNames(element)).toEqual(["Admin"]);
      expect(renderedColumns(element, 0)).toBe(1);
    });

    it("deleting the only layout leaves no row at all and puts the user back on the seeded layout", async () => {
      const store = installStore([
        {
          layoutId: SECOND_ID,
          name: "Support",
          isActive: true,
          isReadable: true,
          layoutJson: SUPPORT
        }
      ]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      selectLayoutMenu(element, "delete-layout");
      await flush();
      promptButton(element, "Delete layout").click();
      await settleAutosave();

      expect(store.rows).toEqual([]);
      expect(sectionNames(element)).toEqual(["All Items"]);
      expect(itemLabelsBySection(element)).toEqual([
        ["Accounts", "Contacts", "Action Plans"]
      ]);
    });

    // ---------------------------------------------------------------
    // The lockout (sixth pass, Jonah's decision, 2026-08-31): while any one
    // of the four writing controls has a round trip outstanding, all four
    // disable — not only the one pressed — so a second layout operation
    // cannot be issued inside the first's server round trip.
    // ---------------------------------------------------------------

    it("Delete layout disables all four writing controls while its own delete is outstanding, and clears them once it lands", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      const releaseDelete = store.deferNextDelete();
      selectLayoutMenu(element, "delete-layout");
      await flush();
      promptButton(element, "Delete layout").click();
      await flush();

      // The delete is outstanding: every one of the four controls is
      // disabled, not only Delete layout itself.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        true
      );
      expect(menuItemDisabled(element, "new-layout")).toBe(true);
      expect(menuItemDisabled(element, "rename-layout")).toBe(true);
      expect(menuItemDisabled(element, "delete-layout")).toBe(true);

      // None of them can be issued while locked — attempting each does
      // nothing.
      await saveEdits(element);
      expect(updateLayout).not.toHaveBeenCalled();
      selectLayoutMenu(element, "new-layout");
      await flush();
      expect(promptInput(element)).toBeNull();

      releaseDelete();
      await flush();
      await flush();
      await flush();
      await flush();

      // The lock has cleared: all four are available again.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        false
      );
      expect(menuItemDisabled(element, "new-layout")).toBe(false);
      expect(menuItemDisabled(element, "rename-layout")).toBe(false);
      expect(store.names()).toEqual(["Selling", "Admin"]);
    });

    it("the lockout clears on a refused write exactly as it does on a successful one", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      // New layout's own create — held open, then refused rather than
      // resolved.
      let refuseCreate;
      createLayout.mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            refuseCreate = () =>
              reject(new Error("That layout could not be saved."));
          })
      );

      selectLayoutMenu(element, "new-layout");
      await flush();
      await typeLayoutName(element, "Weekly review");

      // Locked while the refusal is still pending.
      expect(menuItemDisabled(element, "rename-layout")).toBe(true);
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        true
      );

      refuseCreate();
      await flush();
      await flush();
      await flush();
      await flush();

      // A refusal clears the lock exactly as a success does — a stuck-open
      // lockout would be worse than the race it exists to close.
      expect(menuItemDisabled(element, "rename-layout")).toBe(false);
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        false
      );
      expect(store.rows).toEqual([]);
    });

    // ---------------------------------------------------------------
    // Looking is not changing
    // ---------------------------------------------------------------

    it("opening the menu, and opening each of its dialogs, writes nothing for a user who has never changed anything", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      layoutMenu(element).dispatchEvent(new CustomEvent("open"));
      await settleAutosave();

      // Opening a dialog is not committing one. A `select` that merely opened
      // a box has been enough to create a row twice on this spec, from two
      // different directions, so each is opened here and none is committed.
      for (const entry of ["new-layout", "rename-layout", "delete-layout"]) {
        selectLayoutMenu(element, entry);
        // eslint-disable-next-line no-await-in-loop
        await settleAutosave();
      }

      expect(store.rows).toEqual([]);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("cancelling New layout, Rename layout and Delete layout each writes nothing", async () => {
      const store = installStore(threeRows());
      const element = await navigatorOnStore(store);
      await enterEditMode(element);

      for (const entry of ["new-layout", "rename-layout", "delete-layout"]) {
        selectLayoutMenu(element, entry);
        // eslint-disable-next-line no-await-in-loop
        await flush();
        promptButton(element, "Cancel").click();
        // eslint-disable-next-line no-await-in-loop
        await settleAutosave();
      }

      expect(store.names()).toEqual(["Selling", "Support", "Admin"]);
      expect(store.activeName()).toBe("Support");
      expect(store.payloadOf(SECOND_ID)).toBe(SUPPORT);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
      expect(deleteLayout).not.toHaveBeenCalled();
      expect(renameLayout).not.toHaveBeenCalled();
    });

    it("a user who has never changed anything still gets a menu, and it names the layout they are looking at", async () => {
      const store = installStore([]);
      const element = await navigatorOnStore(store);

      expect(layoutMenu(element).label).toBe("My Navigator");
      expect(layoutMenuEntries(element).map((entry) => entry.value)).toEqual([
        "layout:"
      ]);

      // Delete is absent: there is no row to delete, and offering it would
      // promise something no call could deliver. That is a claim about the
      // *edit-mode* half of the menu, so it can only be asked there.
      await enterEditMode(element);
      expect(layoutMenuEntries(element).map((entry) => entry.value)).toEqual([
        "layout:",
        "new-layout",
        "rename-layout"
      ]);
      expect(store.rows).toEqual([]);
    });
  });

  // ---------------------------------------------------------------
  // Edit mode: the gate itself, and the draft boundary behind it
  // ---------------------------------------------------------------

  describe("entering and leaving edit mode", () => {
    const NAV_ITEMS = [ACCOUNT_ITEM, CONTACT_ITEM, ACTION_HUB_ITEM];
    const OTHER_ID = "a0X000000000031AAA";

    const ENTER_ANNOUNCEMENT =
      "Edit mode on. Customise your Navigator, then press Save.";
    const SAVE_ANNOUNCEMENT = "Changes saved. Edit mode off.";
    const CANCEL_ANNOUNCEMENT = "Edit mode off. Nothing was saved.";

    function payload(sectionName, columns, items) {
      return JSON.stringify({
        schemaVersion: SCHEMA_VERSION,
        sections: [{ name: sectionName, columns, items }]
      });
    }

    const DAILY_WORK = payload("Daily work", 2, [{ id: "Account" }]);
    const ADMIN = payload("Admin", 1, [{ id: "standard-ActionHub" }]);

    function storedRow(overrides) {
      return {
        layoutId: EXISTING_LAYOUT_ID,
        name: "My Navigator",
        isActive: true,
        isReadable: true,
        layoutJson: DAILY_WORK,
        ...overrides
      };
    }

    function adminRow(overrides) {
      return {
        layoutId: OTHER_ID,
        name: "Admin",
        isActive: false,
        isReadable: true,
        layoutJson: ADMIN,
        ...overrides
      };
    }

    async function navigatorWithTabs(navItems = NAV_ITEMS) {
      const element = createNavigator();
      getNavItems.emit({ navItems });
      await flush();
      await flush();
      return element;
    }

    /** A Navigator that has a stored layout, so there is something to edit. */
    async function storedNavigator() {
      getLayouts.mockResolvedValue([storedRow()]);
      return navigatorWithTabs();
    }

    function layoutMenu(element) {
      return element.shadowRoot.querySelector("lightning-button-menu");
    }

    function selectLayoutMenu(element, value) {
      layoutMenu(element).dispatchEvent(
        new CustomEvent("select", { detail: { value } })
      );
    }

    function menuEntryValues(element) {
      return Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      ).map((entry) => entry.value);
    }

    function announcement(element) {
      return spoken(
        element.shadowRoot.querySelector(".rstk-nav-announcer").textContent
      );
    }

    /** The column count actually painted, read off the grid's class. */
    function renderedColumns(element, sectionIndex) {
      const grid =
        querySections(element)[sectionIndex].shadowRoot.querySelector("ul");
      return Number(/cols-(\d)/.exec(grid.className)[1]);
    }

    async function commitLayoutName(element, name) {
      const input = element.shadowRoot.querySelector(
        ".rstk-nav-layout-prompt__input"
      );
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: name } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();
      await flush();
    }

    // ---------------------------------------------------------------
    // What the action row holds, in each state
    // ---------------------------------------------------------------

    it("holds exactly the layout switcher and the edit affordance out of edit mode", async () => {
      const element = await storedNavigator();

      expect(
        actionRow(element).map((control) => control.tagName.toLowerCase())
      ).toEqual(["lightning-button-menu", "lightning-button-icon"]);
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      // The affordance has to say what it is to a screen reader: an icon
      // button with no alternative text is announced as nothing at all.
      expect(
        element.shadowRoot.querySelector(EDIT_AFFORDANCE).alternativeText
      ).toBeTruthy();
    });

    it("lists the user's saved layouts and switches between them out of edit mode, because choosing a layout is navigation", async () => {
      getLayouts.mockResolvedValue([storedRow(), adminRow()]);
      activateLayout.mockResolvedValue([
        storedRow({ isActive: false }),
        adminRow({ isActive: true })
      ]);
      const element = await navigatorWithTabs();

      expect(menuEntryValues(element)).toEqual([
        `layout:${EXISTING_LAYOUT_ID}`,
        `layout:${OTHER_ID}`
      ]);

      selectLayoutMenu(element, `layout:${OTHER_ID}`);
      await flush();
      await flush();

      expect(activateLayout).toHaveBeenCalledWith({ layoutId: OTHER_ID });
      expect(sectionNames(element)).toEqual(["Admin"]);
      // And the switch was navigation, not a way into customisation: the mode
      // is exactly where it was.
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      expect(element.shadowRoot.querySelector(NEW_SECTION_BUTTON)).toBeNull();
    });

    it("keeps New, Rename and Delete layout out of the switcher until edit mode is entered", async () => {
      const element = await storedNavigator();

      expect(menuEntryValues(element)).toEqual([
        `layout:${EXISTING_LAYOUT_ID}`
      ]);

      await enterEditMode(element);

      expect(menuEntryValues(element)).toEqual([
        `layout:${EXISTING_LAYOUT_ID}`,
        "new-layout",
        "rename-layout",
        "delete-layout"
      ]);
    });

    it("keeps New section off the page until edit mode is entered", async () => {
      const element = await storedNavigator();

      expect(element.shadowRoot.querySelector(NEW_SECTION_BUTTON)).toBeNull();

      await enterEditMode(element);

      expect(
        element.shadowRoot.querySelector(NEW_SECTION_BUTTON)
      ).not.toBeNull();
    });

    it("replaces the edit affordance with Cancel and Save, and puts it back on the way out", async () => {
      const element = await storedNavigator();

      await enterEditMode(element);

      // Replaced, not joined: there is exactly one way out of the mode from
      // the action row.
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).toBeNull();
      expect(
        actionRow(element)
          .slice(1)
          .map((control) => control.label)
      ).toEqual(["New section", "Cancel", "Save"]);
      // Save is the primary action, and the SLDS action row puts that last.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).variant).toBe(
        "brand"
      );

      await cancelEdits(element);

      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON)).toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_CANCEL_BUTTON)).toBeNull();
    });

    it("offers no way into edit mode when the stored layout could not be read", async () => {
      // A mode that could not save is worse than no mode: the user would make
      // changes, press Save, and be told the write was refused.
      getLayouts.mockRejectedValue({ body: { message: "Read timed out" } });
      const element = await navigatorWithTabs();

      expect(element.shadowRoot.querySelector('[role="alert"]')).not.toBeNull();
      // The seeded Navigator is still there and still navigates.
      expect(queryItems(element)).toHaveLength(NAV_ITEMS.length);
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).toBeNull();
      expect(actionRow(element)).toHaveLength(0);
    });

    // ---------------------------------------------------------------
    // The draft boundary
    // ---------------------------------------------------------------

    it("writes nothing when the autosave interval elapses mid-edit", async () => {
      const element = await storedNavigator();
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();
      expect(renderedColumns(element, 0)).toBe(6);

      await settleAutosave();

      expect(updateLayout).not.toHaveBeenCalled();
      expect(createLayout).not.toHaveBeenCalled();
      // Held, not lost: the change is still the one on screen.
      expect(renderedColumns(element, 0)).toBe(6);
    });

    it("writes the layout on Save, leaves edit mode, and the change is still there after a reload", async () => {
      const element = await storedNavigator();
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();
      await saveEdits(element);

      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(lastSavedLayout(updateLayout).sections[0].columns).toBe(6);
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      expect(element.shadowRoot.querySelector(NEW_SECTION_BUTTON)).toBeNull();

      // Remounted on the payload the write actually captured, rather than on
      // the in-memory model — which would prove nothing about what was stored.
      const written = updateLayout.mock.calls[0][0].layoutJson;
      document.body.removeChild(element);
      jest.runOnlyPendingTimers();
      await flush();
      getLayouts.mockResolvedValue([storedRow({ layoutJson: written })]);
      const reloaded = await navigatorWithTabs();

      expect(renderedColumns(reloaded, 0)).toBe(6);
    });

    it("commits a change made before edit mode was entered, so the snapshot is what is stored", async () => {
      // The draft boundary has to be exact at both ends. A change made a
      // moment before the pencil was pressed belongs to the autosave that was
      // already going to write it — leaving it in its debounce would put a
      // promised write behind a Save the user has not pressed, and hand Cancel
      // a change it has no business reverting.
      const element = await storedNavigator();

      // An item rename is gated behind edit mode as of this slice, same as a
      // section-level change. `renameFirstItem` dispatches the `itemrename`
      // event directly on the item element rather than opening its (now
      // gated) menu, so the call below still stands in for "a canvas change
      // made before edit mode was entered" even though no user path reaches
      // the menu itself out here — the draft-boundary behaviour under test
      // does not care which act made it. The second call, once edit mode has
      // been entered, dispatches the identical event but is then a faithful
      // stand-in for what that menu would send for real.
      await renameFirstItem(element, 0, "Renamed before edit");
      expect(updateLayout).not.toHaveBeenCalled();

      await enterEditMode(element);
      await flush();

      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(lastSavedLayout(updateLayout).sections[0].items[0].rename).toBe(
        "Renamed before edit"
      );

      // And Cancel goes back to that, not past it.
      await renameFirstItem(element, 0, "Renamed during edit");
      await cancelEdits(element);

      const item =
        querySections(element)[0].shadowRoot.querySelector("c-navigator-item");
      expect(item.label).toBe("Renamed before edit");
      expect(updateLayout).toHaveBeenCalledTimes(1);
    });

    it("puts the canvas back exactly as it was on entry when Cancel is pressed, and writes nothing", async () => {
      const element = await storedNavigator();
      expect(sectionNames(element)).toEqual(["Daily work"]);
      expect(renderedColumns(element, 0)).toBe(2);

      await enterEditMode(element);
      await addSection(element);
      selectSectionMenuItem(element, 0, "columns-6");
      await flush();
      expect(sectionNames(element)).toEqual(["Daily work", "New section"]);
      expect(renderedColumns(element, 0)).toBe(6);

      await cancelEdits(element);
      await settleAutosave();

      expect(sectionNames(element)).toEqual(["Daily work"]);
      expect(renderedColumns(element, 0)).toBe(2);
      expect(updateLayout).not.toHaveBeenCalled();
      expect(createLayout).not.toHaveBeenCalled();
    });

    it("writes no layout record for a user who opened edit mode, changed nothing and pressed Save", async () => {
      // The oldest settled rule on this component: a user who has only ever
      // looked owns no row. Opening the mode and closing it again is looking.
      const element = await navigatorWithTabs();

      await enterEditMode(element);
      await saveEdits(element);

      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
    });

    it("leaves a user who has never changed anything exactly there when they cancel", async () => {
      const element = await navigatorWithTabs([ACCOUNT_ITEM, CONTACT_ITEM]);

      await enterEditMode(element);
      await addSection(element);
      await cancelEdits(element);

      expect(sectionNames(element)).toEqual(["All Items"]);

      // Still computed from the platform's tab list rather than frozen into a
      // stored layout: a tab the user gains after the cancel still appears.
      // Restoring the snapshot unconditionally would turn "has never changed
      // anything" into "has a stored layout" — by way of a Cancel whose whole
      // promise is that it changes nothing.
      getNavItems.emit({
        navItems: [ACCOUNT_ITEM, CONTACT_ITEM, ACTION_HUB_ITEM],
        nextPageUrl: null
      });
      await flush();

      expect(itemLabelsBySection(element)).toEqual([
        ["Accounts", "Contacts", "Action Plans"]
      ]);
    });

    it("loses an unsaved canvas change when the user leaves the page mid-edit, rather than flushing it", async () => {
      // The pre-spec `disconnectedCallback` flushed unconditionally, because
      // there was no such thing as an unsaved change. Explicit save means
      // nothing is written until the user says so, and that has to hold when
      // the user leaves by closing the tab.
      const element = await storedNavigator();
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      document.body.removeChild(element);
      jest.runOnlyPendingTimers();
      await flush();
      await flush();

      expect(updateLayout).not.toHaveBeenCalled();
      expect(createLayout).not.toHaveBeenCalled();
    });

    // ---------------------------------------------------------------
    // Confirming before discarding unsaved work. Cancel, switching layouts,
    // New layout and Delete layout all reach the same shared prompt — see
    // `## Design`'s "Leaving edit mode with unsaved work" — asked exactly
    // when a write would differ from the entry snapshot, string for string.
    // ---------------------------------------------------------------

    it("closes edit mode without asking when Cancel is pressed on an untouched session", async () => {
      const element = await storedNavigator();
      await enterEditMode(element);

      element.shadowRoot.querySelector(EDIT_CANCEL_BUTTON).click();
      await flush();

      expect(discardConfirmButton(element)).toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_CANCEL_BUTTON)).toBeNull();
    });

    it("asks before discarding when Cancel is pressed with unsaved canvas changes, and declining leaves the user editing with them intact", async () => {
      const element = await storedNavigator();
      await enterEditMode(element);
      await addSection(element);
      expect(sectionNames(element)).toEqual(["Daily work", "New section"]);

      element.shadowRoot.querySelector(EDIT_CANCEL_BUTTON).click();
      await flush();

      // Asked, not silently discarded: still editing, the change still on
      // screen, and — reusing the same inline-prompt idiom the naming and
      // delete confirmations already use, per criterion 6 — the same
      // `.rstk-nav-layout-prompt` container and `alertdialog` role the
      // delete confirmation renders with.
      const dialog = element.shadowRoot.querySelector(
        ".rstk-nav-layout-prompt[role='alertdialog']"
      );
      expect(dialog).not.toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON)).not.toBeNull();
      expect(sectionNames(element)).toEqual(["Daily work", "New section"]);

      keepEditingButton(element).click();
      await flush();

      expect(discardConfirmButton(element)).toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON)).not.toBeNull();
      expect(sectionNames(element)).toEqual(["Daily work", "New section"]);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("confirming the discard prompt on Cancel throws the unsaved changes away and leaves edit mode", async () => {
      const element = await storedNavigator();
      await enterEditMode(element);
      await addSection(element);

      element.shadowRoot.querySelector(EDIT_CANCEL_BUTTON).click();
      await flush();
      discardConfirmButton(element).click();
      await flush();

      expect(sectionNames(element)).toEqual(["Daily work"]);
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON)).toBeNull();
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    /**
     * Criterion 5: whether there is anything to lose is exact string equality
     * on the canonical payload, not a dirty flag that could disagree with it.
     * A change made and then undone back to precisely the entry snapshot's
     * own value has nothing left for a write to differ about, so Cancel
     * closes exactly as it does on a session nothing ever touched.
     */
    it("closes without asking when a change is undone back to exactly its entry value", async () => {
      const element = await storedNavigator();
      expect(renderedColumns(element, 0)).toBe(2);
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();
      selectSectionMenuItem(element, 0, "columns-2");
      await flush();
      expect(renderedColumns(element, 0)).toBe(2);

      element.shadowRoot.querySelector(EDIT_CANCEL_BUTTON).click();
      await flush();

      expect(discardConfirmButton(element)).toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
    });

    it("asks before discarding when New layout is chosen with unsaved canvas changes, and declining leaves the draft in place", async () => {
      const element = await storedNavigator();
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      selectLayoutMenu(element, "new-layout");
      await flush();
      const input = element.shadowRoot.querySelector(
        ".rstk-nav-layout-prompt__input"
      );
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: "Weekly review" } })
      );
      input.dispatchEvent(new CustomEvent("commit"));
      await flush();

      // The naming prompt's own commit does not create on the spot: there is
      // a draft to lose, so the shared discard prompt intervenes first.
      expect(discardConfirmButton(element)).not.toBeNull();
      expect(createLayout).not.toHaveBeenCalled();
      expect(renderedColumns(element, 0)).toBe(6);

      keepEditingButton(element).click();
      await flush();

      expect(createLayout).not.toHaveBeenCalled();
      expect(renderedColumns(element, 0)).toBe(6);
      expect(layoutMenu(element).label).toBe("My Navigator");
    });

    it("confirming the discard prompt on New layout throws the draft away and creates the named layout", async () => {
      createLayout.mockResolvedValue({
        layoutId: CREATED_LAYOUT_ID,
        name: "Weekly review",
        isActive: true
      });
      const element = await storedNavigator();
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      selectLayoutMenu(element, "new-layout");
      await flush();
      await commitLayoutName(element, "Weekly review");
      discardConfirmButton(element).click();
      await flush();
      await flush();

      expect(createLayout).toHaveBeenCalledTimes(1);
      // Addressed to New layout's own seed, never to the six-column draft
      // that was thrown away — `createNewLayout` seeds from the live tab
      // list, not from the discarded canvas.
      expect(
        JSON.parse(createLayout.mock.calls[0][0].layoutJson).sections[0].columns
      ).toBe(3);
      expect(layoutMenu(element).label).toBe("Weekly review");
      expect(sectionNames(element)).toEqual(["All Items"]);
    });

    it("asks before discarding when Delete layout is confirmed with unsaved canvas changes, and declining leaves the draft in place", async () => {
      const element = await storedNavigator();
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      selectLayoutMenu(element, "delete-layout");
      await flush();
      Array.from(
        element.shadowRoot.querySelectorAll(
          ".rstk-nav-layout-prompt lightning-button"
        )
      )
        .find((button) => button.label === "Delete layout")
        .click();
      await flush();

      // Delete layout's own confirmation does not delete on the spot: there
      // is a draft to lose, so the shared discard prompt intervenes first.
      expect(discardConfirmButton(element)).not.toBeNull();
      expect(deleteLayout).not.toHaveBeenCalled();
      expect(renderedColumns(element, 0)).toBe(6);

      keepEditingButton(element).click();
      await flush();

      expect(deleteLayout).not.toHaveBeenCalled();
      expect(renderedColumns(element, 0)).toBe(6);
      expect(sectionNames(element)).toEqual(["Daily work"]);
    });

    it("confirming the discard prompt on Delete layout throws the draft away and deletes the layout", async () => {
      deleteLayout.mockResolvedValue([]);
      const element = await storedNavigator();
      await enterEditMode(element);

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();

      selectLayoutMenu(element, "delete-layout");
      await flush();
      Array.from(
        element.shadowRoot.querySelectorAll(
          ".rstk-nav-layout-prompt lightning-button"
        )
      )
        .find((button) => button.label === "Delete layout")
        .click();
      await flush();
      discardConfirmButton(element).click();
      await flush();
      await flush();

      expect(deleteLayout).toHaveBeenCalledWith({
        layoutId: EXISTING_LAYOUT_ID
      });
      expect(updateLayout).not.toHaveBeenCalled();
      // Back to the seeded arrangement, not to the discarded six-column draft.
      expect(sectionNames(element)).toEqual(["All Items"]);
    });

    // ---------------------------------------------------------------
    // Tier 2 inside an edit session: committed on the spot, and Cancel
    // does not reach it. The seam is deliberate — see the spec's Traps.
    // ---------------------------------------------------------------

    it("commits a layout rename made inside an edit session, and a later Cancel does not take it back", async () => {
      renameLayout.mockResolvedValue({
        layoutId: EXISTING_LAYOUT_ID,
        name: "Cases"
      });
      const element = await storedNavigator();
      await enterEditMode(element);

      selectLayoutMenu(element, "rename-layout");
      await flush();
      await commitLayoutName(element, "Cases");

      expect(renameLayout).toHaveBeenCalledWith({
        layoutId: EXISTING_LAYOUT_ID,
        name: "Cases"
      });

      await cancelEdits(element);

      expect(layoutMenu(element).label).toBe("Cases");
    });

    it("commits a rename made inside an edit session by a user who owns no layout row yet", async () => {
      // The one Tier 2 act with no Apex call of its own: a user with no row is
      // renamed by the write that creates the row, which is the autosave — and
      // the autosave writes nothing in edit mode. Left to the debounce this
      // rename would sit behind a Save it is not supposed to wait for, and be
      // thrown away by a Cancel that is not supposed to reach it.
      //
      // A canvas change is made *before* the rename, per the spec's trap: a
      // rename committed against the current canvas rather than the entry
      // snapshot would carry that unsaved change onto the server the moment
      // the layout was named — the exact write Cancel is supposed to be able
      // to undo. A test that renames without first changing the canvas is
      // green whether or not that bug exists, because there is nothing yet
      // for the two payloads to disagree about.
      const element = await navigatorWithTabs();
      await enterEditMode(element);
      await addSection(element);
      expect(sectionNames(element)).toEqual(["All Items", "New section"]);

      selectLayoutMenu(element, "rename-layout");
      await flush();
      await commitLayoutName(element, "Daily driver");

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(createLayout.mock.calls[0][0].name).toBe("Daily driver");
      // The payload is the entry snapshot — the canvas as it stood before
      // "New section" was pressed — never the draft the canvas is showing.
      const written = createLayout.mock.calls[0][0].layoutJson;
      expect(
        JSON.parse(written).sections.map((section) => section.name)
      ).toEqual(["All Items"]);

      await cancelEdits(element);

      // The row this write created holds the snapshot's payload, and Cancel
      // must land on it: the section added after the write, and thrown away
      // by Cancel, is gone — and the layout the row now names is not.
      expect(layoutMenu(element).label).toBe("Daily driver");
      expect(sectionNames(element)).toEqual(["All Items"]);

      // Remounted on the payload the write actually captured, so the section
      // added and then cancelled is confirmed gone on the server, not merely
      // absent from a canvas that could have been rebuilt from the seed.
      document.body.removeChild(element);
      jest.runOnlyPendingTimers();
      await flush();
      getLayouts.mockResolvedValue([
        {
          layoutId: CREATED_LAYOUT_ID,
          name: "Daily driver",
          isActive: true,
          isReadable: true,
          layoutJson: written
        }
      ]);
      const reloaded = await navigatorWithTabs();

      expect(sectionNames(reloaded)).toEqual(["All Items"]);
    });

    /**
     * Re-review finding A. `commitLayoutNow` calls `captureSaveTarget`
     * synchronously, and that reads `this.layoutId` — which stays `undefined`
     * for a user with no row until the rename's create round trip lands. A
     * Save pressed before it lands must not be captured with `layoutId:
     * undefined` too, or it becomes a second `createLayout` and the user ends
     * up with two rows, the server's active flag on whichever lands last.
     * The first Apex call is deferred so the second act can be made inside
     * the wait, per the spec's trap on this exact hazard.
     *
     * **Updated for the sixth pass's lockout (Jonah's decision, 2026-08-31).**
     * A Save pressed in this window used to *wait* on the rename's create and
     * land automatically once it resolved — `commitLayoutNow`'s coalescing
     * mechanism, finding A's own fix. `isWriteLocked` disables Save outright
     * for as long as the rename's create is outstanding, so that Save press
     * is now a no-op rather than a queued wait: nothing lands until the user
     * presses Save again, which they can once the lock clears. What the
     * mechanism used to do automatically, the lockout now makes into two
     * explicit user actions — but the outcome finding A cared about is the
     * same: never a second row, and the row that exists ends up holding the
     * full canvas.
     */
    it("Save is blocked while a no-row rename's create is still in flight, and updates that row once pressed again after it lands", async () => {
      let releaseCreate;
      createLayout.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCreate = () =>
              resolve({
                layoutId: CREATED_LAYOUT_ID,
                name: "Daily driver",
                isActive: true
              });
          })
      );
      updateLayout.mockImplementationOnce(({ layoutId, name, layoutJson }) =>
        Promise.resolve({ layoutId, name, layoutJson, isActive: true })
      );
      const element = await navigatorWithTabs();
      await enterEditMode(element);
      await addSection(element);
      expect(sectionNames(element)).toEqual(["All Items", "New section"]);

      selectLayoutMenu(element, "rename-layout");
      await flush();
      await commitLayoutName(element, "Daily driver");

      // The rename's create has been issued and is being held open.
      expect(createLayout).toHaveBeenCalledTimes(1);

      // Save, pressed while that create is still open: blocked, not queued.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        true
      );
      await saveEdits(element);
      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).not.toHaveBeenCalled();

      releaseCreate();
      await flush();
      await flush();
      await flush();
      await flush();

      // The lock has cleared: Save is available again, and pressing it now
      // is what actually commits the canvas.
      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        false
      );
      await saveEdits(element);

      // At most one row: the second write landed as an update of the row the
      // first one created, never as a create of its own.
      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).toHaveBeenCalledWith(
        expect.objectContaining({ layoutId: CREATED_LAYOUT_ID })
      );
      expect(layoutMenu(element).label).toBe("Daily driver");
      expect(
        Array.from(
          element.shadowRoot.querySelectorAll("lightning-menu-item")
        ).filter((entry) => entry.checked)
      ).toHaveLength(1);
      // Save's write is what landed: the section added after the rename
      // survives, because Save committed the full canvas onto the row the
      // rename created.
      expect(sectionNames(element)).toEqual(["All Items", "New section"]);
    });

    it("commits a layout created inside an edit session, and a later Cancel leaves the new layout on screen", async () => {
      createLayout.mockResolvedValue({
        layoutId: CREATED_LAYOUT_ID,
        name: "Weekly review",
        isActive: true
      });
      const element = await storedNavigator();
      await enterEditMode(element);

      selectLayoutMenu(element, "new-layout");
      await flush();
      await commitLayoutName(element, "Weekly review");

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(layoutMenu(element).label).toBe("Weekly review");
      expect(sectionNames(element)).toEqual(["All Items"]);

      await cancelEdits(element);

      // Cancel reverts the canvas to what it was on entry — and after a Tier 2
      // act replaced the canvas wholesale, "on entry" is the created layout's
      // canvas. Restoring the pre-create snapshot here would paint the old
      // layout's sections onto the new layout and hold them as unwritten draft.
      expect(layoutMenu(element).label).toBe("Weekly review");
      expect(sectionNames(element)).toEqual(["All Items"]);
    });

    it("commits a layout deletion made inside an edit session, and a later Cancel does not bring it back", async () => {
      deleteLayout.mockResolvedValue([]);
      const element = await storedNavigator();
      await enterEditMode(element);

      selectLayoutMenu(element, "delete-layout");
      await flush();
      Array.from(
        element.shadowRoot.querySelectorAll(
          ".rstk-nav-layout-prompt lightning-button"
        )
      )
        .find((button) => button.label === "Delete layout")
        .click();
      await flush();
      await flush();

      expect(deleteLayout).toHaveBeenCalledWith({
        layoutId: EXISTING_LAYOUT_ID
      });
      expect(sectionNames(element)).toEqual(["All Items"]);

      await cancelEdits(element);

      expect(sectionNames(element)).toEqual(["All Items"]);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    // ---------------------------------------------------------------
    // Re-review finding D: a Tier 2 prompt cannot outlive the mode that
    // opened it. The inline prompt renders on `hasItems`, not on `isEditing`,
    // so leaving edit mode used to leave it standing, with its commit and its
    // confirm button both still wired to act.
    // ---------------------------------------------------------------

    it("closes an open delete-layout prompt when Cancel ends edit mode, so the confirm button cannot act", async () => {
      // Reproduced: enter edit mode, open "Delete layout…", press Cancel —
      // the affordance comes back, and the confirmation used to still be on
      // screen with a working button.
      const element = await storedNavigator();
      await enterEditMode(element);

      selectLayoutMenu(element, "delete-layout");
      await flush();
      expect(
        element.shadowRoot.querySelector('[role="alertdialog"]')
      ).not.toBeNull();

      await cancelEdits(element);

      expect(
        element.shadowRoot.querySelector('[role="alertdialog"]')
      ).toBeNull();
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();
      expect(deleteLayout).not.toHaveBeenCalled();
    });

    it("closes an open rename prompt when Save ends edit mode, so a stray commit does not fire afterward", async () => {
      // New layout and Rename layout leak the same way, through
      // `handleLayoutNameCommit` — this drives the naming prompt through the
      // other exit route, Save, so both handlers and both routes out of the
      // mode are covered between the two tests.
      const element = await storedNavigator();
      await enterEditMode(element);

      selectLayoutMenu(element, "rename-layout");
      await flush();
      expect(
        element.shadowRoot.querySelector(".rstk-nav-layout-prompt__input")
      ).not.toBeNull();

      await saveEdits(element);

      expect(
        element.shadowRoot.querySelector(".rstk-nav-layout-prompt__input")
      ).toBeNull();
      expect(renameLayout).not.toHaveBeenCalled();
    });

    // ---------------------------------------------------------------
    // Accessibility: both transitions are announced, and both move focus
    // ---------------------------------------------------------------

    it("announces entering edit mode, and announces leaving it by either route", async () => {
      const element = await storedNavigator();

      await enterEditMode(element);
      expect(announcement(element)).toBe(ENTER_ANNOUNCEMENT);

      await cancelEdits(element);
      expect(announcement(element)).toBe(CANCEL_ANNOUNCEMENT);

      // A real change, so this Save is a write — the no-op case is its own
      // test below, and must not share this one's announcement.
      await enterEditMode(element);
      await addSection(element);
      await saveEdits(element);
      expect(announcement(element)).toBe(SAVE_ANNOUNCEMENT);
    });

    it("announces that nothing was saved when Save is pressed with no changes, not a save that did not happen", async () => {
      // The guard that correctly stops the write does not, on its own, reach
      // the sentence: the live region is the one channel a screen-reader user
      // has, and `CANCEL_ANNOUNCEMENT` is already worded as a fact about the
      // write rather than about the changes. Save has to hold itself to that
      // same standard, or this is the one path on which it lies about having
      // saved.
      const element = await storedNavigator();

      await enterEditMode(element);
      await saveEdits(element);

      expect(announcement(element)).toBe(CANCEL_ANNOUNCEMENT);
      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).not.toHaveBeenCalled();
    });

    it("moves focus to the first revealed control on entry, and back to the edit affordance on the way out", async () => {
      // Entering destroys the element that had focus — the affordance is
      // replaced, not joined — so focus falls to document.body unless it is
      // moved explicitly. Invisible to a mouse user, immediate to anyone else.
      const element = await storedNavigator();
      const moved = recordFocusMoves();

      await enterEditMode(element);

      expect(moved[moved.length - 1]).toBe(
        element.shadowRoot.querySelector(NEW_SECTION_BUTTON)
      );
      // Not Save. A stray Enter on the control that has just taken focus must
      // not commit the session.
      expect(moved).not.toContain(
        element.shadowRoot.querySelector(EDIT_SAVE_BUTTON)
      );

      await cancelEdits(element);

      expect(moved[moved.length - 1]).toBe(
        element.shadowRoot.querySelector(EDIT_AFFORDANCE)
      );

      // Save is the other route out, and it is order-dependent in a way
      // Cancel above never exercises: `beginWrite` assigns `EDIT_FOCUS_LOCK`
      // and `leaveEditMode` assigns `EDIT_FOCUS_LEAVE` in the same handler,
      // so whichever statement runs second decides where focus lands.
      // Neither exit above goes through Save, and Cancel never calls
      // `beginWrite` at all, so nothing until now pinned this ordering.
      await enterEditMode(element);
      await addSection(element);
      await saveEdits(element);

      expect(moved[moved.length - 1]).toBe(
        element.shadowRoot.querySelector(EDIT_AFFORDANCE)
      );
    });

    it("ends any in-flight keyboard grab when edit mode ends", async () => {
      // A correctness bug rather than a nicety. `renderedCallback` restores
      // focus to a grabbed card *by index*, so a grab left standing after the
      // mode ends re-asserts itself on the very render that is supposed to
      // hand focus back to the edit affordance — and, running second, wins.
      const element = await storedNavigator();
      await enterEditMode(element);
      const moved = recordFocusMoves();

      querySections(element)[0]
        .shadowRoot.querySelector("article")
        .dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
      await flush();

      await cancelEdits(element);

      expect(moved[moved.length - 1]).toBe(
        element.shadowRoot.querySelector(EDIT_AFFORDANCE)
      );
    });

    // ---------------------------------------------------------------
    // The lockout (sixth pass, Jonah's decision, 2026-08-31)
    // ---------------------------------------------------------------

    function menuItemDisabled(element, value) {
      const item = Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      ).find((entry) => entry.value === value);
      return item ? item.disabled === true : undefined;
    }

    it("disables Save, New layout and Rename layout while New layout's own create is outstanding, and clears them once it lands", async () => {
      const element = await navigatorWithTabs();
      await enterEditMode(element);

      let releaseCreate;
      createLayout.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCreate = () =>
              resolve({
                layoutId: CREATED_LAYOUT_ID,
                name: "Weekly review",
                isActive: true
              });
          })
      );

      selectLayoutMenu(element, "new-layout");
      await flush();
      await commitLayoutName(element, "Weekly review");

      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        true
      );
      expect(menuItemDisabled(element, "new-layout")).toBe(true);
      expect(menuItemDisabled(element, "rename-layout")).toBe(true);

      releaseCreate();
      await flush();
      await flush();

      expect(element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).disabled).toBe(
        false
      );
      expect(menuItemDisabled(element, "new-layout")).toBe(false);
      expect(menuItemDisabled(element, "rename-layout")).toBe(false);
    });

    it("moves focus to the layout switcher when New layout's own create leaves it disabled without leaving edit mode", async () => {
      // New layout does not leave edit mode, unlike Save — so it cannot rely
      // on the pencil hand-off `EDIT_FOCUS_LEAVE` gives Save. The prompt it
      // was pressed from closes (`closePrompt()`) without restoring focus on
      // its own, so the switcher — the control that opened the prompt in the
      // first place — is where the deliberate hand-off has to land, or focus
      // falls to `document.body`, Trap 3's hazard one control over.
      const element = await navigatorWithTabs();
      await enterEditMode(element);

      let releaseCreate;
      createLayout.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCreate = () =>
              resolve({
                layoutId: CREATED_LAYOUT_ID,
                name: "Weekly review",
                isActive: true
              });
          })
      );

      const moved = recordFocusMoves();
      selectLayoutMenu(element, "new-layout");
      await flush();
      await commitLayoutName(element, "Weekly review");

      expect(moved[moved.length - 1]).toBe(
        element.shadowRoot.querySelector(".rstk-nav-layout-menu")
      );

      releaseCreate();
      await flush();
      await flush();
    });

    it("announces that the writing controls are unavailable while New layout's own create is outstanding, superseded once it lands", async () => {
      const element = await navigatorWithTabs();
      await enterEditMode(element);

      let releaseCreate;
      createLayout.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCreate = () =>
              resolve({
                layoutId: CREATED_LAYOUT_ID,
                name: "Weekly review",
                isActive: true
              });
          })
      );

      selectLayoutMenu(element, "new-layout");
      await flush();
      await commitLayoutName(element, "Weekly review");

      expect(announcement(element)).toBe(
        "Saving. Save, New layout, Rename layout and Delete layout are unavailable until this finishes."
      );

      releaseCreate();
      await flush();
      await flush();

      // Superseded once the create lands — a screen reader user is told
      // what actually happened, not left holding the busy message.
      expect(announcement(element)).toBe(
        "Weekly review created and now showing."
      );
    });

    /**
     * Seventh pass, critique finding: `beginWrite()` in `handleEditSave` is a
     * surviving mutant, and the regression it hides is walkable, not
     * theoretical. Save is the only one of the four writing controls that
     * leaves edit mode while its own write is still outstanding, and nothing
     * disables the pencil in that window, so a user can re-enter edit mode
     * and reach New layout inside the very round trip Save opened. Without
     * `beginWrite()`, `writeInFlight` never leaves zero for Save's own write,
     * `isWriteLocked` stays false through the re-entry, and New layout is
     * free to open and commit — a second `createLayout` for a user who owned
     * none.
     */
    it("does not let New layout open while Save's own no-row create is still outstanding, even after re-entering edit mode", async () => {
      let releaseCreate;
      createLayout.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            releaseCreate = () =>
              resolve({
                layoutId: CREATED_LAYOUT_ID,
                name: "My Navigator",
                isActive: true
              });
          })
      );
      const element = await navigatorWithTabs();
      await enterEditMode(element);
      await addSection(element);

      await saveEdits(element);

      // Save's own create is issued and held open, and Save has already left
      // edit mode — nothing disables the pencil while that write is still in
      // flight.
      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(element.shadowRoot.querySelector(EDIT_AFFORDANCE)).not.toBeNull();

      await enterEditMode(element);

      // New layout, attempted inside the window Save's own create opened:
      // must be blocked exactly as it is when a Rename layout create is the
      // one outstanding.
      expect(menuItemDisabled(element, "new-layout")).toBe(true);
      selectLayoutMenu(element, "new-layout");
      await flush();
      expect(
        element.shadowRoot.querySelector(".rstk-nav-layout-prompt__input")
      ).toBeNull();
      expect(createLayout).toHaveBeenCalledTimes(1);

      releaseCreate();
      await flush();
      await flush();
      await flush();
      await flush();
    });
  });
});
