/* Local-only connection and sign-out controls. The PIN itself is verified by the local Edge Function. */
(() => {
  const config = window.DairySupabaseConfig;
  if (config?.environment !== 'local') return;

  const controls = document.getElementById('local-auth-controls');
  if (!controls) return;
  controls.innerHTML = `
    <div class="connection-test">
      <button class="button button-outline" id="test-supabase-connection" type="button">Test local Supabase connection</button>
      <p class="connection-status" id="supabase-connection-status" role="status" aria-live="polite">Connection not tested</p>
    </div>
    <p class="connection-status" id="local-auth-state" role="status" aria-live="polite"></p>
    <button class="button button-outline" id="local-signout" type="button" hidden>Sign out</button>`;

  document.getElementById('local-signout')?.addEventListener('click', async () => {
    const errorNode = document.getElementById('access-error');
    try {
      const { error } = await window.DairyDatabase.signOut();
      if (error) throw error;
      document.getElementById('local-auth-state').textContent = 'Signed out of the local database.';
      document.getElementById('local-signout').hidden = true;
      window.dispatchEvent(new CustomEvent('dairy-farm:session-changed', { detail: { session: null } }));
    } catch (error) {
      errorNode.textContent = error.message || 'Could not sign out of the local database.';
    }
  });

  document.getElementById('test-supabase-connection')?.addEventListener('click', async event => {
    const button = event.currentTarget;
    const status = document.getElementById('supabase-connection-status');
    button.disabled = true;
    button.textContent = 'Testing connection…';
    status.className = 'connection-status';
    status.textContent = 'Contacting local Supabase…';
    try {
      const result = await window.DairyDatabase.testConnection();
      status.classList.add('success');
      status.textContent = `Connected successfully (HTTP ${result.status}). No tables or records were queried.`;
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.message || 'Connection test failed.';
    } finally {
      button.disabled = false;
      button.textContent = 'Test local Supabase connection';
    }
  });
})();
