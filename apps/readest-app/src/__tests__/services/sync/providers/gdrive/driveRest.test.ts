import { describe, expect, test } from 'vitest';
import {
  aboutUrl,
  childrenQuery,
  deleteUrl,
  escapeDriveLiteral,
  FILES_ENDPOINT,
  listQuery,
  listUrl,
  mediaDownloadUrl,
  mediaUpdateUrl,
  metadataUrl,
  multipartUploadUrl,
  resumableCreateUrl,
  resumableUpdateUrl,
} from '@/services/sync/providers/gdrive/driveRest';

describe('driveRest', () => {
  test('escapes single quotes in query literals', () => {
    expect(escapeDriveLiteral("O'Brien")).toBe("O\\'Brien");
  });

  test('escapes backslashes (first) so they cannot break out of the literal', () => {
    // A lone backslash is doubled.
    expect(escapeDriveLiteral('a\\b')).toBe('a\\\\b');
    // A trailing backslash would otherwise escape the closing quote.
    expect(escapeDriveLiteral('dir\\')).toBe('dir\\\\');
    // Backslash-then-quote: backslash doubled, then the quote escaped — never
    // \' (which Drive would read as an escaped quote from the original input).
    expect(escapeDriveLiteral("a\\'b")).toBe("a\\\\\\'b");
  });

  test('listQuery scopes by name + parent + not-trashed', () => {
    expect(listQuery('config.json', 'PARENT')).toBe(
      "name = 'config.json' and 'PARENT' in parents and trashed = false",
    );
  });

  test('childrenQuery enumerates live children of a parent', () => {
    expect(childrenQuery('PARENT')).toBe("'PARENT' in parents and trashed = false");
  });

  test('mediaDownloadUrl uses alt=media', () => {
    expect(mediaDownloadUrl('FID')).toBe(`${FILES_ENDPOINT}/FID?alt=media`);
  });

  test('upload URLs carry the right uploadType and request id/md5/size', () => {
    // Creates are multipart so the name + parent ride WITH the bytes — an
    // unnamed create would materialise as "Untitled" in the Drive root (#5147).
    expect(multipartUploadUrl()).toContain('uploadType=multipart');
    expect(multipartUploadUrl()).toContain('fields=id,md5Checksum,size');
    expect(mediaUpdateUrl('FID')).toContain('/FID?uploadType=media');
  });

  test('resumable upload URLs use uploadType=resumable and request the id', () => {
    expect(resumableCreateUrl()).toBe(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
    );
    expect(resumableUpdateUrl('FID')).toBe(
      'https://www.googleapis.com/upload/drive/v3/files/FID?uploadType=resumable&fields=id',
    );
  });

  test('metadataUrl + deleteUrl target the file id', () => {
    expect(metadataUrl('FID')).toBe(
      `${FILES_ENDPOINT}/FID?fields=id,name,mimeType,size,modifiedTime,md5Checksum`,
    );
    expect(deleteUrl('FID')).toBe(`${FILES_ENDPOINT}/FID`);
  });

  test('aboutUrl requests only the user identity fields', () => {
    expect(aboutUrl()).toBe(
      'https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)',
    );
  });

  test('listUrl requests nextPageToken + a page size and threads a page token', () => {
    const first = new URL(listUrl(childrenQuery('PARENT')));
    expect(first.searchParams.get('q')).toBe("'PARENT' in parents and trashed = false");
    expect(first.searchParams.get('fields')).toBe(
      'nextPageToken,files(id,name,mimeType,size,modifiedTime,md5Checksum)',
    );
    expect(first.searchParams.get('pageSize')).toBe('1000');
    expect(first.searchParams.get('pageToken')).toBeNull();

    const next = new URL(listUrl(childrenQuery('PARENT'), 'TOKEN2'));
    expect(next.searchParams.get('pageToken')).toBe('TOKEN2');
  });
});
