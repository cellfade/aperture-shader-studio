/**
 * Hex-colour validation + normalization for the editable colour fields (B5).
 *
 * The native `<input type=color>` swatch only ever emits a canonical
 * `#rrggbb`, but the adjacent text field lets power users type a hex directly.
 * These pure helpers accept the common author shorthands (`#rgb`, bare strings
 * without `#`, mixed case) and normalize to the canonical lowercase `#rrggbb`
 * that the shader pipeline + URL state expect; invalid input is rejected so the
 * caller can fall back to the prior value on blur.
 *
 * Kept pure + dependency-free so they're unit-testable without a DOM (B5 tests).
 */

const SHORT = /^#?[0-9a-fA-F]{3}$/;
const LONG = /^#?[0-9a-fA-F]{6}$/;

/** True if `input` is a parseable #rgb or #rrggbb hex (with or without `#`). */
export function isValidHex(input: string): boolean {
  const s = input.trim();
  return SHORT.test(s) || LONG.test(s);
}

/**
 * Normalize a hex string to canonical lowercase `#rrggbb`, expanding `#rgb`
 * shorthand and adding a leading `#`. Returns `null` if the input is not a valid
 * hex colour (so callers can fall back to the prior value).
 */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, "");
  if (SHORT.test(`#${s}`)) {
    const [r, g, b] = s;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  if (LONG.test(`#${s}`)) {
    return `#${s}`.toLowerCase();
  }
  return null;
}
