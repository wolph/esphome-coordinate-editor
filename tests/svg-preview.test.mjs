import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("SVG preview preserves recorded layers, their order and timing without scripts or raster images", async () => {
  /** @type {typeof import('../scripts/svg-preview.mjs')} */
  const { renderSvgPreview } = await import("../scripts/svg-preview.mjs");
  /** @type {string} */
  const grid = '<g><path d="M0 0L10 10" /></g>';
  /** @type {string} */
  const source = renderSvgPreview({ viewBox: "0 0 640 480", css: ".point { stroke: white; }", duration: 2,
    frames: [{ time: 0, layers: [grid, '<g><circle cx="1" /></g>'] },
      { time: 1, layers: [grid, '<g><circle cx="2" /></g>'] }] });
  /** @type {JSDOM} */
  const dom = new JSDOM(source, { contentType: "image/svg+xml" });
  try {
    /** @type {Document} */
    const document = dom.window.document;
    assert.equal(document.documentElement.getAttribute("viewBox"), "0 0 640 480");
    assert.equal(document.querySelectorAll("script, image").length, 0);
    assert.equal(document.querySelectorAll("defs path").length, 1, "Unchanged geometry is shared");
    /** @type {Element[]} */
    const frames = [...document.querySelectorAll(".frame")];
    assert.equal(frames.length, 2);
    for (const [index, frame] of frames.entries()) {
      /** @type {Element[]} */
      const layers = [...frame.querySelectorAll("use")].map((use) => document.querySelector(use.getAttribute("href")));
      assert.ok(layers[0].querySelector("path"));
      assert.equal(layers[1].querySelector("circle").getAttribute("cx"), String(index + 1));
    }
    assert.match(source, /50%/);
    assert.match(source, /2s steps\(1, end\) infinite/);
    assert.match(source, /prefers-reduced-motion: no-preference/);
    assert.ok(document.querySelector(".poster use"), "A static frame remains available without animation");
  } finally { dom.window.close(); }
});

test("SVG preview includes recorded controls and shares unchanged interface states", async () => {
  /** @type {typeof import('../scripts/svg-preview.mjs')} */
  const { renderSvgPreview } = await import("../scripts/svg-preview.mjs");
  /** @type {string} */
  const controls = '<foreignObject width="1200" height="1126"><div xmlns="http://www.w3.org/1999/xhtml"><label>Z Max (m)<input value="4.2" /></label><button>Apply</button></div></foreignObject>';
  /** @type {string} */
  const applied = controls.replace('value="4.2"', 'value="3.8"');
  /** @type {string} */
  const source = renderSvgPreview({ viewBox: "0 0 1200 1126", css: "", duration: 3, frames: [
    { time: 0, layers: [], interface: controls }, { time: 1, layers: [], interface: controls },
    { time: 2, layers: [], interface: applied },
  ] });
  /** @type {JSDOM} */
  const dom = new JSDOM(source, { contentType: "image/svg+xml" });
  try {
    /** @type {Document} */
    const document = dom.window.document;
    assert.equal(document.querySelectorAll(".interface-frame foreignObject").length, 2);
    assert.equal(document.querySelector(".poster input").getAttribute("value"), "4.2");
    assert.equal(document.querySelectorAll(".interface-frame input")[1].getAttribute("value"), "3.8");
    assert.equal(document.querySelector(".interface-frame button").textContent, "Apply");
    assert.equal(document.querySelectorAll("defs foreignObject").length, 0,
      "HTML controls render directly because foreignObject inside use is blank in Chromium");
  } finally { dom.window.close(); }
});
