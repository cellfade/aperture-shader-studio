/**
 * Accessibility gate — live axe-core pass (PRD §7 / Success Metrics).
 *
 * Runs axe against the loaded studio in its default photo state AND with the
 * bundled sample image loaded. ASSERTS zero serious/critical violations
 * (the §10 target); moderate/minor findings are logged as info only and do not
 * fail the run, so the gate tracks the metric that matters without churning on
 * cosmetic noise.
 *
 * Self-contained via `playwright.config.ts`'s `webServer` (builds + serves).
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SERIOUS = new Set(["serious", "critical"]);

async function runAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    // WCAG 2.x AA — matches the project's stated bar.
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  const counts: Record<string, number> = {};
  for (const v of results.violations) {
    const impact = v.impact ?? "unknown";
    counts[impact] = (counts[impact] ?? 0) + 1;
  }

  const serious = results.violations.filter((v) => SERIOUS.has(v.impact ?? ""));

  // Baseline record — surfaced in the test runner output.
  console.log(
    `[axe:${label}] violations by impact: ${JSON.stringify(counts)} ` +
      `(serious/critical: ${serious.length})`,
  );
  for (const v of results.violations) {
    console.log(`[axe:${label}]   ${v.impact}: ${v.id} — ${v.help}`);
  }

  expect(
    serious,
    serious.map((v) => `${v.impact}: ${v.id} — ${v.help}`).join("\n"),
  ).toHaveLength(0);
}

test("studio (default photo state) has no serious/critical a11y violations", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("radiogroup", { name: /source type/i }).waitFor();
  await runAxe(page, "default");
});

test("studio (sample loaded) has no serious/critical a11y violations", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /try a sample/i }).click();
  // The download control appears once a frame is drawable — proxy for "loaded".
  await page.getByRole("button", { name: /download png/i }).waitFor();
  await runAxe(page, "sample");
});
