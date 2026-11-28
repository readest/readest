import { describe, expect, test } from 'vitest';
import { findZhWord } from '@/utils/jieba';

// The word a long-press on `char` selects (#8018): the span jieba gives back
// for that one character.
const wordAt = (text: string, char: string) => {
  const start = text.indexOf(char);
  const word = findZhWord(text, start, start + char.length);
  return word && text.slice(word[0], word[1]);
};

describe('findZhWord', () => {
  test.each([
    // #8018's example. jieba keeps 独立思考 whole; iOS and desktop select 思考.
    ['独立思考是一种重要的能力。', '思', '思考'],
    ['独立思考是一种重要的能力。', '独', '独立'],
    ['独立思考是一种重要的能力。', '能', '能力'],
    ['独立思考是一种重要的能力。', '是', '是'],
    ['中华人民共和国成立了', '华', '中华'],
    ['中华人民共和国成立了', '人', '人民'],
    ['中华人民共和国成立了', '国', '共和国'],
    ['我们明天去北京大学看看', '学', '大学'],
    // Character names, which jieba's HMM finds and the dictionary doesn't have.
    ['韩立看着南宫婉，微微一笑。', '立', '韩立'],
    // 微微一笑 has 微微 in it but not 一笑: the rest stays together.
    ['韩立看着南宫婉，微微一笑。', '笑', '一笑'],
  ])('%s: %s selects %s', (text, char, word) => {
    expect(wordAt(text, char)).toBe(word);
  });

  test('a span that crosses words is in none of them', () => {
    const text = '独立思考是一种重要的能力。';
    const start = text.indexOf('考是');
    expect(findZhWord(text, start, start + 2)).toBeNull();
  });
});
