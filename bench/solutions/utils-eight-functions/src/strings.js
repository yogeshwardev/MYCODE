export function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function camelCase(s) {
  return s
    .split(/[\s\-_]+/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");
}

export function truncate(s, max, suffix = "…") {
  return s.length <= max ? s : s.slice(0, max - suffix.length) + suffix;
}
