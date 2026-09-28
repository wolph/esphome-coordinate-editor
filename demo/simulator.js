import { createPaths, samplePath } from "./motion.js";
/** @typedef {import('./types.js').EditorConfig} EditorConfig */
/** @typedef {import('./types.js').Reference} Reference */
/** @typedef {import('./types.js').Zone} Zone */
/** @typedef {{axis: import('./types.js').Axis, ref: Reference}} Writable */
/** @typedef {{paused?: boolean, seed?: number, origin?: string, schedule?: (callback: () => void, delay: number) => any, cancel?: (id: any) => void}} Options */

/** @param {Reference} ref @returns {string} */
const entityKey = (ref) => `${ref.domain}/${ref.id}`;

/** @param {number} status @param {object} data @returns {Response} */
const response = (status, data) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

/** Keep scaled values short without changing the example's millimetre mapping.
 * Nearby whole millimetres avoid binary multiplication tails in the editor.
 * @param {number} value @param {Reference} ref @returns {number}
 */
function coordinateValue(value, ref) {
  if (ref.scale !== 0.001) return Number((value / ref.scale).toFixed(2));
  /** @type {number} */
  const rounded = Math.round(value * 100) * 10;
  for (let distance = 0; distance <= 250; distance += 10) {
    for (const raw of [rounded - distance, rounded + distance]) {
      /** @type {number} */
      const displayed = raw * ref.scale;
      if (displayed === Number(displayed.toFixed(2))) return raw;
    }
  }
  throw Error("Cannot represent simulated coordinate");
}

/** In-memory entity values and a simulated ESPHome REST transport. */
export class Simulator {
  /** @param {EditorConfig} config @param {Options} [options] */
  constructor(config, options = {}) {
    /** @type {EditorConfig} */
    this.config = config;
    /** @type {number} */
    this.seed = options.seed ?? 173;
    /** @type {boolean} */
    this.paused = options.paused ?? false;
    /** @type {string} */
    this.origin = options.origin ?? "https://demo.invalid";
    /** @type {(callback: () => void, delay: number) => any} */
    this.schedule = options.schedule ?? ((callback, delay) => setTimeout(callback, delay));
    /** @type {(id: any) => void} */
    this.cancel = options.cancel ?? ((id) => clearTimeout(id));
    /** @type {Set<any>} */
    this.confirmations = new Set();
    /** @type {Map<string, number>} */
    this.values = new Map();
    /** @type {Map<string, Writable>} */
    this.writable = new Map();
    /** @type {Map<string, Zone>} */
    this.buttons = new Map();
    /** @type {ReturnType<typeof createPaths>} */
    this.paths = createPaths(config, this.seed);
    /** @type {number} */
    this.elapsed = 0;
    this.reset();
  }

  /** Cancel confirmations when switching presets or resetting.
   * @returns {void}
   */
  dispose() {
    for (const timer of this.confirmations) this.cancel(timer);
    this.confirmations.clear();
  }

  /** @returns {void} */
  reset() {
    this.dispose();
    this.elapsed = 0;
    this.values.clear(); this.writable.clear(); this.buttons.clear();
    this.config.zones.forEach((zone, index) => this.initialiseZone(zone, index));
    this.updateTargets();
  }

  /** @param {Zone} zone @param {number} index @returns {void} */
  initialiseZone(zone, index) {
    /** @type {Record<string, number>} */
    const boxes = [
      { x_min: -3.5, x_max: -0.5, y_min: 1, y_max: 4, z_min: 0, z_max: 2.5 },
      { x_min: 0.5, x_max: 3, y_min: 2, y_max: 5.5, z_min: 0, z_max: 2.5 },
      { x_min: -2, x_max: 1, y_min: 5, y_max: 7, z_min: 0, z_max: 3 },
      { x_min: -4.5, x_max: -3, y_min: 4.8, y_max: 7, z_min: 0, z_max: 2 },
      { x_min: 3.2, x_max: 4.5, y_min: 0.5, y_max: 2, z_min: 0, z_max: 1.5 },
      { x_min: -4.5, x_max: -3.2, y_min: 0.2, y_max: 0.8, z_min: 0, z_max: 1 },
      { x_min: 1.5, x_max: 3.5, y_min: 6, y_max: 7.5, z_min: 0, z_max: 2.5 },
      { x_min: -0.5, x_max: 0.5, y_min: 0.3, y_max: 1, z_min: 0, z_max: 1 },
    ][index];
    for (const [key, ref] of Object.entries(zone.bounds)) {
      /** @type {import('./types.js').Axis} */
      const axis = this.config.axes[key[0]];
      /** @type {number} */
      const displayed = Number((axis.min + Math.round((boxes[key] - axis.min) / axis.step) * axis.step).toFixed(6));
      this.values.set(entityKey(ref), displayed / ref.scale);
      if (zone.write === "direct") this.writable.set(entityKey(ref), { axis, ref });
      if (zone.staging) {
        /** @type {Reference} */
        const staging = zone.staging[key];
        if (!this.values.has(entityKey(staging))) this.values.set(entityKey(staging), displayed / staging.scale);
        this.writable.set(entityKey(staging), { axis, ref: staging });
      }
    }
    if (zone.applyButton) this.buttons.set(entityKey(zone.applyButton), zone);
  }

  /** @param {boolean} paused @returns {void} */
  setPaused(paused) { this.paused = paused; }

  /** @param {number} [milliseconds] @returns {void} */
  tick(milliseconds = 250) {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw Error("Invalid simulation interval");
    if (this.paused) return;
    this.elapsed += milliseconds;
    this.updateTargets();
  }

  /** @returns {void} */
  updateTargets() {
    this.config.targets.forEach((target, index) => {
      /** @type {ReturnType<typeof samplePath>} */
      const position = samplePath(this.paths[index], this.elapsed, index);
      for (const key of ["x", "y", ...(target.z ? ["z"] : [])]) {
        /** @type {Reference} */
        const ref = target[key];
        this.values.set(entityKey(ref), coordinateValue(position[key], ref));
      }
      if (target.presence) this.values.set(entityKey(target.presence), position.present ? 1 : 0);
      if (target.age) this.values.set(entityKey(target.age), 0);
    });
  }

  /** Capture staging values now, then update actual bounds after the simulated delay.
   * @param {Zone} zone @returns {void}
   */
  apply(zone) {
    /** @type {[string, number][]} */
    const actual = Object.entries(zone.bounds).map(([key, ref]) => [
      entityKey(ref), this.values.get(entityKey(zone.staging[key])) * zone.staging[key].scale / ref.scale,
    ]);
    /** @type {any} */
    const timer = this.schedule(() => {
      for (const [key, value] of actual) this.values.set(key, value);
      this.confirmations.delete(timer);
    }, 600);
    this.confirmations.add(timer);
  }

  /** No request falls through to the network.
   * @param {string | URL | Request} input @param {RequestInit} [options] @returns {Promise<Response>}
   */
  async fetch(input, options = {}) {
    if (options.signal?.aborted) throw new DOMException("Request aborted", "AbortError");
    /** @type {URL} */
    let url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, this.origin); }
    catch { return response(404, { error: "Unknown simulated route" }); }
    /** @type {RegExpMatchArray | null} */
    const route = url.pathname.match(/^\/(sensor|number|binary_sensor|button)\/([^/]+)(?:\/(set|press))?$/);
    if (url.origin !== this.origin || !route || url.hash) return response(404, { error: "Unknown simulated route" });
    /** @type {string} */
    let key;
    try { key = `${route[1]}/${decodeURIComponent(route[2])}`; }
    catch { return response(404, { error: "Invalid simulated entity name" }); }
    /** @type {string} */
    const method = options.method ?? "GET";
    if (method !== "GET" && method !== "POST") return response(405, { error: "Unsupported method" });
    if (!route[3] && method === "GET" && !url.search && this.values.has(key)) return response(200, { value: this.values.get(key) });
    if (route[3] === "press" && method === "POST" && !url.search && this.buttons.has(key)) {
      this.apply(this.buttons.get(key));
      return response(200, { success: true });
    }
    if (route[3] === "set" && method === "POST" && this.writable.has(key)) return this.write(key, url.searchParams);
    return response(404, { error: "Unknown simulated route" });
  }

  /** @param {string} key @param {URLSearchParams} params @returns {Response} */
  write(key, params) {
    /** @type {string | null} */
    const text = params.get("value");
    /** @type {number} */
    const value = Number(text);
    /** @type {Writable} */
    const { axis, ref } = this.writable.get(key);
    /** @type {number} */
    const displayed = value * ref.scale;
    /** @type {number} */
    const steps = (displayed - axis.min) / axis.step;
    if (params.size !== 1 || !text?.trim() || !Number.isFinite(value) || displayed < axis.min || displayed > axis.max || Math.abs(steps - Math.round(steps)) > 0.000001) {
      return response(400, { error: "Invalid simulated number value" });
    }
    this.values.set(key, value);
    return response(200, { success: true });
  }
}
