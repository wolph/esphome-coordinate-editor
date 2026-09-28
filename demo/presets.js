/** @typedef {import('./types.js').EditorConfig} EditorConfig */
/** @typedef {import('./types.js').Reference} Reference */
/** @typedef {import('./types.js').Target} Target */

/** @type {import('./types.js').Preset[]} */
export const PRESETS = [
  { id: "ld6004", label: "LD6004", detail: "3D coordinates, four detection areas, staged writes" },
  { id: "ld2450", label: "LD2450", detail: "2D coordinates, one zone, direct writes from metres to millimetres" },
  { id: "ld6002b", label: "LD6002B", detail: "3D coordinates, four detection and four interference areas, staged writes" },
];

/** @type {Map<string, EditorConfig>} */
const examples = new Map();

/** Load the repository example module once and retain its configuration.
 * @param {string} id @returns {Promise<EditorConfig>}
 */
export async function loadPreset(id) {
  if (!PRESETS.some((preset) => preset.id === id)) throw Error("Unknown sensor preset");
  if (!examples.has(id)) {
    await import(`../examples/${id}-config.js`);
    examples.set(id, structuredClone(window.coordinateEditorConfig));
  }
  return createPreset(id, examples.get(id));
}

/** Preserve example mappings and add three explicitly simulated target slots.
 * @param {string} id @param {EditorConfig} source @returns {EditorConfig}
 */
export function createPreset(id, source) {
  if (!PRESETS.some((preset) => preset.id === id)) throw Error("Unknown sensor preset");
  /** @type {EditorConfig} */
  const config = structuredClone(source);
  /** @type {Target} */
  const original = config.targets[0];
  config.targets = [0, 1, 2].map((index) => {
    /** @type {Target} */
    const target = structuredClone(original);
    target.label = `Simulated slot ${index + 1}`;
    if (index > 0) {
      for (const key of ["x", "y", "z", "presence", "age"]) {
        /** @type {Reference | undefined} */
        const ref = target[key];
        if (ref) ref.id = ref.id.includes("Target 1")
          ? ref.id.replace("Target 1", `Target ${index + 1}`)
          : `Simulated ${index + 1} ${ref.id}`;
      }
    }
    target.presence ??= { domain: "binary_sensor", id: `Simulated ${index + 1} Present`, scale: 1, threshold: 1 };
    return target;
  });
  config.pollMs = 250;
  return config;
}
