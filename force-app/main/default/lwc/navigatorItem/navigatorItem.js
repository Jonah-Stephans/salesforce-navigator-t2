import { LightningElement, api } from "lwc";
import { NavigationMixin } from "lightning/navigation";

/**
 * Both axes move the item one place, because a section is a grid: in a
 * one-column section Up/Down is the list's own direction, and in a
 * multi-column one Left/Right is. Mapping all four onto ±1 means a keyboard
 * user never has to know which layout they are in.
 */
const ARROW_DELTAS = {
  ArrowUp: -1,
  ArrowLeft: -1,
  ArrowDown: 1,
  ArrowRight: 1
};

/**
 * One tab: a real anchor, navigated with `NavigationMixin` against the
 * stored `pageReference` verbatim — no branching, no derivation. That is
 * what makes a rename (added by a later slice) structurally unable to
 * disturb navigation: the label and the target are different fields.
 */
export default class NavigatorItem extends NavigationMixin(LightningElement) {
  @api tabId;
  @api label;
  @api pageReference;

  /**
   * This item's position in its section, and whether a keyboard drag of it is
   * currently under way. Both are owned by the section, not by this
   * component: the section is what holds a list, so it is the only thing that
   * can say what "position 3 of 7" means or which single item is grabbed.
   * This component's job is to turn gestures into events carrying that index
   * back, never to decide where anything goes.
   */
  @api index = 0;
  @api grabbed = false;

  // Defaults to a real, non-empty href so the anchor is always a genuine
  // link — in tab order, exposing a link role, and supporting native
  // middle-click / "open in new tab" — from first render, before
  // `GenerateUrl` has settled at all. `connectedCallback` below upgrades
  // this value to the resolved URL on success. That "#" window is brief
  // (a microtask or two) and tolerated for that reason. It is not
  // tolerated forever: on a permanent rejection, the `.catch` below clears
  // it back to `undefined` rather than leaving "#" in place — see the
  // comment there for why.
  url = "#";

  connectedCallback() {
    this[NavigationMixin.GenerateUrl](this.pageReference)
      .then((url) => {
        this.url = url;
      })
      .catch(() => {
        // GenerateUrl failed to produce a target, and unlike the brief
        // pending window above, this failure never resolves. Leaving
        // `url` at "#" would hand every future middle-click and
        // cmd/ctrl/shift-click on this anchor a real `href` that silently
        // opens a duplicate of the *current* page — a wrong destination,
        // not a visible failure, and exactly what criterion 6 exists to
        // prevent. Clearing `url` removes the anchor's `href` instead, so
        // those native new-tab gestures become inert rather than
        // misleading. The plain-click path is unaffected: `handleClick`
        // below navigates via `NavigationMixin.Navigate` from
        // `this.pageReference` independent of `url`, so a plain click
        // still works even when `GenerateUrl` has failed.
        this.url = undefined;
      });
  }

  handleClick(event) {
    // Mid-drag this is still an anchor, and a keyboard user who has grabbed
    // an item is one Enter away from the browser's own activation of it.
    // Navigating away in the middle of moving an item loses the move.
    if (this.grabbed) {
      event.preventDefault();
      return;
    }
    // A real <a href> already lets the browser open a middle-click or an
    // explicit "open in new tab" on its own. Salesforce's own
    // NavigationMixin sample calls preventDefault() unconditionally, which
    // would swallow a ctrl/cmd/shift-click too; guarding on the modifier
    // keys and letting the browser's default through is what keeps those
    // working.
    if (event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }
    event.preventDefault();
    this[NavigationMixin.Navigate](this.pageReference);
  }

  // An <a> without an `href` is not focusable and exposes no implicit link
  // role, so once `GenerateUrl` has permanently rejected (see the `.catch`
  // above) the item would otherwise be fully invisible to keyboard and
  // assistive-technology users while still working for a mouse user via
  // `handleClick`. Engineer's decision, taken in this fix-pass session:
  // keep the item keyboard-reachable by supplying `tabindex` and a link
  // role explicitly, but only in this no-href case — a working anchor
  // already has both natively, and adding them there would be redundant
  // and could override native semantics.
  get fallbackTabIndex() {
    return this.url === undefined ? "0" : undefined;
  }

  get fallbackRole() {
    return this.url === undefined ? "link" : undefined;
  }

  /**
   * A grabbed item needs to *look* grabbed, or a sighted keyboard user is
   * moving something with no indication of what. SLDS's own drag classes
   * cannot do this — `.slds-is-draggable` has one rule in the whole design
   * system and it is scoped to the App Launcher tile, and `.slds-is-grabbed`
   * only applies inside a dueling list — so this is our own class against
   * SLDS 2 global hooks.
   */
  get anchorClass() {
    return this.grabbed
      ? "rstk-nav-item rstk-nav-item_grabbed"
      : "rstk-nav-item";
  }

  /** The instruction node's id exists only while the item is grabbed. */
  get instructionsId() {
    return this.grabbed ? `rstk-nav-drag-${this.tabId}` : undefined;
  }

  /**
   * The resting hint's id, which is the mirror image: it exists only while
   * the item is *not* grabbed. The two nodes are alternatives, never
   * co-present, so that the anchor is never described by both at once.
   */
  get hintId() {
    return this.grabbed ? undefined : `rstk-nav-hint-${this.tabId}`;
  }

  /**
   * Which of the two the anchor points at. A single idref rather than a pair,
   * because while a drag is under way the instructions are the only thing the
   * user needs and reading the teaser ahead of them on every arrow press
   * would be noise.
   */
  get describedById() {
    return this.grabbed ? this.instructionsId : this.hintId;
  }

  /**
   * Puts focus back on this item's anchor. A move reorders the list under the
   * user, and in a real browser moving a focused node can drop focus; a
   * grabbed item that has lost focus strands a keyboard user with no way to
   * drop it or cancel. The section calls this after each move.
   */
  @api
  focusAnchor() {
    const anchor = this.template.querySelector("a");
    if (anchor) {
      anchor.focus();
    }
  }

  // -------------------------------------------------------------------
  // The mouse path. Every handler here does one thing: turn a native drag
  // event into a CustomEvent carrying this item's index. No layout arithmetic
  // happens in this file, and no drag state is kept in it either — the
  // section holds that, because only the section knows the list.
  // -------------------------------------------------------------------

  handleDragStart(event) {
    // `setData` is the browser's handshake and nothing more: `getData()`
    // returns "" during `dragover` in every browser by the HTML spec's
    // protected mode, so nothing downstream may read this back to decide
    // anything. The authoritative source and destination travel as the
    // explicit `index` payloads on these events.
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", this.tabId);
      event.dataTransfer.effectAllowed = "move";
    }
    // Deliberately no preventDefault(): on dragstart that cancels the drag.
    // The event is stopped instead, so the section card this item sits in
    // does not also read the gesture as the start of a section drag.
    event.stopPropagation();
    this.dispatch("itemdragstart", { index: this.index });
  }

  handleDragOver(event) {
    // Without preventDefault() here the browser never fires `drop` at all.
    // This is the whole mechanism that makes an item a drop target, not a
    // detail of it.
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    this.dispatch("itemdragover", { index: this.index });
  }

  handleDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    this.dispatch("itemdrop", { index: this.index });
  }

  handleDragEnd(event) {
    // Fires whether or not the drop landed anywhere, which is what lets the
    // section clear its drag state after a drag abandoned over open space.
    event.stopPropagation();
    this.dispatch("itemdragend", { index: this.index });
  }

  // -------------------------------------------------------------------
  // The keyboard path — Salesforce's own dnd-a11y-patterns, adopted whole:
  // Space to grab, arrows to move, Space to drop, Escape to cancel. Arrow
  // keys deliberately do not cross containers; moving between sections is a
  // menu, not an arrow key.
  // -------------------------------------------------------------------

  handleKeydown(event) {
    if (this.handleDragKeydown(event)) {
      return;
    }
    // A native <a href> fires `click` on Enter for free, so this handler
    // only has work to do once `url` (and therefore `href`) has been
    // removed by the permanent-rejection `.catch` above. It reuses
    // `handleClick` verbatim rather than adding a second navigation path,
    // so `this.pageReference` still reaches `Navigate` unmodified.
    if (this.url !== undefined || event.key !== "Enter") {
      return;
    }
    this.handleClick(event);
  }

  /** Returns whether the key was consumed as part of the drag pattern. */
  handleDragKeydown(event) {
    const key = event.key;

    if (key === " " || key === "Spacebar") {
      // Space would otherwise scroll the page out from under the item.
      event.preventDefault();
      event.stopPropagation();
      this.dispatch(this.grabbed ? "itemkeydrop" : "itemgrab", {
        index: this.index
      });
      return true;
    }

    if (!this.grabbed) {
      // Nothing else is ours while the item is sitting still. Arrow keys in
      // particular are the platform's own, and an item in a list that is not
      // being dragged has no business swallowing them.
      return false;
    }

    if (key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      this.dispatch("itemkeycancel", { index: this.index });
      return true;
    }

    if (key === "Tab") {
      // Focus must not leave a grabbed item: the drag has no other anchor,
      // and a user who tabs away is left with a grabbed item they can
      // neither drop nor cancel.
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    const delta = ARROW_DELTAS[key];
    if (delta === undefined) {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    this.dispatch("itemkeymove", { index: this.index, delta });
    return true;
  }

  /**
   * Gestures travel as primitives — an index, a direction — never as a layout
   * object. The section owns the ordering; handing it a reference into this
   * component's state would let either side mutate the other's.
   */
  dispatch(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
