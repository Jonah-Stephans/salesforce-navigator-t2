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

function createNavigatorItem(overrides) {
  const element = createElement("c-navigator-item", { is: NavigatorItem });
  element.tabId = "standard-OurSite";
  element.label = "Our Site";
  element.pageReference = STORED_PAGE_REFERENCE;
  Object.assign(element, overrides || {});
  document.body.appendChild(element);
  return element;
}

// jsdom 20 defines no `DragEvent` and no `DataTransfer` at all, so the drag
// *gesture* cannot be simulated here and nothing below claims to. What this
// does is what the survey verified does work: a hand-rolled CustomEvent with
// a `dataTransfer` attached via defineProperty fires the declarative
// `ondragstart` binding, and `preventDefault()` and `dataTransfer` behave
// correctly on it. So the handlers are under test; the browser's own
// dragstart -> dragover -> drop sequence is not.
function dragEvent(type) {
  const event = new CustomEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true
  });
  Object.defineProperty(event, "dataTransfer", {
    value: {
      store: {},
      effectAllowed: undefined,
      dropEffect: undefined,
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

function keydown(key) {
  return new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true
  });
}

function anchorOf(element) {
  return element.shadowRoot.querySelector("a");
}

async function settled(element) {
  await Promise.resolve();
  await Promise.resolve();
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

  it("stays keyboard reachable, with an explicit link role, when NavigationMixin.GenerateUrl rejects", async () => {
    // An <a> without href is not focusable and carries no implicit link
    // role, so a keyboard or assistive-technology user cannot reach this
    // item at all once GenerateUrl has permanently rejected. Engineer's
    // decision (this session): supply tabindex and role explicitly only in
    // this no-href case, so Tab still reaches the item.
    GenerateUrl.mockRejectedValueOnce(new Error("GenerateUrl failed"));

    const element = createNavigatorItem();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const anchor = element.shadowRoot.querySelector("a");
    expect(anchor.getAttribute("tabindex")).toBe("0");
    expect(anchor.getAttribute("role")).toBe("link");
  });

  it("activates through the same handleClick logic on Enter when NavigationMixin.GenerateUrl rejects", async () => {
    // A native <a href> fires `click` on Enter for free; one without href
    // does not, so the fallback needs its own keydown handling. It must
    // still route through `handleClick` — the same stored `pageReference`
    // passed to `Navigate` verbatim, not a second navigation path.
    GenerateUrl.mockRejectedValueOnce(new Error("GenerateUrl failed"));

    const element = createNavigatorItem();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const anchor = element.shadowRoot.querySelector("a");
    const keydownEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    anchor.dispatchEvent(keydownEvent);

    expect(getNavigateCalledWith().pageReference).toEqual(
      STORED_PAGE_REFERENCE
    );
  });

  it("does not call Navigate on Enter when the anchor already has a working href", async () => {
    // handleKeydown's guard has two halves: it only acts once `url` is
    // undefined (the permanent-rejection fallback state) and the key is
    // Enter. A native <a href> already fires `click` on Enter for free, so
    // if the no-href half of that guard were dropped, pressing Enter on a
    // *working* anchor would also run handleKeydown -> handleClick ->
    // Navigate -- on top of the browser's own native Enter-click, firing
    // two navigations. This pins that the fallback stays confined to the
    // no-href case, rather than only that it fires in that case.
    const element = createNavigatorItem();
    await Promise.resolve();
    await Promise.resolve();

    const anchor = element.shadowRoot.querySelector("a");
    expect(anchor.getAttribute("href")).toBe("/lightning/o/Account/home");

    const keydownEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true
    });
    anchor.dispatchEvent(keydownEvent);

    expect(getNavigateCalledWith()).toBeUndefined();
  });

  describe("as a drag source", () => {
    it("makes the anchor itself draggable, so the clickable link is the drag source", async () => {
      const element = await settled(createNavigatorItem({ index: 2 }));

      expect(anchorOf(element).draggable).toBe(true);
    });

    it("re-emits dragstart as a CustomEvent carrying its own index", async () => {
      // The parent must never see inside this component. A native dragstart
      // is composed, so it crosses the shadow boundary — but it arrives
      // retargeted to this host, with no way to tell which item it was. So
      // the item handles it and re-emits an explicit payload.
      const element = await settled(createNavigatorItem({ index: 2 }));
      const handler = jest.fn();
      element.addEventListener("itemdragstart", handler);

      anchorOf(element).dispatchEvent(dragEvent("dragstart"));

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({ index: 2 });
    });

    it("hands the browser its handshake data without navigating or cancelling the drag", async () => {
      // preventDefault() on dragstart cancels the drag outright, and a
      // navigation here would mean a drag that leaves the page.
      const element = await settled(createNavigatorItem({ index: 0 }));

      const event = dragEvent("dragstart");
      anchorOf(element).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(event.dataTransfer.getData("text/plain")).toBe("standard-OurSite");
      expect(event.dataTransfer.effectAllowed).toBe("move");
      expect(getNavigateCalledWith()).toBeUndefined();
    });

    it("accepts a drop by cancelling dragover, which is what makes it a drop target", async () => {
      // Without preventDefault() on dragover the browser never fires drop at
      // all, so this is the whole mechanism rather than a detail.
      const element = await settled(createNavigatorItem({ index: 1 }));
      const handler = jest.fn();
      element.addEventListener("itemdragover", handler);

      const event = dragEvent("dragover");
      anchorOf(element).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(event.dataTransfer.dropEffect).toBe("move");
      expect(handler.mock.calls[0][0].detail).toEqual({ index: 1 });
    });

    it("re-emits a drop as its own index, and reads no state out of dataTransfer", async () => {
      // getData() returns "" during dragover in every browser by the HTML
      // spec's protected mode, so the authoritative drag state is kept in JS
      // and the payload here is the *destination*, which this item knows.
      const element = await settled(createNavigatorItem({ index: 3 }));
      const handler = jest.fn();
      element.addEventListener("itemdrop", handler);

      const event = dragEvent("drop");
      anchorOf(element).dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(handler.mock.calls[0][0].detail).toEqual({ index: 3 });
    });

    it("announces the end of a drag so a drag that dropped on nothing clears state", async () => {
      const element = await settled(createNavigatorItem({ index: 0 }));
      const handler = jest.fn();
      element.addEventListener("itemdragend", handler);

      anchorOf(element).dispatchEvent(dragEvent("dragend"));

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it("still navigates on a plain click after a completed drag", async () => {
      const element = await settled(createNavigatorItem({ index: 0 }));
      const anchor = anchorOf(element);

      anchor.dispatchEvent(dragEvent("dragstart"));
      anchor.dispatchEvent(dragEvent("dragend"));
      expect(getNavigateCalledWith()).toBeUndefined();

      anchor.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );

      expect(getNavigateCalledWith().pageReference).toEqual(
        STORED_PAGE_REFERENCE
      );
    });
  });

  describe("as a keyboard drag source", () => {
    it("grabs on Space, and swallows the key so the page does not scroll", async () => {
      const element = await settled(createNavigatorItem({ index: 2 }));
      const handler = jest.fn();
      element.addEventListener("itemgrab", handler);

      const event = keydown(" ");
      anchorOf(element).dispatchEvent(event);

      expect(handler.mock.calls[0][0].detail).toEqual({ index: 2 });
      expect(event.defaultPrevented).toBe(true);
    });

    it("drops on the second Space, rather than grabbing again", async () => {
      const element = await settled(
        createNavigatorItem({ index: 2, grabbed: true })
      );
      const grab = jest.fn();
      const drop = jest.fn();
      element.addEventListener("itemgrab", grab);
      element.addEventListener("itemkeydrop", drop);

      anchorOf(element).dispatchEvent(keydown(" "));

      expect(grab).not.toHaveBeenCalled();
      expect(drop.mock.calls[0][0].detail).toEqual({ index: 2 });
    });

    it.each([
      ["ArrowUp", -1],
      ["ArrowLeft", -1],
      ["ArrowDown", 1],
      ["ArrowRight", 1]
    ])("moves one place on %s while grabbed", async (key, delta) => {
      const element = await settled(
        createNavigatorItem({ index: 1, grabbed: true })
      );
      const handler = jest.fn();
      element.addEventListener("itemkeymove", handler);

      const event = keydown(key);
      anchorOf(element).dispatchEvent(event);

      expect(handler.mock.calls[0][0].detail).toEqual({ index: 1, delta });
      expect(event.defaultPrevented).toBe(true);
    });

    it.each(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"])(
      "leaves %s alone when the item is not grabbed",
      async (key) => {
        // Arrow keys are the platform's own, and an item sitting in a list
        // that is not being dragged has no business swallowing them.
        const element = await settled(createNavigatorItem({ index: 1 }));
        const handler = jest.fn();
        element.addEventListener("itemkeymove", handler);

        const event = keydown(key);
        anchorOf(element).dispatchEvent(event);

        expect(handler).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
      }
    );

    it("cancels on Escape while grabbed", async () => {
      const element = await settled(
        createNavigatorItem({ index: 1, grabbed: true })
      );
      const handler = jest.fn();
      element.addEventListener("itemkeycancel", handler);

      const event = keydown("Escape");
      anchorOf(element).dispatchEvent(event);

      expect(handler.mock.calls[0][0].detail).toEqual({ index: 1 });
      expect(event.defaultPrevented).toBe(true);
    });

    it("holds focus against Tab while grabbed, and releases it when not", async () => {
      const grabbed = await settled(
        createNavigatorItem({ index: 0, grabbed: true })
      );
      const tabWhileGrabbed = keydown("Tab");
      anchorOf(grabbed).dispatchEvent(tabWhileGrabbed);
      expect(tabWhileGrabbed.defaultPrevented).toBe(true);

      const free = await settled(createNavigatorItem({ index: 0 }));
      const tabWhileFree = keydown("Tab");
      anchorOf(free).dispatchEvent(tabWhileFree);
      expect(tabWhileFree.defaultPrevented).toBe(false);
    });

    it("does not navigate on a click or an Enter while grabbed", async () => {
      // Mid-drag the anchor is still an anchor. Letting it navigate would
      // take the user off the page in the middle of moving an item.
      const element = await settled(
        createNavigatorItem({ index: 0, grabbed: true })
      );

      anchorOf(element).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      anchorOf(element).dispatchEvent(keydown("Enter"));

      expect(getNavigateCalledWith()).toBeUndefined();
    });

    it("attaches the instruction text only while grabbed, never permanently", async () => {
      const element = await settled(createNavigatorItem({ index: 0 }));

      expect(anchorOf(element).hasAttribute("aria-describedby")).toBe(false);
      expect(
        element.shadowRoot.querySelector(".rstk-nav-item__instructions")
      ).toBeNull();

      element.grabbed = true;
      await settled(element);

      const instructions = element.shadowRoot.querySelector(
        ".rstk-nav-item__instructions"
      );
      expect(instructions).not.toBeNull();
      expect(instructions.textContent).toMatch(/arrow keys/i);
      expect(instructions.textContent).toMatch(/space/i);
      expect(instructions.textContent).toMatch(/escape/i);
      // Associated, not merely present: the idref must resolve to that node.
      expect(anchorOf(element).getAttribute("aria-describedby")).toBe(
        instructions.getAttribute("id")
      );

      element.grabbed = false;
      await settled(element);

      expect(anchorOf(element).hasAttribute("aria-describedby")).toBe(false);
      expect(
        element.shadowRoot.querySelector(".rstk-nav-item__instructions")
      ).toBeNull();
    });

    it.each([false, true])(
      "uses neither aria-grabbed nor aria-dropeffect when grabbed is %s",
      async (grabbed) => {
        // Both are deprecated in ARIA 1.1+ and Salesforce's own reference
        // implementation of this pattern uses neither.
        const element = await settled(createNavigatorItem({ index: 0 }));
        element.grabbed = grabbed;
        await settled(element);

        const attributes = Array.from(
          element.shadowRoot.querySelectorAll("*")
        ).flatMap((node) => Array.from(node.attributes).map((at) => at.name));

        expect(attributes).not.toContain("aria-grabbed");
        expect(attributes).not.toContain("aria-dropeffect");
        // The assertion is only worth anything if it is looking at real
        // attributes at all.
        expect(attributes).toContain("draggable");
      }
    );

    it("exposes a way for its section to put focus back on it after a move", async () => {
      // A move reorders the list under the user, and a grabbed item that
      // loses focus mid-drag strands a keyboard user with no way to finish.
      const element = await settled(createNavigatorItem({ index: 0 }));

      element.focusAnchor();

      expect(element.shadowRoot.activeElement).toBe(anchorOf(element));
    });
  });
});
