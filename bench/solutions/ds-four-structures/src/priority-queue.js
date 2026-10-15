export class PriorityQueue {
  #heap = [];
  #cmp;

  constructor(compare = (a, b) => a - b) {
    this.#cmp = compare;
  }

  push(value) {
    const h = this.#heap;
    h.push(value);
    let i = h.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#cmp(h[i], h[parent]) >= 0) break;
      [h[i], h[parent]] = [h[parent], h[i]];
      i = parent;
    }
    return this;
  }

  pop() {
    const h = this.#heap;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop();
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.#cmp(h[l], h[m]) < 0) m = l;
        if (r < h.length && this.#cmp(h[r], h[m]) < 0) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }

  peek() {
    return this.#heap[0];
  }

  get size() {
    return this.#heap.length;
  }
}
