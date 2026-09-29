import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { assertBounds, editorFrame, snapshot, waitReady } from "./demo-browser.mjs";

/** @typedef {{page: import('playwright').Page, recording: boolean, started: number, cues: {time: number, text: string}[]}} Sequence */
/** @typedef {{x: number, y: number}} Point */

/** @param {Sequence} sequence @param {string} text @returns {void} */
function cue(sequence, text) { sequence.cues.push({ time: (performance.now() - sequence.started) / 1000, text }); }

/** Presentation holds are omitted by the browser check.
 * @param {Sequence} sequence @param {number} seconds @param {string} text @param {() => Promise<void>} action @returns {Promise<void>}
 */
async function shot(sequence, seconds, text, action) {
  /** @type {number} */
  const started = performance.now();
  cue(sequence, text);
  await action();
  if (sequence.recording) await sequence.page.waitForTimeout(Math.max(0, seconds * 1000 - (performance.now() - started)));
}

/** @param {Sequence} sequence @param {Point} start @param {Point} end @returns {Promise<void>} */
async function drag(sequence, start, end) {
  await sequence.page.mouse.move(start.x, start.y);
  await sequence.page.mouse.down();
  /** @type {number} */
  let step;
  for (step = 1; step <= 12; step++) {
    await sequence.page.mouse.move(start.x + (end.x - start.x) * step / 12, start.y + (end.y - start.y) * step / 12);
    if (sequence.recording) await sequence.page.waitForTimeout(35);
  }
  await sequence.page.mouse.up();
}

/** @param {Sequence} sequence @param {string} axis @param {string} edge @param {number} units @returns {Promise<void>} */
async function axisDrag(sequence, axis, edge, units) {
  /** @type {import('playwright').Frame} */
  const frame = editorFrame(sequence.page);
  /** @type {import('playwright').Locator} */
  const handle = frame.locator(`[data-axis='${axis}'][data-edge='${edge}']`);
  /** @type {import('playwright').BoundingBox} */
  const box = await handle.boundingBox();
  assert.ok(box, `${axis} ${edge} handle rendered`);
  /** @type {Point} */
  const delta = await frame.evaluate(({ axis, units }) => {
    /** @type {object} */
    const editor = window.demoFrame.editor;
    /** @type {object} */
    const vector = editor.spatial.axisVector(axis);
    /** @type {DOMMatrix} */
    const matrix = editor.svg.getScreenCTM();
    return { x: (matrix.a * vector.x + matrix.c * vector.y) * units, y: (matrix.b * vector.x + matrix.d * vector.y) * units };
  }, { axis, units });
  /** @type {Point} */
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(sequence, start, { x: start.x + delta.x, y: start.y + delta.y });
  assertBounds(await snapshot(sequence.page));
}

/** @param {Sequence} sequence @param {string} selector @param {number} dx @param {number} dy @returns {Promise<void>} */
async function rectangleDrag(sequence, selector, dx, dy) {
  /** @type {import('playwright').BoundingBox} */
  const box = await editorFrame(sequence.page).locator(selector).last().boundingBox();
  assert.ok(box, "Rectangle gesture target rendered");
  /** @type {Point} */
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await drag(sequence, start, { x: start.x + dx, y: start.y + dy });
  assertBounds(await snapshot(sequence.page));
}

/** @param {Sequence} sequence @param {string} label @param {string} value @returns {Promise<void>} */
async function enterBound(sequence, label, value) {
  /** @type {import('playwright').Locator} */
  const input = editorFrame(sequence.page).locator("fieldset:not([hidden])").getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press("Tab");
  assertBounds(await snapshot(sequence.page));
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function orbitAndZoom(sequence) {
  /** @type {any} */
  const before = await snapshot(sequence.page);
  /** @type {import('playwright').BoundingBox} */
  const box = await editorFrame(sequence.page).locator("svg.scene[role='group']").boundingBox();
  await drag(sequence, { x: box.x + box.width * 0.8, y: box.y + box.height * 0.75 },
    { x: box.x + box.width * 0.8 + 65, y: box.y + box.height * 0.75 - 20 });
  assert.notEqual((await snapshot(sequence.page)).camera.yaw, before.camera.yaw, "Orbit changes yaw");
  await editorFrame(sequence.page).getByRole("button", { name: "Zoom in", exact: true }).click();
  assert.ok((await snapshot(sequence.page)).camera.zoom > before.camera.zoom, "Zoom changes camera scale");
  await editorFrame(sequence.page).getByRole("button", { name: "Zoom out", exact: true }).click();
  assert.equal((await snapshot(sequence.page)).dirty, false, "Camera controls do not edit bounds");
}

/** Locate a visible cube surface through the editor's geometric picker.
 * @param {Sequence} sequence @param {'face'|'edge'} kind @param {number} index @param {string[]} axes @returns {Promise<{point: Point, axis: string}>}
 */
async function surface(sequence, kind, index, axes) {
  /** @type {import('playwright').Frame} */
  const frame = editorFrame(sequence.page);
  /** @type {import('playwright').BoundingBox} */
  const box = await sequence.page.locator("#editor-frame").boundingBox();
  /** @type {{point: Point, axis: string} | null} */
  const found = await frame.evaluate(({ kind, index, axes }) => {
    /** @type {any} */
    const editor = window.demoFrame.editor;
    /** @type {DOMMatrix} */
    const matrix = editor.svg.getScreenCTM();
    /** @type {Point[]} */
    const candidates = [];
    for (const polygon of editor.svg.querySelectorAll(`polygon[data-zone='${index}']`)) {
      /** @type {Point[]} */
      const points = Array.from(polygon.points, (point) => ({ x: point.x, y: point.y }));
      if (points.length !== 4) continue;
      if (kind === "face") {
        for (const u of [0.5, 0.3, 0.7]) {
          for (const v of [0.5, 0.3, 0.7]) {
            candidates.push({ x: points[0].x + u * (points[1].x - points[0].x) + v * (points[3].x - points[0].x),
              y: points[0].y + u * (points[1].y - points[0].y) + v * (points[3].y - points[0].y) });
          }
        }
      } else {
        points.forEach((point, edge) => {
          /** @type {Point} */
          const next = points[(edge + 1) % points.length];
          for (const fraction of [0.5, 0.25, 0.75]) candidates.push({
            x: point.x + (next.x - point.x) * fraction, y: point.y + (next.y - point.y) * fraction });
        });
      }
    }
    for (const point of candidates) {
      /** @type {any} */
      const picked = editor.spatial.pick(point);
      if (editor.spatial.pickHandle(point)) continue;
      if (picked?.kind !== kind || picked.index !== index || !axes.includes(picked.axis)) continue;
      /** @type {Point} */
      const client = { x: matrix.a * point.x + matrix.c * point.y + matrix.e,
        y: matrix.b * point.x + matrix.d * point.y + matrix.f };
      /** @type {Element | null} */
      const hit = editor.shadowRoot.elementFromPoint(client.x, client.y);
      if (!hit || hit.closest("[data-axis]")) continue;
      return { point: client, axis: picked.axis };
    }
    return null;
  }, { kind, index, axes });
  assert.ok(found, `Visible ${kind} for area ${index} on ${axes.join("/")}`);
  return { point: { x: found.point.x + box.x, y: found.point.y + box.y }, axis: found.axis };
}

/** @param {Sequence} sequence @param {'face'|'edge'} kind @param {string[]} normals @param {Record<string, number>} movement @returns {Promise<void>} */
async function surfaceDrag(sequence, kind, normals, movement) {
  /** @type {any} */
  const state = await snapshot(sequence.page);
  /** @type {{point: Point, axis: string}} */
  const target = await surface(sequence, kind, state.selected, normals);
  /** @type {Point} */
  const delta = await editorFrame(sequence.page).evaluate((movement) => {
    /** @type {any} */
    const editor = window.demoFrame.editor;
    /** @type {DOMMatrix} */
    const matrix = editor.svg.getScreenCTM();
    /** @type {Point} */
    const projected = { x: 0, y: 0 };
    for (const [axis, units] of Object.entries(movement)) {
      /** @type {Point} */
      const vector = editor.spatial.axisVector(axis);
      projected.x += vector.x * units;
      projected.y += vector.y * units;
    }
    return { x: matrix.a * projected.x + matrix.c * projected.y, y: matrix.b * projected.x + matrix.d * projected.y };
  }, movement);
  await drag(sequence, target.point, { x: target.point.x + delta.x, y: target.point.y + delta.y });
  assertBounds(await snapshot(sequence.page));
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function manipulateXYZ(sequence) {
  /** @type {{point: Point, axis: string}} */
  const other = await surface(sequence, "face", 1, ["x", "y", "z"]);
  await sequence.page.mouse.click(other.point.x, other.point.y);
  assert.equal((await snapshot(sequence.page)).selected, 1, "Cube click selects another area");
  /** @type {any} */
  const before = await snapshot(sequence.page);
  await surfaceDrag(sequence, "face", ["z"], { x: 0.3, y: 0.3 });
  /** @type {any} */
  const horizontal = await snapshot(sequence.page);
  assert.notEqual(horizontal.draft.x_min, before.draft.x_min, "Top face moves X");
  assert.notEqual(horizontal.draft.y_min, before.draft.y_min, "Top face moves Y");
  await surfaceDrag(sequence, "face", ["x", "y"], { z: 0.3 });
  /** @type {any} */
  const moved = await snapshot(sequence.page);
  assert.notEqual(moved.draft.z_min, before.draft.z_min, "Side face moves height");
  assert.ok(Math.abs(moved.draft.z_max - moved.draft.z_min - (before.draft.z_max - before.draft.z_min)) < 1e-8, "Face movement preserves height");
  await surfaceDrag(sequence, "edge", ["z"], { x: 0.3, y: 0.3 });
  /** @type {any} */
  const edged = await snapshot(sequence.page);
  assert.notEqual(edged.draft.x_max - edged.draft.x_min, moved.draft.x_max - moved.draft.x_min, "Vertical edge resizes X");
  assert.notEqual(edged.draft.y_max - edged.draft.y_min, moved.draft.y_max - moved.draft.y_min, "Vertical edge resizes Y");
  await axisDrag(sequence, "z", "max", 10);
  /** @type {any} */
  const resized = await snapshot(sequence.page);
  assert.equal(resized.draft.z_max, resized.axes.z.max, "Height arrow clamps at permitted maximum");
  assert.deepEqual(resized.actual, before.actual, "Gestures leave actual bounds untouched");
  await editorFrame(sequence.page).getByRole("button", { name: "Fit view", exact: true }).click();
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function stagedApply(sequence) {
  await enterBound(sequence, "Z Max (m)", "4.2");
  /** @type {any} */
  const draft = await snapshot(sequence.page);
  assert.equal(draft.draft.z_max, 4.2, "Numeric height edit retained");
  if (sequence.recording) await sequence.page.waitForTimeout(2000);
  await editorFrame(sequence.page).locator("fieldset:not([hidden]) button.primary").click();
  await editorFrame(sequence.page).waitForFunction(() => Boolean(window.demoFrame.editor.zones[window.demoFrame.editor.selected].pending));
  cue(sequence, "Apply is pending.");
  /** @type {any} */
  const pending = await snapshot(sequence.page);
  assert.deepEqual(pending.actual, draft.actual, "Pending retains prior actual values");
  await editorFrame(sequence.page).waitForFunction(() => {
    /** @type {object} */
    const zone = window.demoFrame.editor.zones[window.demoFrame.editor.selected];
    return !zone.pending && !zone.dirty && zone.actual.z_max === 4.2;
  });
  cue(sequence, "The simulated actual values now agree. The staged draft is confirmed.");
  assert.deepEqual((await snapshot(sequence.page)).actual, draft.draft, "Staged actual values match all requested bounds");
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function discardAndFit(sequence) {
  await enterBound(sequence, "Z Max (m)", "3.8");
  assert.equal((await snapshot(sequence.page)).dirty, true);
  await editorFrame(sequence.page).getByRole("button", { name: "Discard draft", exact: true }).filter({ visible: true }).click();
  /** @type {any} */
  const discarded = await snapshot(sequence.page);
  assert.equal(discarded.dirty, false);
  assert.deepEqual(discarded.draft, discarded.actual, "Discard restores actual bounds");
  await editorFrame(sequence.page).getByRole("button", { name: "Fit view", exact: true }).click();
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function topView(sequence) {
  await editorFrame(sequence.page).getByRole("button", { name: "Top view", exact: true }).click();
  /** @type {any} */
  const before = await snapshot(sequence.page);
  await rectangleDrag(sequence, "rect.hit", 35, -20);
  /** @type {any} */
  const moved = await snapshot(sequence.page);
  assert.notEqual(moved.draft.x_min, before.draft.x_min, "Top view rectangle moves");
  assert.ok(Math.abs((moved.draft.x_max - moved.draft.x_min) - (before.draft.x_max - before.draft.x_min)) < 1e-8, "Rectangle move preserves width");
  await rectangleDrag(sequence, "rect[data-corner='max,max'][pointer-events='all']", 40, -30);
  /** @type {any} */
  const resized = await snapshot(sequence.page);
  assert.ok(resized.draft.x_max > moved.draft.x_max, "Top view corner increases width");
  assert.deepEqual(resized.actual, before.actual, "Top view retains local drafts");
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function pauseResume(sequence) {
  await sequence.page.getByRole("button", { name: "Pause", exact: true }).click();
  assert.equal((await snapshot(sequence.page)).paused, true);
  /** @type {number} */
  const elapsed = (await snapshot(sequence.page)).elapsed;
  await enterBound(sequence, "Y Max (m)", "5.0");
  assert.equal((await snapshot(sequence.page)).elapsed, elapsed, "Pause freezes simulation while editing works");
  if (sequence.recording) await sequence.page.waitForTimeout(1000);
  await sequence.page.getByRole("button", { name: "Resume", exact: true }).click();
  await editorFrame(sequence.page).waitForFunction((elapsed) => window.demoFrame.simulator.elapsed > elapsed, elapsed);
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function directApply(sequence) {
  await sequence.page.selectOption("#preset", "ld2450");
  await waitReady(sequence.page, "ld2450");
  assert.equal((await snapshot(sequence.page)).view, "top");
  assert.equal((await snapshot(sequence.page)).zoneCount, 1);
  await rectangleDrag(sequence, "rect.hit", 25, -20);
  await enterBound(sequence, "X Max (m)", "1.2");
  /** @type {any} */
  const before = await snapshot(sequence.page);
  assert.equal(before.write, "direct");
  await editorFrame(sequence.page).locator("button.primary").click();
  await editorFrame(sequence.page).waitForFunction(() => !window.demoFrame.editor.zones[0].dirty && !window.demoFrame.editor.busy);
  assert.deepEqual((await snapshot(sequence.page)).actual, before.draft, "Direct Apply agrees with the full draft");
  assert.equal(await editorFrame(sequence.page).evaluate(() => {
    /** @type {object} */
    const app = window.demoFrame;
    /** @type {object} */
    const zone = app.editor.zones[0];
    return Object.entries(zone.definition.bounds).every(([key, ref]) =>
      app.simulator.values.get(`${ref.domain}/${ref.id}`) === zone.actual[key] / ref.scale);
  }), true, "LD2450 writes metre bounds as scaled entity values");
}

/** @param {Sequence} sequence @returns {Promise<void>} */
async function interferenceArea(sequence) {
  await sequence.page.selectOption("#preset", "ld6002b");
  await waitReady(sequence.page, "ld6002b");
  await editorFrame(sequence.page).getByRole("button", { name: "Interference 0", exact: true }).click();
  assert.equal((await snapshot(sequence.page)).selected, 4);
  assert.equal((await snapshot(sequence.page)).zoneCount, 8);
  assert.equal((await snapshot(sequence.page)).view, "3d");
  await axisDrag(sequence, "z", "max", 0.3);
  await axisDrag(sequence, "x", "max", 0.4);
  assert.equal((await snapshot(sequence.page)).dirty, true);
  await editorFrame(sequence.page).getByRole("button", { name: "Fit view", exact: true }).click();
}

/** The same real interactions power both the recording and the quick browser gate.
 * @param {Sequence} sequence @returns {Promise<void>}
 */
export async function runSequence(sequence) {
  await shot(sequence, 5, "Simulated XYZ targets move through four LD6004 detection cuboids. Drop-lines show height above the floor.", async () => {
    /** @type {any} */
    const first = await snapshot(sequence.page);
    assert.equal(first.view, "3d");
    assert.equal(first.zoneCount, 4);
    assert.equal(first.targets.length, 3);
    await editorFrame(sequence.page).locator("line.drop-line").first().waitFor({ state: "attached" });
    await editorFrame(sequence.page).waitForFunction((first) => window.demoFrame.editor.targets.some((target, index) => target.z !== first[index].z), first.targets);
  });
  await shot(sequence, 5, "Drag empty scene space to orbit. Icon buttons zoom the camera without changing bounds.", () => orbitAndZoom(sequence));
  await shot(sequence, 9, "Click another cube. Drag faces to move X/Y and height, then a vertical edge to resize X/Y. The height arrow clamps at the limit.", () => manipulateXYZ(sequence));
  await shot(sequence, 6, "Enter 4.2 metres. Apply uses staged writes.", () => stagedApply(sequence));
  await shot(sequence, 4, "A further height edit stays local. Discard restores actual values, and Fit adjusts the camera.", () => discardAndFit(sequence));
  await shot(sequence, 6, "Top view edits the same zone as a rectangle. Drag its centre to move and a corner to resize.", () => topView(sequence));
  await shot(sequence, 4, "Pause freezes target motion while precise editing remains available. Resume starts motion again.", () => pauseResume(sequence));
  await shot(sequence, 6, "LD2450 uses a 2D map and direct writes. Apply updates the simulated millimetre entities from metre bounds.", () => directApply(sequence));
  await shot(sequence, 6, "LD6002B adds four interference areas. Select Interference 0 and resize its height and X bound precisely with axis arrows.", () => interferenceArea(sequence));
  await shot(sequence, 3, "Reset clears local edits and restores the simulated sensor mapping. Try the interactive demo.", async () => {
    await sequence.page.getByRole("button", { name: "Reset", exact: true }).click();
    await waitReady(sequence.page, "ld6002b");
    assert.equal((await snapshot(sequence.page)).dirty, false);
    assert.equal((await snapshot(sequence.page)).selected, 0);
  });
  cue(sequence, "");
}

/** @param {import('playwright').Page} page @returns {Promise<void>} */
export async function checkLayouts(page) {
  for (const width of [1440, 768, 375]) {
    await page.setViewportSize({ width, height: 1200 });
    for (const id of ["ld6004", "ld2450", "ld6002b"]) {
      await page.selectOption("#preset", id);
      await waitReady(page, id);
      await page.waitForFunction(() => {
        /** @type {HTMLIFrameElement} */
        const frame = document.querySelector("#editor-frame");
        return frame.contentDocument.body.getBoundingClientRect().height <= frame.clientHeight + 1;
      });
      /** @type {{horizontal: boolean, clipped: boolean}} */
      const measured = await page.evaluate(() => {
        /** @type {HTMLIFrameElement} */
        const frame = document.querySelector("#editor-frame");
        return { horizontal: document.documentElement.scrollWidth > innerWidth || frame.contentDocument.documentElement.scrollWidth > frame.clientWidth,
          clipped: frame.contentDocument.body.getBoundingClientRect().height > frame.clientHeight + 1 };
      });
      assert.deepEqual(measured, { horizontal: false, clipped: false }, `${id} layout at ${width}px`);
    }
  }
}
