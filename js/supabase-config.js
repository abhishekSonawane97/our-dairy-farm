/* Explicit local-only configuration for the source development app. */
(() => {
  const host = window.location.hostname;
  const loopback = ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host);
  const localApiHost = loopback ? '127.0.0.1' : host;

  window.DairySupabaseConfig = Object.freeze({
    environment: 'local',
    localDevelopment: true,
    productionAuthConfigured: false,
    projectUrl: `http://${localApiHost}:55321`,
    publishableKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
    localPinAuthPath: `http://${localApiHost}:8001/__local_auth/pin`
  });
})();
