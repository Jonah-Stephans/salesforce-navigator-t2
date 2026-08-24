/**
 * The one file in this component that knows where the running user's
 * accessible tabs come from — its config shape, its pagination math, and
 * the reasoning behind the choice. `getNavItems` (`lightning/uiAppsApi`) is
 * chosen over the GA alternative, `TabDefinition`, because `TabDefinition`
 * has no `pageReference` at all — this component would then have to
 * hand-derive a navigation target from a tab's name, and a live org
 * returned five distinct `pageReference` types across 174 nav items, two of
 * which (`standard__cmsPage`, `standard__directCmpReference`) are not on the
 * documented PageReference Types page at all. A hand-derived branch cannot
 * know about those and would mis-navigate them silently.
 *
 * `getNavItems` carries Salesforce's "not for production use" Beta
 * disclaimer. It was chosen anyway, and this module is the mitigation: if it
 * must later move to a supported basis, this is the one file that changes,
 * and any tab kind the replacement cannot represent must then be omitted,
 * never guessed at.
 *
 * Pagination is mandatory, not optional: `pageSize` caps at 100 on the
 * platform side, and a bare scratch org already returns more nav items than
 * that.
 *
 * One exception to "the only file that knows": `getNavItems` itself is not
 * re-exported from here. Salesforce's own `@lwc/eslint-plugin-lwc` config
 * lists `lightning/uiAppsApi`'s `getNavItems` under
 * `no-unexpected-wire-adapter-usages`'s restricted-use adapters, which
 * forbids assigning, passing, or re-exporting it anywhere other than as the
 * literal first argument of an `@wire` decorator — so the consuming
 * component imports `getNavItems` directly from `lightning/uiAppsApi` for
 * that one decorator call, and everything else about the source (this
 * config, the pagination math, the reasoning above) still lives here.
 */

// The platform's own cap. Asking for more is silently reduced by the
// platform, which would make the cap invisible to code that asked for more.
export const MAX_PAGE_SIZE = 100;

// Every nav item kind so this enumerates the same set the App Launcher's All
// Items list draws from, not merely standard object tabs. Exported, rather
// than kept local, so the @wire config literal in the consuming component
// can reference it directly instead of duplicating the string.
export const NAV_ITEM_TYPES =
  "Standard,Custom,LightningComponent,LightningPage,AllPages";

export const NAV_ITEMS_CONFIG = {
  formFactor: "Large",
  navItemType: NAV_ITEM_TYPES,
  scope: "visible",
  pageSize: MAX_PAGE_SIZE
};

/**
 * True when a `getNavItems` response has not yet reached the end of the
 * running user's accessible tabs.
 *
 * Verified against a live org: the platform's response carries no total
 * `count` at all — its shape is `{ currentPageUrl, eTag, navItems,
 * nextPageUrl }`, and `nextPageUrl` is present only when a further page
 * exists (`null` on the last page). That presence is the only pagination
 * signal the platform actually gives; a page/pageSize/count arithmetic
 * against a field the platform never returns would silently stop after
 * page 0 in production while still looking correct against a test that
 * fabricates a `count`.
 */
export function hasMorePages(data) {
  return Boolean(data?.nextPageUrl);
}
