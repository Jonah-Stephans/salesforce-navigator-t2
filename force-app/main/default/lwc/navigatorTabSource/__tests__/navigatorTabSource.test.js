import {
  hasMorePages,
  MAX_PAGE_SIZE,
  NAV_ITEMS_CONFIG,
  normalizeNavItems
} from "c/navigatorTabSource";

describe("navigatorTabSource", () => {
  it("caps the page size at the platform's own limit", () => {
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(NAV_ITEMS_CONFIG.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("reports another page is needed when the platform supplies a nextPageUrl", () => {
    // Verified against a live org: the ui-api/nav-items response carries no
    // total `count` field at all. `nextPageUrl` present vs. absent is the
    // only signal the platform actually gives for "more pages remain" — a
    // bare scratch org returns 175 items across exactly two such pages.
    expect(
      hasMorePages({
        nextPageUrl:
          "/services/data/v67.0/ui-api/nav-items?formFactor=Large&page=1&pageSize=100"
      })
    ).toBe(true);
  });

  it("reports no further page once the platform omits nextPageUrl", () => {
    expect(hasMorePages({ nextPageUrl: null })).toBe(false);
  });

  it("reports no further page when the response has no pagination info at all", () => {
    expect(hasMorePages({})).toBe(false);
    expect(hasMorePages(undefined)).toBe(false);
  });

  describe("normalizeNavItems", () => {
    it("maps the platform's envelope and per-item field names to a stable { id, label, pageReference } shape", () => {
      const pageReference = {
        type: "standard__objectPage",
        attributes: { objectApiName: "Account", actionName: "home" },
        state: {}
      };

      expect(
        normalizeNavItems({
          navItems: [
            { developerName: "Account", label: "Accounts", pageReference }
          ]
        })
      ).toEqual([{ id: "Account", label: "Accounts", pageReference }]);
    });

    it("returns an empty array when the response has no navItems", () => {
      expect(normalizeNavItems({})).toEqual([]);
      expect(normalizeNavItems(undefined)).toEqual([]);
    });
  });
});
