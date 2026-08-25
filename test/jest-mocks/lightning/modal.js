/**
 * A jest mock for `lightning/modal`.
 *
 * Unlike `lightning/navigation`, this module has **no stub at all** in
 * `@salesforce/sfdx-lwc-jest` — its `lightning-stubs` directory ships
 * `modalBody`, `modalFooter` and `modalHeader` and no `modal`. So the
 * resolver falls through and `import LightningModal from "lightning/modal"`
 * fails to resolve outright: without this file the picker bundle cannot even
 * be imported by a test, never mind driven by one.
 *
 * Placed at repo-root `test/jest-mocks/`, not under `force-app/`, per this
 * repo's own `.forceignore` convention that the jest harness must never reach
 * a packaged org — and wired in via `moduleNameMapper` in `jest.config.js`,
 * exactly as the `lightning/navigation` mock beside it is.
 *
 * **It mounts the real component rather than standing in for it.** A mock
 * whose `open()` merely recorded its arguments and handed back a controllable
 * promise would leave every assertion about the picker's *contents* — what it
 * lists, what the search box finds, what a click on an entry does — driven
 * entirely by synthetic events against a component nothing ever rendered.
 * That is the shape of blind spot this spec has now found three times: "the
 * handler does the right thing when told" and "the user can find this" are
 * two different facts. So `open()` here does what the platform's does: it
 * creates the component, applies the config as properties, puts it in the
 * document, and returns a promise that settles with whatever the instance
 * passes to `close()`.
 *
 * **No decorators.** This file is linted by the flat config's plain-JS
 * `jest-mocks` entry, which has no decorator-aware parser, so the bridge from
 * `open()` to `close()` is a `WeakMap` keyed on the host element — reached
 * through `this.template.host` — rather than an `@api` property. Nothing is
 * lost by it: the platform's own base does the same wiring internally.
 *
 * **What this is not.** It is *our* reading of the base component's documented
 * contract, not the platform's implementation. Two behaviours below are
 * asserted by tests and are this file's rather than Salesforce's: that Escape
 * closes the modal with `undefined`, and that `close()` settles the `open()`
 * promise exactly once. Both are documented `LightningModal` behaviour and
 * neither is verified here against a real org.
 */
import { LightningElement, createElement } from "lwc";

/**
 * Every modal this mock has mounted and not yet closed, so a test can find
 * the picker in the document without knowing the tag name `open()` chose.
 */
let openModals = [];

/**
 * host element → `{resolve, settled}`. `settled` lives here rather than on the
 * handle a component could reach because `close()` must be idempotent, which
 * is the platform's own behaviour: a modal already dismissed cannot be
 * dismissed a second time with a different result.
 */
const handles = new WeakMap();

/**
 * The base component's own public surface, as distinct from a subclass's
 * `@api` properties. These four are declared on the class below rather than on
 * the picker, and `element[key] = config[key]` reaches a component only for
 * `@api` properties — so applied that way they landed as unknown
 * own-properties on the host (LWC logs "Unknown public property" for each) and
 * the component never saw them. `disableClose` in particular was accepted and
 * silently ignored, so `open({disableClose: true})` followed by Escape closed
 * the modal anyway: a mock passing for the wrong reason.
 *
 * They are carried on the side instead, keyed on the host, and adopted by the
 * instance in `connectedCallback` — which is the same shape as the `handles`
 * bridge above and for the same reason: this file is linted by the flat
 * config's plain-JS `jest-mocks` entry, which has no decorator-aware parser,
 * so `@api` cannot be written here.
 */
const BASE_CONFIG_KEYS = ["label", "size", "description", "disableClose"];

/** host element -> the base-class config `open()` was called with. */
const configs = new WeakMap();

/**
 * What a component asked the base for, so a test can assert the dialog's
 * accessible name and its size rather than take them on trust.
 */
export function configOf(host) {
  return configs.get(host) || {};
}

export function getOpenModals() {
  return openModals.slice();
}

/**
 * Registers a directly-mounted modal so `close()` has somewhere to report to.
 * `open()` does this itself; a test that mounts the component with
 * `createElement` — which is how the picker's own suite drives it, without a
 * parent in the way — calls this instead.
 */
export function trackModal(host, resolve) {
  handles.set(host, { resolve, settled: false });
}

/**
 * Forgets every modal still standing. A test that leaves one open would
 * otherwise hand it to the next test, which is the same class of leak the
 * navigator suite's `afterEach` closes for a pending autosave.
 */
export function resetModals() {
  openModals = [];
}

export default class LightningModal extends LightningElement {
  // The platform's public surface. Plain fields rather than `@api` for the
  // parser reason above; `open()` routes them through `configs` instead, and
  // `connectedCallback` adopts them below, so the instance really does hold
  // what the caller asked for.
  label;
  size;
  description;
  disableClose = false;

  connectedCallback() {
    // Adopt the base-class config before anything reads it. `open()` records
    // it against the host before appending, so it is here by now; a modal
    // mounted directly with `createElement` has none and keeps its defaults.
    const config = configs.get(this.template.host);
    if (config) {
      BASE_CONFIG_KEYS.forEach((key) => {
        if (key in config) {
          this[key] = config[key];
        }
      });
    }

    // The base component's own Escape handling. A listener on the host rather
    // than inside a template, because the subclass owns the template and the
    // platform's base owns this behaviour — a picker that handled Escape
    // itself would be duplicating the base and would close twice.
    this.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !this.disableClose) {
        this.close(undefined);
      }
    });
  }

  close(result) {
    const host = this.template.host;
    const handle = handles.get(host);
    if (!handle || handle.settled) {
      return;
    }
    handle.settled = true;
    openModals = openModals.filter((element) => element !== host);
    if (host.parentNode) {
      host.parentNode.removeChild(host);
    }
    handle.resolve(result);
  }

  static open(config = {}) {
    const element = createElement("c-lightning-modal", { is: this });
    const baseConfig = {};
    Object.keys(config).forEach((key) => {
      if (BASE_CONFIG_KEYS.indexOf(key) !== -1) {
        // The base's own, which no amount of host assignment would reach.
        baseConfig[key] = config[key];
      } else {
        // The subclass's `@api` properties, which host assignment does reach.
        element[key] = config[key];
      }
    });
    configs.set(element, baseConfig);

    return new Promise((resolve) => {
      trackModal(element, resolve);
      document.body.appendChild(element);
      openModals = openModals.concat([element]);
    });
  }
}
