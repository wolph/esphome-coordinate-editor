/**
 * @typedef {{domain: string, id: string, scale: number}} Reference
 * @typedef {{min: number, max: number, step: number}} Axis
 * @typedef {{label: string, x: Reference, y: Reference, z?: Reference, presence?: Reference & {threshold: number}, age?: Reference & {max: number}}} Target
 * @typedef {{label: string, bounds: Record<string, Reference>, write?: string, staging?: Record<string, Reference>, stagingHasNoSideEffects?: boolean, applyButton?: Reference}} Zone
 * @typedef {{title?: string, originLabel?: string, unit: string, axes: Record<string, Axis>, targets: Target[], zones: Zone[], pollMs: number, expireMs: number, pendingTimeoutMs?: number}} EditorConfig
 * @typedef {{id: string, label: string, detail: string}} Preset
 */
export {};
