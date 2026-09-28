import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

/** @typedef {{x_min: number, x_max: number, y_min: number, y_max: number, z_min?: number, z_max?: number}} TestBounds */
/** @typedef {{id: string, domain: string, scale: number}} TestReference */
/** @typedef {Record<string, any>} TestEditor */
/** @typedef {Record<string, any>} TestZone */
/** @typedef {{dom: JSDOM, editor: TestEditor, zone: TestZone}} TestContext */
/** @type {string} */
const source = await readFile(new URL("../coordinate-editor.js", import.meta.url), "utf8");
/** @param {string} id @returns {TestReference} */
const ref = (id) => ({ id, domain: "number", scale: 1 });
/** @type {TestBounds} */
const box = { x_min: -1, x_max: 1, y_min: 1, y_max: 3, z_min: 0.5, z_max: 2 };
/** @param {boolean} xyz @returns {TestContext} */
function setup(xyz = true) {
  /** @type {JSDOM} */
  const dom = new JSDOM("", { runScripts: "outside-only" });
  dom.window.eval(source);
  /** @type {TestEditor} */
  const editor = new dom.window.CoordinateEditor();
  editor.config = {
    unit: "m", axes: { x: { min: -6, max: 6, step: 0.1 }, y: { min: -6, max: 6, step: 0.1 },
      ...(xyz ? { z: { min: -6, max: 6, step: 0.1 } } : {}) },
    targets: [], zones: [], pollMs: 500, expireMs: 2000,
  };
  /** @type {TestBounds} */
  const bounds = xyz ? { ...box } : { x_min: -1, x_max: 1, y_min: 1, y_max: 3 };
  /** @type {Record<string, any>} */
  const definition = { label: "Room", bounds: Object.fromEntries(Object.keys(bounds).map((key) => [key, ref(key)])), write: "direct" };
  /** @type {TestZone} */
  const zone = { definition, actual: { ...bounds }, draft: { ...bounds }, available: true, dirty: false };
  editor.config.zones = [definition];
  editor.zones = [zone];
  editor.draw();
  editor.svg.setPointerCapture = () => {};
  editor.svg.hasPointerCapture = () => true;
  editor.svg.releasePointerCapture = () => {};
  editor.scenePointer = (event) => ({ x: event.clientX, y: event.clientY });
  return { dom, editor, zone };
}
/** @param {Element} target @param {number} x @param {number} y @param {number} pointerId
 * @returns {{target: Element, clientX: number, clientY: number, pointerId: number, button: number, preventDefault: () => void}}
 */
function pointer(target, x = 0, y = 0, pointerId = 7) {
  return { target, clientX: x, clientY: y, pointerId, button: 0, preventDefault() {} };
}
/** @param {string} label @param {number | null} z @returns {Record<string, any>} */
function target(label, z) {
  return { index: 0, definition: { label, z: ref("z") }, x: 0, y: 2, z,
    presence: true, age: null, received: Date.now() };
}

test("XYZ defaults to cuboids with visible height while XY stays a rectangle", () => {
  /** @type {TestContext} */
  const spatial = setup();
  assert.equal(spatial.editor.viewMode, "3d");
  assert.ok(spatial.editor.svg.querySelectorAll("polygon[data-zone='0']").length >= 3);
  /** @type {string} */
  const points = spatial.editor.svg.querySelector("polygon").getAttribute("points");
  assert.match(points, /,/);
  assert.match(spatial.editor.svg.textContent, /Z/);
  /** @type {TestContext} */
  const flat = setup(false);
  assert.equal(flat.editor.viewMode, "top");
  assert.equal(flat.editor.svg.querySelectorAll("polygon").length, 0);
  assert.ok(flat.editor.svg.querySelector("rect.hit"));
  spatial.dom.window.close(); flat.dom.window.close();
});

test("projection uses Z and orbit without unequal unit scales", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  /** @type {{x: number, y: number, depth: number}} */
  const floor = editor.spatial.project({ x: 0, y: 2, z: 0 });
  /** @type {{x: number, y: number, depth: number}} */
  const raised = editor.spatial.project({ x: 0, y: 2, z: 1 });
  assert.ok(raised.y < floor.y);
  assert.equal(raised.x, floor.x);
  editor.spatial.camera.yaw += 0.7;
  /** @type {{x: number, y: number, depth: number}} */
  const orbited = editor.spatial.project({ x: 0, y: 2, z: 1 });
  assert.notEqual(orbited.x, raised.x);
  /** @type {Array<{x: number, y: number}>} */
  const axes = ["x", "y", "z"].map((axis) => editor.spatial.axisVector(axis));
  for (const vector of axes) assert.ok(Number.isFinite(vector.x) && Number.isFinite(vector.y));
  dom.window.close();
});

test("cuboid faces and targets are ordered by camera depth", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  /** @type {number[]} */
  const depths = [...editor.svg.querySelectorAll("polygon[data-depth]")].map((face) => Number(face.dataset.depth));
  assert.ok(depths.length >= 3);
  assert.deepEqual(depths, [...depths].sort((a, b) => a - b));
  editor.targets = [target("High", 2), { ...target("Low", 0), index: 1 }];
  editor.drawPoints();
  /** @type {SVGCircleElement[]} */
  const marks = [...editor.targetLayer.querySelectorAll("circle.point")];
  assert.ok(Number(marks[0].dataset.depth) <= Number(marks[1].dataset.depth));
  dom.window.close();
});

test("missing Z remains numeric and visible in Top view without fabricated 3D height", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  editor.targets = [target("High", 1.5), { ...target("Unknown", null), index: 1 }];
  editor.drawPoints();
  assert.equal(editor.targetLayer.querySelectorAll("circle.point").length, 1);
  assert.equal(editor.targetLayer.querySelectorAll("line.drop-line").length, 1);
  /** @type {SVGLineElement} */
  const line = editor.targetLayer.querySelector("line.drop-line");
  assert.notEqual(line.getAttribute("y1"), line.getAttribute("y2"));
  assert.match(editor.details.textContent, /Unknown:.*Z unavailable/);
  assert.match(editor.summary.textContent, /2 usable targets, 1 plotted/);
  editor.setViewMode("top");
  assert.equal(editor.targetLayer.querySelectorAll("circle.point").length, 2);
  assert.equal(editor.targetLayer.querySelectorAll("line.drop-line").length, 0);
  dom.window.close();
});

test("switching views preserves actual and local draft bounds", () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  editor.setDraft(zone, { ...zone.draft, z_max: 2.3 });
  editor.setViewMode("top");
  assert.equal(zone.draft.z_max, 2.3);
  assert.equal(zone.actual.z_max, 2);
  assert.ok(editor.svg.querySelector("rect.hit"));
  editor.setViewMode("3d");
  assert.equal(zone.draft.z_max, 2.3);
  assert.equal(zone.dirty, true);
  dom.window.close();
});

test("XYZ move preserves extents, clamps axes and snaps to their configured grid", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  dom.window.testAxes = editor.config.axes;
  /** @type {TestBounds} */
  const moved = JSON.parse(dom.window.eval("JSON.stringify(moveBounds({x_min:-1,x_max:1,y_min:1,y_max:3,z_min:0.5,z_max:2},{x:0.26,y:99,z:0.26},testAxes))"));
  assert.deepEqual(moved, { x_min: -0.7, x_max: 1.3, y_min: 4, y_max: 6, z_min: 0.8, z_max: 2.3 });
  dom.window.close();
});

test("single-face resizing snaps relative to minimum and forbids inverted or zero volume", () => {
  const { dom } = setup();
  /** @type {TestBounds} */
  const resized = JSON.parse(dom.window.eval("JSON.stringify(resizeAxisBounds({x_min:-1,x_max:1,y_min:1,y_max:3,z_min:0.55,z_max:2.05},'z','min',99,{min:-5.95,max:6,step:0.1}))"));
  assert.equal(resized.z_min, 1.95);
  assert.equal(resized.z_max, 2.05);
  assert.equal(resized.x_min, -1);
  /** @type {TestBounds} */
  const maximum = JSON.parse(dom.window.eval("JSON.stringify(resizeAxisBounds({x_min:-1,x_max:1,y_min:1,y_max:3,z_min:0.55,z_max:2.05},'z','max',99,{min:-5.95,max:6,step:0.1}))"));
  assert.equal(maximum.z_max, 5.95);
  assert.equal(dom.window.eval("axisDisplacement({x:100,y:100},{x:0,y:0})"), null);
  assert.equal(dom.window.eval("axisDisplacement({x:100,y:100},{x:1e-10,y:1e-10})"), null);
  dom.window.close();
});

test("axis move is local and incoming target redraw preserves the active handle", () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  /** @type {SVGElement} */
  const handle = editor.svg.querySelector("[data-axis='z'][data-edge='move']");
  assert.ok(handle);
  /** @type {number} */
  let writes = 0;
  editor.request = async () => { writes++; };
  /** @type {{x: number, y: number}} */
  const vector = editor.spatial.axisVector("z");
  editor.startGesture(pointer(handle));
  editor.updateGesture(pointer(handle, vector.x * 0.3, vector.y * 0.3));
  assert.equal(zone.draft.z_min, 0.8);
  assert.equal(zone.draft.z_max, 2.3);
  assert.equal(zone.actual.z_min, 0.5);
  editor.targets = [target("Moving", 1)];
  editor.refresh();
  assert.equal(editor.svg.querySelector("[data-axis='z'][data-edge='move']"), handle);
  assert.equal(writes, 0);
  assert.equal(editor.forms[0].apply.disabled, true);
  editor.endGesture({ pointerId: 7 }, false);
  assert.equal(editor.forms[0].apply.disabled, false);
  dom.window.close();
});

test("face handles resize only the selected bound and cancellation restores the prior draft", () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  editor.setManipulationMode("resize");
  /** @type {SVGElement} */
  const handle = editor.svg.querySelector("[data-axis='z'][data-edge='max']");
  assert.ok(handle);
  /** @type {{x: number, y: number}} */
  const vector = editor.spatial.axisVector("z");
  editor.startGesture(pointer(handle));
  editor.updateGesture(pointer(handle, vector.x * 0.3, vector.y * 0.3));
  assert.equal(zone.draft.z_max, 2.3);
  assert.equal(zone.draft.z_min, 0.5);
  editor.keyMove({ target: editor.svg, key: "Escape", preventDefault() {} });
  assert.deepEqual(JSON.parse(JSON.stringify(zone.draft)), box);
  assert.equal(zone.dirty, false);
  assert.equal(editor.drag, null);
  dom.window.close();
});

test("empty-space orbit, zoom and reset never create a draft or write", () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  /** @type {number} */
  let writes = 0;
  editor.request = async () => { writes++; };
  /** @type {number} */
  const yaw = editor.spatial.camera.yaw;
  editor.startGesture(pointer(editor.svg));
  editor.updateGesture(pointer(editor.svg, 80, 40));
  assert.notEqual(editor.spatial.camera.yaw, yaw);
  editor.endGesture({ pointerId: 7 }, false);
  editor.spatial.zoomBy(1000);
  assert.ok(editor.spatial.camera.zoom <= 4);
  editor.spatial.zoomBy(0.00001);
  assert.ok(editor.spatial.camera.zoom >= 0.35);
  editor.shadowRoot.querySelector('[data-action="reset-view"]').click();
  assert.equal(zone.dirty, false);
  assert.deepEqual(JSON.parse(JSON.stringify(zone.draft)), box);
  assert.equal(writes, 0);
  dom.window.close();
});

test("PageUp and PageDown move Z while review, unavailable and pending zones have no handles", () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  editor.keyMove({ target: editor.svg, key: "PageUp", preventDefault() {} });
  assert.equal(zone.draft.z_min, 0.6);
  editor.keyMove({ target: editor.svg, key: "PageDown", shiftKey: true, preventDefault() {} });
  assert.equal(zone.draft.z_min, -0.4);
  for (const state of ["conflict", "pending", "unavailable", "busy"]) {
    zone.conflict = state === "conflict";
    zone.pending = state === "pending" ? { ...zone.draft } : null;
    zone.available = state !== "unavailable";
    editor.busy = state === "busy";
    editor.refresh();
    assert.equal(editor.svg.querySelectorAll("[data-axis]").length, 0, state);
  }
  dom.window.close();
});

test("XY-only zones in XYZ configuration show a labelled footprint with no Z handles", () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  for (const key of ["z_min", "z_max"]) { delete zone.actual[key]; delete zone.draft[key]; delete zone.definition.bounds[key]; }
  editor.refresh();
  assert.equal(editor.svg.querySelectorAll("polygon[data-zone='0']").length, 1);
  assert.match(editor.svg.textContent, /XY only/);
  assert.equal(editor.svg.querySelectorAll("[data-axis='z']").length, 0);
  dom.window.close();
});

test("initial framing keeps full XY limits but omits empty negative Z, and fit includes elevated targets", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  assert.equal(editor.spatial.frame.x.min, -6);
  assert.equal(editor.spatial.frame.x.max, 6);
  assert.equal(editor.spatial.frame.z.min, 0);
  assert.equal(editor.spatial.frame.z.max, 2);
  editor.targets = [{ ...target("High", 5), x: 4 }];
  editor.fitView();
  assert.equal(editor.spatial.frame.z.max, 5);
  /** @type {string} */
  const camera = JSON.stringify(editor.spatial.camera);
  editor.targets[0].z = 3;
  editor.refresh();
  assert.equal(JSON.stringify(editor.spatial.camera), camera);
  assert.equal(editor.config.axes.z.min, -6);
  dom.window.close();
});

test("polling actual bounds keeps a captured spatial handle alive and pointercancel restores the draft", async () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  /** @type {SVGElement} */
  const handle = editor.svg.querySelector("[data-axis='z'][data-edge='move']");
  /** @type {{x: number, y: number}} */
  const vector = editor.spatial.axisVector("z");
  /** @type {(bounds: TestBounds) => void} */
  let release;
  editor.readBounds = () => new Promise((resolve) => { release = resolve; });
  /** @type {Promise<void>} */
  const polling = editor.poll(editor.generation);
  editor.startGesture(pointer(handle));
  editor.updateGesture(pointer(handle, vector.x * 0.3, vector.y * 0.3));
  release({ ...zone.actual, x_min: -1.2 });
  await polling;
  assert.equal(editor.svg.querySelector("[data-axis='z'][data-edge='move']"), handle);
  assert.equal(zone.draft.z_min, 0.8);
  assert.equal(zone.conflict, true);
  editor.svg.onpointercancel({ pointerId: 7 });
  assert.equal(zone.draft.z_min, 0.5);
  assert.equal(zone.dirty, false);
  assert.equal(zone.conflict, true);
  assert.equal(editor.svg.querySelectorAll("[data-axis]").length, 0);
  editor.disconnectedCallback();
  dom.window.close();
});

test("switching view and disposal release captured drags and their event handlers", () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  /** @type {number} */
  let released = 0;
  editor.svg.releasePointerCapture = () => { released++; };
  /** @type {SVGElement} */
  const handle = editor.svg.querySelector("[data-axis='z'][data-edge='move']");
  /** @type {{x: number, y: number}} */
  const vector = editor.spatial.axisVector("z");
  editor.startGesture(pointer(handle));
  editor.updateGesture(pointer(handle, vector.x * 0.3, vector.y * 0.3));
  editor.setViewMode("top");
  assert.equal(released, 1);
  assert.equal(editor.drag, null);
  assert.equal(zone.draft.z_min, 0.5);
  editor.setViewMode("3d");
  editor.startGesture(pointer(editor.svg));
  editor.disconnectedCallback();
  assert.equal(released, 2);
  for (const event of ["onpointerdown", "onpointermove", "onpointerup", "onpointercancel", "onkeydown", "onwheel"])
    assert.equal(editor.svg[event], null, event);
  dom.window.close();
});

test("near camera-aligned handles are suppressed instead of applying unstable axis deltas", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  editor.spatial.camera.yaw = Math.PI / 2;
  editor.spatial.camera.pitch = 0;
  editor.refresh();
  assert.equal(editor.svg.querySelectorAll("[data-axis='x']").length, 0);
  assert.ok(editor.svg.querySelector("[data-axis='y']"));
  assert.ok(editor.svg.querySelector("[data-axis='z']"));
  dom.window.close();
});

test("XYZ handle edits reach six real REST number writes only after Apply", async () => {
  /** @type {TestContext} */
  const { dom, editor, zone } = setup();
  /** @type {TestBounds} */
  const state = { ...zone.actual };
  /** @type {string[]} */
  const posts = [];
  dom.window.AbortSignal.any = () => undefined;
  dom.window.AbortSignal.timeout = () => undefined;
  dom.window.fetch = async (url, options) => {
    /** @type {URL} */
    const path = new URL(url, "http://sensor.local");
    /** @type {string} */
    const id = path.pathname.split("/")[2];
    if (options.method === "POST") {
      posts.push(path.pathname);
      state[id] = Number(path.searchParams.get("value"));
    }
    return { ok: true, json: async () => ({ value: state[id] }) };
  };
  editor.controller = new dom.window.AbortController();
  /** @type {SVGElement} */
  const handle = editor.svg.querySelector("[data-axis='z'][data-edge='move']");
  /** @type {{x: number, y: number}} */
  const vector = editor.spatial.axisVector("z");
  editor.startGesture(pointer(handle));
  editor.updateGesture(pointer(handle, vector.x * 0.3, vector.y * 0.3));
  editor.endGesture({ pointerId: 7 }, false);
  assert.equal(posts.length, 0);
  await editor.apply(zone);
  assert.equal(posts.length, 6);
  assert.equal(state.z_min, 0.8);
  assert.equal(state.z_max, 2.3);
  assert.equal(zone.actual.z_min, 0.8);
  assert.equal(zone.dirty, false);
  assert.match(zone.message, /Entity values agree/);
  dom.window.close();
});

test("camera icons keep accessible names and editing mode labels", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  for (const [action, label] of [["zoom-in", "Zoom in"], ["zoom-out", "Zoom out"], ["fit-view", "Fit view"], ["reset-view", "Reset view"]]) {
    /** @type {HTMLButtonElement} */
    const button = editor.shadowRoot.querySelector(`[data-action='${action}']`);
    assert.equal(button.getAttribute("aria-label"), label);
    assert.equal(button.title, label);
    assert.equal(button.querySelector("svg").getAttribute("aria-hidden"), "true");
  }
  for (const [attribute, value, label] of [["data-mode", "move", "Move"], ["data-mode", "resize", "Resize"],
    ["data-view", "3d", "3D view"], ["data-view", "top", "Top view"]]) {
    /** @type {HTMLButtonElement} */
    const button = editor.shadowRoot.querySelector(`[${attribute}='${value}']`);
    assert.ok(button.querySelector("svg"));
    assert.match(button.textContent, new RegExp(label));
  }
  assert.equal(editor.forms[0].select.textContent, "Room");
  dom.window.close();
});

test("XYZ target-only configurations render height without a selected zone", () => {
  /** @type {TestContext} */
  const { dom, editor } = setup();
  editor.config.zones = [];
  editor.zones = [];
  editor.targets = [target("Tracking", 1.2)];
  assert.doesNotThrow(() => editor.draw());
  assert.equal(editor.svg.querySelectorAll("circle.point").length, 1);
  assert.equal(editor.svg.querySelectorAll("polygon[data-zone]").length, 0);
  assert.equal(editor.svg.querySelectorAll("[data-axis]").length, 0);
  dom.window.close();
});
