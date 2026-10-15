export class Trie {
  #root = { children: new Map(), end: false };
  #size = 0;

  insert(word) {
    let node = this.#root;
    for (const ch of word) {
      if (!node.children.has(ch)) node.children.set(ch, { children: new Map(), end: false });
      node = node.children.get(ch);
    }
    if (!node.end) {
      node.end = true;
      this.#size++;
    }
    return this;
  }

  #find(prefix) {
    let node = this.#root;
    for (const ch of prefix) {
      node = node.children.get(ch);
      if (!node) return undefined;
    }
    return node;
  }

  has(word) {
    return Boolean(this.#find(word)?.end);
  }

  startsWith(prefix) {
    const out = [];
    const walk = (node, acc) => {
      if (node.end) out.push(acc);
      for (const [ch, child] of node.children) walk(child, acc + ch);
    };
    const start = this.#find(prefix);
    if (start) walk(start, prefix);
    return out.sort();
  }

  delete(word) {
    const node = this.#find(word);
    if (!node?.end) return false;
    node.end = false;
    this.#size--;
    return true;
  }

  get size() {
    return this.#size;
  }
}
