import { createElement } from "lwc";
import NavigatorItem from "c/navigatorItem";
import {
  getNavigateCalledWith,
  getGenerateUrlCalledWith,
  GenerateUrl
} from "lightning/navigation";
import { readFileSync } from "fs";
import { join } from "path";

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

    it("looks grabbed while it is grabbed, and only then", async () => {
      // A sighted keyboard user has no other signal that they are holding
      // something: the instruction text is assistive-only and the
      // announcement is spoken. Without this class the grab is invisible.
      const element = await settled(createNavigatorItem());

      expect(anchorOf(element).classList.contains("rstk-nav-item")).toBe(true);
      expect(
        anchorOf(element).classList.contains("rstk-nav-item_grabbed")
      ).toBe(false);

      element.grabbed = true;
      await Promise.resolve();

      expect(anchorOf(element).classList.contains("rstk-nav-item")).toBe(true);
      expect(
        anchorOf(element).classList.contains("rstk-nav-item_grabbed")
      ).toBe(true);

      element.grabbed = false;
      await Promise.resolve();

      expect(
        anchorOf(element).classList.contains("rstk-nav-item_grabbed")
      ).toBe(false);
    });

    it("gives the grabbed class a real appearance that works in both colour modes", () => {
      // jsdom applies no stylesheet, so the assertion above proves the class
      // is computed and not that it means anything. This reads the CSS that
      // ships and pins that the grabbed state is a visible change taken from
      // SLDS 2 semantic hooks — which resolve per colour mode — rather than
      // a hand-rolled colour that would fail contrast in one of them.
      const css = readFileSync(
        join(__dirname, "..", "navigatorItem.css"),
        "utf8"
      );
      const rule = css.match(/\.rstk-nav-item_grabbed\s*\{[^}]*\}/);

      expect(rule).not.toBeNull();
      expect(rule[0]).toContain("--slds-g-shadow-outline-focus-1");
      expect(rule[0]).toContain("--slds-g-color-surface-container-2");
      expect(rule[0]).not.toMatch(/prefers-color-scheme|--slds-c-|--lwc-/);
    });

    it("attaches the instruction text only while grabbed, never permanently", async () => {
      const element = await settled(createNavigatorItem({ index: 0 }));

      // The anchor is described at rest — by the four-word hint, tested
      // below — so the criterion is about *this* node: the instruction text
      // is not in the document and nothing points at it.
      expect(
        element.shadowRoot.querySelector(".rstk-nav-item__instructions")
      ).toBeNull();
      expect(anchorOf(element).getAttribute("aria-describedby")).not.toMatch(
        /rstk-nav-drag-/
      );

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
      const instructionsId = instructions.getAttribute("id");
      expect(anchorOf(element).getAttribute("aria-describedby")).toBe(
        instructionsId
      );

      element.grabbed = false;
      await settled(element);

      expect(
        element.shadowRoot.querySelector(".rstk-nav-item__instructions")
      ).toBeNull();
      expect(anchorOf(element).getAttribute("aria-describedby")).not.toBe(
        instructionsId
      );
    });

    it("tells a keyboard user the move gesture exists before they have guessed it", async () => {
      // A sighted mouse user infers draggability from the grab cursor. A
      // keyboard user has nothing until they have already pressed Space, so
      // the full instructions — which are correctly attached only while
      // grabbed — arrive too late to be the thing that teaches the gesture.
      // A terse, permanent hint is what closes that. Terse deliberately: it
      // is read on every focus, and a bare org shows ~174 items.
      const element = await settled(createNavigatorItem({ index: 0 }));

      const hint = element.shadowRoot.querySelector(".rstk-nav-item__hint");
      expect(hint).not.toBeNull();
      expect(hint.classList.contains("slds-assistive-text")).toBe(true);
      expect(hint.textContent).toMatch(/space/i);
      // Not a sentence, and not the item's own label again — the accessible
      // name already carries that, and repeating it doubles every focus.
      expect(hint.textContent.trim().split(/\s+/).length).toBeLessThanOrEqual(
        6
      );
      expect(hint.textContent).not.toMatch(/our site/i);
      // Associated, not merely present: an idref that does not resolve is an
      // association that only looks present.
      expect(anchorOf(element).getAttribute("aria-describedby")).toBe(
        hint.getAttribute("id")
      );
    });

    it("swaps the hint for the full instructions while grabbed, never both at once", async () => {
      // The grabbed state must win outright. Two description nodes on one
      // anchor would have a screen reader read the teaser and the
      // instructions back to back on every arrow press.
      const element = await settled(createNavigatorItem({ index: 0 }));

      element.grabbed = true;
      await settled(element);

      const instructions = element.shadowRoot.querySelector(
        ".rstk-nav-item__instructions"
      );
      expect(instructions).not.toBeNull();
      expect(
        element.shadowRoot.querySelector(".rstk-nav-item__hint")
      ).toBeNull();
      expect(anchorOf(element).getAttribute("aria-describedby")).toBe(
        instructions.getAttribute("id")
      );

      element.grabbed = false;
      await settled(element);

      const hint = element.shadowRoot.querySelector(".rstk-nav-item__hint");
      expect(hint).not.toBeNull();
      expect(
        element.shadowRoot.querySelector(".rstk-nav-item__instructions")
      ).toBeNull();
      expect(anchorOf(element).getAttribute("aria-describedby")).toBe(
        hint.getAttribute("id")
      );
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

  describe("the Move to… menu", () => {
    // Arrow keys deliberately do not cross a section boundary — that is the
    // pattern, not an omission — so this menu is the cross-section mechanism,
    // and it is the same menu a mouse user gets. Unlike the drag gesture it is
    // ordinary DOM and ordinary events, so all of it is reachable here.
    const TARGETS = [
      { value: "1", label: "Selling" },
      { value: "2", label: "Support" }
    ];

    function menuOf(element) {
      return element.shadowRoot.querySelector("lightning-button-menu");
    }

    function menuItemsOf(element) {
      return Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      );
    }

    it("lists every destination it was given, under the label that section has", async () => {
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );

      expect(menuItemsOf(element).map((item) => item.label)).toEqual([
        "Selling",
        "Support"
      ]);
    });

    it("offers no menu at all when there is nowhere to move to", async () => {
      // A layout with one section would otherwise show every item a menu that
      // opens onto nothing.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: [] })
      );

      expect(menuOf(element)).toBeNull();
    });

    it("reports the chosen destination upward, with its own position", async () => {
      const element = await settled(
        createNavigatorItem({ index: 2, moveTargets: TARGETS })
      );
      const handler = jest.fn();
      element.addEventListener("itemmoveto", handler);

      const chosen = menuItemsOf(element)[1];
      menuOf(element).dispatchEvent(
        new CustomEvent("select", { detail: { value: chosen.value } })
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][0].detail).toEqual({
        index: 2,
        toSection: 2
      });
    });

    it("never asks to cross a section boundary with an arrow key", async () => {
      // The second half of the keyboard criterion, and it is a *negative*:
      // arrows are not required to cross a boundary and are not expected to.
      // Salesforce's own dnd-a11y-patterns has arrows move within a container
      // and a menu move between them, so an arrow that crossed would be the
      // defect, not the feature.
      const element = await settled(
        createNavigatorItem({ index: 1, moveTargets: TARGETS, grabbed: true })
      );
      const crossed = jest.fn();
      const within = jest.fn();
      element.addEventListener("itemmoveto", crossed);
      element.addEventListener("itemkeymove", within);

      ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].forEach((key) => {
        anchorOf(element).dispatchEvent(keydown(key));
      });

      expect(crossed).not.toHaveBeenCalled();
      expect(within).toHaveBeenCalledTimes(4);
    });

    it("puts the cross-section route in a base menu component rather than a hand-rolled one", async () => {
      // `lightning-button-menu` is what makes this operable without a mouse:
      // it is focusable, in the tab order, and handles its own keys. jsdom
      // stubs base components, so its key handling cannot be driven here —
      // what is pinned is that the route is that component and not a div with
      // a click handler, which is the choice the keyboard criterion rests on.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );

      expect(menuOf(element)).not.toBeNull();
      expect(menuOf(element).tagName.toLowerCase()).toBe(
        "lightning-button-menu"
      );
    });

    it("names the item in the menu's accessible name, so several menus are told apart", async () => {
      // Every item in a section carries one of these, and a menu button
      // announced only as "Show menu" leaves a screen reader user with a
      // column of identical buttons.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );

      expect(menuOf(element).alternativeText).toContain("Our Site");
    });
  });
});
