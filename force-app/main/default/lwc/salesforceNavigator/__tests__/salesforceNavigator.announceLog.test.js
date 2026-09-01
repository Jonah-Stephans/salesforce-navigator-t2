import { createElement } from "lwc";
import SalesforceNavigator from "c/salesforceNavigator";
import { getNavItems } from "lightning/uiAppsApi";
import { SCHEMA_VERSION } from "c/navigatorLayoutModel";
import getLayouts from "@salesforce/apex/NavigatorLayoutController.getLayouts";
import createLayout from "@salesforce/apex/NavigatorLayoutController.createLayout";
import updateLayout from "@salesforce/apex/NavigatorLayoutController.updateLayout";
import activateLayout from "@salesforce/apex/NavigatorLayoutController.activateLayout";
import renameLayout from "@salesforce/apex/NavigatorLayoutController.renameLayout";
import deleteLayout from "@salesforce/apex/NavigatorLayoutController.deleteLayout";

// A file of its own, and the reason is mechanical rather than stylistic —
// the same reason `salesforceNavigator.smallFormFactor.test.js` is its own
// file, per its own header comment. `## Traps`' newest entry ("a live
// region's last write in a tick wins") says the only assertion that can
// catch a synchronous `announce()` call being overwritten before it ever
// renders is the announce *call log*, because the collapse happens before
// any render — no rendered-text assertion can see it, and
// `announcementNonce`'s own parity only constrains the count modulo two, not
// to one. Reading the call log means wrapping
// `SalesforceNavigator.prototype.announce`, and that has to happen before
// this component's *first* instance is ever created anywhere in the process:
// LWC freezes a component's prototype the moment its first instance exists
// (checked directly — `Object.getOwnPropertyDescriptor` reports
// non-writable, non-configurable after `createElement`+`appendChild`), and
// `salesforceNavigator.test.js` has already mounted 558 tests' worth by the
// time any test in it could run. A module-scope wrap here, before this
// file's own first `createElement`, works precisely because this file's
// prototype has never been touched.
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.getLayouts",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.createLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.updateLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.activateLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.renameLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);
jest.mock(
  "@salesforce/apex/NavigatorLayoutController.deleteLayout",
  () => ({ default: jest.fn() }),
  { virtual: true }
);

// The call log itself. Installed once, at module scope, before any test in
// this file runs and therefore before this file's first `createElement` —
// which is what makes the assignment succeed at all (see the header comment
// above). Forwards to the original implementation so `this.announcement` /
// `this.announcementNonce` still update exactly as they do in production;
// this wrap only ever adds an observer, never changes behaviour.
let announced = [];
const originalAnnounce = SalesforceNavigator.prototype.announce;
SalesforceNavigator.prototype.announce = function wrappedAnnounce(message) {
  announced.push(message);
  return originalAnnounce.call(this, message);
};

// The five sentences under test, copied verbatim from salesforceNavigator.js
// rather than imported — none of them is exported, and duplicating five
// string literals is not the kind of shared logic
// `.claude/rules/rstk-dry-enforcement.md` exists to guard, the same
// judgement the "entering and leaving edit mode" describe in
// salesforceNavigator.test.js already makes for its own local copies.
const WRITE_LOCK_ANNOUNCEMENT =
  "Saving. Save, New layout, Rename layout and Delete layout are unavailable until this finishes.";
const SAVE_EDIT_ANNOUNCEMENT = "Changes saved. Edit mode off.";

const ACCOUNT_ITEM = {
  developerName: "Account",
  label: "Accounts",
  pageReference: {
    type: "standard__objectPage",
    attributes: { objectApiName: "Account", actionName: "home" },
    state: {}
  }
};

const EXISTING_LAYOUT_ID = "a0X000000000001AAA";
const CREATED_LAYOUT_ID = "a0X000000000002AAA";

function storedPayload() {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    sections: [{ name: "Daily work", columns: 3, items: [{ id: "Account" }] }]
  });
}

function storedRow() {
  return {
    layoutId: EXISTING_LAYOUT_ID,
    name: "My Navigator",
    isActive: true,
    isReadable: true,
    layoutJson: storedPayload()
  };
}

function createNavigator() {
  const element = createElement("c-salesforce-navigator", {
    is: SalesforceNavigator
  });
  document.body.appendChild(element);
  return element;
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function mountWithTabs() {
  const element = createNavigator();
  getNavItems.emit({ navItems: [ACCOUNT_ITEM] });
  await flush();
  await flush();
  return element;
}

const EDIT_AFFORDANCE = "lightning-button-icon.rstk-nav-edit";
const NEW_SECTION_BUTTON = "lightning-button.rstk-nav-new-section";
const EDIT_SAVE_BUTTON = "lightning-button.rstk-nav-edit-save";

async function enterEditMode(element) {
  element.shadowRoot.querySelector(EDIT_AFFORDANCE).click();
  await flush();
}

async function addSection(element) {
  element.shadowRoot.querySelector(NEW_SECTION_BUTTON).click();
  await flush();
}

function layoutMenu(element) {
  return element.shadowRoot.querySelector("lightning-button-menu");
}

function selectLayoutMenu(element, value) {
  layoutMenu(element).dispatchEvent(
    new CustomEvent("select", { detail: { value } })
  );
}

function promptInput(element) {
  return element.shadowRoot.querySelector(".rstk-nav-layout-prompt__input");
}

/**
 * Types and commits a layout name — deliberately with no `await` inside it,
 * unlike every other helper in this file. The whole point of the tests that
 * call this one is to inspect `announced` in the same synchronous tick the
 * commit ran in, before this component's own code has yielded to a promise;
 * an `await` here would let that yield happen before the caller ever gets a
 * chance to look.
 */
function commitLayoutNameSync(element, name) {
  const input = promptInput(element);
  input.dispatchEvent(new CustomEvent("change", { detail: { value: name } }));
  input.dispatchEvent(new CustomEvent("commit"));
}

function promptButton(element, label) {
  return Array.from(
    element.shadowRoot.querySelectorAll(
      ".rstk-nav-layout-prompt lightning-button"
    )
  ).find((button) => button.label === label);
}

describe("c-salesforce-navigator's announce() call log", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    announced = [];
    getLayouts.mockResolvedValue([]);
    createLayout.mockResolvedValue({
      layoutId: CREATED_LAYOUT_ID,
      name: "My Navigator",
      isActive: true
    });
    updateLayout.mockResolvedValue({});
    activateLayout.mockResolvedValue([]);
    renameLayout.mockResolvedValue({});
    deleteLayout.mockResolvedValue([]);
  });

  afterEach(async () => {
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    jest.runOnlyPendingTimers();
    await flush();
    await flush();
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // The mechanical check `## Traps`' newest entry asks for: every
  // `beginWrite(` call site, and whether a `this.announce(` follows it in
  // the same body before any `await`, `.then()` or `return`. There are five.
  // Two do: `handleEditSave` (by decision — `announceLock: false` — covered
  // by the last test below) and `renameCurrentLayout`'s no-`layoutId`
  // branch, which did *not* decide to and is the fix this file exists to
  // pin (the second test below). The other three — `createNewLayout`, the
  // with-row half of `renameCurrentLayout`, and `deleteCurrentLayout` — each
  // reach a `.then()` immediately after `beginWrite()`, so their own outcome
  // is never in the same synchronous stack at all; pinned here too, so a
  // future change that moved one of *their* outcomes back onto the
  // synchronous stack would be caught the same way.
  // -----------------------------------------------------------------------

  it("createNewLayout's busy announcement survives to render, and the outcome supersedes it only once the create settles", async () => {
    let releaseCreate;
    createLayout.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCreate = () =>
            resolve({
              layoutId: CREATED_LAYOUT_ID,
              name: "Weekly review",
              isActive: true
            });
        })
    );
    const element = await mountWithTabs();
    await enterEditMode(element);

    selectLayoutMenu(element, "new-layout");
    await flush();
    // Cleared here, not only in `beforeEach`: entering edit mode and opening
    // the menu each announce their own thing first, and this test's claim is
    // about the commit alone.
    announced = [];
    commitLayoutNameSync(element, "Weekly review");

    // Nothing has been awaited since the commit. Only `beginWrite()`'s own
    // synchronous call has had a chance to run.
    expect(announced).toEqual([WRITE_LOCK_ANNOUNCEMENT]);

    // `createLayout` itself is only called once the save chain's own
    // `.then()` runs, which needs a tick — `releaseCreate` does not exist
    // until it has.
    await flush();
    releaseCreate();
    await flush();
    await flush();

    expect(announced).toEqual([
      WRITE_LOCK_ANNOUNCEMENT,
      "Weekly review created and now showing."
    ]);
  });

  it("a no-row rename's busy announcement survives to render, and the outcome supersedes it only once the write settles", async () => {
    // The fix this file exists to pin. Before it, this branch called
    // `this.announce()` synchronously, five lines below `beginWrite()`, with
    // no `await`/`.then()`/`return` between them — so the busy message was
    // gone before any render, and because this branch (unlike Save) never
    // leaves edit mode, nothing else ever told the user their rename had
    // landed either.
    let releaseCreate;
    createLayout.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseCreate = () =>
            resolve({
              layoutId: CREATED_LAYOUT_ID,
              name: "Renamed",
              isActive: true
            });
        })
    );
    const element = await mountWithTabs();
    await enterEditMode(element);

    selectLayoutMenu(element, "rename-layout");
    await flush();
    announced = [];
    commitLayoutNameSync(element, "Renamed");

    expect(announced).toEqual([WRITE_LOCK_ANNOUNCEMENT]);

    await flush();
    releaseCreate();
    await flush();
    await flush();

    expect(announced).toEqual([
      WRITE_LOCK_ANNOUNCEMENT,
      "Layout renamed to Renamed."
    ]);
  });

  it("a with-row rename's busy announcement survives to render, and the outcome supersedes it only once the rename settles", async () => {
    let releaseRename;
    renameLayout.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseRename = () =>
            resolve({ layoutId: EXISTING_LAYOUT_ID, name: "Renamed" });
        })
    );
    getLayouts.mockResolvedValue([storedRow()]);
    const element = await mountWithTabs();
    await enterEditMode(element);

    selectLayoutMenu(element, "rename-layout");
    await flush();
    announced = [];
    commitLayoutNameSync(element, "Renamed");

    expect(announced).toEqual([WRITE_LOCK_ANNOUNCEMENT]);

    await flush();
    releaseRename();
    await flush();
    await flush();

    expect(announced).toEqual([
      WRITE_LOCK_ANNOUNCEMENT,
      "Layout renamed to Renamed."
    ]);
  });

  it("deleteCurrentLayout's busy announcement survives to render, and the outcome supersedes it only once the delete settles", async () => {
    let releaseDelete;
    deleteLayout.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseDelete = () => resolve([]);
        })
    );
    getLayouts.mockResolvedValue([storedRow()]);
    const element = await mountWithTabs();
    await enterEditMode(element);

    selectLayoutMenu(element, "delete-layout");
    await flush();
    // Opening the confirmation itself announces `layoutDeleteMessage` — not
    // this test's concern.
    announced = [];
    promptButton(element, "Delete layout").click();

    expect(announced).toEqual([WRITE_LOCK_ANNOUNCEMENT]);

    await flush();
    releaseDelete();
    await flush();
    await flush();

    // The store comes back empty, so `adoptFromStore` lands on the default
    // seeded name.
    expect(announced).toEqual([
      WRITE_LOCK_ANNOUNCEMENT,
      "Layout deleted. Now showing My Navigator."
    ]);
  });

  it("Save announces exactly once, and it is the outcome, never the busy message", async () => {
    // Task 2. `announcementNonce`'s own parity (the pin
    // salesforceNavigator.test.js reaches for, in a file that has already
    // mounted 558 instances and so cannot spy on or wrap `announce`) only
    // constrains the announcement count modulo two, not to one — three
    // calls ending on the outcome would leave that pin green too. The call
    // log this file makes possible pins the stronger claim directly.
    let releaseUpdate;
    updateLayout.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseUpdate = () =>
            resolve({ layoutId: EXISTING_LAYOUT_ID, isActive: true });
        })
    );
    getLayouts.mockResolvedValue([storedRow()]);
    const element = await mountWithTabs();
    await enterEditMode(element);
    await addSection(element);
    // Entering edit mode already announced its own entry sentence — not
    // this test's concern.
    announced = [];

    element.shadowRoot.querySelector(EDIT_SAVE_BUTTON).click();

    expect(announced).toEqual([SAVE_EDIT_ANNOUNCEMENT]);

    await flush();
    releaseUpdate();
    await flush();
    await flush();

    // `endWrite()` announces nothing of its own; the log does not grow.
    expect(announced).toEqual([SAVE_EDIT_ANNOUNCEMENT]);
  });
});
