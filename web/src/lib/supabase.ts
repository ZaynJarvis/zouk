import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _url = '';
let _key = '';

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  if (!_client || _url !== url || _key !== anonKey) {
    _url = url;
    _key = anonKey;
    _client = createClient(url, anonKey, {
      auth: { detectSessionInUrl: false },
    });
  }
  return _client;
}

export function getSupabaseClient(): SupabaseClient | null {
  return _client;
}
