import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { JSDOM } from "jsdom";

const source = await readFile(new URL("../coordinate-editor.js", import.meta.url), "utf8");
const config = (title) => ({
  title, unit: "mm", axes: { x: { min: -1000, max: 1000, step: 1 }, y: { min: 0, max: 1000, step: 1 } },
  targets: [], zones: [], pollMs: 1000, expireMs: 5000,
});
const settle = async (dom) => {
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));
};

for (const kind of ["json", "global", "url"]) {
  test(`configuration priority selects ${kind} and mounts below esp-app`, async () => {
    const dom = new JSDOM('<esp-app></esp-app><script src="/coordinate-editor.js" data-config="/config.json"></script>', {
      runScripts: "outside-only", url: "http://device.local/",
    });
    try {
      const calls = [];
      dom.window.fetch = async (url) => {
        calls.push(url);
        return { ok: true, json: async () => config("url") };
      };
      if (kind !== "url") dom.window.coordinateEditorConfig = config("global");
      if (kind === "json") {
        const script = dom.window.document.createElement("script");
        script.type = "application/json";
        script.id = "coordinate-editor-config";
        script.textContent = JSON.stringify(config("json"));
        dom.window.document.body.append(script);
      }
      dom.window.eval(source);
      await settle(dom);
      const editor = dom.window.document.querySelector("coordinate-editor");
      assert.ok(editor);
      assert.equal(editor.previousElementSibling.tagName, "ESP-APP");
      assert.equal(editor.config.title, kind);
      assert.equal(editor.shadowRoot.querySelector("h2").textContent, kind);
      assert.equal(calls.length, kind === "url" ? 1 : 0);
    } finally { dom.window.close(); }
  });
}

test("late configuration module and late esp-app mount exactly once", async () => {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  try {
    dom.window.eval(source);
    await settle(dom);
    dom.window.coordinateEditorConfig = config("late");
    dom.window.dispatchEvent(new dom.window.Event("coordinate-editor-config"));
    dom.window.document.body.append(dom.window.document.createElement("esp-app"));
    await settle(dom);
    dom.window.dispatchEvent(new dom.window.Event("coordinate-editor-config"));
    await settle(dom);
    assert.equal(dom.window.document.querySelectorAll("coordinate-editor").length, 1);
    assert.equal(dom.window.document.querySelector("coordinate-editor").config.title, "late");
  } finally { dom.window.close(); }
});

test("explicit editor.config remains compatible with js_include", async () => {
  const dom = new JSDOM("<esp-app></esp-app>", { runScripts: "outside-only" });
  try {
    dom.window.eval(source);
    const editor = dom.window.document.createElement("coordinate-editor");
    editor.config = config("explicit");
    dom.window.coordinateEditorConfig = config("global");
    dom.window.document.body.append(editor);
    await settle(dom);
    assert.equal(dom.window.document.querySelectorAll("coordinate-editor").length, 1);
    assert.equal(editor.config.title, "explicit");
    assert.equal(editor.shadowRoot.querySelector("h2").textContent, "explicit");
  } finally { dom.window.close(); }
});

test("element data-config loads JSON and does not revive after removal", async () => {
  const dom = new JSDOM('<coordinate-editor data-config="/room.json"></coordinate-editor>', { runScripts: "outside-only" });
  try {
    let release;
    dom.window.fetch = async () => new Promise((resolve) => { release = resolve; });
    dom.window.eval(source);
    const editor = dom.window.document.querySelector("coordinate-editor");
    assert.equal(typeof release, "function");
    editor.remove();
    release({ ok: true, json: async () => config("removed") });
    await settle(dom);
    assert.equal(editor.shadowRoot.querySelector("h2"), null);
  } finally { dom.window.close(); }
});

test("invalid higher-priority JSON reports an error without falling back", async () => {
  const dom = new JSDOM('<esp-app></esp-app><script type="application/json" id="coordinate-editor-config">broken</script>', { runScripts: "outside-only" });
  try {
    dom.window.coordinateEditorConfig = config("fallback");
    dom.window.eval(source);
    await settle(dom);
    const editor = dom.window.document.querySelector("coordinate-editor");
    assert.ok(editor);
    assert.match(editor.shadowRoot.textContent, /Configuration error/);
    assert.equal(editor.shadowRoot.querySelector("h2"), null);
  } finally { dom.window.close(); }
});

test("element data-config initialises a 2D editor", async () => {
  const dom = new JSDOM('<coordinate-editor data-config="/room.json"></coordinate-editor>', { runScripts: "outside-only" });
  try {
    dom.window.fetch = async (url) => {
      assert.equal(url, "/room.json");
      return { ok: true, json: async () => config("2D room") };
    };
    dom.window.eval(source);
    await settle(dom);
    const editor = dom.window.document.querySelector("coordinate-editor");
    assert.equal(editor.shadowRoot.querySelector("h2").textContent, "2D room");
    assert.equal(editor.config.axes.z, undefined);
  } finally { dom.window.close(); }
});

for (const failure of ["http", "json"]) {
  test(`configuration URL ${failure} failure is visible`, async () => {
    const dom = new JSDOM('<coordinate-editor data-config="/bad.json"></coordinate-editor>', { runScripts: "outside-only" });
    try {
      dom.window.fetch = async () => ({ ok: failure !== "http", status: 404, json: async () => { throw Error("Invalid JSON"); } });
      dom.window.eval(source);
      await settle(dom);
      assert.match(dom.window.document.querySelector("coordinate-editor").shadowRoot.textContent,
        failure === "http" ? /Configuration error: HTTP 404/ : /Configuration error: Invalid JSON/);
    } finally { dom.window.close(); }
  });
}

for (const sensor of ["ld2450", "ld6004", "ld6002b"]) {
  test(`${sensor} example maps configured names and renders its dimensions`, async () => {
    const mapping = await readFile(new URL(`../examples/${sensor}-config.js`, import.meta.url), "utf8");
    const yaml = await readFile(new URL(`../examples/${sensor}.yaml`, import.meta.url), "utf8");
    const dom = new JSDOM("<esp-app></esp-app>", { runScripts: "outside-only" });
    try {
      // Read entity names under their YAML domain, without interpreting firmware tags.
      const names = new Set();
      let domain;
      for (const line of yaml.split("\n")) {
        const section = /^(sensor|number|binary_sensor|button):$/.exec(line);
        if (section) domain = section[1];
        const name = /^\s+name: "([^"]+)"$/.exec(line);
        if (name) names.add(`${domain}/${name[1]}`);
      }
      dom.window.fetch = async (url) => ({ ok: true, json: async () => ({ value: url.includes("Max") ? 2 : 0 }) });
      dom.window.eval(mapping);
      const example = dom.window.coordinateEditorConfig;
      const references = example.targets.flatMap((target) => [target.x, target.y, target.z, target.presence].filter(Boolean));
      for (const zone of example.zones)
        references.push(...Object.values(zone.bounds), ...Object.values(zone.staging || {}), ...[zone.applyButton].filter(Boolean));
      for (const reference of references)
        assert.ok(names.has(`${reference.domain}/${reference.id}`), `Missing YAML entity ${reference.domain}/${reference.id}`);
      dom.window.eval(source);
      await settle(dom);
      const editor = dom.window.document.querySelector("coordinate-editor");
      assert.ok(editor.shadowRoot.querySelector("h2"));
      assert.equal(example.zones.length, sensor === "ld2450" ? 1 : sensor === "ld6004" ? 4 : 8);
      assert.equal(Object.keys(editor.forms[0].controls).length, sensor === "ld2450" ? 4 : 6);
      assert.equal(Boolean(example.axes.z), sensor !== "ld2450");
      assert.equal(example.zones[0].write, sensor === "ld2450" ? "direct" : "staged");
      assert.equal(example.targets[0].x.scale, sensor === "ld2450" ? 0.001 : 1);
      if (sensor === "ld6002b") {
        for (const kind of ["detection", "interference"])
          for (let index = 0; index < 4; index++) {
            assert.ok(yaml.includes(`    ${kind}_area_${index}:`));
            assert.ok(yaml.includes(`option: ${kind}_area_${index}`));
          }
      }
    } finally { dom.window.close(); }
  });
}
