import assert from "node:assert/strict";
import { installSvgCapture } from "./svg-capture.mjs";

/** @typedef {{time: number, layers: string[], interface?: string}} SvgFrame */
/** @typedef {{viewBox: string, css: string, duration: number, frames: SvgFrame[]}} SvgCapture */

/** Record the real scene while the existing browser sequence operates the editor.
 * @param {import('playwright').Frame} frame @returns {Promise<void>}
 */
export async function startSvgCapture(frame) {
  await frame.evaluate(installSvgCapture);
}

/** HTML inside foreignObject must render directly, outside SVG use references.
 * @param {SvgCapture} capture @returns {{markup: string, css: string}}
 */
function interfaceFrames(capture) {
  /** @type {string[]} */
  const interfaces = [...new Set(capture.frames.map((frame) => frame.interface).filter(Boolean))];
  /** @type {string[]} */
  const rules = [];
  /** @type {string[]} */
  const markup = interfaces.map((source, index) => {
    /** @type {boolean | undefined} */
    let previous;
    /** @type {string[]} */
    const keys = [];
    for (const frame of capture.frames) {
      /** @type {boolean} */
      const visible = frame.interface === source;
      if (visible === previous) continue;
      keys.push(`${Number((frame.time / capture.duration * 100).toFixed(5))}%{visibility:${visible ? "visible" : "hidden"}}`);
      previous = visible;
    }
    rules.push(`#interface${index}{animation:interface${index} ${capture.duration}s steps(1, end) infinite}` +
      `@keyframes interface${index}{${keys.join("")}100%{visibility:hidden}}`);
    return `<g class="interface-frame" id="interface${index}">${source}</g>`;
  });
  return { markup: markup.join("\n"), css: rules.join("\n") };
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
  /** @type {{markup: string, css: string}} */
  const controls = interfaceFrames(capture);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${capture.viewBox}" role="img" aria-labelledby="title description">
<title id="title">ESPHome coordinate editor - controls, targets and zone editing</title>
<desc id="description">Recorded editor interface: camera orbit, zone dragging, exact bounds, Apply, Discard and Top view. All data is simulated.</desc>
<style>${capture.css.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}
svg{font:16px system-ui}.frame,.interface-frame{visibility:hidden}
@media (prefers-reduced-motion: no-preference){.poster{display:none}${animations.join("\n")}${controls.css}}
</style>
<defs>${[...definitions].map(([layer, id]) => `<g id="${id}">${layer}</g>`).join("\n")}</defs>
<g class="poster">${capture.frames[0].interface ?? ""}${bodies[0]}</g>
${controls.markup}
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
  /** @type {string} */
  const source = await (await page.request.get(new URL("media/preview.svg", url).href)).text();
  /** @type {{buttons: string[], values: string[], interfaces: number}} */
  const content = await page.evaluate((source) => {
    /** @type {Document} */
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    return { buttons: [...document.querySelectorAll(".interface-frame button")].map((button) => button.textContent.trim()),
      values: [...document.querySelectorAll(".interface-frame input")].map((input) => input.getAttribute("value")),
      interfaces: document.querySelectorAll(".interface-frame foreignObject").length };
  }, source);
  assert.ok(content.interfaces > 1, "The preview includes changing editor controls");
  for (const label of ["Apply", "Discard draft", "Top view"]) assert.ok(content.buttons.includes(label), `${label} is recorded`);
  for (const value of ["4.2", "3.8"]) assert.ok(content.values.includes(value), `The ${value} metre edit remains visible before Apply or Discard`);
  /** @type {Buffer} */
  const first = await page.locator("img").screenshot();
  await page.waitForTimeout(600);
  /** @type {Buffer} */
  const second = await page.locator("img").screenshot();
  assert.equal(first.equals(second), stationary, `SVG image ${stationary ? "stays still" : "animates"}`);
}
