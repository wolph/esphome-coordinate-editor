/** @typedef {import('./types.js').EditorConfig} EditorConfig */
/** @typedef {{x: number, y: number, z?: number}} Position */
/** @typedef {{from: Position, to: Position, travel: number, hold: number}} Segment */

/** @param {number} seed @returns {() => number} */
function random(seed) {
  /** @type {number} */
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Generate deterministic waypoints inside the configured sensor limits.
 * @param {EditorConfig} config @param {number} seed @returns {Segment[][]}
 */
export function createPaths(config, seed) {
  return config.targets.map((target, index) => {
    /** @type {() => number} */
    const next = random(seed + index * 7919);
    /** @returns {Position} */
    const point = () => {
      /** @type {Position} */
      const position = { x: 0, y: 0 };
      for (const key of ["x", "y", ...(target.z ? ["z"] : [])]) {
        /** @type {import('./types.js').Axis} */
        const axis = config.axes[key];
        /** @type {number} */
        const min = key === "z" ? Math.max(axis.min, 0.6) : axis.min + (axis.max - axis.min) * 0.12;
        /** @type {number} */
        const max = key === "z" ? Math.min(axis.max, 2) : axis.max - (axis.max - axis.min) * 0.12;
        position[key] = Math.min(axis.max, Math.max(axis.min, min + next() * (max - min)));
      }
      return position;
    };
    /** @type {Position[]} */
    const points = Array.from({ length: 12 }, point);
    return points.map((from, segment) => ({
      from, to: points[(segment + 1) % points.length],
      travel: 4000 + Math.floor(next() * 12) * 250,
      hold: 750 + Math.floor(next() * 8) * 250,
    }));
  });
}

/** @param {Segment[]} path @param {number} elapsed @param {number} index @returns {Position & {present: boolean}} */
export function samplePath(path, elapsed, index) {
  /** @type {number} */
  const total = path.reduce((sum, segment) => sum + segment.travel + segment.hold, 0);
  /** @type {number} */
  let offset = elapsed % total;
  /** @type {Segment} */
  let current = path[0];
  for (const segment of path) {
    current = segment;
    if (offset < segment.travel + segment.hold) break;
    offset -= segment.travel + segment.hold;
  }
  /** @type {number} */
  const fraction = Math.min(1, offset / current.travel);
  /** @type {number} */
  const eased = fraction * fraction * (3 - 2 * fraction);
  /** @type {Position & {present: boolean}} */
  const position = { x: 0, y: 0, present: (elapsed + index * 4000) % 26000 < 22000 };
  for (const key of Object.keys(current.from)) position[key] = current.from[key] + (current.to[key] - current.from[key]) * eased;
  return position;
}
