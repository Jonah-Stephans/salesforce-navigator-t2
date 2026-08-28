---
paths:
  - "**/lwc/**/*.css"
  - "**/lwc/**/*.html"
---

# SLDS 2.0 UX Standards

Rootstock aligns all custom LWC styling to the Salesforce SLDS 2.0 design system. These rules are mandatory for all new and modified components.

## Core Principle: Styling Hooks, Not Hardcoded Values

SLDS 2.0 uses CSS custom properties (styling hooks) prefixed with `--slds-g-`. **Never hardcode** colors, font sizes, spacing, sizing, border widths, radii, or shadows. Always use the corresponding styling hook.

### Always write `var(--hook, fallback)`

A bare `var(--slds-g-*)` is a lint failure, not a style preference: `no-slds-var-without-fallback`
fires on every one of them, and `npm run lint` runs with `--max-warnings 0`. Styling hooks are
unavailable in some Salesforce environments, and the fallback is what renders there. Every example
below carries one, and so must your CSS.

The linter tells you the right fallback in the message it prints — take the value from there rather
than inventing one. Fallbacks in this document are the linter's own suggestions.

```css
/* WRONG — hardcoded */
.container { color: #747474; font-size: 14px; padding: 16px; }

/* WRONG — hook, but no fallback */
.container { color: var(--slds-g-color-on-surface-1); }

/* RIGHT */
.container {
  color: var(--slds-g-color-on-surface-1, #747474);
  font-size: var(--slds-g-font-scale-1, 0.875rem);
  padding: var(--slds-g-spacing-4, 1rem);
}
```

### Never author against `--slds-c-*`, `--slds-s-*`, `--lwc-*` or `--sds-*`

`--slds-g-*` is the only authoring target. `--slds-c-*` component hooks are unsupported under SLDS 2
and the linter does **not** catch them, so that one is on review. `--slds-s-*` and `--_slds-*` are
Salesforce-internal. `--lwc-*` and `--sds-*` are both deprecated, but the linter does **not** grade
them alike: `lwc-token-to-slds-hook` ships at **error** severity, while `enforce-sds-to-slds-hooks`
and `no-unsupported-hooks-slds2` — the two that fire on `--sds-*` and on retired hooks — ship at
**warning**. Under `npm run lint`'s `--max-warnings 0` either one fails the run, so the guidance is
the same in practice; do not expect an `--sds-*` hook to announce itself as an error. Custom
properties of our own must not use the `--slds` or `--sds` prefix — use a project prefix.

### Use semantic hooks only — a hook is necessary, not sufficient

Under Cosmos most colour hooks are authored as CSS `light-dark()`, which is how dark mode works with
no code. 38 colour hooks are not: every `--slds-g-color-palette-*`, every `*-base-50` /
`*-base-100`, `--slds-g-color-accent-container-1`, the `disabled` family, and
`accent-light-*` / `accent-dark-*`. They pass a "uses a hook" check and then behave like a
hard-coded colour in dark mode. Author against the semantic hooks (`surface`, `surface-container`,
`on-surface`, the feedback families) instead.

Never write a `prefers-color-scheme` media query and never branch on colour mode in JS. The user's
setting is Light / Dark / **System**, and a hand-rolled query overrides an explicit "Light" choice
on a dark OS.

## Color Hierarchy — Surface / Container / On-Surface

SLDS 2.0 uses a layered color model. Every color choice must follow this stacking:

1. **Surface** (`--slds-g-color-surface-*`) — page backgrounds, panels, modals, popovers
2. **Surface-container** (`--slds-g-color-surface-container-*`) — cards, buttons, tabsets, elements that sit ON a surface and contain text/icons
3. **On-surface** (`--slds-g-color-on-surface-*`) — text and icons that sit on a surface or container

### Pairing Rules (WCAG 2.1 Compliance)

Every hex below is the fallback the linter itself suggests for that hook, taken from its own message
rather than from a palette page — the same rule the fallback section above sets.

- Text on a surface MUST use the matching `on-surface` color for contrast compliance
- `on-surface-1` (#747474) — body text, placeholders, field labels, sub-headings, taglines
- `on-surface-2` (#2e2e2e) — secondary headings, dark body copy, filled input fields
- `on-surface-3` (#181818) — page/component titles ONLY
- On dark backgrounds, use `on-surface-inverse` variants
- Accent colors (`--slds-g-color-accent-*`) can be used for text/icons on surfaces for interactive elements

### Inverse Pairing

- `surface-inverse-1` pairs with `on-surface-inverse-1`
- `surface-container-inverse-1` pairs with `on-surface-inverse-1`
- Never mix normal and inverse colors

## Feedback Colors — Fixed Semantic Meanings

Feedback colors are reserved for their specific meanings. Never repurpose them.

| State | Color | Hook prefix |
|-------|-------|-------------|
| Error | Pink/Red | `--slds-g-color-error-*` |
| Warning | Yellow/Amber | `--slds-g-color-warning-*` |
| Success | Teal/Green | `--slds-g-color-success-*` |
| Information | Blue | `--slds-g-color-info-*` |
| Disabled | Gray | `--slds-g-color-disabled-*` |

Each feedback state has up to four hook variants: base color, on-color (text), container (background), and border. Always use the matching set (e.g., `error-container-1` background with `on-error-1` text).

**The set is not uniform, and assuming it is produces a hook that does not exist.** There is no
`--slds-g-color-border-info-1` — informational states have no border variant. Verify a hook exists in
`@salesforce-ux/sds-metadata` before using it; the linter's `no-unsupported-hooks-slds2` rule is the
backstop, not the design step. (Likewise `--slds-g-color-neutral-100` does not exist — the real hook
is `--slds-g-color-neutral-base-100`.)

## Accent Colors — Brand and Interactive States

- `accent-1`, `accent-2`, `accent-3` — text/icon emphasis and interactive state indicators
- `accent-container-1/2/3` — brand button backgrounds, hover/active states
- `border-accent-1/2/3` — button outlines
- `brand-base-90` and `brand-base-80` — menu component backgrounds and hover states
- **electric blue-50, -40, -30 are reserved** for buttons, hover, selected/active states. Do not use for decoration.

## Typography

### Font Scale

Use `--slds-g-font-scale-*` hooks, never raw `px` or `rem` values.

- **Body text** (neg-2 through 2): scales neg-2 (10px) to 2 (16px), supports regular/semibold/bold weights
- **Titles** (3 through 6): scales 3 (20px) to 6 (32px), regular or semibold weight
- **Display** (7 through 8): scales 7 (40px) to 8 (48px), light weight only
- Base font size: `--slds-g-font-size-base` (13px)

### Font Weight

Use `--slds-g-font-weight-*` hooks. Only four weights are permitted:

| Weight | Hook | Value | Use for |
|--------|------|-------|---------|
| Light | `--slds-g-font-weight-3` | 300 | Display text only |
| Regular | `--slds-g-font-weight-4` | 400 | Titles and body text |
| Semibold | `--slds-g-font-weight-6` | 600 | Buttons and smaller body titles |
| Bold | `--slds-g-font-weight-7` | 700 | Emphasis only, use sparingly |

Bold is for emphasis, NOT for headings. Use `on-surface-3` color for headings/titles.

### Line Height

Use `--slds-g-font-lineheight-*` hooks (unitless multipliers from 1 to 2).

## Spacing vs Sizing — Different Scales, Different Purposes

### Spacing (margins and padding)

Use `--slds-g-spacing-*` hooks. Follows a **4-point grid** (multiples of 4px).

- Range: `spacing-1` (4px) through `spacing-12` (80px)
- Use for margins, padding, and gaps between elements
- Do NOT use spacing hooks for element dimensions (width/height)

### Sizing (width and height)

Use `--slds-g-sizing-*` hooks. Follows an **8-point grid** (multiples of 8px).

- Range: `sizing-1` (2px) through `sizing-16` (480px)
- Use for fixed height, width, and dimension-based properties
- Do NOT use sizing hooks for margins or padding

## Borders

### SLDS 2 Breaking Change: No Card Borders

SLDS 2 removes borders from cards and components. Do NOT add `border` to `lightning-card` or card-like containers unless the component is on a white surface (same-color-on-same-color requires a border for separation).

### Border Colors

- `--slds-g-color-border-1` — decorative borders, divider lines (lighter, #e5e5e5)
- `--slds-g-color-border-2` — functional/interactive borders (darker, #747474)
- Use `border-2` for buttons, inputs, and interactive elements (WCAG contrast)
- Use `border-1` for non-interactive dividers and separators

### Border Width

Use `--slds-g-sizing-border-*` hooks (1px through 4px). Standard border is `sizing-border-1` (1px).

## Border Radius

Use `--slds-g-radius-border-*` hooks. Match radius to element density:

- `radius-border-1` (4px) — dense elements: buttons, inputs, checkboxes
- `radius-border-2` (8px) — medium elements: cards, input containers, form fields
- `radius-border-3` (12px) — larger panels
- `radius-border-4` (20px) — prominent containers, modals
- `radius-border-circle` (100%) — avatars, circular icons
- `radius-border-pill` (15rem) — pill-shaped buttons

Never mix sharp and rounded corners within the same component.

## Shadows and Elevation

Use `--slds-g-shadow-*` hooks. Higher stacking order = higher shadow number.

| Level | Hook | Use for |
|-------|------|---------|
| Base (no shadow) | none | Components sitting flat on a surface |
| Level 1 | `--slds-g-shadow-1` | Subtle lift |
| Level 2 | `--slds-g-shadow-2` | Menus, docked footers, color pickers, notifications |
| Level 3 | `--slds-g-shadow-3` | Panels, docked composers, tooltips, toasts |
| Level 4 | `--slds-g-shadow-4` | Modals, popovers, App Launcher |

- Base level components on a gray surface: white background, no border
- Base level components on a white surface: white background WITH a border
- Bevel/inset shadows are only for buttons and inputs — do not use in custom situations

### Focus Rings

Focus indication is part of the shadow system, not a hand-rolled `outline`. A hand-rolled outline
picks one colour and fails contrast in either light or dark mode; these four resolve per mode.

| Hook | Use for |
|------|---------|
| `--slds-g-shadow-outline-focus-1` | the default focus ring on an interactive element |
| `--slds-g-shadow-inset-focus-1` | focus drawn inside the element's own bounds |
| `--slds-g-shadow-outset-focus-1` | focus needing a light halo to separate it from its background |
| `--slds-g-shadow-inset-inverse-focus-1` | focus on an inverse/dark surface |

Any component whose gestures are keyboard-operable must indicate focus with one of these.

## Illustrations and Empty States

- Use illustrations for empty states, informational messages, and error states
- One illustration per page maximum — multiple illustrations distract users
- Never use illustrations inside related lists or cards
- Never use illustrations as feedback for direct actions (use toasts/popovers instead)
- Include actionable text with illustrations to guide the user
- Mobile illustrations: max 300px width, 180px height
- Desktop illustrations: max 600px width, 360px height

## Do NOT

- Hardcode hex colors, px font sizes, or px spacing values in CSS
- Write a bare `var(--slds-g-*)` without a fallback value
- Apply decoration, brand bands, or textures to application backgrounds
- Use `on-surface-3` for anything other than page/component titles
- Use feedback colors (error/warning/success/info) for non-feedback purposes
- Mix sharp and rounded corners in the same component
- Add custom box-shadows — use the elevation system hooks
- Use `font-weight: bold` for headings (use `on-surface-3` color + regular/semibold weight)
