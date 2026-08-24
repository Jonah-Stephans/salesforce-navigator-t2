import { LightningElement, api } from "lwc";
import { MIN_COLUMNS, MAX_COLUMNS, reorder } from "c/navigatorLayoutModel";

const RENAME = "rename";
const DELETE = "delete";
const COLUMNS_PREFIX = "columns-";

/** See the note on ARROW_DELTAS in navigatorItem — a section is a grid. */
const CARD_ARROW_DELTAS = {
  ArrowUp: -1,
  ArrowLeft: -1,
  ArrowDown: 1,
  ArrowRight: 1
};

/**
 * One section card: its header, its overflow menu, and its own items laid out
 * at the section's column count.
 *
 * The section this component is handed is a *resolved* section — the object
 * `navigatorLayoutModel.resolveLayout` produces, with labels and page
 * references already attached and inaccessible items already absent. This
 * component therefore holds no layout logic of its own and cannot disagree
 * with the model about what a section contains; it reports what the user did
 * and lets the parent apply it to the stored layout.
 *
 * The one piece of state it does own is the in-progress rename, which is
 * transient UI and belongs nowhere near the store.
 */
export default class NavigatorSection extends LightningElement {
  @api section;

  /**
   * Whether *this card* is currently grabbed for a section reorder. Owned by
   * the parent rather than by this component, and for a concrete reason: a
   * section reorder changes every section's index, so the parent re-renders
   * this list with new keys and these components are rebuilt. State kept here
   * would not survive the first arrow press. What a section can own is the
   * ordering of its *own* items, because nothing about that changes this
   * card's identity.
   */
  @api grabbed = false;

  isRenaming = false;
  draftName = "";

  // The authoritative source of a mouse drag, kept in JS. It cannot be
  // recovered from the drop event instead: `dataTransfer.getData()` returns
  // "" during `dragover` in every browser by the HTML spec's protected mode,
  // so `setData` is a handshake with the browser and never a channel back to
  // us. Undefined means no drag of ours is in flight, and a drop arriving in
  // that state is a drag that began somewhere else.
  dragFromIndex;

  // The keyboard drag: where the grabbed item is now, and where it started.
  // Both are needed because each arrow press is applied to the stored layout
  // as it happens, so Escape is a move back to the origin rather than the
  // discarding of an uncommitted preview.
  grabbedItemIndex;
  grabbedItemOrigin;

  announcement = "";

  get name() {
    return this.section ? this.section.name : "";
  }

  get items() {
    return this.section ? this.section.items : [];
  }

  get isEmpty() {
    return !(this.section && this.section.hasItems);
  }

  /**
   * The resolved items, decorated with the two facts an item cannot work out
   * for itself: its own position, and whether it is the one being dragged.
   * Both are properties of the *list*, which is this component's to know.
   */
  get renderItems() {
    return this.items.map((item, index) => ({
      ...item,
      index,
      isGrabbed: index === this.grabbedItemIndex
    }));
  }

  get cardClass() {
    return this.grabbed
      ? "rstk-nav-section rstk-nav-section_grabbed"
      : "rstk-nav-section";
  }

  /** The idref and the id both exist only while this card is grabbed. */
  get instructionsId() {
    return this.grabbed
      ? `rstk-nav-section-drag-${this.sectionIndex}`
      : undefined;
  }

  /**
   * `cols-1` … `cols-6`, computed by the model rather than assembled here so
   * that the clamp and the class have one definition between them.
   *
   * Deliberately a class and not an inline `style`: `lightning-layout` cannot
   * express five columns (`size` is a 1–12 integer span), and an inline style
   * would be reaching for `width`, which the SLDS linter validates and would
   * flag — while `grid-template-columns`, which the stylesheet uses, is not on
   * its validated-property list.
   */
  get gridClass() {
    return this.section
      ? this.section.columnClass
      : `rstk-nav-section__grid cols-${MIN_COLUMNS}`;
  }

  /**
   * The column choices, built from the model's own range so that widening it
   * cannot leave the menu behind. `checked` marks the section's current count,
   * which is what makes the menu report state rather than only accept input.
   */
  get columnChoices() {
    const choices = [];
    for (let columns = MIN_COLUMNS; columns <= MAX_COLUMNS; columns += 1) {
      choices.push({
        value: `${COLUMNS_PREFIX}${columns}`,
        label: columns === 1 ? "1 column" : `${columns} columns`,
        checked: this.section ? this.section.columns === columns : false
      });
    }
    return choices;
  }

  get sectionIndex() {
    return this.section ? this.section.index : 0;
  }

  handleMenuSelect(event) {
    const value = event.detail.value;

    if (value === RENAME) {
      this.startRename();
      return;
    }
    if (value === DELETE) {
      this.dispatch("sectiondelete", { index: this.sectionIndex });
      return;
    }
    if (value.startsWith(COLUMNS_PREFIX)) {
      this.dispatch("sectioncolumns", {
        index: this.sectionIndex,
        columns: Number(value.slice(COLUMNS_PREFIX.length))
      });
    }
  }

  startRename() {
    this.draftName = this.name;
    this.isRenaming = true;
  }

  handleRenameChange(event) {
    // Tracked but not dispatched: renaming on every keystroke would re-render
    // the header under the user's caret, and would put a half-typed name into
    // the layout the autosave is about to write.
    this.draftName = event.detail.value;
  }

  handleRenameCommit() {
    const name = (this.draftName || "").trim();
    this.isRenaming = false;

    // An empty name would leave the card with no header text at all and no
    // way back to the menu that could fix it, so the rename is abandoned
    // rather than applied.
    if (!name || name === this.name) {
      return;
    }
    this.dispatch("sectionrename", { index: this.sectionIndex, name });
  }

  handleRenameKeydown(event) {
    if (event.key === "Escape") {
      this.isRenaming = false;
      this.draftName = "";
    }
  }

  renderedCallback() {
    this.keepFocusOnGrabbedItem();

    // Focus follows the rename, or the gesture is mouse-only: the menu item
    // that opened the input is gone from the DOM by the time it renders, so
    // a keyboard user would otherwise be left with focus on the card.
    if (!this.isRenaming) {
      return;
    }
    const input = this.template.querySelector("lightning-input");
    if (input && this.template.activeElement !== input) {
      input.focus();
    }
  }

  /**
   * A move reorders the list under the user. In a real browser, relocating
   * the focused node can drop focus to the body, and a grabbed item that has
   * lost focus is one a keyboard user can neither move again, drop, nor
   * cancel — the drag becomes unfinishable. So focus is put back after every
   * render while a grab is live.
   */
  keepFocusOnGrabbedItem() {
    if (this.grabbedItemIndex === undefined) {
      return;
    }
    const items = this.template.querySelectorAll("c-navigator-item");
    const grabbed = items[this.grabbedItemIndex];
    if (grabbed && this.template.activeElement !== grabbed) {
      grabbed.focusAnchor();
    }
  }

  // -------------------------------------------------------------------
  // Reordering this section's items with the mouse.
  // -------------------------------------------------------------------

  handleItemDragStart(event) {
    this.dragFromIndex = event.detail.index;
    // Forwarded as well as recorded: the parent needs to know an *item* drag
    // is in flight, because a drop landing on a section can mean either "put
    // this section here" or "put this item in that section", and only the
    // parent sees both kinds.
    this.dispatch("itemdragstart", {
      sectionIndex: this.sectionIndex,
      index: event.detail.index
    });
  }

  handleItemDragOver() {
    // The item has already cancelled the native event, which is what makes
    // the drop fire. Nothing is read out of `dataTransfer` here on purpose —
    // see the note on `dragFromIndex`.
  }

  handleItemDrop(event) {
    const from = this.dragFromIndex;
    const to = event.detail.index;
    this.dragFromIndex = undefined;

    if (from === undefined) {
      // A drop with no drag of ours behind it began somewhere else — another
      // section's item, or a section card being dragged over this one. An
      // item covers most of a card's surface, so treating it as a drop on
      // this section is what makes the whole card a target; the parent, which
      // is the only thing that can see both kinds of drag, decides what it
      // means. It must never become a move of an item of ours.
      this.dispatch("sectiondrop", { index: this.sectionIndex });
      return;
    }
    if (from === to) {
      return;
    }
    this.requestMove(from, to);
  }

  handleItemDragEnd() {
    // Fires whether or not the drop landed anywhere, so a drag abandoned over
    // open space leaves no stale source behind for the next drop to pick up.
    this.dragFromIndex = undefined;
    this.dispatch("sectiondragend", { index: this.sectionIndex });
  }

  // -------------------------------------------------------------------
  // Reordering this section's items from the keyboard — Salesforce's own
  // dnd-a11y-patterns. Arrow keys deliberately do not cross containers.
  // -------------------------------------------------------------------

  handleItemGrab(event) {
    const index = event.detail.index;
    this.grabbedItemIndex = index;
    this.grabbedItemOrigin = index;
    this.announce(`${this.labelAt(index)} grabbed. ${this.positionOf(index)}.`);
  }

  handleItemKeyMove(event) {
    const from = event.detail.index;
    const to = from + event.detail.delta;
    const landed = this.landingIndex(from, to);

    this.grabbedItemIndex = landed;
    // Announced even when nothing moved. An arrow press at either end that
    // said nothing would leave a screen reader user unable to tell a key that
    // did not register from one that had nowhere to go.
    this.announce(`${this.labelAt(from)} moved. ${this.positionOf(landed)}.`);

    if (landed !== from) {
      this.requestMove(from, landed);
    }
  }

  handleItemKeyDrop(event) {
    const index = event.detail.index;
    this.announce(`${this.labelAt(index)} dropped. ${this.positionOf(index)}.`);
    this.releaseGrab();
  }

  handleItemKeyCancel(event) {
    const from = event.detail.index;
    const origin = this.grabbedItemOrigin;
    const label = this.labelAt(from);

    // Each arrow press was already applied, so cancelling is a real move back
    // rather than the discarding of a preview — and it goes through the same
    // `itemmove` the arrows use, so it is the same placement maths.
    if (origin !== undefined && origin !== from) {
      this.requestMove(from, origin);
    }
    this.announce(
      `Move cancelled. ${label} returned. ${this.positionOf(
        origin === undefined ? from : origin
      )}.`
    );
    this.releaseGrab();
  }

  releaseGrab() {
    this.grabbedItemIndex = undefined;
    this.grabbedItemOrigin = undefined;
  }

  /**
   * Where an item moving from `from` to `to` actually lands, computed by the
   * same `reorder` the parent will apply. Calling the model rather than
   * repeating its clamp is the point: an announcement that disagreed with the
   * move would be worse than no announcement, because it would be believed.
   */
  landingIndex(from, to) {
    const positions = this.items.map((_item, index) => index);
    return reorder(positions, from, to).indexOf(from);
  }

  positionOf(index) {
    return `Position ${index + 1} of ${this.items.length}`;
  }

  labelAt(index) {
    const item = this.items[index];
    return item ? item.label : "";
  }

  announce(message) {
    this.announcement = message;
  }

  /** The one route out of this component for a change of item order. */
  requestMove(from, to) {
    this.dispatch("itemmove", {
      sectionIndex: this.sectionIndex,
      from,
      to
    });
  }

  // -------------------------------------------------------------------
  // This card as a draggable thing in its own right. The section cannot
  // reorder itself — it does not know about its siblings — so every gesture
  // here is reported upward and nothing is decided locally.
  // -------------------------------------------------------------------

  handleCardDragStart(event) {
    if (event.dataTransfer) {
      event.dataTransfer.setData("text/plain", this.name);
      event.dataTransfer.effectAllowed = "move";
    }
    this.dispatch("sectiondragstart", { index: this.sectionIndex });
  }

  handleCardDragOver(event) {
    // Without this the browser fires no drop at all.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  handleCardDrop(event) {
    event.preventDefault();
    this.dispatch("sectiondrop", { index: this.sectionIndex });
  }

  handleCardDragEnd() {
    this.dispatch("sectiondragend", { index: this.sectionIndex });
  }

  handleCardKeydown(event) {
    // Keydown bubbles, and an item sits inside this card. Without this guard
    // Space on an item would grab both the item and the whole section.
    // `currentTarget` is this card; `target` is retargeted to the item's host
    // for anything raised inside a child's shadow root, so the two are equal
    // only for a key pressed on the card itself.
    if (event.currentTarget !== event.target) {
      return;
    }

    const key = event.key;
    if (key === " " || key === "Spacebar") {
      event.preventDefault();
      this.dispatch(this.grabbed ? "sectionkeydrop" : "sectiongrab", {
        index: this.sectionIndex
      });
      return;
    }
    if (!this.grabbed) {
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      this.dispatch("sectionkeycancel", { index: this.sectionIndex });
      return;
    }
    if (key === "Tab") {
      // Focus must not leave a grabbed card, or the user is left holding a
      // section they can neither drop nor cancel.
      event.preventDefault();
      return;
    }
    const delta = CARD_ARROW_DELTAS[key];
    if (delta === undefined) {
      return;
    }
    event.preventDefault();
    this.dispatch("sectionkeymove", { index: this.sectionIndex, delta });
  }

  /** Puts focus back on this card after a section reorder rebuilt it. */
  @api
  focusCard() {
    const card = this.template.querySelector("article");
    if (card) {
      card.focus();
    }
  }

  /**
   * Section edits travel as primitives — an index and a value — never as a
   * layout object. The parent owns the layout; handing it a reference into
   * this component's state would let either side mutate the other's.
   */
  dispatch(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
