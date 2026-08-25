import { api } from "lwc";
import LightningModal from "lightning/modal";

/**
 * The picker: everything the running user can reach that is not already in
 * their layout, searchable, and adding one puts it in the section the picker
 * was opened from.
 *
 * **It is a `lightning-modal`, composed from the base components.** They adopt
 * SLDS 2 automatically, and the only documented way to break that is our own
 * CSS overriding their internals, which nothing here does — the stylesheet
 * beside this file styles the list and the entries, which have no base
 * component to compose from, and nothing else.
 *
 * **It decides nothing about the layout.** It is handed a list and hands back
 * one id, or nothing at all. Which tabs are on offer is `availableTabs`'s
 * answer and which section receives the chosen one is the parent's — this
 * component cannot get either wrong because it is never told either.
 *
 * **The labels are Salesforce's own, and there is nowhere for a rename to come
 * from.** A rename is a property of a layout entry, and by definition
 * everything on this list has no entry: that is what "not already in the
 * layout" means. So the criterion is satisfied structurally rather than by a
 * rule someone has to remember, and it holds one level up as well — see the
 * note on `availableTabs` in `navigatorLayoutModel`.
 *
 * **Every gesture here is a native control.** The entries are `<button>`s, the
 * search is a `lightning-input` and the cancel is a `lightning-button`, so
 * they are in the tab order and activate on Enter and Space without this
 * component writing a single key handler. Escape is the base component's own
 * and is deliberately not reimplemented here: `LightningModal` closes on it
 * with `undefined`, which is the "adds nothing" half, and a second handler of
 * ours would close it twice.
 */
export default class NavigatorItemPicker extends LightningModal {
  /**
   * The tabs on offer, as `{id, label}`. Supplied by the parent from
   * `availableTabs`, which is the only thing that knows both the layout and
   * the running user's accessible set.
   */
  @api availableItems = [];

  /**
   * The name of the section the picker was opened from. Display only — the
   * parent keeps the section's *index* and applies the add against it, so
   * nothing about where the item lands travels through this component.
   */
  @api sectionName = "";

  /**
   * What the user has typed. Transient UI: it filters what is on screen and
   * reaches nothing else, and it is deliberately not a `@api` — a search term
   * is not something the parent has an opinion about.
   */
  searchTerm = "";

  hasFocusedSearch = false;

  get term() {
    return (this.searchTerm || "").trim().toLowerCase();
  }

  /**
   * The entries actually on screen. With 174 items in a bare org a scrolling
   * list alone fails the user, which is what the search box is for — and it
   * matches on any part of the label rather than only the start, because a
   * user looking for "Purchase Orders" is as likely to type "orders".
   */
  get visibleItems() {
    const term = this.term;
    return (this.availableItems || [])
      .filter(
        (item) => !term || String(item.label).toLowerCase().indexOf(term) !== -1
      )
      .map((item) => ({
        id: item.id,
        label: item.label,
        // A column of buttons all announced as "Add" leaves a screen reader
        // user unable to tell which one they are on, and naming the
        // destination is what makes the button say what choosing it does.
        assistiveLabel: `Add ${item.label} to ${this.sectionName}`
      }));
  }

  get hasMatches() {
    return this.visibleItems.length > 0;
  }

  /**
   * Whether there was anything to offer *before* the search narrowed it. The
   * two empty states are different facts and need different words: "nothing
   * matches what you typed" is fixed by typing something else, and "everything
   * you can reach is already here" is not fixed by anything.
   */
  get hasAvailable() {
    return (this.availableItems || []).length > 0;
  }

  get heading() {
    return `Add items to ${this.sectionName}`;
  }

  get noMatchMessage() {
    return `No item matches “${(this.searchTerm || "").trim()}”.`;
  }

  handleSearch(event) {
    this.searchTerm = event.detail.value;
  }

  /**
   * Reads the id off the entry that was activated rather than an index into
   * `availableItems`. That is load-bearing once a search is in play: entry 0
   * of the filtered list is not entry 0 of the full one, so an index would add
   * a tab the user never pointed at.
   */
  handleAdd(event) {
    this.close(event.currentTarget.dataset.id);
  }

  handleCancel() {
    this.close(undefined);
  }

  renderedCallback() {
    // Focus follows the modal into the search box, or the picker opens with
    // focus nowhere useful and a keyboard user has to tab past the heading to
    // reach the one control that makes 174 items usable. Once only: putting
    // it back on every render would drag focus off an entry the user had
    // arrowed to.
    if (this.hasFocusedSearch) {
      return;
    }
    const search = this.template.querySelector("lightning-input");
    if (search) {
      this.hasFocusedSearch = true;
      search.focus();
    }
  }
}
