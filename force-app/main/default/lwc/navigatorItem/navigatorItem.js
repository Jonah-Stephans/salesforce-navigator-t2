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

  url;

  connectedCallback() {
    this[NavigationMixin.GenerateUrl](this.pageReference)
      .then((url) => {
        this.url = url;
      })
      .catch(() => {
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
