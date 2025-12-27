import type { Transformer } from './types';
import { initSimpleCC, runSimpleCC } from '@/utils/simplecc';

export const simpleccTransformer: Transformer = {
  name: 'simplecc',

  transform: async (ctx) => {
    const convertChineseVariant = ctx.viewSettings.convertChineseVariant;
    if (!convertChineseVariant || convertChineseVariant === 'none') {
      return ctx.content;
    }

    await initSimpleCC();
    const parser = new DOMParser();
    const doc = parser.parseFromString(ctx.content, 'text/html');

    const walker = document.createTreeWalker(
      doc.body || doc.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          if (parent && (parent.tagName === 'SCRIPT' || parent.tagName === 'STYLE')) {
            return NodeFilter.FILTER_REJECT;
          }
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
      if (textNode.textContent) {
        textNode.textContent = runSimpleCC(textNode.textContent, convertChineseVariant);
      }
    }

    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  },
};
