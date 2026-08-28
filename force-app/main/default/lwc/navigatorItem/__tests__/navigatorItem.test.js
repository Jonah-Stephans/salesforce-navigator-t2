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

  it("activates only on Enter, not on any other key, when NavigationMixin.GenerateUrl rejects", async () => {
    // The other half of handleKeydown's guard. The `url !== undefined` half is
    // pinned by the test above; nothing pinned `event.key !== "Enter"`, and
    // dropping it leaves the suite green because on a *working* anchor `url`
    // is a defined string and the first half returns early regardless of key.
    // Its real effect is on the rejection state, where `url` is undefined and
    // every remaining key would activate the item. A link activates on Enter
    // and not otherwise, so that is an accessibility defect rather than only
    // an untested branch.
    //
    // Space is asserted because it is the key the rule is usually stated
    // about, but it cannot discriminate on its own: `handleDragKeydown`
    // consumes Space as the grab gesture and returns before this guard is
    // reached either way. The keys that reach the guard — an arrow, Escape,
    // Tab and an ordinary character on an item that is not grabbed — are what
    // make this bite.
    GenerateUrl.mockRejectedValueOnce(new Error("GenerateUrl failed"));

    const element = createNavigatorItem();
    await settled(element);
    await Promise.resolve();

    const anchor = anchorOf(element);
    expect(anchor.hasAttribute("href")).toBe(false);

    for (const key of [" ", "Spacebar", "ArrowDown", "Escape", "Tab", "a"]) {
      anchor.dispatchEvent(keydown(key));
      expect(getNavigateCalledWith()).toBeUndefined();
    }

    // ...and the item is still reachable the one way it should be, so this
    // cannot be satisfied by an anchor that activates on nothing at all.
    anchor.dispatchEvent(keydown("Enter"));
    expect(getNavigateCalledWith().pageReference).toEqual(
      STORED_PAGE_REFERENCE
    );
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

  /**
   * A section's width now follows its field-column count (the sibling slice),
   * so a column can be narrower than a tab name. Nothing bounded a label
   * before that — there was no ellipsis on an item anywhere, because the card
   * was always full width. This is the truncation this narrower column now
   * needs.
   *
   * `slds-truncate` is used rather than hand-written CSS, per
   * `rstk-lwc-standards.md`'s rule to prefer SLDS utility classes over custom
   * CSS for a standard pattern. Read from the real shipped stylesheet
   * (`salesforce-lightning-design-system.css`) rather than assumed, the class
   * resolves to four declarations — `max-width: 100%`, `overflow: hidden`,
   * `text-overflow: ellipsis`, `white-space: nowrap` — one more than an
   * earlier draft of the design spelled out by hand. Against the flex row
   * this lands in: the label span is a flex item of `.rstk-nav-item` (itself
   * `display: flex`), and its own `overflow: hidden` gives it an automatic
   * flex min-width of 0 per the Flexbox spec (an item's automatic minimum
   * size is 0 once its own `overflow` is not `visible`) — so it shrinks and
   * truncates without a hand-added `min-width: 0` of its own.
   *
   * What jsdom cannot observe, and is not asserted here: applies no
   * stylesheet, so no ellipsis ever renders and `getBoundingClientRect()`
   * returns zeros — whether an item's label actually clips, wraps, or stays
   * on one line is a real-browser fact. Whether a screen reader announces the
   * label once or twice with both `title` and `aria-label` present is a
   * live-AT fact spec.md's own `## Traps` names as unverified. Both are
   * recorded as such rather than asserted past what this suite can see.
   */
  describe("truncating a label too long for its column", () => {
    const LONG_LABEL = "Receivable Transaction Scheduled Payment";

    function labelOf(element) {
      return element.shadowRoot.querySelector(".rstk-nav-item__label");
    }

    it("puts slds-truncate on the label rather than a hand-rolled ellipsis", async () => {
      const element = await settled(createNavigatorItem({ label: LONG_LABEL }));

      expect(labelOf(element).classList.contains("slds-truncate")).toBe(true);
    });

    it("clips the anchor's own overflow, so a long label cannot spill past the pill's border or over the menu beside it", () => {
      // Rendered clipping is not observable in jsdom — the existing
      // `_grabbed` appearance test above reads the shipped CSS as text for
      // the same reason, and this follows that pattern.
      // Anchored at the start of a line: `.rstk-nav-item__row .rstk-nav-item`
      // (the compound selector a few rules above this one) also contains the
      // literal text ".rstk-nav-item {" and would otherwise be the first,
      // wrong match — this is the one rule whose selector *is* exactly
      // `.rstk-nav-item`, nothing else.
      const css = readFileSync(
        join(__dirname, "..", "navigatorItem.css"),
        "utf8"
      );
      const rule = css.match(/^\.rstk-nav-item\s*\{[^}]*\}/m);

      expect(rule).not.toBeNull();
      expect(rule[0]).toContain("overflow: hidden");
    });

    it("leaves the full label in the DOM text, unshortened, so find-in-page still matches what the ellipsis hides", async () => {
      // text-overflow: ellipsis clips only the rendering; it never edits the
      // text node. A component that instead computed its own substring plus
      // "…" would defeat find-in-page, which this pins against by asserting
      // the rendered text is the whole string, not a shortened one.
      const element = await settled(createNavigatorItem({ label: LONG_LABEL }));

      expect(labelOf(element).textContent).toBe(LONG_LABEL);
    });

    it("gives the anchor a title carrying the full label, so hovering a truncated item reveals it", async () => {
      const element = await settled(createNavigatorItem({ label: LONG_LABEL }));

      expect(anchorOf(element).getAttribute("title")).toBe(LONG_LABEL);
    });

    it("leaves aria-label as the anchor's only accessible-name source alongside the new title", async () => {
      // aria-label outranks title in accessible-name computation (WAI-ARIA
      // accname), so the anchor's *name* is unaffected by title being added.
      // Whether some assistive tech separately reads title as a hint on top
      // of that name is the live-AT question spec.md leaves open, not a
      // structural claim this test can settle.
      const element = await settled(createNavigatorItem({ label: LONG_LABEL }));
      const anchor = anchorOf(element);

      expect(anchor.getAttribute("aria-label")).toBe(LONG_LABEL);
      expect(anchor.getAttribute("title")).toBe(LONG_LABEL);
    });

    it("applies the same truncation markup to a label that already fits, unchanged in its own text", async () => {
      // Nothing here branches on length: the same class and title apply
      // whether or not the column is wide enough, and it is the real
      // stylesheet's own text-overflow that decides whether an ellipsis ever
      // shows. So "unchanged when it fits" is a property of the CSS, not of
      // this component choosing not to truncate — this pins that no
      // second, JS-computed truncation is layered on top of it.
      const element = await settled(createNavigatorItem({ label: "Our Site" }));

      expect(labelOf(element).classList.contains("slds-truncate")).toBe(true);
      expect(labelOf(element).textContent).toBe("Our Site");
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

    /**
     * Only the destinations. The overflow menu carries this item's other
     * actions too — Rename… since slice 06 — so a bare `lightning-menu-item`
     * query is no longer a list of places to move to.
     */
    function destinationsOf(element) {
      return menuItemsOf(element).filter((item) =>
        item.value.startsWith("move-to-")
      );
    }

    it("lists every destination it was given, under the label that section has", async () => {
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );

      expect(destinationsOf(element).map((item) => item.label)).toEqual([
        "Selling",
        "Support"
      ]);
    });

    it("offers nowhere to move to when there is nowhere to move to", async () => {
      // A layout with one section would otherwise show every item a
      // destination list that opens onto nothing. The menu itself stays —
      // Rename… lives in it, and the seeded layout is a single section, so a
      // menu withheld here would make renaming unreachable for exactly the
      // user who has never customised anything.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: [] })
      );

      expect(destinationsOf(element)).toEqual([]);
      expect(
        element.shadowRoot.querySelector("lightning-menu-subheader")
      ).toBeNull();
      expect(menuOf(element)).not.toBeNull();
    });

    it("reports the chosen destination upward, with its own position", async () => {
      const element = await settled(
        createNavigatorItem({ index: 2, moveTargets: TARGETS })
      );
      const handler = jest.fn();
      element.addEventListener("itemmoveto", handler);

      const chosen = destinationsOf(element)[1];
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

  /**
   * Renaming an item, from the same overflow menu the cross-section move is
   * in. The interaction is the one `navigatorSection` already uses for a
   * section name — an inline input, committed on Enter or blur, abandoned on
   * Escape — rather than a second gesture invented for the same job.
   *
   * Nothing here writes anything. This component reports the wording the user
   * typed and its own position; the label it renders next is the one the model
   * resolved and handed back down, which is why an assertion about what a
   * rename *does* belongs in the parent's suite and not this one.
   */
  describe("the Rename… entry", () => {
    const TARGETS = [{ value: "1", label: "Selling" }];

    function menuOf(element) {
      return element.shadowRoot.querySelector("lightning-button-menu");
    }

    function selectMenuItem(element, value) {
      menuOf(element).dispatchEvent(
        new CustomEvent("select", { detail: { value } })
      );
    }

    function inputOf(element) {
      return element.shadowRoot.querySelector("lightning-input");
    }

    async function startRenaming(element) {
      selectMenuItem(element, "rename");
      await Promise.resolve();
      return inputOf(element);
    }

    function type(input, value) {
      input.dispatchEvent(new CustomEvent("change", { detail: { value } }));
    }

    it("offers Rename… whether or not there is anywhere to move to", async () => {
      // The seeded layout is a single section, so an item's only action there
      // is the rename — a menu gated on having a destination would put this
      // out of reach of every user who has never made a section.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: [] })
      );

      const values = Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      ).map((item) => item.value);
      expect(values).toContain("rename");
    });

    it("opens an input on the wording the item is currently shown under", async () => {
      const element = await settled(
        createNavigatorItem({
          index: 0,
          label: "Clients",
          moveTargets: TARGETS
        })
      );

      const input = await startRenaming(element);

      expect(input).not.toBeNull();
      // The wording on screen, so a user correcting a typo in their own rename
      // is not made to retype it from the platform label.
      expect(input.value).toBe("Clients");
      expect(anchorOf(element)).toBeNull();
    });

    it("puts focus on the input it opened, so the rename is not a mouse-only gesture", async () => {
      // "The user can find this" and "the handler does the right thing when
      // told" are two facts, and every other test here drives the input by
      // holding a reference to it — which pins only the second. The menu entry
      // that opened the input is gone from the DOM by the time it renders, so
      // without the focus call a keyboard user is left with focus on nothing.
      //
      // jsdom's base-component stub is an empty custom element whose `focus()`
      // does not move `shadowRoot.activeElement`, so the assertion cannot be
      // made against `activeElement` the way `focusAnchor`'s is on a real
      // anchor. Recording the call on the prototype is what makes the fact
      // observable at all.
      const focused = [];
      const spy = jest
        .spyOn(HTMLElement.prototype, "focus")
        .mockImplementation(function record() {
          focused.push(this.tagName);
        });

      try {
        const element = await settled(
          createNavigatorItem({ index: 0, moveTargets: TARGETS })
        );

        await startRenaming(element);

        expect(focused).toContain("LIGHTNING-INPUT");
      } finally {
        spy.mockRestore();
      }
    });

    it("reports the wording upward with its own position, on commit", async () => {
      const element = await settled(
        createNavigatorItem({ index: 2, moveTargets: TARGETS })
      );
      const handler = jest.fn();
      element.addEventListener("itemrename", handler);

      const input = await startRenaming(element);
      type(input, "  My site  ");
      input.dispatchEvent(new CustomEvent("commit"));

      expect(handler).toHaveBeenCalledTimes(1);
      // Its own index, not a constant: an item that reported 0 would rename
      // whatever sits at the top of the section.
      expect(handler.mock.calls[0][0].detail).toEqual({
        index: 2,
        rename: "My site"
      });
    });

    it("puts the item back under its anchor once the rename is committed", async () => {
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );

      const input = await startRenaming(element);
      type(input, "My site");
      input.dispatchEvent(new CustomEvent("commit"));
      await Promise.resolve();

      expect(inputOf(element)).toBeNull();
      expect(anchorOf(element)).not.toBeNull();
    });

    it("does not fire a rename while the user is still typing", async () => {
      // A rename per keystroke would re-render the row under the caret and put
      // half-typed wording into the layout the autosave is about to write.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );
      const handler = jest.fn();
      element.addEventListener("itemrename", handler);

      const input = await startRenaming(element);
      type(input, "M");
      type(input, "My");

      expect(handler).not.toHaveBeenCalled();
    });

    it("keeps the wording it had when a rename is abandoned with Escape", async () => {
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );
      const handler = jest.fn();
      element.addEventListener("itemrename", handler);

      const input = await startRenaming(element);
      type(input, "Nope");
      input.dispatchEvent(keydown("Escape"));
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
      expect(inputOf(element)).toBeNull();
      expect(anchorOf(element).textContent.trim()).toBe("Our Site");
    });

    it.each(["", "   "])(
      "asks for the rename to be cleared when the input is committed as %p",
      async (emptied) => {
        // How a user gets their Salesforce label back: empty the box. The
        // wording travels as the empty string and the model drops the key.
        const element = await settled(
          createNavigatorItem({
            index: 1,
            label: "Clients",
            moveTargets: TARGETS
          })
        );
        const handler = jest.fn();
        element.addEventListener("itemrename", handler);

        const input = await startRenaming(element);
        type(input, emptied);
        input.dispatchEvent(new CustomEvent("commit"));

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].detail).toEqual({
          index: 1,
          rename: ""
        });
      }
    );

    it("says nothing at all when the wording is committed unchanged", async () => {
      // Opening the menu and pressing Enter is not a change, and reporting it
      // would schedule a write — and, on an item with no rename, freeze the
      // platform label into the payload so a later org relabelling stopped
      // reaching it.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );
      const handler = jest.fn();
      element.addEventListener("itemrename", handler);

      const input = await startRenaming(element);
      input.dispatchEvent(new CustomEvent("commit"));
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
      expect(inputOf(element)).toBeNull();
    });

    it("reports nothing when a commit arrives after the rename was abandoned", async () => {
      // `commit` is what `lightning-input` fires on blur as well as on Enter,
      // and Escape removes the focused input from the DOM — so the blur that
      // follows an abandoned edit can deliver a commit of the blanked draft.
      // For a *section* that would be refused as an empty name; for an item an
      // empty commit is a legitimate clear, so the guard has to be the state
      // rather than the value. Abandoning an edit must not destroy the wording
      // the user was editing.
      const element = await settled(
        createNavigatorItem({
          index: 1,
          label: "Clients",
          moveTargets: TARGETS
        })
      );
      const handler = jest.fn();
      element.addEventListener("itemrename", handler);

      const input = await startRenaming(element);
      type(input, "Nope");
      input.dispatchEvent(keydown("Escape"));
      input.dispatchEvent(new CustomEvent("commit"));
      await Promise.resolve();

      expect(handler).not.toHaveBeenCalled();
      // And the wording it was abandoned from is still what is on screen.
      expect(anchorOf(element).textContent.trim()).toBe("Clients");
    });

    it("does not navigate, grab or drag while the wording is being edited", async () => {
      // Navigation, the drag source and Space-to-grab are all carried by the
      // anchor and by nothing else, so the property that makes all three safe
      // is that the anchor is *replaced* by the input rather than joined by it.
      // That is what this asserts. Dispatching the Space on the input alone
      // would not: the two are siblings in one shadow root with no ancestor
      // handler, so a keydown raised on the input never reaches the anchor's
      // handler whether or not the anchor is rendered — the test would pass
      // over a template that left the anchor sitting there for a real user to
      // Tab onto and Space.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );
      const grabbed = jest.fn();
      element.addEventListener("itemgrab", grabbed);

      const input = await startRenaming(element);

      expect(input).not.toBeNull();
      expect(anchorOf(element)).toBeNull();
      // Nothing else in the item is a drag source either, so there is no
      // second node a mouse drag could start from during a rename.
      expect(element.shadowRoot.querySelector("[draggable]")).toBeNull();

      // And with the anchor gone, the Space the user types into the box is a
      // Space and not a grab.
      input.dispatchEvent(keydown(" "));

      expect(grabbed).not.toHaveBeenCalled();
      expect(getNavigateCalledWith()).toBeUndefined();
    });
  });

  describe("removing the item", () => {
    const TARGETS = [
      { value: "1", label: "Selling" },
      { value: "2", label: "Support" }
    ];

    function menuOf(element) {
      return element.shadowRoot.querySelector("lightning-button-menu");
    }

    function menuEntries(element) {
      return Array.from(
        element.shadowRoot.querySelectorAll("lightning-menu-item")
      ).map((entry) => [entry.value, entry.label]);
    }

    function selectMenuItem(element, value) {
      menuOf(element).dispatchEvent(
        new CustomEvent("select", { detail: { value } })
      );
    }

    it("offers Remove in the overflow menu, where a user can find it", async () => {
      // Asserted as an entry the user can *find*, not only as a value the
      // handler responds to. Slice 06's row 16 is the lesson: every test
      // fires the menu's own `select` event, and a menu with nothing in it
      // emits that just as happily as a full one — so the entry could be
      // deleted outright with the suite green.
      const element = await settled(createNavigatorItem({ index: 0 }));

      expect(menuEntries(element)).toContainEqual(["remove", "Remove"]);
    });

    it("offers Remove even when there is nowhere to move to", async () => {
      // The seeded layout is a single section, so an entry gated on having a
      // destination would put removal out of reach of exactly the user who
      // has never customised anything — every user, on first open. Same
      // reasoning as slice 06's always-present menu.
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: [] })
      );

      expect(menuEntries(element)).toContainEqual(["remove", "Remove"]);
    });

    it("asks for its own removal, carrying its own position", async () => {
      const element = await settled(createNavigatorItem({ index: 2 }));
      const removed = jest.fn();
      element.addEventListener("itemremove", removed);

      selectMenuItem(element, "remove");

      expect(removed).toHaveBeenCalledTimes(1);
      expect(removed.mock.calls[0][0].detail).toEqual({ index: 2 });
    });

    it("reports its own position and not a constant", async () => {
      // An item that reported `index: 0` would be indistinguishable from one
      // that reported itself in every fixture built at position 0.
      const element = await settled(createNavigatorItem({ index: 4 }));
      const removed = jest.fn();
      element.addEventListener("itemremove", removed);

      selectMenuItem(element, "remove");

      expect(removed.mock.calls[0][0].detail.index).toBe(4);
    });

    it("does not confuse Remove with Rename or with a destination", async () => {
      const element = await settled(
        createNavigatorItem({ index: 0, moveTargets: TARGETS })
      );
      const removed = jest.fn();
      const moved = jest.fn();
      element.addEventListener("itemremove", removed);
      element.addEventListener("itemmoveto", moved);

      selectMenuItem(element, "rename");
      selectMenuItem(element, "move-to-1");

      expect(removed).not.toHaveBeenCalled();
      expect(moved).toHaveBeenCalledTimes(1);
    });

    it("abandons an open rename on its way out, so no stale wording is committed after it", async () => {
      // The menu is a sibling of the rename box and stays clickable while it
      // is open, so Remove is reachable mid-edit. Removing the component
      // destroys the input, and `lightning-input` fires `commit` on blur —
      // an unabandoned edit would arrive as an `itemrename` on a position
      // that by then names a different item. Abandoning first is what makes
      // the existing `isRenaming` guard swallow it.
      const element = await settled(createNavigatorItem({ index: 0 }));
      selectMenuItem(element, "rename");
      await Promise.resolve();
      const input = element.shadowRoot.querySelector("lightning-input");
      input.dispatchEvent(
        new CustomEvent("change", { detail: { value: "Half typed" } })
      );

      const removed = jest.fn();
      const renamed = jest.fn();
      element.addEventListener("itemremove", removed);
      element.addEventListener("itemrename", renamed);

      selectMenuItem(element, "remove");
      await Promise.resolve();

      expect(removed).toHaveBeenCalledTimes(1);
      // The box is gone and the blur-driven commit it would fire reports
      // nothing.
      expect(element.shadowRoot.querySelector("lightning-input")).toBeNull();
      input.dispatchEvent(new CustomEvent("commit"));
      expect(renamed).not.toHaveBeenCalled();
    });
  });
});
