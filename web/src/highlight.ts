/**
 * 在渲染后的笔记 HTML 中，按原文片段查找并用 <mark data-comment-id> 包裹，
 * 使评论对应的文字在笔记里高亮可见。
 */

/** 移除 root 下所有评论高亮，还原为纯文本节点。 */
export function clearHighlights(root: HTMLElement): void {
  root.querySelectorAll('mark[data-comment-id]').forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  });
}

/**
 * 在全文中定位 quote。优先精确匹配；找不到时忽略空白差异再匹配
 * （选区跨段落时 selection 文本带换行，而 textContent 没有）。
 */
function findRange(haystack: string, quote: string): [number, number] | null {
  const exact = haystack.indexOf(quote);
  if (exact !== -1) return [exact, exact + quote.length];

  const target = quote.replace(/\s+/g, '');
  if (!target) return null;
  const chars: string[] = [];
  const map: number[] = [];
  for (let i = 0; i < haystack.length; i++) {
    if (!/\s/.test(haystack[i])) {
      chars.push(haystack[i]);
      map.push(i);
    }
  }
  const idx = chars.join('').indexOf(target);
  if (idx === -1) return null;
  return [map[idx], map[idx + target.length - 1] + 1];
}

/** 高亮 quote 对应的文字，返回是否找到。 */
export function applyHighlight(root: HTMLElement, commentId: string, quote: string): boolean {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }

  const range = findRange(nodes.map((n) => n.data).join(''), quote);
  if (!range) return false;
  const [start, end] = range;

  let offset = 0;
  for (const node of nodes) {
    const nodeStart = offset;
    const nodeEnd = offset + node.data.length;
    offset = nodeEnd;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    if (from >= to) continue;

    const wrapRange = document.createRange();
    wrapRange.setStart(node, from);
    wrapRange.setEnd(node, to);
    const mark = document.createElement('mark');
    mark.dataset.commentId = commentId;
    wrapRange.surroundContents(mark);
  }
  return true;
}
