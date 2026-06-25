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
  reparentUrl,
  simpleUploadUrl,
} from '@/services/sync/providers/gdrive/driveRest';

describe('driveRest', () => {
  test('escapes single quotes in query literals', () => {
    expect(escapeDriveLiteral("O'Brien")).toBe("O\\'Brien");
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

  test('upload URLs use uploadType=media and request id/md5/size', () => {
    expect(simpleUploadUrl()).toContain('uploadType=media');
    expect(simpleUploadUrl()).toContain('fields=id,md5Checksum,size');
    expect(mediaUpdateUrl('FID')).toContain('/FID?uploadType=media');
  });

  test('metadataUrl + deleteUrl target the file id', () => {
    expect(metadataUrl('FID')).toBe(
      `${FILES_ENDPOINT}/FID?fields=id,name,mimeType,size,modifiedTime,md5Checksum`,
    );
    expect(deleteUrl('FID')).toBe(`${FILES_ENDPOINT}/FID`);
  });

  test('reparentUrl moves a file from one parent to another via query params', () => {
    const url = new URL(reparentUrl('FID', 'NEWPARENT', 'root'));
    expect(url.pathname.endsWith('/FID')).toBe(true);
    expect(url.searchParams.get('addParents')).toBe('NEWPARENT');
    expect(url.searchParams.get('removeParents')).toBe('root');
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
