import { getAPIBaseUrl } from '@/services/environment';
import { getUserID } from '@/utils/access';
import { fetchWithAuth } from '@/utils/fetch';

const API_ENDPOINT = getAPIBaseUrl() + '/user/delete';

export const deleteUser = async () => {
  try {
    const userId = await getUserID();
    if (!userId) {
      throw new Error('Not authenticated');
    }

    await fetchWithAuth(API_ENDPOINT, {
      method: 'DELETE',
    });
  } catch (error) {
    console.error('User deletion failed:', error);
    throw new Error('User deletion failed');
  }
};
