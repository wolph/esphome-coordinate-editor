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
  zones: [{
    label: "Zone 1",
    bounds: {
      x_min: coordinateRef("number", "Zone X Min"),
      x_max: coordinateRef("number", "Zone X Max"),
      y_min: coordinateRef("number", "Zone Y Min"),
      y_max: coordinateRef("number", "Zone Y Max"),
    },
    write: "direct",
  }],
};
window.dispatchEvent(new Event("coordinate-editor-config"));
