import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";
const source = await readFile(new URL("../coordinate-editor.js", import.meta.url), "utf8");
const ref = (id, domain = "number", scale = 1) => ({ id, domain, scale });
function setup(staged = false) {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  dom.window.eval(source);
  const editor = new dom.window.CoordinateEditor();
  const bounds = Object.fromEntries(["x_min", "x_max", "y_min", "y_max"].map((key) => [key, ref(key)]));
  editor.config = {
    unit: "m",
    axes: { x: { min: -10, max: 10, step: 0.1 }, y: { min: 0, max: 10, step: 0.1 } },
    targets: [],
    zones: [],
    pollMs: 500,
    expireMs: 2000,
  };
  const definition = {
    label: "Area",
    bounds,
    write: staged ? "staged" : "direct",
    staging: Object.fromEntries(Object.keys(bounds).map((key) => [key, ref(`stage_${key}`)])),
    applyButton: ref("apply", "button"),
    stagingHasNoSideEffects: true,
  };
  const zone = {
    definition,
    available: true,
    actual: { x_min: -1, x_max: 1, y_min: 1, y_max: 3 },
    draft: { x_min: -2, x_max: 2, y_min: 1, y_max: 3 },
    dirty: true,
  };
  editor.config.zones = [definition];
  editor.zones = [zone];
  editor.refresh = () => {};
  return { dom, editor, zone };
}
test("rejects unavailable numeric values and snaps relative to configured minimum", () => {
  const { dom } = setup();
  for (const value of [null, "", "NA", NaN, Infinity, "12 mm"])
    assert.equal(dom.window.eval(`numeric({value: ${JSON.stringify(value)}})`), null);
  assert.equal(dom.window.eval("numeric({value: 0})"), 0);
  assert.equal(dom.window.eval('numeric({value: "-1.25"})'), -1.25);
  assert.equal(dom.window.eval('numeric({value: "1e3"})'), 1000);
  assert.equal(dom.window.eval("snap(0.31, {min: 0.1, step: 0.2})"), 0.3);
  dom.window.close();
});
test("direct partial failure retains draft and reports mixed bounds", async () => {
  const { dom, editor, zone } = setup();
  let writes = 0;
  editor.readBounds = async () => ({ ...zone.actual });
  editor.request = async () => {
    if (++writes === 2) throw Error("offline");
  };
  await editor.apply(zone);
  assert.equal(writes, 2);
  assert.equal(zone.dirty, true);
  assert.match(zone.message, /mixed bounds/);
  assert.equal(editor.busy, false);
  dom.window.close();
});
test("changed actual bounds block writes until reviewed", async () => {
  const { dom, editor, zone } = setup();
  let writes = 0;
  editor.readBounds = async () => ({ ...zone.actual, x_min: -3 });
  editor.request = async () => writes++;
  await editor.apply(zone);
  assert.equal(writes, 0);
  assert.equal(zone.conflict, true);
  dom.window.close();
});
test("staged verification failure suppresses Apply", async () => {
  const { dom, editor, zone } = setup(true);
  const calls = [];
  editor.readBounds = async () => ({ ...zone.actual });
  editor.request = async (reference, value) => {
    calls.push(reference.id);
    return value === undefined ? 100 : undefined;
  };
  await editor.apply(zone);
  assert.equal(calls.includes("apply"), false);
  assert.match(zone.message, /Apply not sent/);
  assert.equal(zone.dirty, true);
  dom.window.close();
});
test("staged success sends button only after verifying every value", async () => {
  const { dom, editor, zone } = setup(true);
  const calls = [];
  editor.readBounds = async () => ({ ...zone.actual });
  editor.request = async (reference, value) => {
    calls.push([reference.id, value]);
    return zone.draft[reference.id.replace("stage_", "")];
  };
  await editor.apply(zone);
  assert.equal(calls.length, 9);
  assert.equal(calls[8][0], "apply");
  assert.match(zone.message, /Hardware confirmation unavailable/);
  dom.window.close();
});
test("disposal during staging verification suppresses button and stale completion", async () => {
  const { dom, editor, zone } = setup(true);
  let button = false;
  editor.readBounds = async () => ({ ...zone.actual });
  editor.request = async (reference, value) => {
    if (value === undefined) editor.disconnectedCallback();
    if (reference.id === "apply") button = true;
    return -2;
  };
  await editor.apply(zone);
  assert.equal(button, false);
  assert.equal(zone.dirty, true);
  dom.window.close();
});
test("XY and XYZ mapping, absence, zero and expiry render independently", () => {
  const { dom, editor } = setup();
  editor.config.zones = [];
  editor.zones = [];
  editor.draw();
  editor.targets = [
    { definition: { label: "Zero" }, x: 0, y: 0, z: null, presence: null, age: null, received: Date.now() },
    { definition: { label: "XYZ", z: ref("z") }, x: 1, y: 2, z: 3, presence: true, age: null, received: Date.now() },
  ];
  editor.drawPoints();
  assert.equal(editor.svg.querySelectorAll("circle").length, 2);
  assert.match(editor.details.textContent, /Z 3/);
  editor.targets[0].presence = false;
  editor.targets[1].received = 0;
  editor.drawPoints();
  assert.equal(editor.svg.querySelectorAll("circle").length, 0);
  dom.window.close();
});
test("poll preserves dirty drafts and detects actual changes", async () => {
  const { dom, editor, zone } = setup();
  editor.readBounds = async () => ({ ...zone.actual, x_min: -3 });
  await editor.poll(editor.generation);
  assert.equal(zone.draft.x_min, -2);
  assert.equal(zone.actual.x_min, -3);
  assert.equal(zone.conflict, true);
  editor.disconnectedCallback();
  dom.window.close();
});
test("report age hides stale points even when a browser read is recent", () => {
  const { dom, editor } = setup();
  editor.zones = [];
  editor.draw();
  editor.targets = [
    { definition: { label: "Old", age: { max: 2 } }, x: 0, y: 1, presence: true, age: 3, received: Date.now() },
  ];
  editor.drawPoints();
  assert.equal(editor.svg.querySelectorAll("circle").length, 0);
  dom.window.close();
});
test("scaled reads and writes use mapped endpoints", async () => {
  const { dom, editor } = setup();
  const calls = [];
  dom.window.AbortSignal.any = () => undefined;
  dom.window.AbortSignal.timeout = () => undefined;
  dom.window.fetch = async (url, options) => {
    calls.push([url, options.method]);
    return { ok: true, json: async () => ({ value: "1234" }) };
  };
  editor.controller = new dom.window.AbortController();
  assert.equal(await editor.request(ref("custom_x", "sensor", 0.001)), 1.234);
  await editor.request(ref("custom_limit", "number", 0.001), 1.5);
  assert.deepEqual(calls, [
    ["/sensor/custom_x", "GET"],
    ["/number/custom_limit/set?value=1500", "POST"],
  ]);
  dom.window.close();
});
test("staged pending draft survives poll until actual values agree", async () => {
  const { dom, editor, zone } = setup(true);
  zone.pending = { ...zone.draft };
  editor.readBounds = async () => ({ ...zone.actual });
  await editor.poll(editor.generation);
  assert.equal(zone.dirty, true);
  assert.equal(zone.draft.x_min, -2);
  assert.equal(zone.conflict, undefined);
  clearTimeout(editor.timer);
  editor.readBounds = async () => ({ ...zone.pending });
  await editor.poll(editor.generation);
  assert.equal(zone.dirty, false);
  assert.equal(zone.pending, null);
  assert.match(zone.message, /Hardware confirmation unavailable/);
  editor.disconnectedCallback();
  dom.window.close();
});
test("validation rejects empty entity names and invalid axes", () => {
  const { dom, editor } = setup();
  dom.window.fixtureConfig = editor.config;
  assert.doesNotThrow(() => dom.window.eval("validate(fixtureConfig)"));
  editor.config.zones[0].bounds.x_min.id = "";
  assert.throws(() => dom.window.eval("validate(fixtureConfig)"), /Invalid entity/);
  editor.config.zones[0].bounds.x_min.id = "safe";
  editor.config.axes.x.step = 0;
  assert.throws(() => dom.window.eval("validate(fixtureConfig)"), /Invalid x axis/);
  dom.window.close();
});
test("zero extent drafts are invalid but coordinate zero is valid", () => {
  const { dom, editor, zone } = setup();
  zone.draft.x_min = 0;
  zone.draft.x_max = 0;
  assert.equal(editor.validDraft(zone), false);
  zone.draft.x_max = 1;
  assert.equal(editor.validDraft(zone), true);
  dom.window.close();
});
test("scaled decimal round-off does not suppress staged Apply", async () => {
  const { dom, editor, zone } = setup(true);
  let pressed = false;
  zone.draft.x_max = 0.7;
  editor.readBounds = async () => ({ ...zone.actual });
  editor.request = async (reference, value) => {
    if (reference.id === "apply") pressed = true;
    if (value === undefined)
      return reference.id === "stage_x_max" ? 700 * 0.001 : zone.draft[reference.id.replace("stage_", "")];
  };
  await editor.apply(zone);
  assert.equal(pressed, true);
  dom.window.close();
});
test("poll leaves local editing enabled while waiting on network reads", async () => {
  const { dom, editor, zone } = setup();
  editor.refresh = dom.window.CoordinateEditor.prototype.refresh;
  editor.draw();
  let release;
  editor.readBounds = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const polling = editor.poll(editor.generation);
  assert.equal(editor.forms[0].controls.x_min.disabled, false);
  release({ ...zone.actual });
  await polling;
  assert.equal(editor.forms[0].controls.x_min.disabled, false);
  editor.disconnectedCallback();
  dom.window.close();
});
test("move clamps all boundaries without changing dimensions or Z", () => {
  const { dom } = setup();
  for (const delta of [
    { x: 100, y: 100 },
    { x: -100, y: -100 },
  ]) {
    dom.window.delta = delta;
    const box = dom.window.eval(
      "moveBounds({x_min: -1, x_max: 1, y_min: 1, y_max: 3, z_min: 2, z_max: 4}, " +
        "delta, {x: {min: -5, max: 5, step: .1}, y: {min: 0, max: 8, step: .2}})",
    );
    assert.equal(box.x_max - box.x_min, 2);
    assert.equal(box.y_max - box.y_min, 2);
    assert.equal(box.z_min, 2);
    assert.ok(box.x_min >= -5 && box.x_max <= 5 && box.y_min >= 0 && box.y_max <= 8);
  }
  dom.window.close();
});
test("corner resizing prevents crossing and uses minimum-relative steps", () => {
  const { dom } = setup();
  for (const x of ["min", "max"])
    for (const y of ["min", "max"]) {
      dom.window.corner = [x, y];
      const box = dom.window.eval(
        "resizeBounds({x_min: .1, x_max: .9, y_min: .1, y_max: .9}, " +
          "{x: .51, y: .51}, corner, {x: {min: .1, max: 2.1, step: .2}, y: {min: .1, max: 2.1, step: .2}})",
      );
      assert.ok(box.x_max > box.x_min && box.y_max > box.y_min);
      assert.equal(box[`x_${x}`], 0.5);
    }
  assert.equal(dom.window.eval("resizeBounds({}, {x: NaN}, [], {})"), null);
  dom.window.close();
});
function rendered() {
  const state = setup();
  state.editor.refresh = state.dom.window.CoordinateEditor.prototype.refresh;
  state.editor.draw();
  return state;
}
test("Fit preserves limits and static layers survive target refreshes", () => {
  const { dom, editor, zone } = rendered();
  const limits = JSON.stringify(editor.config.axes);
  const grid = editor.gridLayer.firstChild,
    box = editor.zoneLayer.firstChild,
    svg = editor.svg;
  editor.drawPoints();
  editor.refresh();
  assert.equal(editor.gridLayer.firstChild, grid);
  assert.equal(editor.zoneLayer.firstChild, box);
  editor.fitView();
  assert.equal(JSON.stringify(editor.config.axes), limits);
  assert.equal(editor.svg, svg);
  assert.notEqual(editor.gridLayer.firstChild, grid);
  assert.equal(editor.forms[0].controls.x_min.min, "-10");
  assert.equal(editor.validDraft(zone), true);
  dom.window.close();
});
test("keyboard moves only the focused map and Shift multiplies axis steps", () => {
  const { dom, editor, zone } = rendered();
  let prevented = false;
  const event = {
    target: editor.svg,
    key: "ArrowRight",
    shiftKey: true,
    preventDefault() {
      prevented = true;
    },
  };
  editor.keyMove(event);
  assert.equal(zone.draft.x_min, -1);
  assert.equal(prevented, true);
  event.target = editor.forms[0].controls.x_min;
  editor.keyMove(event);
  assert.equal(zone.draft.x_min, -1);
  dom.window.close();
});
test("gesture and numeric focus survive in-flight reads and cancel restores state", async () => {
  const { dom, editor, zone } = rendered();
  zone.dirty = false;
  zone.draft = { ...zone.actual };
  let release;
  editor.readBounds = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const pending = editor.poll(editor.generation);
  editor.pointer = (event) => ({ x: event.clientX, y: event.clientY });
  editor.svg.setPointerCapture = () => {};
  editor.startGesture({
    button: 0,
    target: editor.zoneLayer.querySelector(".hit"),
    pointerId: 1,
    clientX: 0,
    clientY: 2,
    preventDefault() {},
  });
  release({ ...zone.actual, x_min: -3 });
  await pending;
  assert.equal(zone.draft.x_min, -1);
  assert.equal(zone.conflict, true);
  editor.updateGesture({ pointerId: 1, clientX: 1, clientY: 3 });
  assert.equal(zone.draft.x_min, 0);
  editor.endGesture({ pointerId: 2 }, true);
  assert.ok(editor.drag);
  editor.endGesture({ pointerId: 1 }, true);
  assert.equal(zone.draft.x_min, -1);
  assert.equal(zone.dirty, false);
  editor.disconnectedCallback();
  dom.window.close();
});
test("labels are literal and stable target colours match mark and detail", () => {
  const { dom, editor } = rendered();
  editor.targets = [
    { index: 2, definition: { label: "<b>Target</b>" }, x: 0, y: 2, age: null, presence: null, received: Date.now() },
  ];
  editor.drawPoints();
  assert.equal(editor.targetLayer.querySelector("circle").getAttribute("fill"), "#9a5c00");
  assert.equal(editor.details.querySelector("p").style.color, "rgb(154, 92, 0)");
  assert.equal(editor.targetLayer.querySelector("text").textContent, "<b>Target</b>");
  assert.equal(editor.details.querySelector("b"), null);
  dom.window.close();
});
test("numeric focus protects a clean draft during a deferred read", async () => {
  const { dom, editor, zone } = rendered();
  dom.window.document.body.append(editor.svg);
  zone.dirty = false;
  zone.draft = { ...zone.actual };
  let release;
  editor.readBounds = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const polling = editor.poll(editor.generation);
  const input = editor.forms[0].controls.x_min;
  input.onfocus();
  input.value = "-0.5";
  input.oninput();
  release({ ...zone.actual });
  await polling;
  assert.equal(zone.draft.x_min, -0.5);
  assert.equal(zone.dirty, true);
  assert.equal(input.disabled, false);
  editor.disconnectedCallback();
  dom.window.close();
});
test("selection preserves drafts and read-only XYZ has six disabled fields", () => {
  const { dom, editor, zone } = setup();
  const second = {
    ...zone,
    definition: { label: "Read-only", bounds: { ...zone.definition.bounds, z_min: ref("z_min"), z_max: ref("z_max") } },
    actual: { ...zone.actual, z_min: 0, z_max: 2 },
    draft: { ...zone.draft, z_min: 0, z_max: 2 },
    message: "Preserved draft",
    pending: { ...zone.draft },
  };
  editor.config.axes.z = { min: -5, max: 5, step: 0.1 };
  editor.zones.push(second);
  editor.refresh = dom.window.CoordinateEditor.prototype.refresh;
  editor.draw();
  editor.selectZone(1);
  assert.equal(Object.keys(editor.forms[1].controls).length, 6);
  assert.ok(Object.values(editor.forms[1].controls).every((input) => input.disabled));
  assert.equal(editor.forms[1].apply.hidden, true);
  assert.equal(editor.zoneLayer.querySelector(".handle"), null);
  assert.match(editor.forms[1].dimensions.textContent, /Height 2 m/);
  editor.selectZone(0);
  assert.equal(zone.draft.x_min, -2);
  assert.equal(second.message, "Preserved draft");
  dom.window.close();
});
test("local input, Fit, selection, move and resize send no requests", () => {
  const { dom, editor, zone } = rendered();
  const requests = [];
  editor.request = (...args) => requests.push(args);
  const input = editor.forms[0].controls.x_min;
  input.value = "-3";
  input.oninput();
  editor.fitView();
  editor.selectZone(0);
  editor.pointer = (event) => ({ x: event.clientX, y: event.clientY });
  editor.svg.setPointerCapture = () => {};
  for (const selector of [".hit", ".handle"]) {
    editor.startGesture({
      button: 0,
      target: editor.zoneLayer.querySelector(selector),
      pointerId: 1,
      clientX: 0,
      clientY: 2,
      preventDefault() {},
    });
    editor.updateGesture({ pointerId: 1, clientX: 0.1, clientY: 2.1 });
    editor.endGesture({ pointerId: 1 }, false);
  }
  assert.equal(requests.length, 0);
  assert.equal(zone.dirty, true);
  dom.window.close();
});
test("out-of-view targets remain counted and invalid optional labels are rejected", () => {
  const { dom, editor } = rendered();
  editor.targets = [
    {
      index: 0,
      definition: { label: "Outside", z: ref("z") },
      x: 100,
      y: 2,
      z: null,
      age: null,
      presence: null,
      received: Date.now(),
    },
  ];
  editor.drawPoints();
  assert.match(editor.summary.textContent, /1 usable target, 0 plotted/);
  assert.match(editor.details.textContent, /Z unavailable.*Outside view/);
  dom.window.fixtureConfig = { ...editor.config, title: 7 };
  assert.throws(() => dom.window.eval("validate(fixtureConfig)"), /Invalid title/);
  dom.window.close();
});
test("pointer transform round trips fitted coordinates independently of allowed axes", () => {
  const { dom, editor } = rendered();
  editor.fitView();
  const { px, py } = editor.projection();
  editor.svg.getScreenCTM = () => ({ inverse: () => ({}) });
  dom.window.DOMPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    matrixTransform() {
      return this;
    }
  };
  const point = editor.pointer({ clientX: px(0.3), clientY: py(1.7) });
  assert.ok(Math.abs(point.x - 0.3) < 1e-8);
  assert.ok(Math.abs(point.y - 1.7) < 1e-8);
  dom.window.close();
});
test("clamping preserves configured steps when the maximum is off-grid", () => {
  const { dom } = setup();
  const moved = dom.window.eval(
    "moveBounds({x_min:.1,x_max:.5,y_min:.1,y_max:.5}, " +
      "{x:100,y:100}, {x:{min:.1,max:1,step:.2},y:{min:.1,max:1,step:.2}})",
  );
  assert.equal(moved.x_max, 0.9);
  const resized = dom.window.eval(
    "resizeBounds({x_min:.1,x_max:.5,y_min:.1,y_max:.5}, " +
      '{x:100,y:100}, ["max","max"], {x:{min:.1,max:1,step:.2},y:{min:.1,max:1,step:.2}})',
  );
  assert.equal(resized.x_max, 0.9);
  dom.window.close();
});
test("off-centre corner grabs preserve stationary bounds and resize by pointer displacement", () => {
  const { dom, editor, zone } = rendered();
  zone.dirty = false;
  zone.draft = { ...zone.actual, z_min: 0, z_max: 2 };
  const original = { ...zone.draft };
  editor.refresh();
  editor.pointer = (event) => ({ x: event.clientX, y: event.clientY });
  editor.svg.setPointerCapture = () => {};
  editor.startGesture({
    button: 0,
    target: editor.zoneLayer.querySelector('[data-corner="max,max"]'),
    pointerId: 1,
    clientX: 0.7,
    clientY: 2.7,
    preventDefault() {},
  });
  editor.updateGesture({ pointerId: 1, clientX: 0.7, clientY: 2.7 });
  assert.deepEqual({ ...zone.draft }, original);
  assert.equal(zone.dirty, false);
  editor.updateGesture({ pointerId: 1, clientX: 0.9, clientY: 3.1 });
  assert.deepEqual({ ...zone.draft }, { ...original, x_max: 1.2, y_max: 3.4 });
  assert.equal(zone.dirty, true);
  editor.endGesture({ pointerId: 1 }, false);
  dom.window.close();
});

test("entity names with spaces and UTF-8 validate and use encoded REST paths", async () => {
  const { dom, editor } = setup();
  try {
    const names = ["Target 1 X", "位置 X", "Zone / café?#%"];
    dom.window.fixtureConfig = editor.config;
    dom.window.AbortSignal.any = () => undefined;
    dom.window.AbortSignal.timeout = () => undefined;
    editor.controller = new dom.window.AbortController();
    const calls = [];
    dom.window.fetch = async (url, options) => {
      calls.push([url, options.method]);
      return { ok: true, json: async () => ({ value: 1 }) };
    };
    for (const name of names) {
      editor.config.zones[0].bounds.x_min.id = name;
      assert.doesNotThrow(() => dom.window.eval("validate(fixtureConfig)"));
      await editor.request(ref(name, "sensor"));
      await editor.request(ref(name), 2);
      await editor.request(ref(name, "button"), 1);
    }
    assert.deepEqual(calls, names.flatMap((name) => [
      [`/sensor/${encodeURIComponent(name)}`, "GET"],
      [`/number/${encodeURIComponent(name)}/set?value=2`, "POST"],
      [`/button/${encodeURIComponent(name)}/press`, "POST"],
    ]));
  } finally { dom.window.close(); }
});

for (const competing of [false, true]) {
  test(competing ? "competing updates while pending retain draft and require review" : "rejected staged command expires and blocks retry until review", async () => {
    const { dom, editor, zone } = setup(true);
    try {
      editor.config.pendingTimeoutMs = 20;
      const actual = { ...zone.actual };
      editor.readBounds = async () => ({ ...actual });
      let buttons = 0;
      editor.request = async (reference, value) => {
        if (reference.domain === "button") { buttons++; return; }
        return value === undefined ? zone.draft[reference.id.replace("stage_", "")] : undefined;
      };
      editor.draw();
      await editor.apply(zone);
      assert.ok(zone.pending);
      if (competing) actual.x_max = 4;
      await editor.poll(editor.generation);
      await new Promise((resolve) => dom.window.setTimeout(resolve, 35));
      assert.equal(zone.pending, null);
      assert.equal(zone.dirty, true);
      assert.equal(zone.draft.x_min, -2);
      assert.equal(zone.conflict, true);
      assert.match(zone.message, /device did not confirm/i);
      await editor.apply(zone);
      assert.equal(buttons, 1);
      editor.forms[0].acknowledge.click();
      assert.equal(zone.conflict, false);
      await editor.apply(zone);
      assert.equal(buttons, 2);
    } finally { editor.disconnectedCallback(); dom.window.close(); }
  });
}

test("uncertain Apply HTTP failure requires review before retry", async () => {
  const { dom, editor, zone } = setup(true);
  try {
    editor.readBounds = async () => ({ ...zone.actual });
    editor.request = async (reference, value) => {
      if (reference.domain === "button") throw Error("HTTP 500");
      return value === undefined ? zone.draft[reference.id.replace("stage_", "")] : undefined;
    };
    await editor.apply(zone);
    assert.equal(zone.conflict, true);
    assert.equal(zone.dirty, true);
  } finally { editor.disconnectedCallback(); dom.window.close(); }
});

test("pending deadline expires even when actual reads fail", async () => {
  const { dom, editor, zone } = setup(true);
  try {
    editor.config.pendingTimeoutMs = 20;
    editor.readBounds = async () => ({ ...zone.actual });
    editor.request = async (reference, value) => value === undefined ? zone.draft[reference.id.replace("stage_", "")] : undefined;
    await editor.apply(zone);
    editor.readBounds = async () => { throw Error("offline"); };
    await editor.poll(editor.generation);
    await new Promise((resolve) => dom.window.setTimeout(resolve, 35));
    assert.equal(zone.pending, null);
    assert.equal(zone.conflict, true);
    assert.equal(zone.available, false);
  } finally { editor.disconnectedCallback(); dom.window.close(); }
});

test("pending confirmation defaults to 15 seconds and cancels its deadline on agreement", async () => {
  const { dom, editor, zone } = setup(true);
  try {
    let delay;
    let cancelled;
    dom.window.setTimeout = (_callback, milliseconds) => { delay = milliseconds; return 123; };
    dom.window.clearTimeout = (timer) => { if (timer === 123) cancelled = true; };
    editor.readBounds = async () => ({ ...zone.actual });
    editor.request = async (reference, value) => value === undefined ? zone.draft[reference.id.replace("stage_", "")] : undefined;
    await editor.apply(zone);
    assert.equal(delay, 15000);
    editor.readBounds = async () => ({ ...zone.draft });
    await editor.poll(editor.generation);
    assert.equal(zone.pending, null);
    assert.equal(zone.dirty, false);
    assert.equal(cancelled, true);
  } finally { editor.disconnectedCallback(); dom.window.close(); }
});

test("pending deadline and entity reference types are validated", () => {
  const { dom, editor, zone } = setup();
  try {
    dom.window.fixtureConfig = editor.config;
    for (const value of [0, -1, Infinity, NaN, "15000", null, 2147483648]) {
      editor.config.pendingTimeoutMs = value;
      assert.throws(() => dom.window.eval("validate(fixtureConfig)"), /Invalid pending deadline/);
    }
    editor.config.pendingTimeoutMs = 15000;
    for (const value of [undefined, null, 123, {}, ""]) {
      zone.definition.bounds.x_min.id = value;
      assert.throws(() => dom.window.eval("validate(fixtureConfig)"), /Invalid entity reference/);
    }
  } finally { dom.window.close(); }
});

test("matching read-back after a competing pending update still requires review", async () => {
  const { dom, editor, zone } = setup(true);
  try {
    editor.readBounds = async () => ({ ...zone.actual });
    editor.request = async (reference, value) => value === undefined ? zone.draft[reference.id.replace("stage_", "")] : undefined;
    await editor.apply(zone);
    editor.readBounds = async () => ({ ...zone.actual, x_max: 4 });
    await editor.poll(editor.generation);
    assert.equal(zone.conflict, true);
    assert.ok(zone.pending);
    dom.window.clearTimeout(editor.timer);
    editor.readBounds = async () => ({ ...zone.draft });
    await editor.poll(editor.generation);
    assert.equal(zone.pending, null);
    assert.equal(zone.conflict, true);
    assert.equal(zone.dirty, true);
    assert.equal(zone.draft.x_min, -2);
  } finally { editor.disconnectedCallback(); dom.window.close(); }
});
