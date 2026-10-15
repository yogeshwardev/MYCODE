export function sum(values) {
  return values.reduce((a, b) => a + b, 0);
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function range(start, end, step = 1) {
  const out = [];
  for (let i = start; i < end; i += step) out.push(i);
  return out;
}
