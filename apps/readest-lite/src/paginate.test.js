// node --test apps/readest-lite/src/*.test.js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginate } from './paginate.js';

test('lines are cut at the first line that does not fit', () => {
  assert.deepEqual(paginate([100, 0, 20, 20, 40, 40, 60, 60, 80, 80, 100], 50), [
    [0, 40],
    [40, 80],
    [80, 100],
  ]);
});

test('a page never ends inside a line, and nothing is lost between pages', () => {
  const pages = paginate([100, 0, 20, 20, 40, 45, 65], 50);
  assert.deepEqual(pages, [
    [0, 45],
    [45, 100],
  ]);
  for (const [i, [start, end]] of pages.entries()) {
    assert.ok(end - start <= 50 || i === pages.length - 1);
    if (i) assert.equal(start, pages[i - 1][1]);
  }
});

test('a page-tall cover image with its line strut is one page (Dune Messiah cover)', () => {
  // body margin 8, img 8..603 (max-height 100vh), its line box 8..607.2, page 595
  assert.deepEqual(paginate([615, 8, 607.2, 8, 603], 595), [[0, 615]]);
});

test('a box taller than a page is sliced at page height', () => {
  assert.deepEqual(paginate([1300, 10, 1300], 595), [
    [0, 595],
    [595, 1190],
    [1190, 1300],
  ]);
});

test('margins after the last line make no page', () => {
  assert.deepEqual(paginate([620, 0, 20, 580, 600], 595), [
    [0, 580],
    [580, 620],
  ]);
});

test('an empty section is one page', () => {
  assert.deepEqual(paginate([0], 595), [[0, 0]]);
});
