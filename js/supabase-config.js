/* Local development points only to the unlinked Docker stack. Never add a secret key here. */
(() => {
  const host = window.location.hostname;
  // Browsers can open a server bound to 0.0.0.0 through this address too.
  // Treat that explicit local wildcard URL as loopback for development and
  // route Supabase requests through 127.0.0.1 instead of the wildcard address.
  const loopback = host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
  const lanIPv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const localDevelopment = loopback || (lanIPv4 && new URLSearchParams(location.search).get('localSupabase') === '1');
  const localApiHost = loopback ? '127.0.0.1' : host;
  const localPinAuthPath = location.port && location.port !== '8001'
    ? `http://${localApiHost}:8001/__local_auth/pin`
    : '/__local_auth/pin';
  window.DairySupabaseConfig = Object.freeze(localDevelopment ? {
    projectUrl: `http://${localApiHost}:55321`,
    publishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    localPinAuthPath,
    localDevelopment: true
  } : {
    projectUrl: 'https://cnlhjcoaonlmzrtwvjio.supabase.co',
    publishableKey: 'sb_publishable_dKbx4m81XZOwOrkgzwErVw_wZbWExbX',
    localDevelopment: false
  });
})();
