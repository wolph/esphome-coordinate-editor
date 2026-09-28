import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

/** @type {string} */
const html = await readFile(new URL("../demo/index.html", import.meta.url), "utf8");
/** @type {string} */
const app = await readFile(new URL("../demo/app.js", import.meta.url), "utf8");

test("simulation pause and resume retain their decorative icons and accessible state names", () => {
  /** @type {JSDOM} */
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://sensor.local/demo/" });
  dom.window.PRESETS = [{ id: "ld6004", detail: "3D demo" }];
  dom.window.eval(app.replace('import { PRESETS } from "./presets.js";', ""));
  /** @type {HTMLButtonElement} */
  const pause = dom.window.document.getElementById("pause");
  /** @type {HTMLButtonElement} */
  const reset = dom.window.document.getElementById("reset");
  /** @type {HTMLIFrameElement} */
  const frame = dom.window.document.getElementById("editor-frame");
  assert.ok(reset.querySelector("svg"));
  for (const paused of [true, false, true]) {
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", { source: frame.contentWindow,
      origin: "http://sensor.local", data: { type: "coordinate-demo-state", height: 850,
        paused, ready: true, preset: "ld6004" } }));
    assert.equal(pause.getAttribute("aria-label"), paused ? "Resume" : "Pause");
    assert.equal(pause.querySelector(".button-label").textContent, paused ? "Resume" : "Pause");
    assert.equal(pause.querySelector("[data-icon='pause']").hasAttribute("hidden"), paused);
    assert.equal(pause.querySelector("[data-icon='resume']").hasAttribute("hidden"), !paused);
    assert.equal(pause.querySelector("svg").getAttribute("aria-hidden"), "true");
    assert.equal(pause.disabled, false);
  }
  dom.window.close();
});
