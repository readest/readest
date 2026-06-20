export const createRejectFilter = ({
  tags = [],
  classes = [],
  attributes = [],
  attributeTokens = [],
  contents = [],
}: {
  tags?: string[];
  classes?: string[];
  attributes?: string[];
  /**
   * Reject elements whose space-separated attribute value contains any of the
   * given tokens, optionally constrained to a tag name. Matches the way CSS
   * `[attr~="token"]` selectors work — e.g. `aside[epub:type~="footnote"]`.
   */
  attributeTokens?: { tag?: string; attribute: string; tokens: string[] }[];
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
        attributeTokens.some(({ tag, attribute, tokens }) => {
          if (tag && name !== tag) return false;
          const value = (node as Element).getAttribute(attribute);
          if (!value) return false;
          const valueTokens = value.split(/\s+/);
          return tokens.some((token) => valueTokens.includes(token));
        })
      ) {
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
