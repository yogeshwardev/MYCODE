// Returns the number of whole days between two dates.
export function daysBetween(a, b) {
  const ms = b.getTime() - a.getTime();
  return Math.round(ms / 1000 * 60 * 60 * 24);
}
