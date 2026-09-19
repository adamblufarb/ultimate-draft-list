/* Syncs app state to/from a file in the GitHub repo via the Contents API,
   so the same data shows up on every device that has a token configured.
   The token lives only in this browser's localStorage (a separate key from
   the app state) — it is never part of App.state, so it can never end up
   committed into the repo. */
(function (global) {
  const TOKEN_KEY = 'udo_github_token';
  const REPO_OWNER = 'adamblufarb';
  const REPO_NAME = 'ultimate-draft-list';
  const BRANCH = 'main';
  const FILE_PATH = 'data/state.json';
  const DEBOUNCE_MS = 2500;

  const listeners = {};
  function on(event, cb) { (listeners[event] = listeners[event] || []).push(cb); }
  function emit(event, payload) { (listeners[event] || []).forEach((cb) => cb(payload)); }

  // disconnected | loading | idle | pending | syncing | error
  let status = 'disconnected';
  let statusMessage = '';
  let sha = null;
  let debounceTimer = null;
  let pendingState = null;

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
    setStatus(token ? 'idle' : 'disconnected');
  }

  function isConnected() {
    return !!getToken();
  }

  function setStatus(next, message) {
    status = next;
    statusMessage = message || '';
    emit('status-changed', { status, message: statusMessage });
  }

  function getStatus() {
    return { status, message: statusMessage };
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach((b) => { binary += String.fromCharCode(b); });
    return btoa(binary);
  }

  function base64ToUtf8(b64) {
    const binary = atob(b64.replace(/\n/g, ''));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function apiUrl() {
    return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${FILE_PATH}`;
  }

  function authHeaders() {
    return {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/vnd.github+json'
    };
  }

  // Fetches the remote state. Returns the parsed state object, or null if
  // the file doesn't exist yet (first-ever sync), the request failed, or
  // no token is set.
  async function fetchRemote() {
    if (!isConnected()) return null;
    setStatus('loading');
    try {
      const res = await fetch(`${apiUrl()}?ref=${BRANCH}`, { headers: authHeaders() });
      if (res.status === 404) {
        sha = null;
        setStatus('idle');
        return null;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `GitHub API error (${res.status})`);
      }
      const body = await res.json();
      sha = body.sha;
      const parsed = JSON.parse(base64ToUtf8(body.content));
      setStatus('idle');
      return parsed;
    } catch (err) {
      setStatus('error', err.message || 'Failed to load from GitHub');
      return null;
    }
  }

  async function pushNow(state) {
    if (!isConnected()) return;
    setStatus('syncing');
    try {
      const content = utf8ToBase64(JSON.stringify(state, null, 2));
      const body = { message: 'Update draft data', content, branch: BRANCH };
      if (sha) body.sha = sha;

      let res = await fetch(apiUrl(), {
        method: 'PUT',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify(body)
      });

      if (res.status === 409 || res.status === 422) {
        // Someone else's write landed first — refetch the current sha and retry once.
        const latest = await fetch(`${apiUrl()}?ref=${BRANCH}`, { headers: authHeaders() });
        if (latest.ok) {
          const latestBody = await latest.json();
          sha = latestBody.sha;
          body.sha = sha;
          res = await fetch(apiUrl(), {
            method: 'PUT',
            headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
            body: JSON.stringify(body)
          });
        }
      }

      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `GitHub API error (${res.status})`);
      }

      const result = await res.json();
      sha = result.content.sha;
      setStatus('idle');
    } catch (err) {
      setStatus('error', err.message || 'Failed to save to GitHub');
    }
  }

  // Called on every App.persist(). Debounces so a burst of local changes
  // (e.g. a drag-reorder, several quick edits) collapses into one commit
  // instead of one per change.
  function scheduleSync(state) {
    if (!isConnected()) return;
    pendingState = state;
    setStatus('pending');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const toSend = pendingState;
      pendingState = null;
      pushNow(toSend);
    }, DEBOUNCE_MS);
  }

  global.GithubSync = { on, getToken, setToken, isConnected, getStatus, fetchRemote, scheduleSync };
})(window);
