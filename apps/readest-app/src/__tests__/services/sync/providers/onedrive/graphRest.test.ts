import { describe, expect, test } from 'vitest';
import {
  childrenUrl,
  contentUrl,
  createChildUrl,
  deleteItemUrl,
  encodeGraphPath,
  itemUrl,
  meUrl,
  uploadSessionUrl,
} from '@/services/sync/providers/onedrive/graphRest';

const APPROOT = 'https://graph.microsoft.com/v1.0/me/drive/special/approot';

describe('graphRest', () => {
  test('encodeGraphPath strips slashes and encodes each segment', () => {
    expect(encodeGraphPath('/Readest/books/a b/config.json')).toBe(
      'Readest/books/a%20b/config.json',
    );
    expect(encodeGraphPath('/')).toBe('');
  });

  test('itemUrl addresses by path with a $select', () => {
    expect(itemUrl('/Readest/x.json', 'size,cTag,file')).toBe(
      `${APPROOT}:/Readest/x.json?$select=size,cTag,file`,
    );
  });

  test('contentUrl targets the content endpoint', () => {
    expect(contentUrl('/Readest/x.json')).toBe(`${APPROOT}:/Readest/x.json:/content`);
  });

  test('childrenUrl of a nested path uses the colon form; root uses no colon', () => {
    expect(childrenUrl('/Readest/books')).toBe(
      `${APPROOT}:/Readest/books:/children?$select=name,size,cTag,file,folder&$top=200`,
    );
    expect(childrenUrl('/')).toBe(
      `${APPROOT}/children?$select=name,size,cTag,file,folder&$top=200`,
    );
  });

  test('createChildUrl targets the parent children collection', () => {
    expect(createChildUrl('/Readest')).toBe(`${APPROOT}:/Readest:/children`);
    expect(createChildUrl('/')).toBe(`${APPROOT}/children`);
  });

  test('deleteItemUrl + uploadSessionUrl + meUrl', () => {
    expect(deleteItemUrl('/Readest/x')).toBe(`${APPROOT}:/Readest/x`);
    expect(uploadSessionUrl('/Readest/b.epub')).toBe(
      `${APPROOT}:/Readest/b.epub:/createUploadSession`,
    );
    expect(meUrl()).toBe(
      'https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName',
    );
  });
});
