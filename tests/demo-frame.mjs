import assert from "node:assert/strict";
import test from "node:test";

/** @type {string} */
const browserModule = process.env.DEMO_PLAYWRIGHT_MODULE || "playwright";
/** @type {typeof import('playwright')} */
const { chromium } = await import(browserModule);
/** @type {string} */
const url = process.env.DEMO_BASE_URL || "http://127.0.0.1:8765/demo/";

test("preset rebuilding measures the new editor even when final body height is unchanged", async () => {
  /** @type {import('playwright').Browser} */
  const browser = await chromium.launch();
  try {
    /** @type {import('playwright').Page} */
    const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
    await page.goto(url);
    await page.frameLocator("#editor-frame").locator(".point").first().waitFor();
    for (const id of ["ld6004", "ld2450", "ld6002b", "ld6004"]) {
      await page.selectOption("#preset", id);
      await page.waitForFunction((id) => {
        /** @type {HTMLIFrameElement} */
        const frame = document.querySelector("iframe");
        return frame.contentWindow.demoFrame.preset === id && frame.contentWindow.demoFrame.editor.zones.every((zone) => zone.available);
      }, id);
      await page.waitForTimeout(100);
      /** @type {{body: number, frame: number}} */
      const measured = await page.evaluate(() => {
        /** @type {HTMLIFrameElement} */
        const frame = document.querySelector("iframe");
        return { body: frame.contentDocument.body.getBoundingClientRect().height, frame: frame.clientHeight };
      });
      assert.ok(measured.body <= measured.frame + 1, `${id} frame clips ${measured.body - measured.frame}px`);
    }
    for (const width of [768, 375]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.waitForTimeout(100);
      /** @type {{horizontal: boolean, clipped: boolean}} */
      const measured = await page.evaluate(() => {
        /** @type {HTMLIFrameElement} */
        const frame = document.querySelector("iframe");
        return {
          horizontal: document.documentElement.scrollWidth > innerWidth || frame.contentDocument.documentElement.scrollWidth > frame.clientWidth,
          clipped: frame.contentDocument.body.getBoundingClientRect().height > frame.clientHeight + 1,
        };
      });
      assert.deepEqual(measured, { horizontal: false, clipped: false });
    }
  } finally { await browser.close(); }
});
