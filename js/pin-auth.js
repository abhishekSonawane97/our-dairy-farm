/* Shared PIN entry UI. PIN verification is always performed by Supabase Edge Function. */
(() => {
  const form = document.getElementById('access-form');
  if (!form) return;

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const input = document.getElementById('farm-pin');
    const errorNode = document.getElementById('access-error');
    const submit = document.getElementById('access-submit');
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
      document.getElementById('access-dialog').close();
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
