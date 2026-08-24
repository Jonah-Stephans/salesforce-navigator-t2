import { LightningElement, api } from "lwc";
import { NavigationMixin } from "lightning/navigation";

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
}
