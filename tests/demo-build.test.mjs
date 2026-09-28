import assert from "node:assert/strict";
import { mkdtemp, readFile, access, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

/** @param {string} root @param {URL} url @returns {Promise<void>} */
async function exists(root, url) {
  assert.ok(url.pathname.startsWith("/esphome-coordinate-editor/"));
  await access(path.join(root, url.pathname.slice("/esphome-coordinate-editor/".length)));
}

test("Pages build clears stale output and serves its editor assets under a project prefix", async () => {
  /** @type {string} */
  const output = await mkdtemp(path.join(tmpdir(), "coordinate-demo-build-"));
  try {
    await writeFile(path.join(output, "stale.txt"), "stale");
    /** @type {typeof import('../scripts/build-demo.mjs')} */
    let builder;
    try { builder = await import("../scripts/build-demo.mjs"); }
    catch (error) { assert.fail(`Pages builder unavailable: ${error.message}`); }
    await builder.buildDemo(output);
    await assert.rejects(access(path.join(output, "stale.txt")));
    /** @type {JSDOM} */
    const page = new JSDOM(await readFile(path.join(output, "index.html"), "utf8"), { url: "https://wolph.github.io/esphome-coordinate-editor/" });
    for (const element of page.window.document.querySelectorAll("script[src], link[href], iframe[src]")) {
      /** @type {URL} */
      const url = new URL(element.getAttribute("src") ?? element.getAttribute("href"), page.window.location.href);
      if (url.protocol === "data:") {
        assert.match(decodeURIComponent(url.href), /^data:image\/svg\+xml,<svg\s/);
        continue;
      }
      await exists(output, url);
    }
    /** @type {URL} */
    const frameUrl = new URL(page.window.document.querySelector("iframe").src);
    /** @type {JSDOM} */
    const frame = new JSDOM(await readFile(path.join(output, "demo/frame.html"), "utf8"), { url: frameUrl.href });
    for (const script of frame.window.document.querySelectorAll("script[src]")) await exists(output, new URL(script.src));
    assert.equal(await readFile(path.join(output, "coordinate-editor.js"), "utf8"), await readFile(new URL("../coordinate-editor.js", import.meta.url), "utf8"));
    for (const id of ["ld2450", "ld6004", "ld6002b"]) {
      await exists(output, new URL(`../examples/${id}-config.js`, new URL("presets.js", frameUrl)));
      assert.equal(await readFile(path.join(output, `examples/${id}-config.js`), "utf8"), await readFile(new URL(`../examples/${id}-config.js`, import.meta.url), "utf8"));
    }
    await access(path.join(output, "walkthrough.html"));
    await assert.rejects(access(path.join(output, "node_modules")));
    await assert.rejects(access(path.join(output, "tests")));
    page.window.close(); frame.window.close();
  } finally { await rm(output, { recursive: true, force: true }); }
});
