import { LightningElement, api } from "lwc";
import { MIN_COLUMNS, MAX_COLUMNS, reorder } from "c/navigatorLayoutModel";

const RENAME = "rename";
const DELETE = "delete";
const COLUMNS_PREFIX = "columns-";

/**
 * The one copy of the Add items button's visible wording. The button reads it
 * and so does the empty-section message that points at the button, so the two
 * cannot say different things.
 */
const ADD_ITEMS = "Add items";

/**
 * The distinguisher that makes a repeated announcement a *new* announcement.
 *
 * A live region is read when its content changes, and LWC writes nothing to
 * the DOM when a bound string is unchanged — so two identical sentences in a
 * row are one write and one announcement, and the second press is silent.
 * That is precisely the case the "announced even when nothing moved" rule
 * below exists to serve: a user pressing ArrowLeft twice at position 1, or
 * walking an item to position 3, back, and to 3 again, is the ordinary case.
 *
 * U+200B ZERO WIDTH SPACE, toggled on and off, makes consecutive writes
 * textually distinct while adding nothing a screen reader voices and nothing
 * a sighted user can see. `salesforceNavigator` carries the same toggle for
 * the section axis, where the same hazard applies to its own live region.
 */
const ANNOUNCEMENT_NONCE = "\u200B";

/**
 * All four arrow keys move a grabbed section card by one place through the
 * sections' own flat stored order — the same order that packs into the
 * canvas's rows — never by a row or a column of the two-dimensional canvas
 * itself. `## Design` keeps row membership out of JS on purpose: there is no
 * row or column index to move by, only a position in the list. So ArrowDown
 * on a card sharing a row with another section moves it later in that list,
 * which visually can land it beside itself rather than in a row below — a
 * real limitation, named for the user in the drag instructions' own wording
 * ("earlier or later") rather than implied away by calling this a grid move.
 * An item's own ARROW_DELTAS in navigatorItem carries the identical
 * mismatch — a flat stored order moved by ±1 that renders into that
 * section's own two-dimensional cols-N grid — which is why navigatorItem's
 * own drag instructions likewise say only "move this item" rather than
 * naming a direction.
 */
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
  /**
   * The resolved section this card renders.
   *
   * An accessor rather than a bare field because the arrival of a new one is a
   * fact this component has to act on and not merely store: a live keyboard
   * grab is held on an *item*, and the list it is counted along has just been
   * replaced. Re-seating the grab here rather than in `renderedCallback` is
   * what keeps it correct — this runs exactly when the list changes, and only
   * then, whereas a render also happens for this component's own state changes
   * and would compare a freshly-set index against a list that had not caught up
   * with it yet.
   */
  @api
  get section() {
    return this.resolvedSection;
  }

  set section(value) {
    this.resolvedSection = value;
    this.reseatOrReleaseGrab();
  }

  resolvedSection;

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

  /**
   * Whether an *item* drag — anyone's — is currently in flight. Owned by the
   * parent for the same reason `dragKind` is: a drop landing on a card can
   * mean "put this section here" or "put this item in that section", and only
   * the component that sees both kinds of drag can tell them apart. Without
   * it this card would light up as a drop target while a whole *section* was
   * being dragged over it, which is a different gesture with a different
   * result.
   */
  @api itemDragActive = false;

  /**
   * Whether the whole Navigator is in edit mode, set by the parent — the
   * same `@api` down / `CustomEvent` up route `grabbed` and `itemDragActive`
   * already use, rather than a new state-sharing mechanism. The "Add items"
   * button and this card's overflow menu — and therefore renaming, changing
   * this section's column count and deleting it — are all reachable only
   * while this holds true; out of edit mode neither renders at all
   * (`lwc:if`, not a CSS class), so neither the tab order nor a screen
   * reader can reach them. `emptyMessage` also reads this: it names the Add
   * items button only while editing, since out of edit mode that button is
   * one of the things this flag hides. Passed straight through to each
   * `c-navigator-item` (`navigatorSection.html`'s `editing={editing}`) so its
   * own overflow menu — Rename…, Remove, Move to… — is gated the same way,
   * one level further down the same route.
   *
   * A setter rather than a bare field for one reason: an in-progress rename
   * is this component's own transient state, entered only through the
   * overflow menu this flag gates. If the parent leaves edit mode mid-rename,
   * the menu that could reopen it is gone, but nothing else would close a
   * rename input left open from before — so leaving edit mode ends any
   * in-progress rename along with it.
   */
  @api
  get editing() {
    return this.isEditingSection;
  }

  set editing(value) {
    // Coerced rather than stored as-is: this is an `@api` boundary, and LWC
    // renders a bound expression that resolves `undefined` by omitting the
    // attribute — the same thing it does for a literal `false` — so an
    // uncoerced `undefined` here would leave `draggable={editing}` bound to
    // `undefined` too, which LWC also renders as an absent `draggable`
    // attribute rather than the explicit `"false"` the design requires.
    this.isEditingSection = value === true;
    if (!this.isEditingSection) {
      this.isRenaming = false;
      // A keyboard grab on one of this section's items is this section's
      // own transient state — `grabbedItemIndex` and its neighbours below —
      // and nothing else clears it when edit mode ends out from under it.
      // Left in place, the item would keep rendering as `grabbed` (its
      // `isGrabbed` class, its drag instructions) even though it can no
      // longer be dragged at all once `editing` is false, and
      // `keepFocusOnGrabbedItem` in `renderedCallback` would keep chasing a
      // card that is no longer part of any live gesture. Silent, the same as
      // `releaseGrabForDepartingItem`: the transition out of edit mode is
      // already announced by the parent, so a second, contradictory
      // announcement about the grab itself would only confuse the sentence
      // the user is already hearing.
      this.releaseGrab();
    }
  }

  isEditingSection = false;

  isRenaming = false;
  draftName = "";

  // The authoritative source of a mouse drag, kept in JS. It cannot be
  // recovered from the drop event instead: `dataTransfer.getData()` returns
  // "" during `dragover` in every browser by the HTML spec's protected mode,
  // so `setData` is a handshake with the browser and never a channel back to
  // us. Undefined means no drag of ours is in flight, and a drop arriving in
  // that state is a drag that began somewhere else.
  dragFromIndex;

  // How many nested `dragenter`s are outstanding on this card. A plain
  // boolean flipped by `dragenter`/`dragleave` flickers off every time the
  // pointer crosses from the card onto one of its own items, because the
  // browser fires `dragleave` on the element being left before `dragenter` on
  // the one being entered — and an item covers most of a card. Counting the
  // pairs is what makes "the pointer is somewhere inside this card" a single
  // fact rather than a race.
  dragDepth = 0;

  // The keyboard drag: where the grabbed item is now, and where it started.
  // Both are needed because each arrow press is applied to the stored layout
  // as it happens, so Escape is a move back to the origin rather than the
  // discarding of an uncommitted preview.
  grabbedItemIndex;
  grabbedItemOrigin;

  // Which item is being held, and what it is called. The index alone cannot
  // answer "is the thing I am holding still here?" — an item can stop
  // rendering mid-drag, because the render-time access intersection drops any
  // tab the running user has lost access to, and the index would then point
  // at a neighbour or past the end of the list with nothing to say so. The
  // label is kept because by the time it is needed the item is gone, and
  // "the move ended" is not something to tell a screen reader user without
  // naming what it was about.
  grabbedItemId;
  grabbedItemLabel = "";

  announcement = "";

  // Flipped on every announcement so that two identical sentences in a row
  // are still two distinct strings — see ANNOUNCEMENT_NONCE above.
  announcementNonce = "";

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

  /**
   * The card's own class list. **Deliberately not `spanClass`** — the card
   * this getter styles is the `<article>` inside this component's own shadow
   * root, and the canvas's six-track grid (`.rstk-nav-sections` in
   * salesforceNavigator.css) is a level up, in the parent's shadow root. A
   * `grid-column` rule reaches nothing written against an element in here:
   * the grid's actual children are the `<c-navigator-section>` hosts, so the
   * span class is applied there instead — `class={section.spanClass}` on
   * `<c-navigator-section>` in salesforceNavigator.html — which is the one
   * place a rule carrying `grid-column` can reach the element the grid
   * actually lays out.
   */
  get cardClass() {
    const classes = ["rstk-nav-section"];
    if (this.grabbed) {
      classes.push("rstk-nav-section_grabbed");
    }
    if (this.isDropTarget) {
      classes.push("rstk-nav-section_droptarget");
    }
    return classes.join(" ");
  }

  /**
   * Whether this card is the one an item would land in if the user let go now.
   * Both halves are required: a drag has to be in flight *and* the pointer has
   * to be over this card. Without the visible answer a cross-section drag is a
   * guess — the item is under the pointer and nothing on screen says which
   * section is about to receive it.
   */
  get isDropTarget() {
    return this.itemDragActive && this.dragDepth > 0;
  }

  /**
   * The sections this card's items could move to — every section but this one
   * — passed straight through from the parent. A section knows nothing about
   * its siblings, so it cannot work this out and does not try.
   */
  get moveTargets() {
    return this.section && this.section.moveTargets
      ? this.section.moveTargets
      : [];
  }

  /**
   * What a screen reader calls this card.
   *
   * The card is `draggable` and reachable by Tab, and an interactive element
   * with no accessible name is announced as nothing at all — the user is
   * barely told it is there, never mind what it holds. The section's own name
   * is what it is; it is read from `section` on every render rather than
   * captured once, so a rename carries to the announcement as well as to the
   * heading.
   *
   * A stored layout can still arrive carrying a blank name — `handleRenameCommit`
   * refuses an all-whitespace rename, but nothing scrubs one that is already
   * stored — and a blank `aria-label` is the same as no label, which is the
   * bug this exists to fix. So a blank falls back to a generic name rather
   * than to nothing.
   */
  get cardLabel() {
    return this.name.trim() ? this.name : "Unnamed section";
  }

  /** The idref and the id both exist only while this card is grabbed. */
  get instructionsId() {
    return this.grabbed
      ? `rstk-nav-section-drag-${this.sectionIndex}`
      : undefined;
  }

  /**
   * A getter rather than the static `"0"` this card used to carry, because a
   * card that cannot be grabbed should not be a tab stop. Left focusable out
   * of edit mode would add one empty stop per section to every keyboard
   * user's journey through a panel whose whole purpose is fast navigation.
   */
  get cardTabIndex() {
    return this.editing ? "0" : "-1";
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

  /**
   * The visible wording on the Add items button, and the same words where the
   * empty-section message points at it.
   *
   * One source for both because they drifted apart once: the button's wording
   * changed and the sentence naming it did not, leaving a message that told
   * the user to use a control that no longer read that way.
   */
  get addItemsText() {
    return ADD_ITEMS;
  }

  /**
   * The rest of the Add items button's accessible name, carried by an
   * assistive-text span inside the button.
   *
   * Every card in the layout has one of these buttons, so a button whose name
   * is only "Add items" leaves the user with a column of identically-named
   * buttons and no way to tell which section they are about to fill — the
   * same reasoning as `menuLabel` on an item and `cardLabel` above. A `title`
   * cannot do this job: a button's accessible name comes from its content
   * before its `title` (HTML-AAM), so a `title` is a pointer tooltip and
   * reaches a screen reader user not at all.
   *
   * It is assistive rather than visible because the header already prints the
   * section's name in its own `<h2>` two elements away: a visible "Add items
   * to Selling" beside a heading reading "Selling" says it twice in a row and
   * roughly doubles the header's intrinsic width. A span inside the button is
   * still the button's content, so the name is "Add items to Selling" either
   * way.
   *
   * The leading space is deliberate and is built here rather than written in
   * the template: template whitespace either side of an expression is
   * collapsed by the compiler, and a name reading "Add itemsto Selling" is
   * the failure that would follow.
   */
  get addItemsAssistive() {
    return ` to ${this.cardLabel}`;
  }

  /**
   * What an emptied section says.
   *
   * In edit mode, both halves of the criterion — that the section is empty,
   * and the way out of it — and the way out is named with the button's own
   * wording rather than a second copy of it. Out of edit mode there is no way
   * out to name: the Add items button this sentence used to point at is
   * itself gated behind edit mode, so pointing at it here would tell the user
   * to press a control that is not on screen. Display mode says only that the
   * section is empty, which is all that stays true.
   */
  get emptyMessage() {
    if (!this.editing) {
      return "This section has no items.";
    }
    return `This section has no items. Use ${ADD_ITEMS} to put tabs you can reach into it.`;
  }

  /**
   * Asks the parent to open the picker for *this* section. The section cannot
   * open it itself and should not try: which tabs are on offer is a fact about
   * the whole layout intersected with the running user's access, and a section
   * knows neither. All it contributes is which section the chosen item lands
   * in, which is the one fact the parent's listener could not supply.
   */
  handleAddItems() {
    this.dispatch("sectionadditems", { index: this.sectionIndex });
  }

  /**
   * An item asking to be taken out of the layout, on its way to the parent.
   * Adds the one fact neither the item nor the parent's listener could supply
   * — which section it is in — and nothing else.
   *
   * The grab is ended on the way out for the same reason `handleItemMoveTo`
   * ends it: the item is about to leave this list, and `reseatOrReleaseGrab`
   * cannot tell that from the tab being withdrawn. Left to it, the card would
   * announce "Move cancelled. X is no longer available." on an assertive
   * region while the parent announced "X removed from Selling." — two regions
   * saying contradictory things about the same gesture, and the false one is
   * the more alarming. It is silent because the parent announces the removal
   * itself, and it releases only the grabbed item's own departure: a
   * *sibling* being removed is not this drag's business, and
   * `reseatOrReleaseGrab` already re-seats the grab across that.
   */
  handleItemRemove(event) {
    this.releaseGrabForDepartingItem(event.detail.index);
    this.dispatch("itemremove", {
      sectionIndex: this.sectionIndex,
      index: event.detail.index
    });
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
    // The grab has already been re-seated or released by the `section` setter,
    // which runs when the list actually changes — so by the time focus is put
    // back, `grabbedItemIndex` names the item the user is holding rather than
    // whatever has slid into that position.
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
    this.dragDepth = 0;

    if (from === undefined) {
      // A drop with no drag of ours behind it began somewhere else — another
      // section's item, or a section card being dragged over this one. An
      // item covers most of a card's surface, so treating it as a drop on
      // this section is what makes the whole card a target; the parent, which
      // is the only thing that can see both kinds of drag, decides what it
      // means. It must never become a move of an item of ours.
      //
      // `itemIndex` is *where in this section* the drop landed. Without it a
      // cross-section drag could only ever append, and the criterion is that
      // the user drops the item "at a chosen position".
      this.dispatch("sectiondrop", {
        index: this.sectionIndex,
        itemIndex: to
      });
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
    this.dragDepth = 0;
    this.dispatch("sectiondragend", { index: this.sectionIndex });
  }

  /**
   * The cross-section move, chosen from an item's own menu rather than
   * dragged. The item knows which destination was picked and its own position;
   * this adds the one fact neither it nor the parent's event listener could
   * supply on its own — which section it is leaving.
   */
  handleItemMoveTo(event) {
    // The item is about to leave this list, and `releaseGrabIfItemGone` cannot
    // tell that from the tab being withdrawn — it would announce "Move
    // cancelled. X is no longer available." while the parent announced "X
    // moved to Support.", two assertive regions contradicting each other, and
    // the false one is the more alarming. Ending the grab here is what makes
    // the difference knowable: a grab released on the way out is a move the
    // section was told about. It is silent because the parent announces the
    // move itself, and it is reachable with a mouse — `navigatorItem`'s
    // `handleClick` blocks navigation mid-grab but not focus, and the menu
    // button is a sibling of the anchor.
    this.releaseGrabForDepartingItem(event.detail.index);
    this.dispatch("itemmoveto", {
      fromSection: this.sectionIndex,
      fromIndex: event.detail.index,
      toSection: event.detail.toSection
    });
  }

  /**
   * An item's own rename, on its way to the parent. This adds the one fact
   * neither the item nor the parent's listener could supply — which section it
   * is in — and nothing else: an empty rename is forwarded exactly as a set
   * one is, because emptying the box is how a user asks for their Salesforce
   * label back, and a section that swallowed it would make that impossible.
   *
   * Nothing about a rename touches the grab, the order or the drag state. It
   * is a display field; the item stays where it is and keeps pointing where it
   * did.
   */
  handleItemRename(event) {
    this.dispatch("itemrename", {
      sectionIndex: this.sectionIndex,
      index: event.detail.index,
      rename: event.detail.rename
    });
  }

  // -------------------------------------------------------------------
  // Reordering this section's items from the keyboard — Salesforce's own
  // dnd-a11y-patterns. Arrow keys deliberately do not cross containers.
  // -------------------------------------------------------------------

  handleItemGrab(event) {
    const index = event.detail.index;

    // A second grab while one is already in flight is refused rather than
    // silently taken. Taking it would overwrite `grabbedItemOrigin`, and the
    // user would then be holding one item with another item's Escape
    // destination — a cancel that puts the wrong thing in the wrong place is
    // worse than a cancel that does nothing. It is reachable with a mouse,
    // not only in theory: `navigatorItem.handleClick` blocks navigation
    // mid-grab but not focus, so a click on a second item can still put focus
    // there and Space would arrive here.
    if (
      this.grabbedItemIndex !== undefined &&
      this.grabbedItemIndex !== index
    ) {
      return;
    }

    const item = this.items[index];
    this.grabbedItemIndex = index;
    this.grabbedItemOrigin = index;
    this.grabbedItemId = item ? item.id : undefined;
    this.grabbedItemLabel = this.labelAt(index);
    this.announce(`${this.labelAt(index)} grabbed. ${this.positionOf(index)}.`);
  }

  handleItemKeyMove(event) {
    const from = event.detail.index;
    const to = from + event.detail.delta;
    const landed = this.landingIndex(from, to);

    this.grabbedItemIndex = landed;
    // Announced even when nothing moved. An arrow press at either end that
    // said nothing would leave a screen reader user unable to tell a key that
    // did not register from one that had nowhere to go. Calling `announce`
    // is not on its own enough to deliver that: two presses at the same end
    // produce the same sentence, and an unchanged string is no DOM write and
    // therefore no announcement, so `announce` distinguishes them — see
    // ANNOUNCEMENT_NONCE.
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

  /**
   * Ends a keyboard grab because the grabbed item is being moved out of this
   * section, rather than because it went missing. Only the grabbed item's own
   * departure releases it: another item leaving is not this drag's business,
   * and dropping the grab silently would strand the user mid-move.
   */
  releaseGrabForDepartingItem(index) {
    if (this.grabbedItemIndex === index) {
      this.releaseGrab();
    }
  }

  releaseGrab() {
    this.grabbedItemIndex = undefined;
    this.grabbedItemOrigin = undefined;
    this.grabbedItemId = undefined;
    this.grabbedItemLabel = "";
  }

  /**
   * Keeps a keyboard grab attached to the *item* it was placed on, and ends it
   * only when that item is genuinely no longer here.
   *
   * `grabbedItemIndex` is a position in the resolved list, and that list is
   * renumbered under a live grab by three things that have nothing to do with
   * this drag: the render-time access intersection dropping a stored id the
   * running user has just lost access to; a *sibling* leaving the section, by
   * its own Move to… menu or by being dragged out; and an item arriving from
   * another section above the one being held. A position that is not re-seated
   * then names a different item, and the user goes on arrowing, dropping and
   * cancelling something they never picked up — or it falls off the end, which
   * is indistinguishable from the item being gone, and the card announces the
   * move cancelled, assertively, about an item still on screen.
   *
   * So identity is what the grab is held by and the index is re-derived from it.
   * `grabbedItemOrigin` moves by the same shift, because Escape means "back to
   * the slot it was picked up from" and that slot renumbers with everything
   * else. Only a grab whose item has actually gone is ended, and that is the
   * one case that is announced — `grabbedItemLabel` is kept alongside the id
   * because by then the item is not in the list to be named from it.
   */
  reseatOrReleaseGrab() {
    if (this.grabbedItemIndex === undefined) {
      return;
    }
    const at = this.items.findIndex((item) => item.id === this.grabbedItemId);
    if (at === -1) {
      this.announce(
        `Move cancelled. ${this.grabbedItemLabel} is no longer available.`
      );
      this.releaseGrab();
      return;
    }
    if (at === this.grabbedItemIndex) {
      return;
    }
    const shift = at - this.grabbedItemIndex;
    this.grabbedItemIndex = at;
    if (this.grabbedItemOrigin !== undefined) {
      this.grabbedItemOrigin = Math.max(
        0,
        Math.min(this.items.length - 1, this.grabbedItemOrigin + shift)
      );
    }
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
    this.announcementNonce = this.announcementNonce ? "" : ANNOUNCEMENT_NONCE;
    this.announcement = message + this.announcementNonce;
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
    // Out of edit mode this card is not a drop target at all. Without this
    // guard the card would still call `preventDefault()` and advertise a
    // "move" cursor for *any* drag passing over it — a file, a link, a text
    // selection, none of them the Navigator's own — which is a drag surface
    // by O1's own definition even though it writes and lights nothing.
    if (!this.editing) {
      return;
    }
    // Without this the browser fires no drop at all.
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  }

  // `dragenter` and `dragleave` both bubble from this card's own contents,
  // which is what makes the counter above the right shape: entering an item
  // inside the card is an enter on the card too, and the pointer has not left
  // until every one of those has been matched by a leave.
  handleCardDragEnter() {
    this.dragDepth += 1;
  }

  handleCardDragLeave() {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
  }

  handleCardDrop(event) {
    event.preventDefault();
    this.dragDepth = 0;
    // A drop on the card itself names no position within it, so none is
    // reported: the parent puts the item at the end of the section. A drop on
    // one of the items *does* name one, and takes the other branch — see
    // `handleItemDrop`.
    this.dispatch("sectiondrop", { index: this.sectionIndex });
  }

  handleCardDragEnd() {
    this.dragDepth = 0;
    this.dispatch("sectiondragend", { index: this.sectionIndex });
  }

  handleCardKeydown(event) {
    // Out of edit mode this card is not a drag source at all — `draggable`
    // is bound to `editing` in the template, which the browser respects for
    // a pointer drag, but `onkeydown` fires whether or not the element is
    // draggable. Without this the Space key would still grab the card from
    // the keyboard, which is exactly the asymmetry
    // `lwc-accessible-interactions.md` exists to catch.
    if (!this.editing) {
      return;
    }

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
