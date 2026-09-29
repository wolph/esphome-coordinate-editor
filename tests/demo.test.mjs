import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { JSDOM } from "jsdom";

/** @typedef {import('../demo/types.js').EditorConfig} EditorConfig */
/** @typedef {import('../demo/simulator.js').Simulator} Simulator */

/** @returns {Promise<typeof import('../demo/presets.js')>} */
async function presets() {
  try { return await import("../demo/presets.js"); }
  catch (error) { assert.fail(`Preset implementation unavailable: ${error.message}`); }
}

/** @param {string} id @returns {Promise<EditorConfig>} */
async function example(id) {
  /** @type {{coordinateEditorConfig?: EditorConfig, dispatchEvent: () => void}} */
  const window = { dispatchEvent() {} };
  /** @type {string} */
  const source = await readFile(new URL(`../examples/${id}-config.js`, import.meta.url), "utf8");
  vm.runInNewContext(source, { window, Event: class {} });
  return JSON.parse(JSON.stringify(window.coordinateEditorConfig));
}

/** @param {string} [id] @param {object} [options] @returns {Promise<Simulator>} */
async function device(id = "ld6004", options = {}) {
  /** @type {typeof import('../demo/presets.js')} */
  const module = await presets();
  /** @type {typeof import('../demo/simulator.js')} */
  const simulation = await import("../demo/simulator.js");
  return new simulation.Simulator(module.createPreset(id, await example(id)), options);
}

/** @param {Simulator} simulator @param {import('../demo/types.js').Reference} ref @returns {Promise<number>} */
async function raw(simulator, ref) {
  /** @type {Response} */
  const response = await simulator.fetch(`/${ref.domain}/${encodeURIComponent(ref.id)}`);
  assert.equal(response.status, 200);
  return (await response.json()).value;
}

/** @param {Simulator} simulator @param {import('../demo/types.js').Reference} ref @param {number} value @returns {Promise<Response>} */
function write(simulator, ref, value) {
  return simulator.fetch(`/${ref.domain}/${encodeURIComponent(ref.id)}/set?value=${value}`, { method: "POST" });
}

/** @returns {{schedule: (callback: () => void, delay: number) => number, cancel: (id: number) => void, advance: (ms: number) => void}} */
function clock() {
  /** @type {number} */
  let elapsed = 0;
  /** @type {number} */
  let next = 0;
  /** @type {Map<number, {time: number, callback: () => void}>} */
  const pending = new Map();
  return {
    schedule(callback, delay) { pending.set(++next, { time: elapsed + delay, callback }); return next; },
    cancel(id) { pending.delete(id); },
    advance(ms) {
      elapsed += ms;
      for (const [id, item] of pending) {
        if (item.time <= elapsed) { pending.delete(id); item.callback(); }
      }
    },
  };
}

for (const id of ["ld2450", "ld6004", "ld6002b"]) {
  test(`${id} demo preserves example dimensions, scales, zones and write modes`, async () => {
    /** @type {EditorConfig} */
    const source = await example(id);
    /** @type {typeof import('../demo/presets.js')} */
    const module = await presets();
    /** @type {EditorConfig} */
    const config = module.createPreset(id, source);
    assert.deepEqual(config.axes, source.axes);
    assert.deepEqual(config.zones, source.zones);
    assert.equal(config.unit, source.unit);
    assert.equal(config.targets.length, 3);
    assert.deepEqual(config.targets[0].x, source.targets[0].x);
    assert.deepEqual(config.targets[0].y, source.targets[0].y);
    assert.equal(config.targets.every((target) => target.label.includes("Simulated")), true);
    assert.equal(config.targets.every((target) => Boolean(target.z)), id !== "ld2450");
    config.zones[0].label = "changed";
    assert.notEqual(source.zones[0].label, "changed");
  });
}

test("seeded motion repeats, pauses, changes presence and stays inside every axis", async () => {
  /** @type {Simulator} */
  const first = await device();
  /** @type {Simulator} */
  const second = await device();
  /** @type {number} */
  const initial = await raw(first, first.config.targets[0].x);
  /** @type {Set<number>} */
  const presence = new Set();
  /** @type {number} */
  let held = 0;
  /** @type {number} */
  let prior = initial;
  for (let tick = 0; tick < 500; tick++) {
    first.tick(); second.tick();
    for (const target of first.config.targets) {
      for (const key of ["x", "y", "z"]) {
        if (!target[key]) continue;
        /** @type {number} */
        const value = await raw(first, target[key]);
        assert.equal(value, await raw(second, second.config.targets[first.config.targets.indexOf(target)][key]));
        assert.ok(value * target[key].scale >= first.config.axes[key].min);
        assert.ok(value * target[key].scale <= first.config.axes[key].max);
      }
      presence.add(await raw(first, target.presence));
    }
    /** @type {number} */
    const current = await raw(first, first.config.targets[0].x);
    if (current === prior) held++;
    prior = current;
  }
  assert.notEqual(prior, initial);
  assert.ok(held > 0, "paths include pauses");
  assert.deepEqual([...presence].sort(), [0, 1]);
  first.setPaused(true);
  first.tick();
  assert.equal(await raw(first, first.config.targets[0].x), prior);
  first.reset();
  assert.equal(await raw(first, first.config.targets[0].x), initial);
});

test("all three LD2450 zones write independently in millimetres while paused", async () => {
  /** @type {Simulator} */
  const simulator = await device("ld2450", { paused: true });
  assert.equal(simulator.config.zones.length, 3);
  /** @type {import('../demo/types.js').Reference[]} */
  const refs = simulator.config.zones.map((zone) => zone.bounds.x_min);
  /** @type {number[]} */
  const expected = await Promise.all(refs.map((ref) => raw(simulator, ref)));
  for (const [index, ref] of refs.entries()) {
    assert.equal(ref.scale, 0.001);
    expected[index] = -2500 + index * 100;
    assert.equal((await write(simulator, ref, expected[index])).status, 200);
    simulator.tick();
    assert.deepEqual(await Promise.all(refs.map((ref) => raw(simulator, ref))), expected);
  }
  simulator.reset();
  for (const [index, ref] of refs.entries()) assert.notEqual(await raw(simulator, ref), expected[index]);
});

test("staged writes confirm only after Apply and the 600 ms transport delay", async () => {
  /** @type {ReturnType<typeof clock>} */
  const timer = clock();
  /** @type {Simulator} */
  const simulator = await device("ld6004", { ...timer, paused: true });
  /** @type {import('../demo/types.js').Zone} */
  const zone = simulator.config.zones[0];
  /** @type {number} */
  const initial = await raw(simulator, zone.bounds.x_min);
  await write(simulator, zone.staging.x_min, -2);
  assert.equal(await raw(simulator, zone.bounds.x_min), initial);
  assert.equal((await simulator.fetch(`/button/${encodeURIComponent(zone.applyButton.id)}/press`, { method: "POST" })).status, 200);
  timer.advance(599);
  assert.equal(await raw(simulator, zone.bounds.x_min), initial);
  timer.advance(1);
  assert.equal(await raw(simulator, zone.bounds.x_min), -2);
});

test("reset cancels scheduled confirmation and restarts the path seed", async () => {
  /** @type {ReturnType<typeof clock>} */
  const timer = clock();
  /** @type {Simulator} */
  const simulator = await device("ld6004", timer);
  /** @type {import('../demo/types.js').Zone} */
  const zone = simulator.config.zones[0];
  /** @type {number} */
  const initial = await raw(simulator, zone.bounds.x_min);
  await write(simulator, zone.staging.x_min, -2);
  await simulator.fetch(`/button/${encodeURIComponent(zone.applyButton.id)}/press`, { method: "POST" });
  simulator.tick(); simulator.reset(); timer.advance(1000);
  assert.equal(await raw(simulator, zone.bounds.x_min), initial);
});

test("simulated transport rejects unknown routes, origins, methods and invalid values locally", async () => {
  /** @type {Simulator} */
  const simulator = await device("ld2450");
  for (const url of ["/sensor/Unknown", "https://device.invalid/sensor/Target%20X", "/number/Zone%20X%20Min/press", "/sensor/Target%20X?extra=1"]) {
    assert.equal((await simulator.fetch(url)).status, 404);
  }
  assert.equal((await simulator.fetch("/sensor/Target%20X", { method: "DELETE" })).status, 405);
  for (const value of ["", "NaN", "Infinity", "50000", "null", "1e309", "123.4"]) {
    assert.equal((await simulator.fetch(`/number/Zone%20X%20Min/set?value=${value}`, { method: "POST" })).status, 400);
  }
  assert.equal((await simulator.fetch("/sensor/Target%20X/set?value=1", { method: "POST" })).status, 404);
});

test("real editor reads simulated values and confirms a staged draft by polling", async () => {
  /** @type {ReturnType<typeof clock>} */
  const timer = clock();
  /** @type {Simulator} */
  const simulator = await device("ld6004", timer);
  /** @type {JSDOM} */
  const dom = new JSDOM("", { runScripts: "outside-only", url: "https://demo.invalid/" });
  try {
    dom.window.AbortSignal.any = () => undefined;
    dom.window.AbortSignal.timeout = () => undefined;
    dom.window.fetch = simulator.fetch.bind(simulator);
    dom.window.eval(await readFile(new URL("../coordinate-editor.js", import.meta.url), "utf8"));
    /** @type {HTMLElement & {config: EditorConfig, zones: any[], targets: any[], generation: number, polling: boolean, timer: number, setDraft: Function, apply: Function, poll: Function}} */
    const editor = dom.window.document.createElement("coordinate-editor");
    editor.config = simulator.config;
    dom.window.document.body.append(editor);
    for (let attempt = 0; attempt < 100 && editor.polling; attempt++) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(editor.zones.every((zone) => zone.available), true);
    assert.equal(editor.targets.length, 3);
    /** @type {any} */
    const zone = editor.zones[0];
    editor.setDraft(zone, { ...zone.draft, x_min: -2 });
    await editor.apply(zone);
    assert.ok(zone.pending);
    await editor.poll(editor.generation);
    assert.ok(zone.pending);
    timer.advance(600);
    await editor.poll(editor.generation);
    assert.equal(zone.pending, null);
    assert.equal(zone.dirty, false);
    assert.equal(zone.actual.x_min, -2);
  } finally { dom.window.close(); simulator.dispose(); }
});

test("simulated target readings use short metre values and whole LD2450 millimetres", async () => {
  for (const id of ["ld6004", "ld2450"]) {
    /** @type {Simulator} */
    const simulator = await device(id);
    for (let tick = 0; tick < 20; tick++) {
      simulator.tick();
      for (const target of simulator.config.targets) {
        for (const key of ["x", "y", ...(target.z ? ["z"] : [])]) {
          /** @type {number} */
          const value = await raw(simulator, target[key]);
          if (id === "ld2450") assert.equal(Number.isInteger(value), true);
          else assert.ok(Math.abs(value * 100 - Math.round(value * 100)) < 0.000001);
        }
      }
    }
  }
});

test("all target coordinates display at most two metre decimals after reference scaling", async () => {
  for (const id of ["ld6004", "ld2450", "ld6002b"]) {
    /** @type {Simulator} */
    const simulator = await device(id);
    for (let tick = 0; tick < 200; tick++) {
      simulator.tick();
      for (const target of simulator.config.targets) {
        for (const key of ["x", "y", ...(target.z ? ["z"] : [])]) {
          /** @type {number} */
          const displayed = (await raw(simulator, target[key])) * target[key].scale;
          assert.match(String(displayed), /^-?\d+(?:\.\d{1,2})?$/);
        }
      }
    }
  }
});
