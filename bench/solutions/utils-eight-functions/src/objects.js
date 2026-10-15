export function isPlainObject(v) {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

export function deepMerge(a, b) {
  const out = {};
  for (const [k, v] of Object.entries(a)) out[k] = isPlainObject(v) ? deepMerge(v, {}) : v;
  for (const [k, v] of Object.entries(b)) {
    out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : isPlainObject(v) ? deepMerge(v, {}) : v;
  }
  return out;
}

export function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}
