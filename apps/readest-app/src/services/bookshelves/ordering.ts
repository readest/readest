import type { Book, BooksGroup } from '@/types/book';
import { setBookGroup } from '@/utils/book';
import { md5Fingerprint } from '@/utils/md5';

export const bookshelfItemId = (item: Book | BooksGroup) =>
  'hash' in item ? `b:${item.hash}` : `g:${item.id}`;

export const bookshelfOrderScope = (groupBy: string, parent = '') => `${groupBy}:${parent}`;

const renameOrderScope = (scope: string, oldName: string, newName: string) =>
  scope === `group:${oldName}` || scope.startsWith(`group:${oldName}/`)
    ? `group:${newName}${scope.slice(`group:${oldName}`.length)}`
    : scope;

export const renameBookshelfOrderTimes = (
  times: Record<string, number> | undefined,
  oldName: string,
  newName: string,
) =>
  times &&
  Object.fromEntries(
    Object.entries(times).map(([scope, time]) => [renameOrderScope(scope, oldName, newName), time]),
  );

export const renameBookshelfGroupOrder = (
  order: Record<string, string[]> | undefined,
  groupNames: string[],
  oldName: string,
  newName: string,
) => {
  if (!order) return order;
  const identities = new Map(
    groupNames
      .filter((name) => name === oldName || name.startsWith(`${oldName}/`))
      .map((name) => [
        `g:${md5Fingerprint(name)}`,
        `g:${md5Fingerprint(newName + name.slice(oldName.length))}`,
      ]),
  );
  const renamed: Record<string, string[]> = {};
  for (const [scope, ids] of Object.entries(order)) {
    const nextScope = renameOrderScope(scope, oldName, newName);
    renamed[nextScope] = [
      ...new Set([
        ...(renamed[nextScope] ?? []),
        ...ids.map((id) => (scope.startsWith('group:') ? (identities.get(id) ?? id) : id)),
      ]),
    ];
  }
  return JSON.stringify(renamed) === JSON.stringify(order) ? order : renamed;
};

export const orderBookshelfItems = <T extends Book | BooksGroup>(
  items: T[],
  order: string[] = [],
  orderedAt?: number,
) => {
  const ranks = new Map(order.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const recentA = orderedAt !== undefined && a.updatedAt > orderedAt;
    const recentB = orderedAt !== undefined && b.updatedAt > orderedAt;
    if (recentA || recentB) return Number(recentB) - Number(recentA) || b.updatedAt - a.updatedAt;
    return (
      (ranks.get(bookshelfItemId(a)) ?? Infinity) - (ranks.get(bookshelfItemId(b)) ?? Infinity)
    );
  });
};

export const mergeBookshelfVisibleOrder = (
  items: (Book | BooksGroup)[],
  saved: string[] | undefined,
) => {
  const visible = items.map(bookshelfItemId);
  const visibleIds = new Set(visible);
  let index = 0;
  return [
    ...new Set([
      ...[...new Set(saved ?? [])].map((id) => (visibleIds.has(id) ? visible[index++]! : id)),
      ...visible.slice(index),
    ]),
  ];
};

export const moveBookshelfItem = (
  items: (Book | BooksGroup)[],
  saved: string[] | undefined,
  source: string,
  target: string,
  after: boolean,
) => {
  const order = mergeBookshelfVisibleOrder(items, saved);
  if (source === target || !order.includes(source) || !order.includes(target)) return order;
  const next = order.filter((id) => id !== source);
  next.splice(next.indexOf(target) + Number(after), 0, source);
  return next;
};

/** Only the dropped book and the book under it change membership; reading clocks stay intact. */
export const groupDroppedBook = (
  source: Book,
  target: Book | BooksGroup,
  library: Book[],
  untitled: string,
  parent = '',
) => {
  let name: string;
  if ('books' in target) name = target.name;
  else {
    const base = parent ? `${parent}/${untitled}` : untitled;
    const existing = new Set(library.flatMap((book) => (book.groupName ? [book.groupName] : [])));
    let index = 1;
    while (
      [...existing].some(
        (path) => path === `${base} ${index}` || path.startsWith(`${base} ${index}/`),
      )
    )
      index++;
    name = `${base} ${index}`;
  }
  const id = md5Fingerprint(name);
  const books = ('books' in target ? [source] : [target, source]).map((book) => {
    const next = { ...book };
    setBookGroup(next, id, name);
    return next;
  });
  return { books, groupId: id, groupName: name };
};

/** Move a book, or a whole subgroup with its descendants, exactly one level up. */
export const moveBookshelfItemToParent = (
  item: Book | BooksGroup,
  currentGroup: string,
  library: Book[],
) => {
  if (!currentGroup) return null;
  const slash = currentGroup.lastIndexOf('/');
  const parent = slash < 0 ? '' : currentGroup.slice(0, slash);
  if ('hash' in item) {
    const original = library.find((book) => book.hash === item.hash && !book.deletedAt);
    if (!original) return null;
    const book = { ...original };
    setBookGroup(book, parent ? md5Fingerprint(parent) : undefined, parent || undefined);
    return { books: [book], parent, itemId: bookshelfItemId(book) };
  }
  if (!item.name.startsWith(`${currentGroup}/`)) return null;
  const leaf = item.name.slice(currentGroup.length + 1);
  const base = parent ? `${parent}/${leaf}` : leaf;
  const names = new Set<string>();
  for (const book of library) {
    if (book.deletedAt || !book.groupName) continue;
    const parts = book.groupName.split('/');
    for (let length = 1; length <= parts.length; length++)
      names.add(parts.slice(0, length).join('/'));
  }
  let name = base;
  for (let number = 2; names.has(name); number++) name = `${base} (${number})`;
  const books = library
    .filter(
      (book) =>
        !book.deletedAt &&
        (book.groupName === item.name || book.groupName?.startsWith(`${item.name}/`)),
    )
    .map((original) => {
      const book = { ...original };
      const path = name + original.groupName!.slice(item.name.length);
      setBookGroup(book, md5Fingerprint(path), path);
      return book;
    });
  return {
    books,
    parent,
    itemId: `g:${md5Fingerprint(name)}`,
    oldGroupName: item.name,
    newGroupName: name,
  };
};
