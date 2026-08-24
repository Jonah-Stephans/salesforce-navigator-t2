import { createElement } from "lwc";
import SalesforceNavigator from "c/salesforceNavigator";
import { getNavItems } from "lightning/uiAppsApi";
import { getNavigateCalledWith } from "lightning/navigation";
import { MAX_PAGE_SIZE, NAV_ITEMS_CONFIG } from "c/navigatorTabSource";
import { SCHEMA_VERSION, reorder } from "c/navigatorLayoutModel";
import getLayouts from "@salesforce/apex/NavigatorLayoutController.getLayouts";
import createLayout from "@salesforce/apex/NavigatorLayoutController.createLayout";
import updateLayout from "@salesforce/apex/NavigatorLayoutController.updateLayout";

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

/** The section headers on screen, in order — the whole Navigator at a glance. */
function sectionNames(element) {
  return querySections(element).map(
    (section) => section.shadowRoot.querySelector("h2").textContent
  );
}

/** The layout the component last sent to Apex, parsed back out of the call. */
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

/** One change in a burst: made, rendered, and 100ms of the debounce spent. */
async function burstChange(element, columns) {
  selectSectionMenuItem(element, 0, `columns-${columns}`);
  await flush();
  jest.advanceTimersByTime(100);
}

async function settleAutosave() {
  jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
  await flush();
  await flush();
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

      element.shadowRoot.querySelector("lightning-button").click();
      await flush();
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

      expect(element.shadowRoot.querySelector("lightning-button")).toBeNull();
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
      expect(
        element.shadowRoot.querySelector("lightning-button")
      ).not.toBeNull();

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
      // we failed to read.
      expect(element.shadowRoot.querySelector("lightning-button")).toBeNull();
      selectSectionMenuItem(element, 0, "columns-4");
      await flush();
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

      expect(element.shadowRoot.querySelector("lightning-button")).toBeNull();

      getNavItems.emit({ navItems: secondPage, nextPageUrl: null });
      await flush();

      element.shadowRoot.querySelector("lightning-button").click();
      await flush();
      await settleAutosave();

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
      selectSectionMenuItem(element, 0, "columns-4");
      await flush();
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

      element.shadowRoot.querySelector("lightning-button").click();
      await flush();

      const names = querySections(element).map(
        (section) => section.shadowRoot.querySelector("h2").textContent
      );
      expect(names).toEqual(["All Items", "New section"]);
    });

    it("renames the section the user renamed, and saves the new name", async () => {
      const element = await navigatorWithTabs();

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

      await settleAutosave();
      expect(lastSavedLayout(createLayout).sections[0].name).toBe("Daily work");
    });

    it("deletes the section the user deleted, and saves the layout without it", async () => {
      const element = await navigatorWithTabs();
      element.shadowRoot.querySelector("lightning-button").click();
      await flush();
      expect(querySections(element)).toHaveLength(2);

      selectSectionMenuItem(element, 0, "delete");
      await flush();

      const names = querySections(element).map(
        (section) => section.shadowRoot.querySelector("h2").textContent
      );
      expect(names).toEqual(["New section"]);

      await settleAutosave();
      expect(
        lastSavedLayout(createLayout).sections.map((section) => section.name)
      ).toEqual(["New section"]);
    });

    it.each([1, 2, 3, 4, 5, 6])(
      "renders the section in %i columns once the user chooses that count, and stores it",
      async (columns) => {
        const element = await navigatorWithTabs();

        selectSectionMenuItem(element, 0, `columns-${columns}`);
        await flush();

        const grid = querySections(element)[0].shadowRoot.querySelector("ul");
        expect(grid.className).toContain(`cols-${columns}`);

        await settleAutosave();
        expect(lastSavedLayout(createLayout).sections[0].columns).toBe(columns);
      }
    );
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

      selectSectionMenuItem(element, 0, "columns-4");
      await flush();
      jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 1);
      await flush();

      expect(createLayout).not.toHaveBeenCalled();
    });

    it("coalesces a burst of rapid changes into one save carrying the last of them", async () => {
      const element = await navigatorWithTabs();

      // Five changes 100ms apart — well inside one debounce window, and
      // written out rather than looped because each has to be awaited and
      // `no-await-in-loop` is on.
      await burstChange(element, 2);
      await burstChange(element, 3);
      await burstChange(element, 4);
      await burstChange(element, 5);
      await burstChange(element, 6);
      await settleAutosave();

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).not.toHaveBeenCalled();
      // One save, and it is the *last* change — a debounce that fired on the
      // leading edge would save 2 columns and lose the other four changes.
      expect(lastSavedLayout(createLayout).sections[0].columns).toBe(6);
    });

    it("updates the record the first change created rather than creating a second one", async () => {
      // The trap this guards is the one the controller's two-method split
      // exists for: a client that keeps sending "save" without the id it was
      // given ends up with a new record per change, or worse, silently
      // overwriting whichever layout the server picked.
      const element = await navigatorWithTabs();

      selectSectionMenuItem(element, 0, "columns-2");
      await flush();
      await settleAutosave();
      expect(createLayout).toHaveBeenCalledTimes(1);

      selectSectionMenuItem(element, 0, "columns-3");
      await flush();
      await settleAutosave();

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout.mock.calls[0][0].layoutId).toBe(CREATED_LAYOUT_ID);
      expect(lastSavedLayout(updateLayout).sections[0].columns).toBe(3);
    });

    it("updates the layout it loaded, by that layout's own id, and never creates", async () => {
      getLayouts.mockResolvedValue([
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
      const element = await navigatorWithTabs();

      selectSectionMenuItem(element, 0, "columns-6");
      await flush();
      await settleAutosave();

      expect(createLayout).not.toHaveBeenCalled();
      expect(updateLayout).toHaveBeenCalledTimes(1);
      expect(updateLayout.mock.calls[0][0].layoutId).toBe(EXISTING_LAYOUT_ID);
    });

    it("never asks the controller to update a null id", async () => {
      const element = await navigatorWithTabs();

      selectSectionMenuItem(element, 0, "columns-2");
      await flush();
      await settleAutosave();
      selectSectionMenuItem(element, 0, "columns-3");
      await flush();
      await settleAutosave();

      for (const call of updateLayout.mock.calls) {
        expect(call[0].layoutId).toBeTruthy();
      }
    });

    it("saves the seeded arrangement along with the first change, so seeding is not lost", async () => {
      const element = await navigatorWithTabs();

      element.shadowRoot.querySelector("lightning-button").click();
      await flush();
      await settleAutosave();

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

      selectSectionMenuItem(element, 0, "columns-4");
      await flush();
      document.body.removeChild(element);
      await flush();

      expect(createLayout).toHaveBeenCalledTimes(1);
      expect(lastSavedLayout(createLayout).sections[0].columns).toBe(4);
    });

    it("keeps the user's change on screen, and its id, when the save is refused", async () => {
      createLayout.mockRejectedValue({
        body: {
          message: "That layout no longer exists, or does not belong to you."
        }
      });
      const element = await navigatorWithTabs();

      selectSectionMenuItem(element, 0, "columns-4");
      await flush();
      await settleAutosave();

      const grid = querySections(element)[0].shadowRoot.querySelector("ul");
      expect(grid.className).toContain("cols-4");
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

    async function navigatorWithThree() {
      const element = createNavigator();
      getNavItems.emit({ navItems: THREE });
      await flush();
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

    it("moves a dragged item to its new position and writes that order", async () => {
      const element = await navigatorWithThree();

      await dragItem(element, 0, 2);

      expect(queryItems(element).map((item) => item.label)).toEqual([
        "Action Plans",
        "Contacts",
        "Accounts"
      ]);

      await settleAutosave();
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
        await settleAutosave();
        const byMouse = savedItemIds(createLayout);
        document.body.removeChild(dragged);

        const typed = await freshNavigator();
        await walkItem(typed, from, to - from);
        await settleAutosave();
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
      await settleAutosave();
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
      await settleAutosave();
      expect(savedItemIds(createLayout)).toEqual(STORED_IDS);
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
      await settleAutosave();
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

      async function navigatorWithSections() {
        getLayouts.mockResolvedValue([TWO_SECTIONS]);
        const element = createNavigator();
        getNavItems.emit({ navItems: THREE });
        await flush();
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
        await settleAutosave();
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
        await settleAutosave();
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

      it("reorders the sections from the keyboard, and cancels on Escape", async () => {
        const element = await navigatorWithSections();

        cardAt(element, 0).dispatchEvent(
          new KeyboardEvent("keydown", { key: " ", cancelable: true })
        );
        await flush();

        const announcer = element.shadowRoot.querySelector("[aria-live]");
        expect(announcer.getAttribute("aria-live")).toBe("assertive");
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
        await settleAutosave();
        expect(savedSectionNames()).toEqual(["First", "Second", "Third"]);
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
        await settleAutosave();
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

      it("leaves an item dragged into another section alone — that is a later slice", async () => {
        // Arrow keys deliberately do not cross containers, and neither does
        // this: cross-section movement is its own pattern, with its own
        // menu, and is not built here. What matters is that attempting it
        // changes nothing rather than corrupting either section.
        const element = await navigatorWithSections();
        const first = queryItems(element)[0].shadowRoot.querySelector("a");
        const second = queryItems(element)[1].shadowRoot.querySelector("a");

        first.dispatchEvent(dragEvent("dragstart"));
        second.dispatchEvent(dragEvent("drop"));
        await flush();

        expect(sectionNames(element)).toEqual(["First", "Second", "Third"]);
        expect(queryItems(element).map((item) => item.label)).toEqual([
          "Accounts",
          "Contacts"
        ]);
        expect(updateLayout).not.toHaveBeenCalled();
      });
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

      selectSectionMenuItem(element, 0, "columns-5");
      await flush();
      await settleAutosave();

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
});
