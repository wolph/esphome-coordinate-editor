// LD2450 values are millimetres. Display metres and convert writes back to mm.
/** @param {string} domain @param {string} id @returns {{domain: string, id: string, scale: number}} */
const coordinateRef = (domain, id) => ({ domain, id, scale: 0.001 });
window.coordinateEditorConfig = {
  title: "LD2450 zones",
  unit: "m",
  axes: {
    x: { min: -4.86, max: 4.86, step: 0.001 },
    y: { min: 0, max: 7.56, step: 0.001 },
  },
  pollMs: 1000,
  expireMs: 5000,
  targets: [{
    label: "Slot 1",
    x: coordinateRef("sensor", "Target X"),
    y: coordinateRef("sensor", "Target Y"),
  }],
  zones: [1, 2, 3].map(
    /** @param {number} zoneNumber
     * @returns {{label: string, bounds: Record<string, {domain: string, id: string, scale: number}>, write: string}}
     */
    (zoneNumber) => {
      // Keep the original Zone 1 entity names compatible with existing devices.
      /** @type {string} */
      const prefix = zoneNumber === 1 ? "Zone" : `Zone ${zoneNumber}`;
      return {
        label: `Zone ${zoneNumber}`,
        bounds: {
          x_min: coordinateRef("number", `${prefix} X Min`),
          x_max: coordinateRef("number", `${prefix} X Max`),
          y_min: coordinateRef("number", `${prefix} Y Min`),
          y_max: coordinateRef("number", `${prefix} Y Max`),
        },
        write: "direct",
      };
    },
  ),
};
window.dispatchEvent(new Event("coordinate-editor-config"));
