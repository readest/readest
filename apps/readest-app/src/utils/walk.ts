export const walkTextNodes = (root: HTMLElement, rejectTags: string[] = []): HTMLElement[] => {
  const elements: HTMLElement[] = [];
  const walk = (node: HTMLElement | Document | ShadowRoot, depth = 0) => {
    if (depth > 15) return;
    if (node instanceof HTMLElement && node.shadowRoot) {
      walk(node.shadowRoot, depth + 1);
    }
    const children = 'children' in node ? (Array.from(node.children) as HTMLElement[]) : [];
    for (const child of children) {
      if (
        child.tagName === 'STYLE' ||
        child.tagName === 'LINK' ||
        rejectTags.includes(child.tagName.toLowerCase())
      ) {
        continue;
      }
      if (child.shadowRoot) {
        walk(child.shadowRoot, depth + 1);
      }
      if (child.tagName === 'IFRAME') {
        const iframe = child as HTMLIFrameElement;
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (iframeDoc && iframeDoc.body) {
          walk(iframeDoc.body, depth + 1);
        }
      }
      const hasDirectText =
        child.childNodes &&
        Array.from(child.childNodes).some((node) => {
          if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
            return true;
          }
          if (
            node.nodeType === Node.ELEMENT_NODE &&
            (node as HTMLElement).tagName === 'SPAN' &&
            node.textContent?.trim()
          ) {
            return true;
          }
          return false;
        });
      if (child.children.length === 0 && child.textContent?.trim()) {
        elements.push(child);
      } else if (hasDirectText) {
        elements.push(child);
      } else if (child.children.length > 0) {
        walk(child, depth + 1);
      }
    }
  };

  walk(root);
  return elements;
};
