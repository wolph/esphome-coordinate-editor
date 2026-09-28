import { loadPreset } from "./presets.js";
import { Simulator } from "./simulator.js";
/** @typedef {import('./types.js').EditorConfig} EditorConfig */
/** @typedef {HTMLElement & {config: EditorConfig}} Editor */

/** @type {MediaQueryList} */
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
/** @type {Editor | null} */
let editor = null;
/** @type {Simulator | null} */
let simulator = null;
/** @type {string} */
let preset = "ld6004";
/** @type {number} */
let generation = 0;

/** Report the content height, independent of the iframe viewport height.
 * @returns {void}
 */
function notify() {
  if (window.parent === window) return;
  window.parent.postMessage({
    type: "coordinate-demo-state", preset, paused: simulator?.paused ?? true,
    height: Math.ceil(document.body.getBoundingClientRect().height), ready: Boolean(editor),
  }, window.location.origin);
}

/** Rebuild both editor and transport to clear drafts and cancel old confirmations.
 * @param {string} id @returns {Promise<void>}
 */
async function changePreset(id) {
  /** @type {number} */
  const requested = ++generation;
  /** @type {EditorConfig} */
  const config = await loadPreset(id);
  if (requested !== generation) return;
  if (editor) observer.unobserve(editor);
  editor?.remove();
  simulator?.dispose();
  preset = id;
  simulator = new Simulator(config, { paused: reducedMotion.matches, origin: window.location.origin });
  window.fetch = simulator.fetch.bind(simulator);
  editor = /** @type {Editor} */ (document.createElement("coordinate-editor"));
  editor.id = "demo-editor";
  editor.config = config;
  document.getElementById("loading")?.remove();
  document.body.append(editor);
  observer.observe(editor);
  notify();
}

/** @param {boolean} paused @returns {void} */
function setPaused(paused) { simulator?.setPaused(paused); notify(); }

/** @type {{readonly editor: Editor | null, readonly simulator: Simulator | null, readonly preset: string, changePreset: typeof changePreset, setPaused: typeof setPaused, reset: () => Promise<void>}} */
window.demoFrame = {
  get editor() { return editor; }, get simulator() { return simulator; }, get preset() { return preset; },
  changePreset, setPaused, reset: () => changePreset(preset),
};

/** @type {ResizeObserver} */
const observer = new ResizeObserver(notify);
observer.observe(document.body);
window.addEventListener("pagehide", () => { observer.disconnect(); simulator?.dispose(); });
reducedMotion.addEventListener("change", (event) => { if (event.matches) setPaused(true); });
window.setInterval(() => simulator?.tick(), 250);
try { await changePreset("ld6004"); }
catch (error) {
  document.getElementById("loading").textContent = `Demo could not load: ${error.message}`;
  notify();
}
