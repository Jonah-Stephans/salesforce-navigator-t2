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
  moduleNameMapper: {
    "^lightning/navigation$": "<rootDir>/test/jest-mocks/lightning/navigation"
  }
};
