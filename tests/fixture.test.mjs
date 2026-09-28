import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { JSDOM, VirtualConsole } from "jsdom";

test("HTML fixture loads the repository script and mounts with simulated data", async () => {
  /** @type {Error[]} */
  const errors = [];
  /** @type {VirtualConsole} */
  const console = new VirtualConsole();
  console.on("jsdomError", (error) => errors.push(error));
  /** @type {JSDOM} */
  const dom = await JSDOM.fromFile(fileURLToPath(new URL("./fixtures/coordinate-editor.html", import.meta.url)), {
    resources: "usable",
    runScripts: "dangerously",
    virtualConsole: console,
    beforeParse(window) {
      // jsdom does not supply the browser's AbortSignal composition helpers.
      window.AbortSignal.any = () => undefined;
      window.AbortSignal.timeout = () => undefined;
    },
  });
  try {
    await new Promise((resolve) => dom.window.addEventListener("load", resolve, { once: true }));
    /** @type {HTMLElement & {zones: Array<{available: boolean}>, targets: object[]}} */
    const editor = dom.window.fixtureEditor;
    assert.ok(editor);
    assert.equal(dom.window.document.querySelectorAll("coordinate-editor").length, 1);
    // Drain the fixture's asynchronous REST reads without waiting for a poll timer.
    for (let attempt = 0; attempt < 100 && editor.zones.some((zone) => !zone.available); attempt++)
      await new Promise((resolve) => dom.window.setTimeout(resolve, 1));
    assert.equal(editor.zones.length, 4);
    assert.ok(editor.zones.every((zone) => zone.available));
    assert.equal(editor.targets.length, 5);
    assert.deepEqual(errors, []);
  } finally { dom.window.close(); }
});
