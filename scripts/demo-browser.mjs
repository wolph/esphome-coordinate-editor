import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {string} */
export const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
/** @type {Record<string, string>} */
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".gif": "image/gif", ".mp4": "video/mp4", ".vtt": "text/vtt" };

/** Serve only repository files on an owned random loopback port.
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
export async function serveDemo() {
  /** @type {import('node:http').Server} */
  const server = createServer(async (request, response) => {
    try {
      /** @type {string} */
      const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
      if (pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
      /** @type {string} */
      const filename = path.resolve(root, `.${pathname.endsWith("/") ? `${pathname}index.html` : pathname}`);
      if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end(); return; }
      response.setHeader("Content-Type", mime[path.extname(filename)] || "application/octet-stream");
      response.end(await readFile(filename));
    } catch { response.writeHead(404).end("Not found"); }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  /** @type {import('node:net').AddressInfo} */
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}/demo/`, close: () => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => error ? reject(error) : resolve());
  }) };
}

/** @param {import('playwright').Page} page @returns {import('playwright').Frame} */
export function editorFrame(page) {
  /** @type {import('playwright').Frame | undefined} */
  const frame = page.frames().find((item) => item.url().endsWith("/frame.html"));
  assert.ok(frame, "Editor iframe loaded");
  return frame;
}

/** @param {import('playwright').Page} page @param {string} [preset] @returns {Promise<void>} */
export async function waitReady(page, preset = "ld6004") {
  await page.waitForFunction((id) => {
    /** @type {HTMLIFrameElement} */
    const frame = document.querySelector("#editor-frame");
    /** @type {object | undefined} */
    const app = frame?.contentWindow?.demoFrame;
    return app?.preset === id && app.editor?.zones.every((zone) => zone.available) && !app.editor.polling;
  }, preset);
  await editorFrame(page).locator("svg.scene[role='group'] circle.point").first().waitFor();
}

/** Read editor state without changing it.
 * @param {import('playwright').Page} page @returns {Promise<any>}
 */
export async function snapshot(page) {
  return editorFrame(page).evaluate(() => {
    /** @type {object} */
    const editor = window.demoFrame.editor;
    /** @type {object} */
    const zone = editor.zones[editor.selected];
    return { actual: { ...zone.actual }, draft: { ...zone.draft }, dirty: zone.dirty,
      pending: Boolean(zone.pending), message: zone.message, selected: editor.selected,
      view: editor.viewMode, camera: { ...editor.spatial.camera }, axes: editor.config.axes,
      targets: editor.targets.map((target) => ({ x: target.x, y: target.y, z: target.z })),
      paused: window.demoFrame.simulator.paused, elapsed: window.demoFrame.simulator.elapsed,
      write: zone.definition.write, label: zone.definition.label, zoneCount: editor.zones.length };
  });
}

/** @param {any} state @returns {void} */
export function assertBounds(state) {
  for (const [axis, limits] of Object.entries(state.axes)) {
    if (!(`${axis}_min` in state.draft)) continue;
    assert.ok(state.draft[`${axis}_min`] >= limits.min && state.draft[`${axis}_max`] <= limits.max, `${axis} bounds stay in range`);
    assert.ok(state.draft[`${axis}_min`] < state.draft[`${axis}_max`], `${axis} extent stays positive`);
  }
}

/** An optional indicator follows actual pointer events in each document.
 * @param {import('playwright').BrowserContext} context @returns {Promise<void>}
 */
export async function showPointer(context) {
  await context.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      /** @type {HTMLDivElement} */
      const dot = document.createElement("div");
      dot.setAttribute("aria-hidden", "true");
      dot.style.cssText = "position:fixed;width:18px;height:18px;border:2px solid #153b58;border-radius:50%;background:#fff9;pointer-events:none;z-index:2147483647;display:none;box-shadow:0 0 0 2px #fff;transform:translate(-50%,-50%)";
      document.body.append(dot);
      /** @param {PointerEvent} event @returns {void} */
      const update = (event) => {
        dot.style.display = "block";
        dot.style.left = `${event.clientX}px`; dot.style.top = `${event.clientY}px`;
        dot.style.background = event.buttons ? "#176ba099" : "#ffffff99";
      };
      for (const type of ["pointermove", "pointerdown", "pointerup"]) document.addEventListener(type, update, true);
      document.addEventListener("pointerout", (event) => { if (!event.relatedTarget) dot.style.display = "none"; }, true);
    });
  });
}
