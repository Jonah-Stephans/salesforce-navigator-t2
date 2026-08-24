import { createElement } from "lwc";
import NavigatorItem from "c/navigatorItem";
import {
  getNavigateCalledWith,
  getGenerateUrlCalledWith,
  GenerateUrl
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
    // Asserts the resolved value itself, not "#" — the jest mock now
    // resolves to a distinct URL so this assertion can tell "the
    // component applied the URL GenerateUrl resolved" apart from "the
    // component never applied anything and the '#' default is still
    // sitting there".
    expect(anchor.getAttribute("href")).toBe("/lightning/o/Account/home");
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

  it("still has a real href while NavigationMixin.GenerateUrl is pending", async () => {
    // A bare <a> with no href is not a link — no tab order, no link role,
    // no native middle-click/"open in new tab" — which is the whole
    // mechanism the "real link" criterion relies on. A promise that never
    // resolves models the moment between render and GenerateUrl settling.
    // `jest.spyOn(NavigatorItem.prototype, NavigationMixin.GenerateUrl)`
    // cannot be used here: the LWC compiler's class output defines that
    // computed-key method as non-writable, so `jest.spyOn`'s plain
    // assignment throws `Cannot assign to read only property`. Overriding
    // the shared `GenerateUrl` mock function directly reaches the same
    // call without touching the prototype.
    GenerateUrl.mockReturnValueOnce(new Promise(() => {}));

    const element = createNavigatorItem();
    await Promise.resolve();
    await Promise.resolve();

    const anchor = element.shadowRoot.querySelector("a");
    expect(anchor.hasAttribute("href")).toBe(true);
  });

  it("removes href when NavigationMixin.GenerateUrl rejects, rather than leaving new-tab gestures pointed at a stale destination", async () => {
    // A rejected GenerateUrl must not leave `url` at the pending-state "#"
    // default forever: a cmd/ctrl/shift-click or a middle-click on that
    // anchor would hand the browser `href="#"`, which silently opens a
    // duplicate of the *current* page — a wrong destination, not a
    // visible failure. Removing the href instead makes those gestures
    // inert rather than misleading; the plain-click path is unaffected
    // because `handleClick` navigates via `NavigationMixin.Navigate`
    // from `this.pageReference`, independent of `url`.
    GenerateUrl.mockRejectedValueOnce(new Error("GenerateUrl failed"));

    const element = createNavigatorItem();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const anchor = element.shadowRoot.querySelector("a");
    expect(anchor.hasAttribute("href")).toBe(false);
    expect(anchor.getAttribute("href")).toBeNull();
  });
});
