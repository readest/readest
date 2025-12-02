// copilot generated
import type { Transformer } from './types';

/**
 * Replacement transformer that applies user-defined text replacement rules.
 * Supports both simple string replacements and regex patterns.
 * Rules are applied in order (by order field), with per-book rules taking precedence over global rules.
 */
export const replacementTransformer: Transformer = {
  name: 'replacement',

  transform: async (ctx) => {
    const replacementRules = ctx.viewSettings.replacementRules;
    
    // If no rules defined, return content unchanged
    if (!replacementRules || replacementRules.length === 0) {
      console.log('[REPLACEMENT] No rules defined, returning unchanged');
      return ctx.content;
    }

    // Filter enabled rules and sort by order
    const enabledRules = replacementRules
      .filter((rule) => rule.enabled)
      .sort((a, b) => (a.order || 0) - (b.order || 0));

    if (enabledRules.length === 0) {
      console.log('[REPLACEMENT] No enabled rules, returning unchanged');
      return ctx.content;
    }

    console.log('[REPLACEMENT] Applying', enabledRules.length, 'rules:', enabledRules.map(r => r.pattern));


    // Parse HTML to work with text nodes only (preserve HTML structure)
    const parser = new DOMParser();
    const doc = parser.parseFromString(ctx.content, 'text/html');

    // Create tree walker to iterate through text nodes
    const walker = doc.createTreeWalker(
      doc.body || doc.documentElement,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          const parent = node.parentElement;
          // Skip script and style tags
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

    // Apply each rule to each text node
    for (const textNode of textNodes) {
      if (!textNode.textContent) continue;

      let transformedText = textNode.textContent;

      for (const rule of enabledRules) {
        try {
          if (rule.isRegex) {
            // Regex replacement
            try {
              const regex = new RegExp(rule.pattern, 'g');
              transformedText = transformedText.replace(regex, rule.replacement);
            } catch (regexError) {
              // Invalid regex - skip this rule and log warning
              console.warn(`Invalid regex pattern in replacement rule "${rule.id}": ${rule.pattern}`, regexError);
              continue;
            }
          } else {
            // Simple string replacement
            // Escape special regex characters for simple string matching
            const escapedPattern = rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(escapedPattern, 'g');
            transformedText = transformedText.replace(regex, rule.replacement);
          }
        } catch (error) {
          // Catch any other errors and continue with next rule
          console.warn(`Error applying replacement rule "${rule.id}":`, error);
          continue;
        }
      }

      textNode.textContent = transformedText;
    }

    console.log('[REPLACEMENT] Transformation complete');

    // Serialize back to HTML string
    const serializer = new XMLSerializer();
    return serializer.serializeToString(doc);
  },
};