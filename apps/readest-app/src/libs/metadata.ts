import { MetadataResult, SearchRequest } from '@/services/metadata/types';
import { getAPIBaseUrl } from '@/services/environment';
import { fetchWithAuth } from '@/utils/fetch';

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: string;
  responseTime?: number;
}

const API_ENDPOINT = getAPIBaseUrl() + '/metadata/search';

export const searchMetadata = async (request: SearchRequest): Promise<MetadataResult[]> => {
  const response = await fetchWithAuth(API_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });

  const result: ApiResponse<MetadataResult[]> = await response.json();

  if (!result.success) {
    throw new Error(result.error || 'Search failed');
  }

  return result.data || [];
};
