/* Supabase v2 client for an explicitly configured, authenticated environment. */
(() => {
  const config = window.DairySupabaseConfig;
  let client = null;
  let initializationError = null;

  try {
    if (!config || !['local', 'staging', 'production'].includes(config.environment)) {
      throw new Error('Application environment is not configured. Farm data is unavailable.');
    }
    if (config.environment !== 'local' && config.hostedAuthConfigured !== true) {
      throw new Error(`${config.environment === 'staging' ? 'Staging' : 'Production'} authentication is not configured. No farm data was requested.`);
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      throw new Error('Supabase JavaScript SDK did not load. Check the network and reload.');
    }
    if (!config.projectUrl || !config.publishableKey) {
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
    if (config.environment !== 'local') {
      throw new Error('Connection testing is disabled until production authentication is configured.');
    }

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
        throw new Error(`Supabase responded with HTTP ${response.status}. Check the local project status.`);
      }
      return { status: response.status };
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Connection test timed out after 10 seconds.');
      if (error instanceof TypeError) throw new Error('Could not reach local Supabase. Check Docker and the local project.');
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function signInWithPin(pin) {
    if (!client) throw new Error(initializationError || 'Supabase client is not ready.');
    if (!/^\d{6}$/.test(String(pin))) throw new Error('Enter the six-digit farm PIN.');
    if (config.environment !== 'local' && config.hostedAuthConfigured !== true) {
      throw new Error(`${config.environment === 'staging' ? 'Staging' : 'Production'} sign-in is not configured yet.`);
    }
    const { data: response, error: invokeError } = await client.functions.invoke('farm-pin-login', {
      body: { pin: String(pin) }
    });
    if (invokeError) {
      let detail = invokeError.message || 'PIN sign-in failed.';
      try {
        const responseBody = invokeError.context instanceof Response
          ? await invokeError.context.clone().json()
          : null;
        if (responseBody?.error) detail = responseBody.error;
      } catch { /* Keep the SDK error if the function response is not JSON. */ }
      throw new Error(detail);
    }
    if (!response?.access_token || !response?.refresh_token) {
      throw new Error('PIN verification did not return a valid Supabase session.');
    }
    const { data, error } = await client.auth.setSession({
      access_token: response.access_token,
      refresh_token: response.refresh_token
    });
    if (error) throw error;
    if (data?.user?.app_metadata?.farm_access !== true) {
      await client.auth.signOut();
      throw new Error('The signed-in account does not have trusted farm access.');
    }
    return { data, error: null };
  }

  window.DairyDatabase = Object.freeze({
    client,
    initializationError,
    testConnection,
    signInWithPin,
    signOut: () => client ? client.auth.signOut() : Promise.resolve({ data: null, error: null }),
    getSession: () => client ? client.auth.getSession() : Promise.resolve({ data: { session: null }, error: null })
  });
})();
