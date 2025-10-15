export const createRejectFilter = ({
  tags = [],
  classes = [],
  attributes = [],
  contents = [],
}: {
  tags?: string[];
  classes?: string[];
  attributes?: string[];
  contents?: { tag: string; content: RegExp }[];
}) => {
  return (node: Node): number => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const name = (node as Element).tagName.toLowerCase();
      if (name === 'script' || name === 'style') {
        return NodeFilter.FILTER_REJECT;
      }
      if (tags.includes(name)) {
        return NodeFilter.FILTER_REJECT;
      }
      if (classes.some((cls) => (node as Element).classList.contains(cls))) {
        return NodeFilter.FILTER_REJECT;
      }
      if (attributes.some((attr) => (node as Element).hasAttribute(attr))) {
        return NodeFilter.FILTER_REJECT;
      }
      if (
        contents.some(({ tag, content }) => {
          return name === tag && content.test((node as Element).textContent || '');
        })
      ) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_SKIP;
    }
    return NodeFilter.FILTER_ACCEPT;
  };
};
