import { getAccessToken } from '@/utils/access';
import { isWebAppPlatform } from '@/services/environment';

export interface AppliedArc {
  applicationId: number;
  campaignId: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewStatus: 'pending' | 'submitted' | 'overdue';
  reviewDueDate: string | null;
  title: string;
  bookName: string;
  bookPhoto: string;
  bookId: number;
  workId: number;
  format: string;
}

const getBibloApiBaseUrl = () => {
  if (isWebAppPlatform()) {
    // Proxied endpoint for web to avoid CORS
    const basePath = process.env['NEXT_PUBLIC_BASE_PATH'] || '';
    return `${basePath}/api/marketing`;
  }
  // Direct endpoint for Tauri / native platforms
  const base = process.env['NEXT_PUBLIC_BIBLO_API_URL'] || 'http://localhost:3001/api/v0';
  return `${base}/marketing`;
};

export const ArcService = {
  /**
   * Fetches the active ARC campaigns applied for by the user
   */
  async getAppliedArcs(): Promise<AppliedArc[]> {
    const token = await getAccessToken();
    if (!token) {
      return [];
    }

    try {
      const baseUrl = getBibloApiBaseUrl();
      const response = await fetch(`${baseUrl}/arcs/user/applied`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        console.error('Failed to fetch applied ARCs:', response.statusText);
        return [];
      }

      const result = await response.json();
      if (result.status === 'success' && Array.isArray(result.data)) {
        return result.data;
      }
      return [];
    } catch (error) {
      console.error('Error fetching applied ARCs:', error);
      return [];
    }
  },

  /**
   * Downloads the watermarked ebook file for an approved ARC
   */
  async downloadArcBook(campaignId: number): Promise<ArrayBuffer | null> {
    const token = await getAccessToken();
    if (!token) {
      return null;
    }

    try {
      const baseUrl = getBibloApiBaseUrl();
      const response = await fetch(`${baseUrl}/arcs/${campaignId}/read`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download ARC book: ${response.statusText}`);
      }

      return await response.arrayBuffer();
    } catch (error) {
      console.error('Error downloading ARC book:', error);
      return null;
    }
  },
};
