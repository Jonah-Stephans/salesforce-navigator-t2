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
 * The prefix on every Move to… entry's value.
 *
 * The menu is this item's overflow menu and later slices add Rename… and
 * Remove to it, so a bare section index would become ambiguous the moment a
 * second kind of entry arrives. Prefixing now costs nothing and means the
 * handler below reads the menu rather than assuming what is in it — the same
 * shape `navigatorSection` already uses for its own `columns-N` entries.
 */
const MOVE_TO_PREFIX = "move-to-";

/**
 * The overflow menu's other entry: the user's own wording for this tab.
 *
 * A bare value rather than a prefixed one because, unlike a destination, it
 * carries no argument — and it is the same spelling `navigatorSection` uses
 * for the same action on a section name, which is deliberate: this is that
 * component's interaction applied to an item, not a second one invented for
 * the same job.
 */
const RENAME = "rename";

/**
 * The overflow menu's third entry: take this item out of the layout.
 *
 * Like `RENAME` it is unconditional — the seeded layout is a single section,
 * so an entry gated on having somewhere to move to would put removal out of
 * reach of exactly the user who has never customised anything. And like
 * `RENAME` it is a bare value rather than a prefixed one, because it carries
 * no argument: the item's own position is what travels, in the payload.
 *
 * Nothing is recorded about a removed item anywhere, and nothing needs to be.
 * An item lives in a layout and nowhere else, so one that is in no section is
 * simply one the picker offers back — which is what makes "add it again later"
 * a property of the store's shape rather than a bin someone has to maintain.
 */
const REMOVE = "remove";

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

  /**
   * The sections this item could move to — every section of the layout except
   * the one it is already in — as `{value, label}`, where `value` is the
   * destination section's index. Supplied by the parent through the section,
   * because a section knows nothing of its siblings and an item knows nothing
   * of anything.
   *
   * This menu is the cross-section mechanism, and it is deliberately not an
   * arrow key: Salesforce's own `dnd-a11y-patterns` has arrows move within a
   * container and a Move button move between them, and the whole point is that
   * a keyboard user reaches the same menu a mouse user does.
   */
  @api moveTargets = [];

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

  /**
   * The in-progress rename. Transient UI and nothing else — it is not a
   * layout, it is not saved, and it exists only between the menu entry being
   * chosen and the input being committed or abandoned. The same two fields
   * `navigatorSection` holds for a section name, for the same reason.
   */
  isRenaming = false;
  draftName = "";

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

  // -------------------------------------------------------------------
  // The Move to… menu — the cross-section move, and the one route to it that
  // does not need a mouse. Ordinary DOM and ordinary events: no gesture is
  // involved, which is why unlike the drag path all of it is testable.
  // -------------------------------------------------------------------

  /**
   * Whether there is anywhere to move to. A layout with a single section
   * would otherwise give every item a menu button that opens onto nothing —
   * one more thing in the tab order, saying nothing when it is reached.
   */
  get hasMoveTargets() {
    return Array.isArray(this.moveTargets) && this.moveTargets.length > 0;
  }

  /**
   * The destinations as menu entries. The prefix is added here rather than by
   * the parent so that how this menu encodes its own entries stays inside this
   * component — the parent supplies section indexes and gets one back.
   */
  get moveMenuItems() {
    return (this.moveTargets || []).map((target) => ({
      value: `${MOVE_TO_PREFIX}${target.value}`,
      label: target.label
    }));
  }

  /**
   * What a screen reader calls the menu button. Every item in a section
   * carries one, so a button announced only as "Show menu" leaves the user
   * with a column of identically-named buttons and no way to tell which item
   * they are acting on.
   */
  get menuLabel() {
    return `Actions for ${this.label}`;
  }

  handleMenuSelect(event) {
    const value = event.detail.value;
    if (value === RENAME) {
      this.startRename();
      return;
    }
    if (value === REMOVE) {
      // The menu is a sibling of the rename box and stays clickable while it
      // is open, so Remove is reachable mid-edit — and removing this item
      // destroys the input, which `lightning-input` blurs and therefore
      // `commit`s. An unabandoned edit would arrive at the parent as a rename
      // of whatever position this one has become. Abandoning first is what
      // makes `handleRenameCommit`'s `isRenaming` guard swallow it.
      this.isRenaming = false;
      this.draftName = "";
      this.dispatch("itemremove", { index: this.index });
      return;
    }
    if (!value || !value.startsWith(MOVE_TO_PREFIX)) {
      return;
    }
    this.dispatch("itemmoveto", {
      index: this.index,
      toSection: Number(value.slice(MOVE_TO_PREFIX.length))
    });
  }

  // -------------------------------------------------------------------
  // The rename. This component reports the wording the user typed and its own
  // position; what the item is *called* afterwards still arrives as `label`
  // from the model, so there is no second copy of "what is this item called"
  // anywhere in the chain.
  // -------------------------------------------------------------------

  /**
   * The box opens on the wording the item is shown under — the user's own
   * rename if they have one, the platform label if they have not — so
   * correcting a typo in a rename does not mean retyping it, and emptying the
   * box is a visible route back to the Salesforce label.
   */
  startRename() {
    this.draftName = this.label;
    this.isRenaming = true;
  }

  handleRenameChange(event) {
    // Tracked but not dispatched: a rename per keystroke would re-render the
    // row under the user's caret and put half-typed wording into the layout
    // the autosave is about to write.
    this.draftName = event.detail.value;
  }

  /**
   * Enter or blur. An empty box is **not** refused, which is the one place
   * this parts company with the section rename it otherwise follows — and the
   * difference is in the job rather than in the interaction. A section with no
   * name has no header text and no way back to the menu that could fix it; an
   * item with no rename has the label Salesforce gives it, which is where it
   * started. So emptying the box is how a user clears a rename, and it travels
   * as the empty string for the model to drop.
   *
   * Wording that has not changed reports nothing at all. Opening the menu and
   * pressing Enter is not an edit, and treating it as one would schedule a
   * write — and on an item with no rename would freeze the platform label into
   * the payload, so a later org relabelling stopped reaching it.
   *
   * The guard is on `isRenaming` and not on the value, because for an item the
   * value carries no signal: an empty commit is a legitimate clear, so the
   * empty-name refusal that keeps `navigatorSection` safe from this cannot be
   * borrowed. `commit` is fired on blur as well as on Enter and Escape removes
   * a focused input from the DOM, so a commit can arrive *after* the draft has
   * been blanked by an abandoned edit — and dispatching that would clear the
   * wording the user pressed Escape to protect.
   */
  handleRenameCommit() {
    if (!this.isRenaming) {
      return;
    }
    const rename = (this.draftName || "").trim();
    this.isRenaming = false;

    if (rename === this.label) {
      return;
    }
    this.dispatch("itemrename", { index: this.index, rename });
  }

  handleRenameKeydown(event) {
    if (event.key === "Escape") {
      this.isRenaming = false;
      this.draftName = "";
    }
  }

  renderedCallback() {
    // Focus follows the rename, or the gesture is mouse-only: the menu entry
    // that opened the input is gone from the DOM by the time it renders, so a
    // keyboard user would otherwise be left with focus on nothing.
    if (!this.isRenaming) {
      return;
    }
    const input = this.template.querySelector("lightning-input");
    if (input && this.template.activeElement !== input) {
      input.focus();
    }
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
