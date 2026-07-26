import { SearchResponse } from './apiTypes';
import { BASE_URL, Manga } from './types';

export async function searchManga(title: string): Promise<Manga[]> {
  const url = new URL('/manga', BASE_URL);
  url.searchParams.set('title', title);
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
  });
  return parseSearchResponse(resp);
}

async function parseSearchResponse(resp: Response): Promise<Manga[]> {
  const response = (await resp.json()) as SearchResponse;
  return response.data;
}
