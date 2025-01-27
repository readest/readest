import { jwtDecode } from 'jwt-decode';
import { UserPlan } from '@/types/user';
import { DEFAULT_STORAGE_QUOTA } from '@/services/constants';
import { isWebAppPlatform } from '@/services/environment';
import { supabase } from '@/utils/supabase';

interface Token {
  plan: UserPlan;
  storage_usage_bytes: number;
  [key: string]: string | number;
}

export const getPlanData = (token: string) => {
  const data = jwtDecode<Token>(token) || {};
  const plan = data['plan'] || 'free';
  const usage = data['storage_usage_bytes'] || 0;
  const quota = DEFAULT_STORAGE_QUOTA[plan] || DEFAULT_STORAGE_QUOTA['free'];

  return {
    plan,
    usage,
    quota,
  };
};

export const getAccessToken = async (): Promise<string | null> => {
  // In browser context there might be two instances of supabase one in the app route
  // and the other in the pages route, and they might have different sessions
  // making the access token invalid for API calls. In that case we should use localStorage.
  if (isWebAppPlatform()) {
    return localStorage.getItem('token') ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
};

export const getUserID = async (): Promise<string | null> => {
  if (isWebAppPlatform()) {
    const user = localStorage.getItem('user') ?? '{}';
    return JSON.parse(user).id ?? null;
  }
  const { data } = await supabase.auth.getSession();
  return data?.session?.user?.id ?? null;
};
