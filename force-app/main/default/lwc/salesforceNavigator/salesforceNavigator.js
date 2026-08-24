import { LightningElement, wire } from "lwc";
// getNavItems is imported directly from its platform module, rather than
// through c/navigatorTabSource, because Salesforce's own eslint config
// (no-unexpected-wire-adapter-usages) restricts it to appearing only as the
// literal first argument of an @wire decorator — see the note in
// navigatorTabSource.js. Everything else about the source — its config
// shape, the pagination math, and the reasoning behind the choice — still
// lives in that one file.
import { getNavItems } from "lightning/uiAppsApi";
import {
  NAV_ITEMS_CONFIG,
  hasMorePages,
  normalizeNavItems
} from "c/navigatorTabSource";

const GENERIC_ERROR_MESSAGE =
  "We could not load your tabs. Try reloading the page.";

/**
 * The Navigator tab's top-level component. This slice renders a flat list
 * of every tab the running user can reach and lets them click through to
 * one — sections, columns, drag-and-drop and per-user persistence belong to
 * later slices.
 */
export default class SalesforceNavigator extends LightningElement {
  page = 0;
  items = [];
  errorMessage;
  isLoading = true;

  // Indexed by page number rather than appended to, so that a wire
  // re-emission for a page already received (an LDS cache refresh
  // redelivering the current, possibly final, page — a normal event for a
  // UI API adapter) overwrites that page's slot instead of duplicating it.
  // `this.page` alone cannot tell "next page" from "same page, redelivered"
  // once pagination has finished advancing, but the page number a response
  // belongs to can.
  pages = [];

  // `page` is the only reactive piece of the wire config — LWC's wire
  // adapter reactivity tracks direct field reassignment of the values named
  // by a `'$fieldName'` config property, not values derived inside a getter
  // or a spread of an object field.
  @wire(getNavItems, {
    formFactor: NAV_ITEMS_CONFIG.formFactor,
    navItemType: NAV_ITEMS_CONFIG.navItemType,
    scope: NAV_ITEMS_CONFIG.scope,
    pageSize: NAV_ITEMS_CONFIG.pageSize,
    page: "$page"
  })
  wiredNavItems({ data, error }) {
    if (data) {
      this.errorMessage = undefined;
      this.pages[this.page] = normalizeNavItems(data);
      this.items = this.pages.flat();

      if (hasMorePages(data)) {
        this.page += 1;
      } else {
        this.isLoading = false;
      }
    } else if (error) {
      this.isLoading = false;
      this.items = [];
      this.errorMessage = SalesforceNavigator.reduceError(error);
    }
  }

  static reduceError(error) {
    if (Array.isArray(error?.body)) {
      return (
        error.body.map((e) => e.message).join(", ") || GENERIC_ERROR_MESSAGE
      );
    }
    if (typeof error?.body?.message === "string") {
      return error.body.message;
    }
    return GENERIC_ERROR_MESSAGE;
  }

  get hasError() {
    return Boolean(this.errorMessage);
  }

  get hasItems() {
    return !this.isLoading && !this.hasError && this.items.length > 0;
  }

  get isEmpty() {
    return !this.isLoading && !this.hasError && this.items.length === 0;
  }
}
