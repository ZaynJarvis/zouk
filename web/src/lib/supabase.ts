import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _url = '';
let _key = '';

export function initSupabase(url: string, anonKey: string): SupabaseClient {
  if (!_client || _url !== url || _key !== anonKey) {
    _url = url;
    _key = anonKey;
    // Implicit flow puts the access_token directly in the URL hash so a
    // magic-link email opened in a different browser/device (which doesn't
    // have the PKCE code_verifier in localStorage) can still complete login.
    _client = createClient(url, anonKey, {
      auth: { detectSessionInUrl: false, flowType: 'implicit' },
    });
  }
  return _client;
}

export function getSupabaseClient(): SupabaseClient | null {
  return _client;
}
