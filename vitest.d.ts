// Make Vitest's `globals: true` API (describe/it/expect/vi/…) and the
// jest-dom matchers visible to the single `tsc --noEmit` program WITHOUT a
// `types` array (which would shadow @types/node, @types/react, etc.). This
// ambient file is included by tsconfig's `**/*.ts` glob.
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />
