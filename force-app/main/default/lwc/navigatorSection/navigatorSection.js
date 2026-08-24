import { LightningElement, api } from "lwc";
import { MIN_COLUMNS, MAX_COLUMNS } from "c/navigatorLayoutModel";

const RENAME = "rename";
const DELETE = "delete";
const COLUMNS_PREFIX = "columns-";

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

  isRenaming = false;
  draftName = "";

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
   * Section edits travel as primitives — an index and a value — never as a
   * layout object. The parent owns the layout; handing it a reference into
   * this component's state would let either side mutate the other's.
   */
  dispatch(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail }));
  }
}
