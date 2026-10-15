// A small, safe Markdown renderer: everything is HTML-escaped first, then a
// limited set of constructs is turned into markup. No raw HTML ever passes.

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function inline(s: string): string {
  // s is already escaped.
  const codes: string[] = [];
  s = s.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(code);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" data-external>$1</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[Number(i)]}</code>`);
}

export function renderMarkdown(src: string): string {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let list: "ul" | "ol" | null = null;
  const closeList = () => {
    if (list) out.push(`</${list}>`);
    list = null;
  };

  while (i < lines.length) {
    const line = lines[i];
    const fence = /^\s*```(\S*)/.exec(line);
    if (fence) {
      closeList();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence (or end of a still-streaming block)
      const lang = escapeHtml(fence[1] || "");
      out.push(`<pre class="code"${lang ? ` data-lang="${lang}"` : ""}><code>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }
    const esc = escapeHtml(line);
    const heading = /^(#{1,4})\s+(.*)$/.exec(esc);
    const bullet = /^\s*[-*]\s+(.*)$/.exec(esc);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(esc);
    if (heading) {
      closeList();
      const level = Math.min(4, heading[1].length + 2);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
    } else if (bullet || numbered) {
      const kind = bullet ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        out.push(`<${kind}>`);
        list = kind;
      }
      out.push(`<li>${inline((bullet ?? numbered)![1])}</li>`);
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      // Merge consecutive text lines into one paragraph.
      const para = [esc];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^\s*(```|#{1,4}\s|[-*]\s|\d+[.)]\s)/.test(lines[i + 1])) {
        para.push(escapeHtml(lines[++i]));
      }
      out.push(`<p>${inline(para.join("<br>"))}</p>`);
    }
    i++;
  }
  closeList();
  return out.join("");
}
