/**
 * Studio smoke test — codifies the manual QA happy path.
 *
 *   load the sample photo → switch to "Image filters" → pick "image dithering"
 *   → Download PNG → assert a non-empty image/png download fires
 *   → assert zero console errors throughout.
 *
 * Requires the app served on PLAYWRIGHT_BASE_URL (default http://localhost:3100).
 * `playwright.config.ts`'s `webServer` builds + starts it automatically, so
 * `npm run test:e2e` is self-contained — no manual server needed.
 */
import { expect, test } from "@playwright/test";

test("sample photo → image dithering → Download PNG", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto("/");

  // Load the bundled sample photo (public/sample.jpg) via the inline link.
  await page.getByRole("button", { name: /try a sample/i }).click();

  // Switch shader category, then select the dithering filter.
  await page.getByRole("button", { name: "Image filters" }).click();
  await page.getByRole("button", { name: /image dithering/i }).click();

  // Wait for a real drawn frame, then export.
  const downloadButton = page.getByRole("button", { name: /download png/i });
  await expect(downloadButton).toBeEnabled();

  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/\.png$/i);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  const bytes = Buffer.concat(chunks);
  expect(bytes.length).toBeGreaterThan(0);
  // PNG magic number: 89 50 4E 47.
  expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  expect(consoleErrors, consoleErrors.join("\n")).toHaveLength(0);
});
