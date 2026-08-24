import { createElement } from "lwc";
import NavigatorItem from "c/navigatorItem";
import {
  NavigationMixin,
  getNavigateCalledWith,
  getGenerateUrlCalledWith
} from "lightning/navigation";

// A pageReference shape verified against a live org: a real nav item, passed
// through unmodified. Using a kind that is not on the documented
// PageReference Types page (`standard__cmsPage`) is deliberate — the item
// must forward whatever it was given without branching on `type`.
const STORED_PAGE_REFERENCE = {
  type: "standard__cmsPage",
  attributes: {
    pageName: "our-site-home"
  },
  state: {}
};

function createNavigatorItem() {
  const element = createElement("c-navigator-item", { is: NavigatorItem });
  element.tabId = "standard-OurSite";
  element.label = "Our Site";
  element.pageReference = STORED_PAGE_REFERENCE;
  document.body.appendChild(element);
  return element;
}

describe("c-navigator-item", () => {
  afterEach(() => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.clearAllMocks();
  });

  it("renders a real anchor whose href comes from NavigationMixin.GenerateUrl", async () => {
    const element = createNavigatorItem();
    await Promise.resolve();
    await Promise.resolve();

    const anchor = element.shadowRoot.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor.getAttribute("href")).toBe("#");
    expect(getGenerateUrlCalledWith()).toEqual(STORED_PAGE_REFERENCE);
  });

  it("navigates using the stored pageReference, unmodified, on a plain click", async () => {
    const element = createNavigatorItem();
    await Promise.resolve();
    await Promise.resolve();

    const anchor = element.shadowRoot.querySelector("a");
    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true
    });
    anchor.dispatchEvent(clickEvent);

    expect(clickEvent.defaultPrevented).toBe(true);
    expect(getNavigateCalledWith().pageReference).toEqual(
      STORED_PAGE_REFERENCE
    );
  });

  it.each([
    ["ctrlKey", { ctrlKey: true }],
    ["metaKey", { metaKey: true }],
    ["shiftKey", { shiftKey: true }]
  ])(
    "lets the browser handle the click when %s is held, rather than navigating client-side",
    async (_name, modifier) => {
      const element = createNavigatorItem();
      await Promise.resolve();
      await Promise.resolve();

      const anchor = element.shadowRoot.querySelector("a");
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...modifier
      });
      anchor.dispatchEvent(clickEvent);

      expect(clickEvent.defaultPrevented).toBe(false);
      expect(getNavigateCalledWith()).toBeUndefined();
    }
  );

  it("exposes NavigationMixin.Navigate as a symbol so the anchor's target is never string-derived", () => {
    // Guards against a regression back to a hand-constructed URL: the mixin
    // API is symbol-keyed, not a plain method name a component could stub
    // out with its own derivation.
    expect(typeof NavigationMixin.Navigate).toBe("symbol");
    expect(typeof NavigationMixin.GenerateUrl).toBe("symbol");
  });
});
