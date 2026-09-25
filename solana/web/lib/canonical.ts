/**
 * Canonical JSON: keys sorted at every level, so the same value always produces the same
 * bytes on a server and in a browser. It lives on its own so both sides can hash a policy
 * the same way without dragging Node's crypto into the bundle.
 *
 * It has to be done by hand — JSON.stringify's replacer-array form filters nested objects
 * to the same key list, which silently empties maps like a policy's weights.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}
