import { createElement } from "lwc";
import SalesforceNavigator from "c/salesforceNavigator";
import { getNavItems } from "lightning/uiAppsApi";
import { getNavigateCalledWith } from "lightning/navigation";
import { MAX_PAGE_SIZE, NAV_ITEMS_CONFIG } from "c/navigatorTabSource";

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

describe("c-salesforce-navigator", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("renders every tab the wire adapter returns, under its platform label", async () => {
    const element = createNavigator();
    getNavItems.emit({
      navItems: [ACCOUNT_ITEM, ACTION_HUB_ITEM]
    });
    await flush();

    const items = element.shadowRoot.querySelectorAll("c-navigator-item");
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

    const item = element.shadowRoot.querySelector("c-navigator-item");
    expect(item.pageReference).toEqual(ACCOUNT_ITEM.pageReference);
  });

  it("navigates to the platform-supplied pageReference, unmodified, when an item is clicked", async () => {
    const element = createNavigator();
    getNavItems.emit({
      navItems: [ACCOUNT_ITEM]
    });
    await flush();

    const item = element.shadowRoot.querySelector("c-navigator-item");
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

    const items = element.shadowRoot.querySelectorAll("c-navigator-item");
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

    let items = element.shadowRoot.querySelectorAll("c-navigator-item");
    expect(items).toHaveLength(totalCount);

    getNavItems.emit({ navItems: secondPage, nextPageUrl: null });
    await flush();

    items = element.shadowRoot.querySelectorAll("c-navigator-item");
    expect(items).toHaveLength(totalCount);
  });

  it("shows a user-facing message rather than a blank panel when the wire adapter errors", async () => {
    const element = createNavigator();
    getNavItems.error({ message: "insufficient access" }, 403, "Forbidden");
    await flush();

    const alert = element.shadowRoot.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(
      element.shadowRoot.querySelectorAll("c-navigator-item")
    ).toHaveLength(0);
  });
});
