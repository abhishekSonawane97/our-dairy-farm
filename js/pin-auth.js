/* Shared PIN entry UI. PIN verification is always performed by Supabase Edge Function. */
(() => {
  const form = document.getElementById('access-form');
  if (!form) return;
  const config = window.DairySupabaseConfig;
  const hosted = config?.environment === 'staging' || config?.environment === 'production';
  const input = document.getElementById('farm-pin');
  const controls = document.getElementById('pin-auth-controls');
  const submit = document.getElementById('access-submit');
  const signout = document.getElementById('auth-signout');
  const dialog = document.getElementById('access-dialog');
  const description = document.getElementById('access-description');

  function updateSessionUi(session) {
    if (!hosted) return;
    const signedIn = Boolean(session);
    controls.hidden = signedIn;
    input.required = !signedIn;
    input.disabled = signedIn;
    submit.hidden = signedIn;
    signout.hidden = !signedIn;
    description.textContent = signedIn
      ? 'This device is signed in to the farm. Sign out here when you are finished.'
      : 'Enter the shared farm PIN to sign in securely.';
  }

  window.addEventListener('dairy-farm:session-changed', event => {
    updateSessionUi(event.detail?.session || null);
  });
  window.DairyDatabase?.getSession().then(({ data }) => updateSessionUi(data?.session || null));

  signout?.addEventListener('click', async () => {
    signout.disabled = true;
    signout.textContent = 'Signing out…';
    const errorNode = document.getElementById('access-error');
    errorNode.textContent = '';
    try {
      const { error } = await window.DairyDatabase.signOut();
      if (error) throw error;
      input.value = '';
      dialog.close();
      window.dispatchEvent(new CustomEvent('dairy-farm:session-changed', { detail: { session: null } }));
    } catch (error) {
      errorNode.textContent = error.message || 'Sign out failed. Please try again.';
    } finally {
      signout.disabled = false;
      signout.textContent = 'Sign out';
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const errorNode = document.getElementById('access-error');
    errorNode.textContent = '';
    if (!input.reportValidity()) return;

    submit.disabled = true;
    submit.textContent = 'Checking PIN…';
    try {
      const { data } = await window.DairyDatabase.signInWithPin(input.value.trim());
      const localStatus = document.getElementById('local-auth-state');
      const localSignOut = document.getElementById('local-signout');
      if (localStatus) localStatus.textContent = 'Signed in to the local farm database.';
      if (localSignOut) localSignOut.hidden = false;
      updateSessionUi(data.session);
      dialog.close();
      input.value = '';
      window.dispatchEvent(new CustomEvent('dairy-farm:session-changed', {
        detail: { session: data.session }
      }));
    } catch (error) {
      errorNode.textContent = error.message || 'PIN sign-in failed. Check the PIN and try again.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Continue';
    }
  });
})();
