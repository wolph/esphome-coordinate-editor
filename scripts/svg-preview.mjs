import assert from "node:assert/strict";

/** @typedef {{time: number, layers: string[]}} SvgFrame */
/** @typedef {{viewBox: string, css: string, duration: number, frames: SvgFrame[]}} SvgCapture */

/** Record the real scene while the existing browser sequence operates the editor.
 * @param {import('playwright').Frame} frame @returns {Promise<void>}
 */
export async function startSvgCapture(frame) {
  await frame.evaluate(() => {
    /** @type {SVGSVGElement} */
    const svg = window.demoFrame.editor.svg;
    /** @type {number} */
    const started = performance.now();
    /** @type {SvgCapture} */
    const capture = { viewBox: svg.getAttribute("viewBox"), duration: 19,
      css: window.demoFrame.editor.shadowRoot.querySelector("style").textContent, frames: [] };
    /** @returns {void} */
    const sample = () => {
      /** @type {number} */
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed >= capture.duration) return;
      /** @type {SVGSVGElement} */
      const clone = /** @type {SVGSVGElement} */ (svg.cloneNode(true));
      for (const element of clone.querySelectorAll("*")) {
        for (const attribute of [...element.attributes]) {
          if (/^(data-|aria-|on)/.test(attribute.name) || ["tabindex", "style", "pointer-events"].includes(attribute.name)) {
            element.removeAttribute(attribute.name);
          } else if (["x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "points", "transform", "font-size"].includes(attribute.name)) {
            element.setAttribute(attribute.name, attribute.value.replace(/-?\d+\.\d+(?:e[-+]?\d+)?/gi,
              (value) => String(Number(Number(value).toFixed(2)))));
          }
        }
      }
      capture.frames.push({ time: capture.frames.length ? elapsed : 0,
        layers: [...clone.children].map((layer) => new XMLSerializer().serializeToString(layer)) });
    };
    sample();
    /** @type {number} */
    const timer = window.setInterval(sample, 100);
    window.setTimeout(() => window.clearInterval(timer), capture.duration * 1000);
    window.svgPreviewCapture = capture;
  });
}

/** Share identical layers between frames and replay their observed times using CSS.
 * @param {SvgCapture} capture @returns {string}
 */
export function renderSvgPreview(capture) {
  assert.ok(capture.frames.length >= 2 && capture.frames[0].time === 0, "Preview starts with recorded frames");
  assert.ok(capture.duration > capture.frames.at(-1).time, "Preview ends after its final frame");
  /** @type {Map<string, string>} */
  const definitions = new Map();
  /** @type {string[]} */
  const bodies = capture.frames.map((frame) => frame.layers.map((layer) => {
    if (!definitions.has(layer)) definitions.set(layer, `layer${definitions.size}`);
    return `<use href="#${definitions.get(layer)}"/>`;
  }).join(""));
  /** @type {string[]} */
  const animations = capture.frames.map((frame, index) => {
    /** @type {number} */
    const start = Number((frame.time / capture.duration * 100).toFixed(5));
    /** @type {number} */
    const end = Number(((capture.frames[index + 1]?.time ?? capture.duration) / capture.duration * 100).toFixed(5));
    assert.ok(end > start, "Frame times increase");
    return `#frame${index}{animation:frame${index} ${capture.duration}s steps(1, end) infinite}` +
      `@keyframes frame${index}{${index ? "0%{visibility:hidden}" : ""}${start}%{visibility:visible}${end}%,100%{visibility:hidden}}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${capture.viewBox}" role="img" aria-labelledby="title description">
<title id="title">ESPHome coordinate editor - simulated 3D targets and zone editing</title>
<desc id="description">Recorded vector frames from the editor: moving targets, camera orbit and cuboid editing. All data is simulated.</desc>
<style>${capture.css.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}
svg{font:16px system-ui;background:#f8fafc}.frame{visibility:hidden}
@media (prefers-reduced-motion: no-preference){.poster{display:none}${animations.join("\n")}}
</style>
<defs>${[...definitions].map(([layer, id]) => `<g id="${id}">${layer}</g>`).join("\n")}</defs>
<g class="poster">${bodies[0]}</g>
${bodies.map((body, index) => `<g class="frame" id="frame${index}">${body}</g>`).join("\n")}
</svg>\n`;
}

/** @param {import('playwright').Frame} frame @returns {Promise<string>} */
export async function finishSvgCapture(frame) {
  /** @type {SvgCapture} */
  const capture = await frame.evaluate(() => window.svgPreviewCapture);
  return renderSvgPreview(capture);
}

/** Exercise image embedding, including the reduced-motion fallback used by README readers.
 * @param {import('playwright').Page} page @param {string} url @param {boolean} [stationary] @returns {Promise<void>}
 */
export async function checkSvgPreview(page, url, stationary = false) {
  await page.setContent(`<img alt="Recorded SVG preview" src="${new URL("media/preview.svg", url).href}" width="640">`);
  await page.locator("img").evaluate((image) => image.decode());
  /** @type {Buffer} */
  const first = await page.locator("img").screenshot();
  await page.waitForTimeout(600);
  /** @type {Buffer} */
  const second = await page.locator("img").screenshot();
  assert.equal(first.equals(second), stationary, `SVG image ${stationary ? "stays still" : "animates"}`);
}
