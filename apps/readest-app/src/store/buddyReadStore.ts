import { create } from 'zustand';
import { getAPIBaseUrl } from '@/services/environment';
import { fetchWithAuth } from '@/utils/fetch';

interface BuddyReadState {
  currentBuddyReadId: number | null;
  activeBuddyRead: any | null;
  members: any[];
  comments: any[];
  annotations: any[];
  loading: boolean;

  setBuddyReadId: (id: number | null) => void;
  fetchBuddyReadDetails: (id: number) => Promise<any>;
  fetchComments: (id: number) => Promise<void>;
  fetchAnnotations: (id: number) => Promise<void>;
  postComment: (
    id: number,
    commentText: string,
    progressPercentage: number,
    pageNumber: number,
  ) => Promise<void>;
  joinBuddyRead: (id: number) => Promise<void>;
  createBuddyRead: (data: {
    bookHash: string;
    title: string;
    author: string;
    description: string;
    maxMembers: number;
    startDate?: string;
  }) => Promise<any>;
  clear: () => void;
}

export const useBuddyReadStore = create<BuddyReadState>((set, get) => ({
  currentBuddyReadId: null,
  activeBuddyRead: null,
  members: [],
  comments: [],
  annotations: [],
  loading: false,

  setBuddyReadId: (id: number | null) => {
    set({ currentBuddyReadId: id });
  },

  fetchBuddyReadDetails: async (id: number) => {
    set({ loading: true });
    try {
      const url = `${getAPIBaseUrl()}/social/buddy-reads/${id}`;
      const response = await fetchWithAuth(url, { method: 'GET' });
      const resData = await response.json();
      const data = resData.data || {};
      set({
        activeBuddyRead: data,
        members: data.members || [],
        currentBuddyReadId: id,
        loading: false,
      });
      return data;
    } catch (err) {
      console.error('Failed to fetch buddy read details:', err);
      set({ loading: false });
      return null;
    }
  },

  fetchComments: async (id: number) => {
    try {
      const url = `${getAPIBaseUrl()}/social/buddy-reads/${id}/comments`;
      const response = await fetchWithAuth(url, { method: 'GET' });
      const resData = await response.json();
      set({ comments: resData.data?.comments || [] });
    } catch (err) {
      console.error('Failed to fetch comments:', err);
    }
  },

  fetchAnnotations: async (id: number) => {
    try {
      const url = `${getAPIBaseUrl()}/social/buddy-reads/${id}/annotations`;
      const response = await fetchWithAuth(url, { method: 'GET' });
      const resData = await response.json();
      set({ annotations: resData.data || [] });
    } catch (err) {
      console.error('Failed to fetch buddy read annotations:', err);
    }
  },

  postComment: async (
    id: number,
    commentText: string,
    progressPercentage: number,
    pageNumber: number,
  ) => {
    try {
      const url = `${getAPIBaseUrl()}/social/buddy-reads/${id}/comments`;
      await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          comment_text: commentText,
          progress_percentage: progressPercentage,
          page_number: pageNumber,
        }),
      });
      await get().fetchComments(id);
    } catch (err) {
      console.error('Failed to post comment:', err);
      throw err;
    }
  },

  joinBuddyRead: async (id: number) => {
    try {
      const url = `${getAPIBaseUrl()}/social/buddy-reads/${id}/join`;
      await fetchWithAuth(url, { method: 'POST' });
      await get().fetchBuddyReadDetails(id);
    } catch (err) {
      console.error('Failed to join buddy read:', err);
      throw err;
    }
  },

  createBuddyRead: async (data) => {
    try {
      const url = `${getAPIBaseUrl()}/social/buddy-reads`;
      const response = await fetchWithAuth(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          isPublic: true,
        }),
      });
      const res = await response.json();
      const buddyRead = res.data || {};
      if (buddyRead.buddyReadId) {
        set({ currentBuddyReadId: buddyRead.buddyReadId });
        await get().fetchBuddyReadDetails(buddyRead.buddyReadId);
      }
      return buddyRead;
    } catch (err) {
      console.error('Failed to create buddy read:', err);
      throw err;
    }
  },

  clear: () => {
    set({
      currentBuddyReadId: null,
      activeBuddyRead: null,
      members: [],
      comments: [],
      annotations: [],
      loading: false,
    });
  },
}));
