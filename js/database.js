/* Supabase v2 client plus connection/auth helpers. */
(() => {
  const config = window.DairySupabaseConfig;
  let client = null;
  let initializationError = null;

  try {
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase JavaScript SDK did not load. Check the network and reload.');
    }
    if (!config?.projectUrl || !config?.publishableKey) {
      throw new Error('Supabase project URL or publishable key is missing.');
    }
    client = window.supabase.createClient(config.projectUrl, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false
      }
    });
  } catch (error) {
    initializationError = error.message || 'Supabase client initialization failed.';
  }

  async function testConnection() {
    if (!client) throw new Error(initializationError || 'Supabase client is not ready.');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10000);
    try {
      const response = await window.fetch(`${config.projectUrl}/auth/v1/settings`, {
        method: 'GET',
        headers: {
          apikey: config.publishableKey,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`Supabase responded with HTTP ${response.status}. Check the project URL and publishable key.`);
      }
      return { status: response.status };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Connection test timed out after 10 seconds.');
      if (error instanceof TypeError) throw new Error('Could not reach Supabase. Check the network and project URL.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function signInWithLocalPin(pin) {
    if (!client) throw new Error(initializationError || 'Supabase client is not ready.');
    if (config?.localDevelopment !== true || !config.localPinAuthPath) {
      throw new Error('PIN sign-in is available only in the local development environment.');
    }
    if (!/^\d{6}$/.test(String(pin))) throw new Error('Enter the six-digit local PIN.');

    let response;
    try {
      response = await window.fetch(config.localPinAuthPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ pin: String(pin) })
      });
    } catch {
      throw new Error('Could not reach the local PIN sign-in helper. Start the local app server and try again.');
    }

    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('The local PIN sign-in helper returned an invalid response.'); }
    if (!response.ok) throw new Error(payload?.error || 'Local PIN sign-in failed. Check the PIN and try again.');
    if (!payload?.access_token || !payload?.refresh_token) {
      throw new Error('The local PIN sign-in helper did not return a valid Auth session.');
    }

    const { data, error } = await client.auth.setSession({
      access_token: payload.access_token,
      refresh_token: payload.refresh_token
    });
    if (error) throw error;
    if (data?.user?.app_metadata?.farm_access !== true) {
      await client.auth.signOut();
      throw new Error('The local account is missing the trusted farm access claim. Re-run local account provisioning.');
    }
    return { data, error: null };
  }

  window.DairyDatabase = Object.freeze({
    client,
    initializationError,
    testConnection,
    signIn: credentials => client.auth.signInWithPassword(credentials),
    signInWithLocalPin,
    signOut: () => client.auth.signOut(),
    getSession: () => client.auth.getSession()
  });
})();
