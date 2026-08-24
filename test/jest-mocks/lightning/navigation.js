/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 *
 * Adapted from the lwc-recipes `lightning/navigation` jest mock
 * (https://github.com/trailheadapps/lwc-recipes/blob/main/jest-mocks/lightning/navigation.js).
 *
 * Placed at repo-root `test/jest-mocks/`, not under `force-app/`, per this
 * repo's own `.forceignore` convention that the jest harness must never reach
 * a packaged org — and wired in via `moduleNameMapper` in `jest.config.js`.
 *
 * Unlike the built-in `@salesforce/sfdx-lwc-jest` stub for this module, whose
 * `Navigate` is a no-op recording nothing, this mock records every call so a
 * test can assert on it via `getNavigateCalledWith()`.
 */
const Navigate = jest.fn();
// Resolves to a value that cannot be confused with the "#" default a
// consuming component may render with before this promise settles — if
// the default and the resolved value were the same string, no test could
// tell "the component applied the resolved URL" apart from "the
// component never applied anything and the default is still sitting
// there".
const GenerateUrl = jest.fn(() => Promise.resolve("/lightning/o/Account/home"));

const NavigationMixin = (Base) => {
  return class extends Base {
    [NavigationMixin.Navigate](...args) {
      Navigate(...args);
    }
    [NavigationMixin.GenerateUrl](...args) {
      return GenerateUrl(...args);
    }
  };
};
NavigationMixin.Navigate = Symbol("Navigate");
NavigationMixin.GenerateUrl = Symbol("GenerateUrl");

const CurrentPageReference = jest.fn();
const NavigationContext = jest.fn();

/**
 * Returns the arguments of the most recent `NavigationMixin.Navigate` call,
 * or `undefined` if it was never called. Mirrors the lwc-recipes helper so a
 * test can assert the emitted `pageReference` is exactly what a component
 * passed in, unmodified.
 */
function getNavigateCalledWith() {
  if (Navigate.mock.calls.length === 0) {
    return undefined;
  }

  const lastCallArguments = Navigate.mock.calls[Navigate.mock.calls.length - 1];
  const pageReference = lastCallArguments[0];
  const replace = lastCallArguments.length > 1 ? lastCallArguments[1] : false;

  return {
    pageReference,
    replace
  };
}

/**
 * Returns the arguments of the most recent `NavigationMixin.GenerateUrl`
 * call, or `undefined` if it was never called.
 */
function getGenerateUrlCalledWith() {
  if (GenerateUrl.mock.calls.length === 0) {
    return undefined;
  }
  return GenerateUrl.mock.calls[GenerateUrl.mock.calls.length - 1][0];
}

export {
  NavigationMixin,
  CurrentPageReference,
  NavigationContext,
  getNavigateCalledWith,
  getGenerateUrlCalledWith,
  // Exported directly (rather than requiring `jest.spyOn` on the
  // symbol-keyed prototype method) so a test can drive a pending or
  // rejected resolution: `GenerateUrl.mockReturnValueOnce(...)` /
  // `mockRejectedValueOnce(...)`. `jest.spyOn(SomeComponent.prototype,
  // NavigationMixin.GenerateUrl)` does not work here — the LWC compiler's
  // class output defines that computed-key method as non-writable, so the
  // plain assignment `jest.spyOn` performs throws
  // `TypeError: Cannot assign to read only property 'Symbol(GenerateUrl)'`.
  // `GenerateUrl` is already the single `jest.fn()` every component's
  // mixin method delegates to, so overriding it here reaches every caller
  // without touching any prototype.
  GenerateUrl
};
