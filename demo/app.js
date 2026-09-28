import { PRESETS } from "./presets.js";
/** @typedef {{editor: HTMLElement | null, simulator: import('./simulator.js').Simulator | null, preset: string, changePreset: (id: string) => Promise<void>, reset: () => Promise<void>, setPaused: (paused: boolean) => void}} FrameApp */

/** @type {HTMLIFrameElement} */
const frame = document.getElementById("editor-frame");
/** @type {HTMLSelectElement} */
const select = document.getElementById("preset");
/** @type {HTMLButtonElement} */
const pause = document.getElementById("pause");
/** @type {HTMLButtonElement} */
const reset = document.getElementById("reset");
/** @type {HTMLElement} */
const status = document.getElementById("simulation-status");
/** @type {HTMLElement} */
const detail = document.getElementById("preset-detail");

/** @returns {FrameApp | undefined} */
function current() { return frame.contentWindow?.demoFrame; }

/** @param {boolean} busy @returns {void} */
function setBusy(busy) { for (const control of [select, pause, reset]) control.disabled = busy; }

/** @param {() => Promise<void>} action @returns {Promise<void>} */
async function rebuild(action) {
  setBusy(true);
  try { await action(); }
  catch (error) { status.textContent = `Demo could not load: ${error.message}`; }
  finally { setBusy(!current()?.editor); }
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.origin !== window.location.origin || event.data?.type !== "coordinate-demo-state") return;
  /** @type {{height: number, paused: boolean, ready: boolean, preset: string}} */
  const state = event.data;
  if (!Number.isFinite(state.height) || state.height <= 0 || state.height > 10000 || typeof state.paused !== "boolean") return;
  frame.style.height = `${state.height}px`;
  /** @type {import('./types.js').Preset | undefined} */
  const preset = PRESETS.find((item) => item.id === state.preset);
  if (!preset) return;
  select.value = preset.id;
  pause.textContent = state.paused ? "Resume" : "Pause";
  status.textContent = state.ready ? `Simulation ${state.paused ? "paused" : "running"}` : "Loading editor";
  detail.textContent = `${preset.detail}. All reads and writes stay in this browser.`;
  setBusy(!state.ready);
});
select.addEventListener("change", () => rebuild(() => current().changePreset(select.value)));
pause.addEventListener("click", () => current()?.setPaused(!current().simulator.paused));
reset.addEventListener("click", () => rebuild(() => current().reset()));

/** @type {{frame: HTMLIFrameElement, setPreset: (id: string) => Promise<void>, reset: () => Promise<void>, setPaused: (paused: boolean) => void}} */
window.demoApp = {
  frame, setPreset: (id) => rebuild(() => current().changePreset(id)),
  reset: () => rebuild(() => current().reset()), setPaused: (paused) => current()?.setPaused(paused),
};
