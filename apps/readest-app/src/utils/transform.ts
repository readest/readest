import {
  Book,
  BookConfig,
  BookFormat,
  BookNote,
  BookNoteType,
  HighlightColor,
  HighlightStyle,
} from '@/types/book';
import { DBBookConfig, DBBook, DBBookNote } from '@/types/records';

export const transformBookConfigToDB = (bookConfig: unknown, userId: string): DBBookConfig => {
  const { bookHash, progress, location, searchConfig, viewSettings, updatedAt } =
    bookConfig as BookConfig;

  return {
    user_id: userId,
    book_hash: bookHash!,
    location: location,
    progress: progress && JSON.stringify(progress),
    search_config: searchConfig && JSON.stringify(searchConfig),
    view_settings: viewSettings && JSON.stringify(viewSettings),
    updated_at: new Date(updatedAt ?? Date.now()).toISOString(),
  };
};

export const transformBookConfigFromDB = (dbBookConfig: DBBookConfig): BookConfig => {
  const { book_hash, progress, location, search_config, view_settings, updated_at } = dbBookConfig;
  return {
    bookHash: book_hash,
    location,
    progress: progress && JSON.parse(progress),
    searchConfig: search_config && JSON.parse(search_config),
    viewSettings: view_settings && JSON.parse(view_settings),
    updatedAt: new Date(updated_at!).getTime(),
  } as BookConfig;
};

export const transformBookToDB = (book: unknown, userId: string): DBBook => {
  const {
    hash,
    format,
    title,
    author,
    groupId,
    groupName,
    tags,
    progress,
    createdAt,
    updatedAt,
    deletedAt,
    uploadedAt,
  } = book as Book;

  return {
    user_id: userId,
    book_hash: hash,
    format,
    title,
    author,
    group_id: groupId,
    group_name: groupName,
    tags: tags,
    progress: progress,
    created_at: new Date(createdAt ?? Date.now()).toISOString(),
    updated_at: new Date(updatedAt ?? Date.now()).toISOString(),
    deleted_at: deletedAt ? new Date(deletedAt).toISOString() : null,
    uploaded_at: uploadedAt ? new Date(uploadedAt).toISOString() : null,
  };
};

export const transformBookFromDB = (dbBook: DBBook): Book => {
  const {
    book_hash,
    format,
    title,
    author,
    group_id,
    group_name,
    tags,
    progress,
    created_at,
    updated_at,
    deleted_at,
    uploaded_at,
  } = dbBook;

  return {
    hash: book_hash,
    format: format as BookFormat,
    title,
    author,
    groupId: group_id,
    groupName: group_name,
    tags: tags,
    progress: progress,
    createdAt: new Date(created_at!).getTime(),
    updatedAt: new Date(updated_at!).getTime(),
    deletedAt: deleted_at ? new Date(deleted_at).getTime() : null,
    uploadedAt: uploaded_at ? new Date(uploaded_at).getTime() : null,
  };
};

export const transformBookNoteToDB = (bookNote: unknown, userId: string): DBBookNote => {
  const { bookHash, id, type, cfi, text, style, color, note, createdAt, updatedAt, deletedAt } =
    bookNote as BookNote;

  return {
    user_id: userId,
    book_hash: bookHash!,
    id,
    type,
    cfi,
    text,
    style,
    color,
    note,
    created_at: new Date(createdAt ?? Date.now()).toISOString(),
    updated_at: new Date(updatedAt ?? Date.now()).toISOString(),
    // note that only null deleted_at is updated to the database, undefined is not
    deleted_at: deletedAt ? new Date(deletedAt).toISOString() : null,
  };
};

export const transformBookNoteFromDB = (dbBookNote: DBBookNote): BookNote => {
  const { book_hash, id, type, cfi, text, style, color, note, created_at, updated_at, deleted_at } =
    dbBookNote;

  return {
    bookHash: book_hash,
    id,
    type: type as BookNoteType,
    cfi,
    text,
    style: style as HighlightStyle,
    color: color as HighlightColor,
    note,
    createdAt: new Date(created_at!).getTime(),
    updatedAt: new Date(updated_at!).getTime(),
    deletedAt: deleted_at ? new Date(deleted_at).getTime() : null,
  };
};
