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
/** @param {Bounds} bounds @param {{x: number, y: number}} delta @param {Axes} axes */
function moveBounds(bounds, delta, axes) {
  const result = { ...bounds };
  for (const key of ["x", "y"]) {
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
      svg {
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
        margin: 8px 8px 0 0;
        cursor: pointer;
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
      svg:focus-visible {
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
        svg {
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
    this.element(
      "p",
      "Drag inside a zone to move it. Drag a corner to resize. " +
        "Arrow keys move by one step, Shift by ten. Escape cancels.",
      map,
    );
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
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
    const fit = this.element("button", "Fit view", this.selectors);
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
      apply.className = "primary";
      apply.onclick = () => this.apply(zone);
      const discard = this.element("button", "Discard draft", group);
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
    return zone?.definition.write && zone.available && !zone.pending && !this.busy && this.validDraft(zone);
  }
  startGesture(event) {
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
    const gesture = this.drag;
    if (!gesture || event.pointerId !== gesture.pointer || this.busy) return;
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
    if (event.key === "Escape" && this.drag) {
      this.endGesture({ pointerId: this.drag.pointer }, true);
      event.preventDefault();
      return;
    }
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    const zone = this.zones[this.selected];
    if (!delta || !this.editable(zone) || this.drag || event.altKey || event.ctrlKey || event.metaKey) return;
    const multiplier = event.shiftKey ? 10 : 1;
    this.setDraft(
      zone,
      moveBounds(
        zone.draft,
        { x: delta[0] * this.config.axes.x.step * multiplier, y: delta[1] * this.config.axes.y.step * multiplier },
        this.config.axes,
      ),
    );
    event.preventDefault();
  }
  fitView() {
    if (this.drag) return;
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
    const targets = this.visibleTargets();
    let plotted = 0;
    for (const [fallback, target] of targets.entries()) {
      const paint = colour(target.index ?? fallback);
      const inside = target.x >= x.min && target.x <= x.max && target.y >= y.min && target.y <= y.max;
      if (inside) {
        plotted++;
        this.shape(
          "circle",
          { cx: px(target.x), cy: py(target.y), r: 6, class: "point", fill: paint },
          this.targetLayer,
        );
        this.shape(
          "text",
          { x: px(target.x) + 10, y: py(target.y) - 10 - fallback * 14, fill: paint, "font-size": 12 },
          this.targetLayer,
        ).textContent = target.definition.label;
      }
      const detail = this.element(
        "p",
        [
          `${target.definition.label}: X ${target.x}, Y ${target.y}`,
          target.definition.z ? `, Z ${target.z ?? "unavailable"}` : "",
          ". ",
          inside ? "" : "Outside view. ",
          target.presence === null ? "Presence unknown. " : "",
          target.age === null ? "Source freshness unknown." : "Within configured report age.",
        ].join(""),
        this.details,
      );
      detail.className = "status";
      detail.style.color = paint;
    }
    const targetCount = `${targets.length} usable target${targets.length === 1 ? "" : "s"}`;
    this.summary.textContent = `${targetCount}, ${plotted} plotted. X/Y in ${this.config.unit}. Equal axis scale.`;
    if (!targets.length) this.element("p", "No usable coordinates. Absent, unavailable or expired.", this.details);
  }
  refresh() {
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
