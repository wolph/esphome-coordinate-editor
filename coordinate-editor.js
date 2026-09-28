/** Optional coordinate view with explicit or page-provided configuration. */
/** @typedef {{min: number, max: number, step: number}} Axis */
/** @typedef {{x_min: number, x_max: number, y_min: number, y_max: number, z_min?: number, z_max?: number}} Bounds */
/** @typedef {{domain: string, id: string, scale: number}} Reference */
/** @typedef {{x: Axis, y: Axis, z?: Axis}} Axes */
const fields = (zone) => Object.keys(zone.bounds);
const same = (a, b) =>
  Object.keys(a).length === Object.keys(b).length &&
  Object.keys(a).every((key) => Number.isFinite(b[key]) && Math.abs(a[key] - b[key]) < 1e-8);
function numeric(data) {
  const raw = data?.value;
  const value = typeof raw === "string" && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(raw) ? Number(raw) : raw;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function snap(value, axis) {
  return Number((axis.min + Math.round((value - axis.min) / axis.step) * axis.step).toFixed(9));
}
const palette = ["#087e69", "#2463b1", "#9a5c00", "#8243ab"];
const colour = (index) => palette[index % palette.length];
/** Move a box as a unit, preserving dimensions and any Z bounds. */
/** @param {Bounds} bounds @param {{x?: number, y?: number, z?: number}} delta @param {Axes} axes */
function moveBounds(bounds, delta, axes) {
  const result = { ...bounds };
  for (const key of ["x", "y", "z"]) {
    if (!axes[key] || !Number.isFinite(delta[key]) || !Number.isFinite(bounds[`${key}_min`])) continue;
    const axis = axes[key];
    const shift = Math.round(delta[key] / axis.step) * axis.step;
    const minimumShift = Math.ceil((axis.min - bounds[`${key}_min`]) / axis.step - 1e-8) * axis.step;
    const maximumShift = Math.floor((axis.max - bounds[`${key}_max`]) / axis.step + 1e-8) * axis.step;
    const limited = Math.max(minimumShift, Math.min(maximumShift, shift));
    result[`${key}_min`] = Number((bounds[`${key}_min`] + limited).toFixed(9));
    result[`${key}_max`] = Number((bounds[`${key}_max`] + limited).toFixed(9));
  }
  return result;
}
/** @param {Bounds} bounds @param {{x: number, y: number}} point @param {string[]} corner @param {Axes} axes */
function resizeBounds(bounds, point, corner, axes) {
  const result = { ...bounds };
  for (const [index, key] of ["x", "y"].entries()) {
    if (!Number.isFinite(point[key])) return null;
    const axis = axes[key],
      edge = corner[index],
      opposite = edge === "min" ? "max" : "min";
    const lower = edge === "min" ? axis.min : bounds[`${key}_${opposite}`] + axis.step;
    const maximum = axis.min + Math.floor((axis.max - axis.min) / axis.step + 1e-8) * axis.step;
    const upper = edge === "max" ? maximum : bounds[`${key}_${opposite}`] - axis.step;
    result[`${key}_${edge}`] = Math.max(lower, Math.min(upper, snap(point[key], axis)));
  }
  return result;
}
/** @typedef {{x: number, y: number}} ScreenPoint */
/** @typedef {{x: number, y: number, z: number}} WorldPoint */
/** @typedef {{yaw: number, pitch: number, zoom: number, scale: number, centre: WorldPoint}} SpatialCamera */
/** Resize one face on the configured grid, preserving the other five bounds.
 * @param {Bounds} bounds @param {string} key @param {string} edge
 * @param {number} value @param {Axis} axis @returns {Bounds | null}
 */
function resizeAxisBounds(bounds, key, edge, value, axis) {
  if (!Number.isFinite(value) || !axis || !["min", "max"].includes(edge)) return null;
  /** @type {number} */
  const opposite = bounds[`${key}_${edge === "min" ? "max" : "min"}`];
  if (!Number.isFinite(opposite)) return null;
  /** @type {number} */
  const lower = edge === "min" ? axis.min : axis.min + (Math.floor((opposite - axis.min) / axis.step + 1e-8) + 1) * axis.step;
  /** @type {number} */
  const upper = edge === "max" ? axis.min + Math.floor((axis.max - axis.min) / axis.step + 1e-8) * axis.step :
    axis.min + (Math.ceil((opposite - axis.min) / axis.step - 1e-8) - 1) * axis.step;
  if (lower > upper) return null;
  return { ...bounds, [`${key}_${edge}`]: Number(Math.max(lower, Math.min(upper, snap(value, axis))).toFixed(9)) };
}
/** Convert projected pointer movement to one world-axis displacement.
 * @param {ScreenPoint} delta @param {ScreenPoint} vector @returns {number | null}
 */
function axisDisplacement(delta, vector) {
  /** @type {number} */
  const lengthSquared = vector.x ** 2 + vector.y ** 2;
  if (!Number.isFinite(lengthSquared) || lengthSquared < 1e-6) return null;
  /** @type {number} */
  const distance = (delta.x * vector.x + delta.y * vector.y) / lengthSquared;
  return Number.isFinite(distance) ? distance : null;
}
/** Orthographic projection: world Z always points vertically upwards.
 * @param {WorldPoint} point @param {SpatialCamera} camera
 * @returns {{x: number, y: number, depth: number}}
 */
function projectSpatial(point, camera) {
  /** @type {number} */
  const x = point.x - camera.centre.x;
  /** @type {number} */
  const y = point.y - camera.centre.y;
  /** @type {number} */
  const z = point.z - camera.centre.z;
  /** @type {number} */
  const horizontal = Math.cos(camera.yaw) * x - Math.sin(camera.yaw) * y;
  /** @type {number} */
  const depth = Math.sin(camera.yaw) * x + Math.cos(camera.yaw) * y;
  /** @type {number} */
  const scale = camera.scale * camera.zoom;
  return { x: 320 + horizontal * scale, y: 245 + (Math.sin(camera.pitch) * depth - Math.cos(camera.pitch) * z) * scale,
    depth: Math.cos(camera.pitch) * depth + Math.sin(camera.pitch) * z };
}
/** Return the eight genuine corners, or four floor corners for XY-only bounds.
 * @param {Bounds} bounds @returns {WorldPoint[]}
 */
function spatialCorners(bounds) {
  /** @type {WorldPoint[]} */
  const corners = [];
  for (const z of Number.isFinite(bounds.z_min) && Number.isFinite(bounds.z_max) ? [bounds.z_min, bounds.z_max] : [0])
    for (const y of [bounds.y_min, bounds.y_max])
      for (const x of [bounds.x_min, bounds.x_max]) corners.push({ x, y, z });
  return corners;
}
function validate(config) {
  if (config.pendingTimeoutMs !== undefined &&
      (!Number.isFinite(config.pendingTimeoutMs) || config.pendingTimeoutMs <= 0 || config.pendingTimeoutMs > 2147483647))
    throw Error("Invalid pending deadline");
  for (const key of ["title", "originLabel"]) {
    if (config[key] !== undefined && typeof config[key] !== "string") throw Error(`Invalid ${key}`);
  }
  for (const key of ["x", "y", ...(config.axes.z ? ["z"] : [])]) {
    const axis = config.axes[key];
    if (![axis.min, axis.max, axis.step].every(Number.isFinite) || axis.min >= axis.max || axis.step <= 0)
      throw Error(`Invalid ${key} axis`);
  }
  const reference = (ref) => {
    if (
      !ref ||
      !["sensor", "number", "binary_sensor", "button"].includes(ref.domain) ||
      typeof ref.id !== "string" ||
      ref.id.length === 0 ||
      !Number.isFinite(ref.scale) ||
      ref.scale <= 0
    )
      throw Error("Invalid entity reference");
  };
  for (const target of config.targets) {
    reference(target.x);
    reference(target.y);
    if (target.z) reference(target.z);
    if (target.presence) {
      reference(target.presence);
      if (!Number.isFinite(target.presence.threshold)) throw Error("Invalid presence threshold");
    }
    if (target.age) {
      reference(target.age);
      if (!Number.isFinite(target.age.max) || !(target.age.max > 0)) throw Error("Invalid report age");
    }
  }
  for (const zone of config.zones) {
    for (const key of ["x_min", "x_max", "y_min", "y_max"]) reference(zone.bounds[key]);
    if (Boolean(zone.bounds.z_min) !== Boolean(zone.bounds.z_max)) throw Error("Both Z bounds are required");
    for (const key of fields(zone)) {
      if (!/^[xyz]_(min|max)$/.test(key) || !config.axes[key[0]]) throw Error("Invalid bound");
      reference(zone.bounds[key]);
      if (zone.write === "direct" && zone.bounds[key].domain !== "number") throw Error("Direct writes require numbers");
      if (zone.write === "staged") {
        reference(zone.staging?.[key]);
        if (zone.staging[key].domain !== "number") throw Error("Staging requires numbers");
      }
    }
    if (zone.write && !["direct", "staged"].includes(zone.write)) throw Error("Invalid write mode");
    if (zone.write === "staged") {
      reference(zone.applyButton);
      if (zone.applyButton.domain !== "button" || zone.stagingHasNoSideEffects !== true)
        throw Error("Staging must have no hardware side effects");
    }
  }
  if (
    ![config.pollMs, config.expireMs].every(Number.isFinite) ||
    !(config.pollMs >= 250) ||
    !(config.expireMs > config.pollMs)
  )
    throw Error("Invalid polling intervals");
}
/** A composed SVG scene renderer. Entity reads and writes remain in the editor. */
class SpatialRenderer {
  /** @param {CoordinateEditor} editor */
  constructor(editor) {
    /** @type {CoordinateEditor} */
    this.editor = editor;
    /** @type {SpatialCamera} */
    this.camera = { yaw: -0.65, pitch: 0.58, zoom: 1, scale: 35, centre: { x: 0, y: 0, z: 1 } };
    /** @type {Map<string, SVGGElement>} */
    this.handles = new Map();
    /** @type {boolean} */
    this.framed = false;
  }
  /** @param {WorldPoint} point @returns {{x: number, y: number, depth: number}} */
  project(point) { return projectSpatial(point, this.camera); }
  /** @param {string} axis @returns {ScreenPoint} */
  axisVector(axis) {
    /** @type {WorldPoint} */
    const origin = this.camera.centre;
    /** @type {ScreenPoint} */
    const first = this.project(origin);
    /** @type {ScreenPoint} */
    const second = this.project({ ...origin, [axis]: origin[axis] + 1 });
    return { x: second.x - first.x, y: second.y - first.y };
  }
  /** Frame content without using the full permitted Z range.
   * @param {boolean} initial @returns {void}
   */
  fit(initial = false) {
    /** @type {WorldPoint[]} */
    const points = [{ x: 0, y: 0, z: 0 }];
    if (initial) {
      points.push(...spatialCorners({ x_min: this.editor.config.axes.x.min, x_max: this.editor.config.axes.x.max,
        y_min: this.editor.config.axes.y.min, y_max: this.editor.config.axes.y.max }));
    }
    for (const zone of this.editor.zones)
      for (const bounds of [zone.actual, zone.dirty ? zone.draft : null])
        if (bounds && Object.values(bounds).every(Number.isFinite)) points.push(...spatialCorners(bounds));
    for (const target of this.editor.visibleTargets())
      if (Number.isFinite(target.z)) points.push({ x: target.x, y: target.y, z: target.z }, { x: target.x, y: target.y, z: 0 });
    /** @type {Record<string, {min: number, max: number}>} */
    this.frame = {};
    for (const axis of ["x", "y", "z"]) {
      /** @type {number[]} */
      const values = points.map((point) => point[axis]);
      this.frame[axis] = { min: Math.min(...values), max: Math.max(...values) };
      this.camera.centre[axis] = (this.frame[axis].min + this.frame[axis].max) / 2;
    }
    this.camera.scale = 1;
    this.camera.zoom = 1;
    /** @type {{x: number, y: number, depth: number}[]} */
    const projected = points.map((point) => this.project(point));
    /** @type {number} */
    const width = Math.max(...projected.map((point) => point.x)) - Math.min(...projected.map((point) => point.x));
    /** @type {number} */
    const height = Math.max(...projected.map((point) => point.y)) - Math.min(...projected.map((point) => point.y));
    /** @type {number} */
    const screenX = (Math.max(...projected.map((point) => point.x)) + Math.min(...projected.map((point) => point.x))) / 2 - 320;
    /** @type {number} */
    const screenY = (Math.max(...projected.map((point) => point.y)) + Math.min(...projected.map((point) => point.y))) / 2 - 245;
    // Centre projected content by shifting along the camera's two screen axes.
    this.camera.centre.x += Math.cos(this.camera.yaw) * screenX + Math.sin(this.camera.yaw) * Math.sin(this.camera.pitch) * screenY;
    this.camera.centre.y += -Math.sin(this.camera.yaw) * screenX + Math.cos(this.camera.yaw) * Math.sin(this.camera.pitch) * screenY;
    this.camera.centre.z -= Math.cos(this.camera.pitch) * screenY;
    this.camera.scale = Math.min(500 / Math.max(width, 1), 325 / Math.max(height, 1));
    this.framed = this.editor.zones.some((zone) => zone.actual) || this.editor.visibleTargets().length > 0;
  }
  /** @param {number} factor @returns {void} */
  zoomBy(factor) {
    if (this.editor.drag || !Number.isFinite(factor) || factor <= 0) return;
    this.camera.zoom = Math.max(0.35, Math.min(4, this.camera.zoom * factor));
    this.render();
  }
  /** @returns {void} */
  reset() {
    if (this.editor.drag) return;
    this.camera.yaw = -0.65;
    this.camera.pitch = 0.58;
    this.fit(true);
    this.render();
  }
  /** @param {WorldPoint} first @param {WorldPoint} second @param {object} attributes
   * @param {SVGElement} layer @returns {SVGElement}
   */
  line(first, second, attributes, layer) {
    /** @type {ScreenPoint} */
    const a = this.project(first);
    /** @type {ScreenPoint} */
    const b = this.project(second);
    return this.editor.shape("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...attributes }, layer);
  }
  /** @returns {void} */
  drawGrid() {
    /** @type {CoordinateEditor} */
    const editor = this.editor;
    editor.gridLayer.replaceChildren();
    if (!this.frame) this.fit(true);
    /** @type {Bounds} */
    const floor = { x_min: this.frame.x.min, x_max: this.frame.x.max, y_min: this.frame.y.min, y_max: this.frame.y.max };
    /** @type {WorldPoint[]} */
    const corners = spatialCorners(floor);
    editor.shape("polygon", { points: [corners[0], corners[1], corners[3], corners[2]].map((point) => {
      /** @type {ScreenPoint} */
      const projected = this.project(point);
      return `${projected.x},${projected.y}`;
    }).join(" "), fill: "#eef3f7", stroke: "#cedbe5" }, editor.gridLayer);
    for (const axis of ["x", "y"]) {
      /** @type {{min: number, max: number}} */
      const range = this.frame[axis];
      /** @type {number} */
      const rough = Math.max((range.max - range.min) / 8, editor.config.axes[axis].step);
      /** @type {number} */
      const magnitude = 10 ** Math.floor(Math.log10(rough));
      /** @type {number} */
      const spacing = [1, 2, 5, 10].find((step) => step * magnitude >= rough) * magnitude;
      for (let value = Math.ceil(range.min / spacing) * spacing; value <= range.max + 1e-8; value += spacing) {
        /** @type {WorldPoint} */
        const first = { x: axis === "x" ? value : floor.x_min, y: axis === "y" ? value : floor.y_min, z: 0 };
        /** @type {WorldPoint} */
        const second = { x: axis === "x" ? value : floor.x_max, y: axis === "y" ? value : floor.y_max, z: 0 };
        this.line(first, second, { stroke: "#d2dee8", "stroke-width": 1 }, editor.gridLayer);
      }
    }
    /** @type {WorldPoint} */
    const origin = { x: 0, y: 0, z: 0 };
    /** @type {number} */
    const length = Math.max(1, Math.min(3, (this.frame.x.max - this.frame.x.min) / 4));
    for (const [axis, paint] of [["x", "#b34b45"], ["y", "#2b8062"], ["z", "#376fb5"]]) {
      /** @type {WorldPoint} */
      const end = { ...origin, [axis]: length };
      this.line(origin, end, { stroke: paint, "stroke-width": 2.5 }, editor.gridLayer);
      /** @type {ScreenPoint} */
      const label = this.project(end);
      editor.shape("text", { x: label.x + 8, y: label.y - 8, fill: paint, "font-size": 13,
        "font-weight": 650 }, editor.gridLayer).textContent = `${axis.toUpperCase()} (${editor.config.unit})`;
    }
    /** @type {ScreenPoint} */
    const label = this.project(origin);
    editor.shape("text", { x: label.x + 8, y: label.y + 18, fill: "#526779", "font-size": 11 },
      editor.gridLayer).textContent = editor.config.originLabel || "Origin";
  }
  /** @returns {void} */
  drawZones() {
    /** @type {CoordinateEditor} */
    const editor = this.editor;
    editor.zoneLayer.replaceChildren();
    /** @type {{points: string, depth: number, index: number, draft: boolean}[]} */
    const faces = [];
    for (const [index, zone] of editor.zones.entries()) {
      for (const [draft, bounds] of [[false, zone.actual], [true, index === editor.selected && zone.dirty ? zone.draft : null]]) {
        if (!bounds || !Object.values(bounds).every(Number.isFinite)) continue;
        /** @type {{x: number, y: number, depth: number}[]} */
        const points = spatialCorners(bounds).map((point) => this.project(point));
        /** @type {number[][]} */
        const sides = points.length === 4 ? [[0, 1, 3, 2]] : [[0, 1, 3, 2], [4, 5, 7, 6],
          [0, 1, 5, 4], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]];
        for (const side of sides) faces.push({ points: side.map((key) => `${points[key].x},${points[key].y}`).join(" "),
          depth: side.reduce((sum, key) => sum + points[key].depth, 0) / side.length, index, draft });
      }
    }
    faces.sort((first, second) => first.depth - second.depth);
    for (const face of faces) editor.shape("polygon", { points: face.points, "data-zone": face.index,
      "data-depth": face.depth, "data-draft": face.draft, fill: `${colour(face.index)}${face.draft ? "08" : "12"}`,
      stroke: colour(face.index), "stroke-width": face.draft ? 2 : 1.3,
      "stroke-dasharray": face.draft ? "6 4" : "none", "pointer-events": "none" }, editor.zoneLayer);
    for (const [index, zone] of editor.zones.entries()) {
      if (!zone.actual) continue;
      /** @type {ScreenPoint} */
      const label = this.project({ x: zone.actual.x_min, y: zone.actual.y_max, z: zone.actual.z_max ?? 0 });
      editor.shape("text", { x: label.x + 5, y: label.y - 10, fill: colour(index), "font-size": 13,
        "pointer-events": "none" }, editor.zoneLayer).textContent = zone.definition.label +
          (Number.isFinite(zone.actual.z_max) ? "" : " (XY only)");
    }
    this.drawHandles();
  }
  /** Keep handle nodes stable while dragging, including between incoming polls.
   * @returns {void}
   */
  drawHandles() {
    /** @type {CoordinateEditor} */
    const editor = this.editor;
    /** @type {object | undefined} */
    const zone = editor.zones[editor.selected];
    /** @type {Set<string>} */
    const wanted = new Set();
    if (editor.editable(zone) || editor.drag && editor.drag.zone === zone) {
      /** @type {WorldPoint} */
      const centre = { x: (zone.draft.x_min + zone.draft.x_max) / 2,
        y: (zone.draft.y_min + zone.draft.y_max) / 2,
        z: Number.isFinite(zone.draft.z_min) ? (zone.draft.z_min + zone.draft.z_max) / 2 : 0 };
      for (const axis of ["x", "y", ...(Number.isFinite(zone.draft.z_min) ? ["z"] : [])]) {
        /** @type {ScreenPoint} */
        const vector = this.axisVector(axis);
        /** @type {number} */
        const length = Math.hypot(vector.x, vector.y);
        if (length < this.camera.scale * this.camera.zoom * 0.12) continue;
        for (const edge of editor.manipulationMode === "resize" ? ["min", "max"] : ["move"]) {
          /** @type {string} */
          const key = `${axis}-${edge}`;
          wanted.add(key);
          /** @type {SVGGElement} */
          const group = this.handleNode(key, axis, edge);
          /** @type {ScreenPoint} */
          const start = this.project({ ...centre, ...(edge === "move" ? {} : { [axis]: zone.draft[`${axis}_${edge}`] }) });
          this.positionHandle(group, axis, edge, start, vector, length);
        }
      }
    }
    for (const [key, group] of this.handles)
      if (!wanted.has(key)) { group.remove(); this.handles.delete(key); }
  }
  /** @param {string} key @param {string} axis @param {string} edge @returns {SVGGElement} */
  handleNode(key, axis, edge) {
    /** @type {SVGGElement | undefined} */
    let group = this.handles.get(key);
    if (group) return group;
    group = this.editor.shape("g", { class: "axis-handle" }, this.editor.handleLayer);
    this.editor.shape("line", { "stroke-width": 2, "pointer-events": "none" }, group);
    this.editor.shape("circle", { fill: "white", "stroke-width": 2, "pointer-events": "none" }, group);
    this.editor.shape("text", { "font-size": 13, "font-weight": 700, "pointer-events": "none" }, group);
    this.editor.shape("circle", { fill: "transparent", "pointer-events": "all", "data-axis": axis,
      "data-edge": edge, "aria-label": `${edge === "move" ? "Move" : "Resize"} ${axis.toUpperCase()} ${edge === "move" ? "" : edge}`,
      style: "cursor:grab" }, group);
    this.handles.set(key, group);
    return group;
  }
  /** @param {SVGGElement} group @param {string} axis @param {string} edge
   * @param {ScreenPoint} start @param {ScreenPoint} vector @param {number} length @returns {void}
   */
  positionHandle(group, axis, edge, start, vector, length) {
    /** @type {number} */
    const displayScale = this.editor.displayScale || 1;
    /** @type {number} */
    const extension = (edge === "move" ? 65 : edge === "min" ? -28 : 28) * displayScale;
    /** @type {ScreenPoint} */
    const end = { x: start.x + vector.x / length * extension, y: start.y + vector.y / length * extension };
    /** @type {string} */
    const paint = { x: "#b34b45", y: "#2b8062", z: "#376fb5" }[axis];
    /** @type {SVGElement[]} */
    const children = [...group.children];
    for (const [name, value] of Object.entries({ x1: start.x, y1: start.y, x2: end.x, y2: end.y, stroke: paint }))
      children[0].setAttribute(name, value);
    for (const child of [children[1], children[3]]) {
      child.setAttribute("cx", end.x);
      child.setAttribute("cy", end.y);
      child.setAttribute("r", (child === children[1] ? 7 : 22) * displayScale);
    }
    children[1].setAttribute("stroke", paint);
    children[2].setAttribute("x", end.x + 11 * displayScale);
    children[2].setAttribute("y", end.y - 9 * displayScale);
    children[2].setAttribute("fill", paint);
    children[2].textContent = axis.toUpperCase() + (edge === "move" ? "" : edge === "min" ? "-" : "+");
  }
  /** @returns {void} */
  render() {
    this.drawGrid();
    this.drawZones();
    this.editor.drawPoints();
  }
}

class CoordinateEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.generation = 0;
    this.busy = false;
    this.targets = [];
    this.zones = [];
  }
  connectedCallback() {
    if (this.config === undefined) {
      this.loadConfiguration();
      return;
    }
    try {
      validate(this.config);
      this.zones = this.config.zones.map((definition) => ({
        definition,
        actual: null,
        draft: null,
        dirty: false,
        conflict: false,
      }));
      this.generation++;
      this.busy = false;
      this.polling = false;
      this.selected = 0;
      this.draw();
      this.poll(this.generation);
      this.expiry = setInterval(() => this.drawPoints(), 250);
    } catch (error) {
      this.shadowRoot.textContent = error.message;
    }
  }
  /** Load page configuration without reviving a removed element.
   * @returns {Promise<void>}
   */
  async loadConfiguration() {
    /** @type {number} */
    const generation = this.generation;
    this.configurationController = new AbortController();
    /** @type {number} */
    const timeout = setTimeout(() => this.configurationController?.abort(), 4000);
    try {
      /** @type {HTMLScriptElement | null} */
      const embedded = document.querySelector('script[type="application/json"]#coordinate-editor-config');
      if (embedded) this.config = JSON.parse(embedded.textContent);
      else if (window.coordinateEditorConfig !== undefined) this.config = window.coordinateEditorConfig;
      else {
        /** @type {string | null} */
        const url = this.getAttribute("data-config");
        if (!url) throw Error("No coordinate editor configuration supplied");
        /** @type {Response} */
        const response = await fetch(url, { signal: this.configurationController.signal });
        if (!response.ok) throw Error(`HTTP ${response.status}`);
        /** @type {object} */
        const config = await response.json();
        if (generation !== this.generation || !this.isConnected) return;
        this.config = config;
      }
      if (generation === this.generation && this.isConnected) this.connectedCallback();
    } catch (error) {
      if (generation === this.generation && this.isConnected)
        this.shadowRoot.textContent = `Configuration error: ${error.message}`;
    } finally {
      clearTimeout(timeout);
    }
  }
  disconnectedCallback() {
    this.generation++;
    for (const zone of this.zones) clearTimeout(zone.pendingTimer);
    clearTimeout(this.timer);
    clearInterval(this.expiry);
    this.controller?.abort();
    this.configurationController?.abort();
    this.observer?.disconnect();
    this.cancelInteraction();
    if (this.svg)
      for (const handler of ["onpointerdown", "onpointermove", "onpointerup", "onpointercancel", "onkeydown", "onwheel"])
        this.svg[handler] = null;
  }
  async request(ref, value) {
    const path = `/${ref.domain}/${encodeURIComponent(ref.id)}`;
    const suffix =
      ref.domain === "button"
        ? "/press"
        : value === undefined
          ? ""
          : `/set?value=${encodeURIComponent(value / ref.scale)}`;
    const response = await fetch(path + suffix, {
      method: value === undefined ? "GET" : "POST",
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(4000)]),
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    if (value !== undefined) return;
    const data = await response.json();
    const number =
      ref.domain === "binary_sensor" && typeof data.value === "boolean" ? Number(data.value) : numeric(data);
    if (number === null) throw Error("Unavailable entity value");
    return number * ref.scale;
  }
  async readBounds(zone) {
    const values = {},
      generation = this.generation;
    for (const key of fields(zone.definition)) {
      if (generation !== this.generation) throw Error("Disposed");
      values[key] = await this.request(zone.definition.bounds[key]);
    }
    return values;
  }
  async poll(generation) {
    if (generation !== this.generation) return;
    if (!this.busy && !this.polling) {
      this.polling = true;
      this.refresh();
      this.controller = new AbortController();
      try {
        const targets = [];
        for (const [index, definition] of this.config.targets.entries()) {
          if (generation !== this.generation) return;
          try {
            const received = Date.now();
            const x = await this.request(definition.x),
              y = await this.request(definition.y);
            const presence = definition.presence
              ? (await this.request(definition.presence)) >= definition.presence.threshold
              : null;
            const age = definition.age ? await this.request(definition.age) : null;
            let z = null;
            if (definition.z) {
              try {
                z = await this.request(definition.z);
              } catch {
                /* X/Y remain useful. */
              }
            }
            targets.push({ index, definition, x, y, z, presence, age, received });
          } catch {
            /* Missing required coordinates hide this slot. */
          }
        }
        if (generation !== this.generation) return;
        this.targets = targets;
        for (const zone of this.zones) {
          const revision = zone.revision || 0;
          try {
            const actual = await this.readBounds(zone);
            if (generation !== this.generation) return;
            if (zone.pending && same(zone.pending, actual)) {
              clearTimeout(zone.pendingTimer);
              zone.pending = null;
              zone.dirty = Boolean(zone.conflict);
              zone.message = "Requested. Actual entity values agree. Hardware confirmation unavailable.";
            } else if (
              (zone.dirty || this.drag?.zone === zone || this.focusedZone === zone) &&
              zone.actual &&
              !same(zone.actual, actual)
            )
              zone.conflict = true;
            zone.actual = actual;
            zone.available = true;
            if (!zone.dirty && !this.drag && this.focusedZone !== zone && revision === (zone.revision || 0))
              zone.draft = { ...actual };
          } catch {
            zone.available = false;
          }
        }
      } finally {
        if (generation === this.generation) {
          this.polling = false;
          this.refresh();
        }
      }
    }
    if (generation === this.generation) this.timer = setTimeout(() => this.poll(generation), this.config.pollMs);
  }
  validDraft(zone) {
    return (
      zone.draft &&
      fields(zone.definition).every((key) => {
        const axis = this.config.axes[key[0]],
          value = zone.draft[key];
        return (
          Number.isFinite(value) &&
          value >= axis.min &&
          value <= axis.max &&
          Math.abs(value - snap(value, axis)) < 1e-8 &&
          zone.draft[`${key[0]}_min`] < zone.draft[`${key[0]}_max`]
        );
      })
    );
  }
  async apply(zone) {
    if (
      this.busy ||
      this.polling ||
      this.drag ||
      zone.pending ||
      !zone.available ||
      zone.conflict ||
      !zone.dirty ||
      !this.validDraft(zone)
    )
      return;
    const generation = this.generation,
      draft = { ...zone.draft };
    this.busy = true;
    this.controller = new AbortController();
    const staged = zone.definition.write === "staged";
    let buttonSent = false;
    zone.message = staged
      ? "Writing staging values. Apply not sent."
      : "Applying sequentially. Each value can change the device immediately.";
    this.refresh();
    try {
      const actual = await this.readBounds(zone);
      if (generation !== this.generation) return;
      if (!same(actual, zone.actual)) {
        zone.actual = actual;
        zone.conflict = true;
        zone.message = "Device bounds changed. Review the actual values, then acknowledge or discard.";
        return;
      }
      for (const key of fields(zone.definition)) {
        if (generation !== this.generation) return;
        await this.request(staged ? zone.definition.staging[key] : zone.definition.bounds[key], draft[key]);
      }
      if (staged) {
        for (const key of fields(zone.definition)) {
          if (Math.abs((await this.request(zone.definition.staging[key])) - draft[key]) > 1e-8)
            throw Error("Staging read-back differs");
          if (generation !== this.generation) return;
        }
        buttonSent = true;
        await this.request(zone.definition.applyButton, 1);
        if (generation !== this.generation) return;
        zone.message = "Apply requested. Awaiting actual read-back. Hardware confirmation unavailable.";
        zone.pending = draft;
        zone.pendingTimer = setTimeout(() => {
          if (generation !== this.generation || !zone.pending) return;
          zone.pending = null;
          zone.conflict = true;
          zone.message = "The device did not confirm the requested bounds before the deadline. Draft retained. Review actual values before another write.";
          this.refresh();
        }, this.config.pendingTimeoutMs ?? 15000);
        return;
      }
      const readback = await this.readBounds(zone);
      if (generation !== this.generation) return;
      zone.actual = readback;
      if (!same(readback, draft)) throw Error("Read-back differs");
      zone.dirty = false;
      zone.message = "Requested. Entity values agree. Hardware confirmation unavailable.";
    } catch {
      if (generation !== this.generation) return;
      if (buttonSent) zone.conflict = true;
      zone.message = staged
        ? buttonSent
          ? "Apply response uncertain. Do not retry without checking the device. Draft retained."
          : "Draft values partially written. Apply not sent. Draft retained."
        : "Apply incomplete. Device may contain mixed bounds. Draft retained. Discard does not undo writes.";
      try {
        const actual = await this.readBounds(zone);
        if (generation === this.generation) zone.actual = actual;
      } catch {
        zone.available = false;
      }
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.refresh();
      }
    }
  }
  element(tag, text, parent) {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    parent?.append(element);
    return element;
  }
  /** Add a self-contained decorative SVG, preserving the button's accessible name.
   * @param {HTMLButtonElement} button @param {string} name @param {boolean} compact @returns {void}
   */
  buttonIcon(button, name, compact = false) {
    /** @type {Record<string, string>} */
    const paths = {
      "zoom-in": "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12M14.5 14.5 21 21M7 10h6M10 7v6",
      "zoom-out": "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12M14.5 14.5 21 21M7 10h6",
      "fit-view": "M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 7h10v10H7z",
      "reset-view": "M4 9a8 8 0 1 1 0 6M4 3v6h6",
      move: "M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4",
      resize: "M4 10V4h6M14 20h6v-6M4 4l6 6M20 20l-6-6",
      "3d": "m12 3 9 5v9l-9 5-9-5V8zM3 8l9 5 9-5M12 13v9M12 3v10",
      top: "M4 4h16v16H4zM4 12h16M12 4v16",
      apply: "m4 12 5 5L20 6",
      discard: "M4 9a8 8 0 1 1 0 6M4 3v6h6",
    };
    /** @type {string} */
    const label = button.textContent;
    button.textContent = "";
    /** @type {SVGElement} */
    const icon = this.shape("svg", { viewBox: "0 0 24 24", class: "button-icon", fill: "none", stroke: "currentColor",
      "stroke-width": 1.7, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true",
      focusable: "false" }, button);
    this.shape("path", { d: paths[name] }, icon);
    if (compact) {
      button.title = label;
      button.setAttribute("aria-label", label);
    } else this.element("span", label, button);
  }
  draw() {
    this.shadowRoot.innerHTML = `<style>
      :host {
        display: block;
        max-width: 1200px;
        margin: 1rem auto;
        font: 16px system-ui;
        color: #182c3e;
        background: #fff;
        padding: 16px;
        border: 1px solid #b9c8d3;
        border-radius: 8px;
        box-sizing: border-box;
      }
      * {
        box-sizing: border-box;
      }
      h2 {
        font-size: 1.2rem;
        margin: 0 0 12px;
      }
      p {
        line-height: 1.5;
      }
      svg.scene {
        display: block;
        width: 100%;
        background: #f8fafc;
        touch-action: none;
        border: 1px solid #b9c8d3;
      }
      fieldset {
        margin: 16px 0;
        padding: 12px;
        border: 1px solid #9bafbd;
      }
      .inputs {
        display: grid;
        grid-template-columns: repeat(auto-fit,minmax(120px,1fr));
        gap: 10px;
      }
      label {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }
      input,button {
        font: inherit;
        padding: 8px;
        min-height: 42px;
      }
      input {
        width: 100%;
        border: 1px solid #829bad;
        border-radius: 3px;
      }
      button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-width: 44px;
        margin: 8px 8px 0 0;
        cursor: pointer;
      }
      .button-icon {
        display: block;
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
      }
      button[hidden] {
        display: none;
      }
      button:disabled {
        cursor: default;
      }
      .status {
        font-size: 14px;
        margin: 8px 0;
        overflow-wrap: anywhere;
      }
      .layout {
        display: grid;
        grid-template-columns: minmax(0,1fr) 300px;
        gap: 20px;
      }
      .map {
        min-width: 0;
      }
      .selectors {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin-bottom: 16px;
      }
      .selectors button {
        --colour: #526779;
        margin: 0;
        border: 1px solid var(--colour);
        border-radius: 5px;
        color: var(--colour);
        background: white;
      }
      .selectors button[aria-pressed=true] {
        background: var(--colour);
        color: white;
      }
      fieldset {
        margin: 0;
        border-radius: 6px;
        min-width: 0;
      }
      fieldset[hidden] {
        display: none;
      }
      legend {
        font-weight: 650;
      }
      .inputs {
        grid-template-columns: 1fr 1fr;
      }
      .dimensions {
        font-weight: 600;
      }
      .summary {
        font-size: 14px;
        color: #526779;
      }
      svg.scene:focus-visible {
        outline: 3px solid #377bd2;
        outline-offset: 3px;
      }
      .handle {
        fill: white;
        stroke-width: 2;
        cursor: crosshair;
      }
      .hit {
        fill: transparent;
        pointer-events: all;
        cursor: move;
      }
      @media(max-width:900px) {
        .layout {
          grid-template-columns: 1fr;
        }
        :host {
          padding: 12px;
        }
        svg.scene {
          min-height: 260px;
        }
      }
      .state {
        padding: 10px;
        background: #eef4f8;
        border-left: 3px solid #829bad;
        border-radius: 3px;
      }
      .state[data-state=dirty] {
        background: #fff5df;
        border-color: #cf8a19;
      }
      .state[data-state=conflict] {
        background: #fff0ef;
        border-color: #b83429;
      }
      .primary:not(:disabled) {
        background: #176ba0;
        color: white;
        border: 1px solid #176ba0;
        border-radius: 4px;
      }
      .point {
        stroke: white;
        stroke-width: 2;
      }
      .box {
        fill: #1384b51a;
        stroke: #12668c;
        stroke-width: 2;
      }
      .draft {
        fill: #ef9b251a;
        stroke: #a25800;
        stroke-width: 2;
        stroke-dasharray: 5 3;
      }
    </style>`;
    this.selected ??= 0;
    this.view = { x: { ...this.config.axes.x }, y: { ...this.config.axes.y } };
    this.viewMode = this.config.axes.z ? "3d" : "top";
    this.manipulationMode = "move";
    this.spatial = new SpatialRenderer(this);
    this.element("h2", this.config.title || "Coordinate zones", this.shadowRoot);
    this.summary = this.element("p", "", this.shadowRoot);
    this.summary.className = "summary";
    this.selectors = this.element("div", "", this.shadowRoot);
    this.selectors.className = "selectors";
    const layout = this.element("div", "", this.shadowRoot);
    layout.className = "layout";
    const map = this.element("div", "", layout);
    map.className = "map";
    const panel = this.element("div", "", layout);
    this.sceneControls = this.element("div", "", map);
    this.sceneControls.className = "selectors scene-controls";
    this.viewButtons = {};
    this.modeButtons = {};
    if (this.config.axes.z) {
      for (const [mode, label] of [["3d", "3D view"], ["top", "Top view"]]) {
        /** @type {HTMLButtonElement} */
        const button = this.element("button", label, this.sceneControls);
        this.buttonIcon(button, mode);
        button.dataset.view = mode;
        button.onclick = () => this.setViewMode(mode);
        this.viewButtons[mode] = button;
      }
      for (const [mode, label] of [["move", "Move"], ["resize", "Resize"]]) {
        /** @type {HTMLButtonElement} */
        const button = this.element("button", label, this.sceneControls);
        this.buttonIcon(button, mode);
        button.dataset.mode = mode;
        button.onclick = () => this.setManipulationMode(mode);
        this.modeButtons[mode] = button;
      }
      for (const [action, label, callback] of [["zoom-in", "Zoom in", () => this.spatial.zoomBy(1.2)],
        ["zoom-out", "Zoom out", () => this.spatial.zoomBy(1 / 1.2)], ["reset-view", "Reset view", () => this.spatial.reset()]]) {
        /** @type {HTMLButtonElement} */
        const button = this.element("button", label, this.sceneControls);
        this.buttonIcon(button, action, true);
        button.dataset.action = action;
        button.onclick = callback;
      }
    }
    this.hint = this.element(
      "p",
      "Drag inside a zone to move it. Drag a corner to resize. " +
        "Arrow keys move by one step, Shift by ten. Escape cancels.",
      map,
    );
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.classList.add("scene");
    this.svg.setAttribute("viewBox", "0 0 640 480");
    this.svg.setAttribute("role", "group");
    this.svg.setAttribute("tabindex", "0");
    this.svg.setAttribute("aria-label", "Target coordinates and zone bounds");
    map.append(this.svg);
    const legend = this.element("p", "Solid: actual bounds. Dashed: selected local draft.", map);
    legend.className = "status";
    this.gridLayer = this.shape("g", { class: "grid" });
    this.zoneLayer = this.shape("g", { class: "zones" });
    this.targetLayer = this.shape("g", { class: "targets", "pointer-events": "none" });
    this.handleLayer = this.shape("g", { class: "spatial-handles" });
    const fit = this.element("button", "Fit view", this.selectors);
    this.buttonIcon(fit, "fit-view", true);
    fit.dataset.action = "fit-view";
    fit.onclick = () => this.fitView();
    this.details = this.element("div", "", map);
    this.element(
      "p",
      "Coordinates are separate entity reads and may span adjacent reports. " +
        "Without report age, source freshness is unknown.",
      this.shadowRoot,
    );
    this.forms = this.zones.map((zone, index) => {
      const group = this.element("fieldset", "", panel);
      this.element("legend", `${zone.definition.label}${zone.definition.write ? " draft" : ""}`, group);
      const select = this.element("button", zone.definition.label, this.selectors);
      select.style.setProperty("--colour", colour(index));
      select.onclick = () => {
        this.selectZone(index);
      };
      const inputs = this.element("div", "", group);
      inputs.className = "inputs";
      const controls = {};
      for (const key of fields(zone.definition)) {
        const label = this.element(
          "label",
          `${key[0].toUpperCase()} ${key.endsWith("min") ? "Min" : "Max"} (${this.config.unit})`,
          inputs,
        );
        const input = this.element("input", "", label),
          axis = this.config.axes[key[0]];
        input.type = "number";
        input.min = axis.min;
        input.max = axis.max;
        input.step = axis.step;
        input.oninput = () => {
          if (!zone.draft || this.busy) return;
          this.setDraft(zone, { ...zone.draft, [key]: input.value === "" ? NaN : Number(input.value) });
        };
        input.onfocus = () => {
          this.focusedZone = zone;
          zone.revision = (zone.revision || 0) + 1;
        };
        input.onblur = () => {
          this.focusedZone = null;
          this.refresh();
        };
        controls[key] = input;
      }
      const dimensions = this.element("p", "", group);
      dimensions.className = "dimensions";
      const actual = this.element("p", "", group);
      actual.className = "status";
      const status = this.element("p", "", group);
      status.className = "status state";
      status.setAttribute("role", "status");
      const apply = this.element("button", "Apply", group);
      this.buttonIcon(apply, "apply");
      apply.className = "primary";
      apply.onclick = () => this.apply(zone);
      const discard = this.element("button", "Discard draft", group);
      this.buttonIcon(discard, "discard");
      discard.onclick = () => {
        zone.draft = { ...zone.actual };
        clearTimeout(zone.pendingTimer);
        zone.pending = null;
        zone.dirty = false;
        zone.conflict = false;
        zone.message = "Draft discarded. Prior writes are not undone.";
        this.refresh();
      };
      const acknowledge = this.element("button", "Keep draft after reviewing actual values", group);
      acknowledge.onclick = () => {
        if (this.busy || this.polling || zone.pending || !zone.available) return;
        zone.conflict = false;
        this.refresh();
      };
      return { group, dimensions, controls, actual, status, apply, discard, acknowledge, select };
    });
    this.svg.onpointerdown = (event) => this.startGesture(event);
    this.svg.onpointermove = (event) => this.updateGesture(event);
    this.svg.onpointerup = (event) => this.endGesture(event, false);
    this.svg.onpointercancel = (event) => this.endGesture(event, true);
    this.svg.onkeydown = (event) => this.keyMove(event);
    this.svg.onwheel = (event) => {
      if (this.viewMode !== "3d") return;
      event.preventDefault();
      this.spatial.zoomBy(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.002));
    };
    this.drawGrid();
    this.refresh();
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => {
        const width = this.svg.getBoundingClientRect().width;
        if (!width) return;
        this.displayScale = Math.max(1, 640 / width);
        this.zoneSignature = null;
        this.drawGrid();
        this.drawZones();
        this.drawPoints();
      });
      this.observer.observe(this.svg);
    }
  }
  selectZone(index) {
    if (this.busy || this.drag) return;
    this.selected = index;
    this.refresh();
  }
  setDraft(zone, bounds) {
    zone.draft = bounds;
    zone.revision = (zone.revision || 0) + 1;
    zone.dirty = true;
    zone.message = "Local draft. Nothing sent until Apply.";
    this.refresh();
  }
  editable(zone) {
    return zone?.definition.write && zone.available && !zone.pending && !zone.conflict && !this.busy && this.validDraft(zone);
  }
  /** @returns {void} */
  cancelInteraction() {
    if (this.drag) this.endGesture({ pointerId: this.drag.pointer }, true);
    if (this.orbit) this.endGesture({ pointerId: this.orbit.pointer }, true);
  }
  /** @param {string} mode @returns {void} */
  setViewMode(mode) {
    if (!["3d", "top"].includes(mode) || mode === "3d" && !this.config.axes.z) return;
    this.cancelInteraction();
    this.viewMode = mode;
    this.handleLayer.replaceChildren();
    this.spatial.handles.clear();
    this.zoneSignature = null;
    this.drawGrid();
    this.refresh();
  }
  /** @param {string} mode @returns {void} */
  setManipulationMode(mode) {
    if (!["move", "resize"].includes(mode) || this.drag) return;
    this.manipulationMode = mode;
    this.refresh();
  }
  /** @param {PointerEvent} event @returns {ScreenPoint | null} */
  scenePointer(event) {
    /** @type {DOMMatrix | null} */
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return null;
    /** @type {DOMPoint} */
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? { x: point.x, y: point.y } : null;
  }
  /** @param {PointerEvent} event @returns {void} */
  startSpatialGesture(event) {
    if (event.button !== 0 || this.drag || this.orbit) return;
    /** @type {ScreenPoint | null} */
    const point = this.scenePointer(event);
    if (!point) return;
    /** @type {string | undefined} */
    const axis = event.target.dataset.axis;
    /** @type {object | undefined} */
    const zone = this.zones[this.selected];
    if (axis) {
      if (!this.editable(zone)) return;
      /** @type {ScreenPoint} */
      const vector = this.spatial.axisVector(axis);
      if (Math.hypot(vector.x, vector.y) < this.spatial.camera.scale * this.spatial.camera.zoom * 0.12) return;
      this.drag = { zone, point, axis, vector, edge: event.target.dataset.edge, pointer: event.pointerId,
        bounds: { ...zone.draft }, dirty: zone.dirty, message: zone.message };
      zone.revision = (zone.revision || 0) + 1;
    } else {
      this.orbit = { point, pointer: event.pointerId, yaw: this.spatial.camera.yaw, pitch: this.spatial.camera.pitch };
    }
    this.svg.focus();
    this.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.refresh();
  }
  startGesture(event) {
    if (this.viewMode === "3d") return this.startSpatialGesture(event);
    const zone = this.zones[this.selected];
    if (event.button !== 0 || !this.editable(zone) || this.drag) return;
    const corner = event.target.dataset.corner?.split(",");
    if (!corner && !event.target.classList.contains("hit")) return;
    const point = this.pointer(event);
    if (!point) return;
    this.drag = {
      zone,
      point,
      corner,
      pointer: event.pointerId,
      bounds: { ...zone.draft },
      dirty: zone.dirty,
      message: zone.message,
    };
    zone.revision = (zone.revision || 0) + 1;
    this.svg.focus();
    this.svg.setPointerCapture(event.pointerId);
    event.preventDefault();
    this.refresh();
  }
  updateGesture(event) {
    if (this.orbit && event.pointerId === this.orbit.pointer) {
      /** @type {ScreenPoint | null} */
      const point = this.scenePointer(event);
      if (!point) return;
      this.spatial.camera.yaw = this.orbit.yaw + (point.x - this.orbit.point.x) * 0.008;
      this.spatial.camera.pitch = Math.max(0.15, Math.min(1.4, this.orbit.pitch + (point.y - this.orbit.point.y) * 0.006));
      this.spatial.render();
      return;
    }
    const gesture = this.drag;
    if (!gesture || event.pointerId !== gesture.pointer || this.busy) return;
    if (gesture.axis) {
      /** @type {ScreenPoint | null} */
      const point = this.scenePointer(event);
      if (!point) return;
      /** @type {number | null} */
      const displacement = axisDisplacement({ x: point.x - gesture.point.x, y: point.y - gesture.point.y }, gesture.vector);
      if (displacement === null) return;
      /** @type {Bounds | null} */
      const bounds = gesture.edge === "move" ? moveBounds(gesture.bounds, { [gesture.axis]: displacement }, this.config.axes) :
        resizeAxisBounds(gesture.bounds, gesture.axis, gesture.edge,
          gesture.bounds[`${gesture.axis}_${gesture.edge}`] + displacement, this.config.axes[gesture.axis]);
      if (bounds && !same(bounds, gesture.zone.draft)) this.setDraft(gesture.zone, bounds);
      return;
    }
    const point = this.pointer(event);
    if (!point) return;
    const delta = { x: point.x - gesture.point.x, y: point.y - gesture.point.y };
    const bounds = gesture.corner
      ? resizeBounds(
          gesture.bounds,
          {
            x: gesture.bounds[`x_${gesture.corner[0]}`] + delta.x,
            y: gesture.bounds[`y_${gesture.corner[1]}`] + delta.y,
          },
          gesture.corner,
          this.config.axes,
        )
      : moveBounds(gesture.bounds, delta, this.config.axes);
    if (bounds && !same(bounds, gesture.zone.draft)) this.setDraft(gesture.zone, bounds);
  }
  endGesture(event, cancel) {
    if (this.orbit && event.pointerId === this.orbit.pointer) {
      if (cancel) {
        this.spatial.camera.yaw = this.orbit.yaw;
        this.spatial.camera.pitch = this.orbit.pitch;
      }
      this.orbit = null;
      if (this.svg.hasPointerCapture?.(event.pointerId)) this.svg.releasePointerCapture(event.pointerId);
      this.drawGrid();
      this.refresh();
      return;
    }
    const gesture = this.drag;
    if (!gesture || event.pointerId !== gesture.pointer) return;
    if (cancel) {
      gesture.zone.draft = gesture.bounds;
      gesture.zone.dirty = gesture.dirty;
      gesture.zone.message = gesture.message;
    }
    this.drag = null;
    if (this.svg.hasPointerCapture?.(gesture.pointer)) this.svg.releasePointerCapture(gesture.pointer);
    this.refresh();
  }
  keyMove(event) {
    if (event.target !== this.svg) return;
    if (event.key === "Escape" && (this.drag || this.orbit)) {
      this.cancelInteraction();
      event.preventDefault();
      return;
    }
    const delta = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0],
      ...(this.viewMode === "3d" ? { PageUp: [0, 0, 1], PageDown: [0, 0, -1] } : {}) }[event.key];
    const zone = this.zones[this.selected];
    if (!delta || !this.editable(zone) || this.drag || event.altKey || event.ctrlKey || event.metaKey) return;
    const multiplier = event.shiftKey ? 10 : 1;
    this.setDraft(
      zone,
      moveBounds(
        zone.draft,
        { x: delta[0] * this.config.axes.x.step * multiplier, y: delta[1] * this.config.axes.y.step * multiplier,
          z: delta[2] * (this.config.axes.z?.step || 0) * multiplier },
        this.config.axes,
      ),
    );
    event.preventDefault();
  }
  fitView() {
    if (this.drag || this.orbit) return;
    if (this.viewMode === "3d") { this.spatial.fit(); this.spatial.render(); return; }
    for (const key of ["x", "y"]) {
      const values = [0];
      for (const zone of this.zones)
        for (const box of [zone.actual, zone.dirty ? zone.draft : null]) {
          if (box) values.push(...[box[`${key}_min`], box[`${key}_max`]].filter(Number.isFinite));
        }
      const min = Math.min(...values),
        max = Math.max(...values);
      const padding = Math.max((max - min) * 0.12, this.config.axes[key].step * 2);
      this.view[key] = { min: min - padding, max: max + padding };
    }
    this.drawGrid();
    this.zoneSignature = null;
    this.drawZones();
    this.drawPoints();
  }
  geometry() {
    const { x, y } = this.view || this.config.axes;
    const scale = Math.min(540 / (x.max - x.min), 380 / (y.max - y.min));
    return { scale, left: (640 - scale * (x.max - x.min)) / 2, top: (480 - scale * (y.max - y.min)) / 2 };
  }
  pointer(event) {
    const matrix = this.svg.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const { scale, left, top } = this.geometry(),
      { x, y } = this.view;
    const values = { x: x.min + (point.x - left) / scale, y: y.max - (point.y - top) / scale };
    return Object.values(values).every(Number.isFinite) ? values : null;
  }
  shape(tag, attributes, parent = this.svg) {
    const shape = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
    if (tag === "text") {
      shape.setAttribute("font-size", String(Number(attributes["font-size"] || 12) * (this.displayScale || 1)));
    }
    parent.append(shape);
    return shape;
  }
  projection() {
    const { scale, left, top } = this.geometry(),
      { x, y } = this.view;
    return { scale, px: (value) => left + (value - x.min) * scale, py: (value) => top + (y.max - value) * scale };
  }
  drawGrid() {
    if (this.viewMode === "3d") return this.spatial.drawGrid();
    this.gridLayer.replaceChildren();
    const { px, py } = this.projection(),
      { x, y } = this.view;
    const text = (label, attributes) => {
      this.shape("text", { "font-size": 12, fill: "#526779", ...attributes }, this.gridLayer).textContent = label;
    };
    for (const [key, axis] of Object.entries(this.view)) {
      const rough = (axis.max - axis.min) / (6 / (this.displayScale || 1));
      const magnitude = 10 ** Math.floor(Math.log10(rough));
      let spacing = [1, 2, 5, 10].find((step) => step * magnitude >= rough) * magnitude;
      while (Math.floor(axis.max / spacing) - Math.ceil(axis.min / spacing) + 1 < 2) spacing /= 2;
      for (let value = Math.ceil(axis.min / spacing) * spacing; value <= axis.max; value += spacing) {
        this.shape(
          "line",
          {
            x1: key === "x" ? px(value) : px(x.min),
            x2: key === "x" ? px(value) : px(x.max),
            y1: key === "y" ? py(value) : py(y.min),
            y2: key === "y" ? py(value) : py(y.max),
            stroke: "#dce5eb",
          },
          this.gridLayer,
        );
        text(Number(value.toFixed(5)), {
          x: key === "x" ? px(value) : px(x.min) - 10,
          y: key === "x" ? py(y.min) + 22 : py(value) + 4,
          "text-anchor": key === "x" ? "middle" : "end",
        });
      }
    }
    text(`X (${this.config.unit})`, { x: 320, y: 470, "text-anchor": "middle" });
    text(`Y (${this.config.unit})`, { x: 18, y: 24 });
    if (x.min <= 0 && x.max >= 0 && y.min <= 0 && y.max >= 0) {
      this.shape(
        "path",
        { d: `M${px(0) - 6},${py(0)}h12 M${px(0)},${py(0) - 6}v12`, stroke: "#182c3e", "stroke-width": 2 },
        this.gridLayer,
      );
      text(`${this.config.originLabel || "Origin"} (0, 0)`, { x: px(0) + 9, y: py(0) - 10 });
    }
  }
  drawZones() {
    if (this.viewMode === "3d") return this.spatial.drawZones();
    const signature = JSON.stringify([
      this.selected,
      this.busy,
      this.zones.map((zone) => [zone.actual, zone.draft, zone.dirty, zone.available, zone.pending]),
    ]);
    if (signature === this.zoneSignature) return;
    this.zoneSignature = signature;
    this.zoneLayer.replaceChildren();
    const { px, py, scale } = this.projection();
    const rectangle = (bounds, attributes) =>
      this.shape(
        "rect",
        {
          x: px(bounds.x_min),
          y: py(bounds.y_max),
          width: Math.max(0, (bounds.x_max - bounds.x_min) * scale),
          height: Math.max(0, (bounds.y_max - bounds.y_min) * scale),
          ...attributes,
        },
        this.zoneLayer,
      );
    this.zones.forEach((zone, index) => {
      if (!zone.actual || !Object.values(zone.actual).every(Number.isFinite)) return;
      rectangle(zone.actual, { fill: `${colour(index)}15`, stroke: colour(index), "stroke-width": 2 });
      this.shape(
        "text",
        {
          x: px(zone.actual.x_min) + 8,
          y: py(zone.actual.y_max) + 18,
          fill: colour(index),
          "font-size": 13,
          "pointer-events": "none",
        },
        this.zoneLayer,
      ).textContent = zone.definition.label;
    });
    const zone = this.zones[this.selected];
    if (!zone?.draft || !Object.values(zone.draft).every(Number.isFinite)) return;
    rectangle(zone.draft, {
      fill: `${colour(this.selected)}20`,
      stroke: colour(this.selected),
      "stroke-width": 2,
      "stroke-dasharray": zone.dirty ? "6 4" : "none",
    });
    if (!this.editable(zone)) return;
    rectangle(zone.draft, { class: "hit" });
    for (const x of ["min", "max"])
      for (const y of ["min", "max"]) {
        this.shape(
          "rect",
          {
            x: px(zone.draft[`x_${x}`]) - 7 * (this.displayScale || 1),
            y: py(zone.draft[`y_${y}`]) - 7 * (this.displayScale || 1),
            width: 14 * (this.displayScale || 1),
            height: 14 * (this.displayScale || 1),
            rx: 3,
            class: "handle",
            stroke: colour(this.selected),
            "data-corner": `${x},${y}`,
          },
          this.zoneLayer,
        );
        const hitSize = 44 * (this.displayScale || 1);
        this.shape(
          "rect",
          {
            x: px(zone.draft[`x_${x}`]) - hitSize / 2,
            y: py(zone.draft[`y_${y}`]) - hitSize / 2,
            width: hitSize,
            height: hitSize,
            fill: "transparent",
            "data-corner": `${x},${y}`,
            "pointer-events": "all",
            style: "cursor:crosshair",
          },
          this.zoneLayer,
        );
      }
  }
  visibleTargets(now = Date.now()) {
    return this.targets.filter((target) => {
      const elapsed = now - target.received;
      return (
        elapsed <= this.config.expireMs &&
        target.presence !== false &&
        (target.age === null || (target.age >= 0 && target.age + elapsed / 1000 <= target.definition.age.max))
      );
    });
  }
  drawPoints() {
    if (!this.svg) return;
    this.targetLayer.replaceChildren();
    this.details.replaceChildren();
    const { px, py } = this.projection(),
      { x, y } = this.view;
    /** @type {boolean} */
    const spatial = this.viewMode === "3d";
    const targets = this.visibleTargets();
    if (spatial) targets.sort((first, second) => this.spatial.project({ x: first.x, y: first.y, z: first.z ?? 0 }).depth -
      this.spatial.project({ x: second.x, y: second.y, z: second.z ?? 0 }).depth);
    let plotted = 0;
    for (const [fallback, target] of targets.entries()) {
      const paint = colour(target.index ?? fallback);
      /** @type {{x: number, y: number, depth: number}} */
      const point = spatial ? this.spatial.project({ x: target.x, y: target.y, z: target.z ?? 0 }) :
        { x: px(target.x), y: py(target.y), depth: 0 };
      /** @type {boolean} */
      const missingHeight = spatial && !Number.isFinite(target.z);
      const inside = spatial ? !missingHeight && point.x >= 10 && point.x <= 630 && point.y >= 10 && point.y <= 470 :
        target.x >= x.min && target.x <= x.max && target.y >= y.min && target.y <= y.max;
      if (inside) {
        plotted++;
        if (spatial) {
          /** @type {ScreenPoint} */
          const floor = this.spatial.project({ x: target.x, y: target.y, z: 0 });
          this.shape("line", { x1: point.x, y1: point.y, x2: floor.x, y2: floor.y, class: "drop-line",
            stroke: paint, "stroke-width": 1.5, "stroke-dasharray": "3 3" }, this.targetLayer);
          this.shape("circle", { cx: floor.x, cy: floor.y, r: 3, fill: paint, "fill-opacity": 0.45 }, this.targetLayer);
        }
        this.shape(
          "circle",
          { cx: point.x, cy: point.y, r: 6, class: "point", fill: paint, "data-depth": point.depth },
          this.targetLayer,
        );
        this.shape(
          "text",
          { x: point.x + 10, y: point.y - 10 - fallback * 14, fill: paint, "font-size": 12 },
          this.targetLayer,
        ).textContent = target.definition.label;
      }
      const detail = this.element(
        "p",
        [
          `${target.definition.label}: X ${target.x}, Y ${target.y}`,
          target.definition.z || this.config.axes.z ? `, Z ${target.z ?? "unavailable"}` : "",
          ". ",
          inside ? "" : missingHeight ? "Height unavailable. Use Top view for X/Y. " : "Outside view. ",
          target.presence === null ? "Presence unknown. " : "",
          target.age === null ? "Source freshness unknown." : "Within configured report age.",
        ].join(""),
        this.details,
      );
      detail.className = "status";
      detail.style.color = paint;
    }
    const targetCount = `${targets.length} usable target${targets.length === 1 ? "" : "s"}`;
    this.summary.textContent = `${targetCount}, ${plotted} plotted. ${spatial ? "X/Y/Z" : "X/Y"} in ${this.config.unit}. Equal axis scale.`;
    if (!targets.length) this.element("p", "No usable coordinates. Absent, unavailable or expired.", this.details);
  }
  refresh() {
    if (this.viewMode === "3d" && !this.spatial.framed) {
      this.spatial.fit(true);
      this.spatial.drawGrid();
    }
    for (const [mode, button] of Object.entries(this.viewButtons || {})) button.setAttribute("aria-pressed", String(mode === this.viewMode));
    for (const [mode, button] of Object.entries(this.modeButtons || {})) {
      button.hidden = this.viewMode !== "3d";
      button.disabled = !this.editable(this.zones[this.selected]) || Boolean(this.drag);
      button.setAttribute("aria-pressed", String(mode === this.manipulationMode));
    }
    for (const button of this.sceneControls?.querySelectorAll("[data-action]") || []) {
      button.hidden = this.viewMode !== "3d";
      button.disabled = Boolean(this.drag || this.orbit);
    }
    if (this.hint) this.hint.textContent = this.viewMode === "3d" ?
      "Drag empty space to orbit. Use the wheel or Zoom buttons. Choose Move or Resize and drag the labelled X/Y/Z handles. " +
        "Arrow keys move X/Y. PageUp/PageDown move Z, Shift by ten. Escape cancels." :
      "Drag inside a zone to move it. Drag a corner to resize. Arrow keys move by one step, Shift by ten. Escape cancels.";
    this.forms?.forEach((form, index) => {
      const zone = this.zones[index],
        writable = Boolean(zone.definition.write);
      form.group.hidden = index !== this.selected;
      form.select.setAttribute("aria-pressed", String(index === this.selected));
      form.dimensions.textContent = zone.draft
        ? ["x", "y", "z"]
            .filter((axis) => `${axis}_min` in zone.draft)
            .map((axis, position) => {
              const extent = Number((zone.draft[`${axis}_max`] - zone.draft[`${axis}_min`]).toFixed(3));
              return `${["Width", "Depth", "Height"][position]} ${extent} ${this.config.unit}`;
            })
            .join(" / ")
        : "Dimensions unavailable";
      for (const [key, input] of Object.entries(form.controls)) {
        if (this.shadowRoot.activeElement !== input)
          input.value = Number.isFinite(zone.draft?.[key]) ? zone.draft[key] : "";
        input.disabled = !writable || !zone.draft || this.busy || Boolean(zone.pending);
      }
      form.actual.textContent = `Actual: ${
        zone.actual
          ? ["x", "y", "z"]
              .filter((axis) => `${axis}_min` in zone.actual)
              .map((axis) => `${axis.toUpperCase()} ${zone.actual[`${axis}_min`]} to ${zone.actual[`${axis}_max`]}`)
              .join(", ") +
            " " +
            this.config.unit
          : "unavailable"
      }`;
      form.status.dataset.state = zone.conflict ? "conflict" : zone.dirty ? "dirty" : "actual";
      const writeStatus = writable
        ? zone.definition.write === "staged"
          ? "Staged writes. Other clients can change staging before Apply."
          : "Sequential writes. Hardware confirmation unavailable."
        : "Read-only zone.";
      form.status.textContent = [
        !zone.available ? "Bounds unavailable. " : "",
        zone.conflict ? "Review required: check actual bounds before applying. " : "",
        zone.message || writeStatus,
      ].join("");
      form.apply.hidden = form.discard.hidden = !writable;
      form.apply.disabled =
        this.busy ||
        this.polling ||
        Boolean(this.drag) ||
        Boolean(zone.pending) ||
        !zone.available ||
        zone.conflict ||
        !zone.dirty ||
        !this.validDraft(zone);
      form.discard.disabled = this.busy || !zone.actual;
      form.acknowledge.hidden = !zone.conflict;
      form.acknowledge.disabled = this.busy || this.polling || Boolean(zone.pending) || !zone.available;
      form.select.disabled = this.busy || Boolean(this.drag);
    });
    this.drawZones();
    this.drawPoints();
  }
}
window.CoordinateEditor = CoordinateEditor;
customElements.define("coordinate-editor", CoordinateEditor);

/** Mount below the stock app, outside its private shadow DOM.
 * Configuration modules dispatch coordinate-editor-config after assigning the global.
 * @returns {void}
 */
function installCoordinateEditor() {
  /** @type {Document} */
  const pageDocument = document;
  /** @type {HTMLScriptElement | null} */
  const script = pageDocument.currentScript || pageDocument.querySelector('script[src*="coordinate-editor.js"][data-config]');
  /** @type {string | null} */
  const url = script?.getAttribute("data-config");
  /** @type {MutationObserver} */
  const observer = new MutationObserver(mount);
  /** @returns {void} */
  function mount() {
    if (pageDocument.querySelector("coordinate-editor")) {
      observer.disconnect();
      window.removeEventListener("coordinate-editor-config", mount);
      return;
    }
    /** @type {Element | null} */
    const app = pageDocument.querySelector("esp-app");
    if (!app || (!url && window.coordinateEditorConfig === undefined &&
        !pageDocument.querySelector('script[type="application/json"]#coordinate-editor-config'))) return;
    /** @type {HTMLElement} */
    const editor = pageDocument.createElement("coordinate-editor");
    if (url) editor.setAttribute("data-config", url);
    observer.disconnect();
    window.removeEventListener("coordinate-editor-config", mount);
    app.insertAdjacentElement("afterend", editor);
  }
  observer.observe(pageDocument.documentElement, { childList: true, subtree: true });
  window.addEventListener("coordinate-editor-config", mount);
  if (pageDocument.readyState === "loading") pageDocument.addEventListener("DOMContentLoaded", mount, { once: true });
  else mount();
}
installCoordinateEditor();
