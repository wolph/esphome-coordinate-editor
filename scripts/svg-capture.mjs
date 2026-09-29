/** Installed in the editor frame by Playwright. All helpers stay inside this browser context.
 * @returns {void}
 */
export function installSvgCapture() {
  /** @type {any} */
  const editor = window.demoFrame.editor;
  /** @type {DOMRect} */
  const bounds = editor.getBoundingClientRect();
  /** @type {XMLSerializer} */
  const serializer = new XMLSerializer();
  /** @type {number} */
  const started = performance.now();
  /** @type {{x: number, y: number, buttons: number} | null} */
  let pointer = null;

  /** Freeze the layout rules that apply to the recorded desktop, even in a small README image.
   * @param {CSSRuleList} rules @returns {string}
   */
  function styles(rules) {
    return [...rules].map((rule) => rule instanceof CSSMediaRule
      ? matchMedia(rule.conditionText).matches ? styles(rule.cssRules) : ""
      : rule.cssText).join("\n").replaceAll(":host", ".recorded-editor");
  }

  /** Clone the actual controls, including live values and their disabled state.
   * @returns {string}
   */
  function captureInterface() {
    /** @type {HTMLDivElement} */
    const clone = document.createElement("div");
    clone.className = "recorded-editor";
    clone.style.cssText = `width:${bounds.width}px;height:${bounds.height}px;margin:0;border-radius:0`;
    clone.innerHTML = editor.shadowRoot.innerHTML;
    /** @type {HTMLInputElement[]} */
    const inputs = [...editor.shadowRoot.querySelectorAll("input")];
    clone.querySelectorAll("input").forEach((input, index) => {
      input.setAttribute("value", inputs[index].value);
      if (inputs[index] === editor.shadowRoot.activeElement) input.style.outline = getComputedStyle(inputs[index]).outline;
    });
    clone.querySelector("svg.scene").replaceChildren();
    for (const element of clone.querySelectorAll("style, [hidden]")) element.remove();
    for (const element of clone.querySelectorAll("[id]")) element.removeAttribute("id");
    return `<foreignObject width="${bounds.width}" height="${bounds.height}">${serializer.serializeToString(clone)}</foreignObject>`;
  }

  /** Keep the original vector geometry at its measured position in the interface.
   * @returns {string[]}
   */
  function captureScene() {
    /** @type {SVGSVGElement} */
    const clone = /** @type {SVGSVGElement} */ (editor.svg.cloneNode(true));
    for (const element of clone.querySelectorAll("*")) {
      for (const attribute of [...element.attributes]) {
        if (/^(data-|aria-|on)/.test(attribute.name) || ["tabindex", "style", "pointer-events"].includes(attribute.name)) {
          element.removeAttribute(attribute.name);
        } else if (["x", "y", "x1", "x2", "y1", "y2", "cx", "cy", "r", "points", "transform", "font-size"].includes(attribute.name)) {
          element.setAttribute(attribute.name, attribute.value.replace(/-?\d+\.\d+(?:e[-+]?\d+)?/gi,
            (value) => String(Number(Number(value).toFixed(2)))));
        }
      }
    }
    /** @type {DOMMatrix} */
    const matrix = editor.svg.getScreenCTM();
    /** @type {string} */
    const transform = `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e - bounds.x} ${matrix.f - bounds.y})`;
    return [...clone.children].map((layer) => `<g transform="${transform}">${serializer.serializeToString(layer)}</g>`);
  }

  /** @param {PointerEvent} event @returns {void} */
  function trackPointer(event) {
    pointer = { x: event.clientX - bounds.x, y: event.clientY - bounds.y, buttons: event.buttons };
  }

  /** @type {import('./svg-preview.mjs').SvgCapture} */
  const capture = { viewBox: `0 0 ${bounds.width} ${bounds.height}`, duration: 35,
    css: styles(editor.shadowRoot.querySelector("style").sheet.cssRules), frames: [] };

  /** @returns {void} */
  function sample() {
    /** @type {number} */
    const elapsed = (performance.now() - started) / 1000;
    if (elapsed >= capture.duration) return;
    /** @type {string[]} */
    const layers = captureScene();
    if (pointer && pointer.x >= 0 && pointer.x <= bounds.width && pointer.y >= 0 && pointer.y <= bounds.height) {
      layers.push(`<circle cx="${pointer.x.toFixed(2)}" cy="${pointer.y.toFixed(2)}" r="9" fill="${pointer.buttons ? "#176ba099" : "#ffffff99"}" stroke="#153b58" stroke-width="2"/>`);
    }
    capture.frames.push({ time: capture.frames.length ? elapsed : 0, layers, interface: captureInterface() });
  }

  for (const type of ["pointermove", "pointerdown", "pointerup"]) document.addEventListener(type, trackPointer, true);
  sample();
  /** @type {number} */
  const timer = window.setInterval(sample, 100);
  window.setTimeout(() => {
    window.clearInterval(timer);
    for (const type of ["pointermove", "pointerdown", "pointerup"]) document.removeEventListener(type, trackPointer, true);
  }, capture.duration * 1000);
  window.svgPreviewCapture = capture;
}
