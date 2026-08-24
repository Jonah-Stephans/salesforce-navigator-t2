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
  // `GenerateUrl` has settled at all. `connectedCallback` below only ever
  // upgrades this value on success; it must never be cleared back to
  // `undefined`, or the anchor stops being a link.
  url = "#";

  connectedCallback() {
    this[NavigationMixin.GenerateUrl](this.pageReference)
      .then((url) => {
        this.url = url;
      })
      .catch(() => {
        // Leave `url` at its current value (the "#" default, since
        // GenerateUrl never resolved) rather than blanking it out. A
        // rejected GenerateUrl must not turn a real link into a bare `<a>`
        // with no `href` — that would drop it from the tab order, remove
        // its link role, and lose native middle-click/"open in new tab",
        // which is the entire mechanism the "real link" criterion relies
        // on.
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
