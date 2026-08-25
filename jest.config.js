const { jestConfig } = require("@salesforce/sfdx-lwc-jest/config");

module.exports = {
  ...jestConfig,
  modulePathIgnorePatterns: ["<rootDir>/.localdevserver"],
  // Without this, `lightning/navigation` resolves to the sfdx-lwc-jest
  // built-in stub, whose `Navigate` is a no-op that records nothing — the
  // repo cannot assert navigation. The replacement lives at repo-root
  // test/jest-mocks/, not under force-app/, per this repo's own
  // .forceignore convention that the jest harness must never reach a
  // packaged org.
  // `lightning/modal` is a harder case than `lightning/navigation`: it has no
  // built-in stub at all — sfdx-lwc-jest ships `modalBody`, `modalFooter` and
  // `modalHeader` and no `modal` — so without this entry the resolver falls
  // through and the picker bundle cannot be imported by a test at all. The
  // mock mounts the real component rather than standing in for it; see the
  // note at the top of the file.
  moduleNameMapper: {
    "^lightning/navigation$": "<rootDir>/test/jest-mocks/lightning/navigation",
    "^lightning/modal$": "<rootDir>/test/jest-mocks/lightning/modal"
  }
};
