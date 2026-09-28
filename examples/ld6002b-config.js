// These names match ld6002b.yaml. LD6002B coordinates are already metres.
/** @param {string} domain @param {string} id @returns {{domain: string, id: string, scale: number}} */
const reference = (domain, id) => ({ domain, id, scale: 1 });
/** @type {string[]} */
const boundKeys = ["x_min", "x_max", "y_min", "y_max", "z_min", "z_max"];
/** @param {string} domain @param {string} prefix @returns {Object<string, {domain: string, id: string, scale: number}>} */
const mappedBounds = (domain, prefix) => Object.fromEntries(
  boundKeys.map((key) => [key, reference(domain, `${prefix} ${key[0].toUpperCase()} ${key.endsWith("min") ? "Min" : "Max"}`)]),
);
window.coordinateEditorConfig = {
  title: "LD6002B zones",
  originLabel: "Radar",
  unit: "m",
  axes: {
    x: { min: -6, max: 6, step: 0.1 },
    y: { min: 0, max: 8, step: 0.1 },
    z: { min: -6, max: 6, step: 0.1 },
  },
  pollMs: 1000,
  expireMs: 5000,
  pendingTimeoutMs: 15000,
  targets: [{
    label: "Slot 1",
    x: reference("sensor", "Target 1 X"),
    y: reference("sensor", "Target 1 Y"),
    z: reference("sensor", "Target 1 Z"),
    presence: { ...reference("binary_sensor", "Target 1 Present"), threshold: 1 },
  }],
  zones: [0, 1, 2, 3, 4, 5, 6, 7].map((area) => ({
    label: `${area < 4 ? "Detection" : "Interference"} ${area % 4}`,
    bounds: mappedBounds("sensor", `Area ${area}`),
    write: "staged",
    staging: mappedBounds("number", "Zone Draft"),
    stagingHasNoSideEffects: true,
    applyButton: reference("button", `Area ${area} Apply`),
  })),
};
window.dispatchEvent(new Event("coordinate-editor-config"));
