import type { Transformer } from './types';

// Regular expression to match words with optional leading/trailing punctuation
// We want to capture the word itself to apply the bionic reading logic
// This regex matches a sequence of word characters, potentially with internal apostrophes or hyphens
// It handles non-ASCII characters as well (unicode aware)
// The splitting logic in the loop below is more important than a single complex regex.

export const bionicTransformer: Transformer = {
  name: 'bionic',

  transform: async (ctx) => {
    // Only run if Bionic Reading is enabled
    if (!ctx.viewSettings.bionicReading) {
      return ctx.content;
    }

    // Using DOMParser to safely parse the HTML content
    const parser = new DOMParser();
    const doc = parser.parseFromString(ctx.content, 'text/html');

    // Create a TreeWalker to iterate over all text nodes
    const walker = document.createTreeWalker(
      doc.body || doc.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          // Skip if parent is a script or style tag, or already inside a bionic highlight
          if (
            parent &&
            (parent.tagName === 'SCRIPT' ||
              parent.tagName === 'STYLE' ||
              parent.classList.contains('bionic-highlight'))
          ) {
            return NodeFilter.FILTER_REJECT;
          }
          // Skip empty or whitespace-only text nodes
          return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
      },
    );

    const textNodes: Text[] = [];
    let currentNode: Node | null;
    while ((currentNode = walker.nextNode())) {
      textNodes.push(currentNode as Text);
    }

    for (const textNode of textNodes) {
      const text = textNode.textContent;
      if (!text) continue;

      // Replace the text node with a DocumentFragment containing the bionic reading HTML
      const fragment = document.createDocumentFragment();

      // We need to preserve whitespace and punctuation, but only process "words"
      // A simple split by spaces isn't enough because of punctuation.
      // We'll use a regex with capturing groups to split but keep delimiters.
      // However, a simpler approach for stability:
      // Regex to find words: [\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*
      // We iterate through matches and append non-matching parts as text, matching parts as bionic HTML.

      const wordRegex = /([\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)/gu;
      let lastIndex = 0;
      let match;

      while ((match = wordRegex.exec(text)) !== null) {
        // Append text before the match (punctuation, whitespace)
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        const word = match[0];
        const length = word.length;
        let boldLength = 0;

        if (length === 1) {
          boldLength = 1;
        } else if (length === 2) {
            boldLength = 1;
        } else if (length === 3) {
            boldLength = 2;
        } else if (length === 4) {
            boldLength = 2;
        } else {
          // For length >= 5, bold ~40%
          boldLength = Math.ceil(length * 0.4);
        }

        const boldPart = word.substring(0, boldLength);
        const normalPart = word.substring(boldLength);

        const bElement = document.createElement('b');
        bElement.className = 'bionic-highlight';
        bElement.textContent = boldPart;

        fragment.appendChild(bElement);
        if (normalPart) {
            fragment.appendChild(document.createTextNode(normalPart));
        }

        lastIndex = match.index + word.length;
      }

      // Append remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      if (textNode.parentNode) {
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    }

    const serializer = new XMLSerializer();
    // Serialize only the body's content if we parsed a full document,
    // but parser.parseFromString might wrap things.
    // Similar to simplecc transformer, we serialize the whole doc.
    // However, if the input was a fragment, we might get extra <html><body> tags.
    // Let's check how simplecc does it. It returns `serializer.serializeToString(doc)`.
    // sanitizerTransformer does some cleanup.

    // If the original content didn't have <html>/<body>, we should probably strip them?
    // But Folliate/Readest usually deals with full chapter content (XHTML).
    // Let's follow simplecc pattern.

    return serializer.serializeToString(doc);
  },
};
