/* Syncs app state to/from a file in the GitHub repo via the Contents API,
   so the same data shows up on every device that has a token configured.
   The token lives only in this browser's localStorage (a separate key from
   the app state) — it is never part of App.state, so it can never end up
   committed into the repo.

   The whole state is one file, so two devices (or one device with stale
   data) can disagree about it. The rules below exist so that disagreement
   can never wipe out drafted players, My Team, or tags:

   1. Never push before pulling. Nothing is sent to GitHub until this
      session has loaded the current remote version (syncOnLoad); an
      unsynced-changes flag left over from an earlier session is merged
      with the remote, never pushed over it.
   2. Merge, don't overwrite. After every successful pull or push the app
      remembers what GitHub held then (the "base": a fingerprint of every
      field plus a copy of the draft lists/tags). When local and remote have
      both moved on, merge3() combines them field by field: a field only one
      side changed takes that side's version; the draft lists and tags are
      merged entry by entry (an entry only counts as removed if *this*
      device removed it since the base); if there's no base at all, lists are
      unioned so nothing is lost. A push that GitHub rejects as out of date
      is retried only after merging in whatever landed first.
   3. A last-resort guard: a push that would drop the combined drafted + My
      Team count to under half of what GitHub currently has (when that's 5
      or more) is refused and reported, instead of sent.
   4. Local snapshots (js/backups.js) are taken before local data is ever
      replaced, and GitHub's own commit history keeps every version — the
      Sources tab's "Recover Draft Data" card restores from either. */
(function (global) {
  const TOKEN_KEY = 'udo_github_token';
  // Set the moment a local change is scheduled to sync, cleared only once a
  // push actually lands on GitHub (and nothing changed meanwhile). A page
  // load that sees this still set means the previous session ended before
  // its change was confirmed pushed. It no longer means "push local over
  // the remote" — it means "merge local with the remote first" (syncOnLoad).
  const DIRTY_KEY = 'udo_sync_dirty';
  // What GitHub held at the last successful pull/push — see merge3().
  const BASE_KEY = 'udo_sync_base';
  // The full local state as it was just before a merge that had no base to
  // go on (first run of this version on a device). Pure insurance.
  const PRIOR_LOCAL_KEY = 'udo_prior_local';
  const REPO_OWNER = 'adamblufarb';
  const REPO_NAME = 'ultimate-draft-list';
  const BRANCH = 'main';
  const FILE_PATH = 'data/state.json';
  const DEBOUNCE_MS = 2500;
  const MAX_PUSH_ATTEMPTS = 4;

  // Fields that can't be re-created from a paste, and so get the careful,
  // entry-by-entry merge.
  const LIST_FIELDS = ['draftedKeys', 'myTeamKeys', 'targetKeys', 'doNotDraftKeys']; // arrays of keys
  const MAP_FIELDS = ['breakoutLevels', 'sleeperLevels', 'playerNotes'];             // key -> value
  const ITEM_FIELDS = ['notes', 'savedSearches'];                                     // arrays of { id, ... }
  const PRECIOUS_FIELDS = LIST_FIELDS.concat(MAP_FIELDS, ITEM_FIELDS);

  const listeners = {};
  function on(event, cb) { (listeners[event] = listeners[event] || []).push(cb); }
  function emit(event, payload) { (listeners[event] || []).forEach((cb) => cb(payload)); }

  // The app hands us how to read and replace its live state (js/main.js).
  let adapter = null;
  function setAdapter(next) { adapter = next; }

  function markDirty() {
    try { localStorage.setItem(DIRTY_KEY, '1'); } catch (e) { /* ignore */ }
  }

  function clearDirty() {
    try { localStorage.removeItem(DIRTY_KEY); } catch (e) { /* ignore */ }
  }

  function isDirty() {
    try { return !!localStorage.getItem(DIRTY_KEY); } catch (e) { return false; }
  }

  // disconnected | loading | idle | pending | syncing | error
  let status = 'disconnected';
  let statusMessage = '';
  let sha = null;            // sha of the remote file version we last saw (null = file doesn't exist yet)
  let ready = false;         // true once this session has pulled/merged the remote
  let debounceTimer = null;
  let hasPending = false;
  let changeCounter = 0;     // bumped on every local change, to tell if one landed mid-push
  let lastRemoteState = null; // the remote version most recently seen, for the wipe guard
  let pushing = null;        // the in-flight push promise, so overlapping requests share it

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }

  function setToken(token) {
    try {
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    } catch (e) { /* ignore */ }
    ready = false;
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

  function authHeaders(accept) {
    return {
      Authorization: `Bearer ${getToken()}`,
      Accept: accept || 'application/vnd.github+json'
    };
  }

  // ---- fingerprints, base, merge -------------------------------------

  // Small non-cryptographic string hash (cyrb53) — only used to notice
  // "this field changed since the base", never for security.
  function hashString(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  function fieldHash(value) {
    return hashString(JSON.stringify(value === undefined ? null : value));
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function buildBase(state, remoteSha) {
    const hashes = {};
    Object.keys(state).forEach((k) => { hashes[k] = fieldHash(state[k]); });
    const precious = {};
    PRECIOUS_FIELDS.forEach((k) => { if (state[k] !== undefined) precious[k] = clone(state[k]); });
    return { sha: remoteSha, hashes, precious };
  }

  function saveBase(state, remoteSha) {
    try { localStorage.setItem(BASE_KEY, JSON.stringify(buildBase(state, remoteSha))); } catch (e) { /* ignore */ }
  }

  function loadBase() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BASE_KEY) || 'null');
      return parsed && parsed.hashes && parsed.precious ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function same(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  // Ordered list of keys. Remote's order wins; an entry this device removed
  // since the base is dropped; an entry this device added since the base is
  // appended (an entry that was in the base but is gone from the remote was
  // removed over there, so stays removed). With no base, nothing counts as
  // removed and every local entry counts as added — a plain union.
  function mergeList(base, remote, local) {
    const baseSet = new Set(base || []);
    const localSet = new Set(local);
    const removedLocally = new Set(base ? base.filter((k) => !localSet.has(k)) : []);
    const out = remote.filter((k) => !removedLocally.has(k));
    const have = new Set(out);
    local.forEach((k) => {
      if (!have.has(k) && !baseSet.has(k)) {
        out.push(k);
        have.add(k);
      }
    });
    return out;
  }

  // key -> value objects. With a base: whichever side changed an entry
  // wins (local if both did). Without: remote's value wins where both have
  // one, and entries only one side has are kept.
  function mergeMap(base, remote, local) {
    const out = {};
    const keys = new Set(Object.keys(remote).concat(Object.keys(local)));
    keys.forEach((k) => {
      const rv = remote[k];
      const lv = local[k];
      let value;
      if (base) {
        const bv = base[k];
        const localChanged = !same(lv, bv);
        value = localChanged ? lv : rv;
      } else {
        value = rv !== undefined ? rv : lv;
      }
      if (value !== undefined) out[k] = value;
    });
    return out;
  }

  // Arrays of { id, ... } (notes, saved searches), matched by id.
  function mergeItems(base, remote, local) {
    const byId = (arr) => new Map((arr || []).map((item) => [item.id, item]));
    const baseById = base ? byId(base) : null;
    const localById = byId(local);
    const out = [];
    const seen = new Set();
    remote.forEach((r) => {
      const l = localById.get(r.id);
      seen.add(r.id);
      if (baseById && baseById.has(r.id) && !l) return; // removed on this device
      if (l && baseById && !same(l, baseById.get(r.id))) out.push(l);
      else out.push(r);
    });
    local.forEach((l) => {
      if (seen.has(l.id)) return;
      // In the base but not the remote: removed over there — unless this
      // device edited it since, in which case keep the edit.
      if (baseById && baseById.has(l.id) && same(l, baseById.get(l.id))) return;
      out.push(l);
    });
    return out;
  }

  // Three-way merge of the remote state and the local state, given what the
  // remote held when we last synced (base, or null if unknown). See the
  // header comment for the rules.
  function merge3(base, remote, local) {
    const merged = {};
    const keys = new Set(Object.keys(remote).concat(Object.keys(local)));
    keys.forEach((k) => {
      const r = remote[k];
      const l = local[k];
      if (LIST_FIELDS.indexOf(k) !== -1) {
        merged[k] = mergeList(base && base.precious[k], r || [], l || []);
      } else if (MAP_FIELDS.indexOf(k) !== -1) {
        merged[k] = mergeMap(base && base.precious[k], r || {}, l || {});
      } else if (ITEM_FIELDS.indexOf(k) !== -1) {
        merged[k] = mergeItems(base && base.precious[k], r || [], l || []);
      } else if (!(k in remote)) {
        merged[k] = l;
      } else if (!(k in local) || !base || !(k in base.hashes)) {
        merged[k] = r; // no history to say local changed it — trust the remote
      } else {
        const localChanged = fieldHash(l) !== base.hashes[k];
        merged[k] = localChanged ? l : r; // both changed: this device's edit wins
      }
    });
    return merged;
  }

  function countDraft(state) {
    return ((state && state.draftedKeys) || []).length + ((state && state.myTeamKeys) || []).length;
  }

  // The last-resort guard (rule 3).
  function wouldWipe(remote, state) {
    const had = countDraft(remote);
    return had >= 5 && countDraft(state) < had / 2;
  }

  function snapshotBackup(reason) {
    if (global.Backups && adapter) {
      try { global.Backups.add(adapter.getState(), reason); } catch (e) { /* ignore */ }
    }
  }

  // ---- talking to GitHub ---------------------------------------------

  // Fetches the file at `ref` (branch name or commit sha). Returns
  // { text, sha } — handling the Contents API's habit of returning no inline
  // content for files over 1 MB (then the raw media type is requested) — or
  // null if the file doesn't exist there. Throws on any other failure.
  async function fetchFile(ref) {
    const res = await fetch(`${apiUrl()}?ref=${encodeURIComponent(ref)}`, { headers: authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `GitHub API error (${res.status})`);
    }
    const body = await res.json();
    if (body.content && body.encoding === 'base64') {
      return { text: base64ToUtf8(body.content), sha: body.sha };
    }
    const raw = await fetch(`${apiUrl()}?ref=${encodeURIComponent(ref)}`, { headers: authHeaders('application/vnd.github.raw+json') });
    if (!raw.ok) throw new Error(`GitHub API error (${raw.status})`);
    return { text: await raw.text(), sha: body.sha };
  }

  // Pulls the current remote. Returns { state, sha }, { missing: true } if
  // the file doesn't exist yet, or null if the request failed (status set).
  async function pullRemote() {
    setStatus('loading');
    try {
      const file = await fetchFile(BRANCH);
      if (!file) {
        sha = null;
        lastRemoteState = null;
        setStatus('idle');
        return { missing: true };
      }
      const state = JSON.parse(file.text);
      sha = file.sha;
      lastRemoteState = state;
      setStatus('idle');
      return { state, sha: file.sha };
    } catch (err) {
      setStatus('error', err.message || 'Failed to load from GitHub');
      return null;
    }
  }

  // Runs once per app load / token connect, before anything is pushed.
  // Brings local and remote together, then (if local had unsynced changes)
  // pushes the merged result. Returns true if the merge/pull completed.
  async function syncOnLoad() {
    if (!isConnected() || !adapter) return false;
    const remote = await pullRemote();
    if (!remote) return false;

    if (remote.missing) {
      ready = true;
      await pushNow(); // very first sync — nothing on GitHub to lose
      return true;
    }

    const local = adapter.getState();
    if (!isDirty()) {
      snapshotBackup('before-pull');
      adapter.replaceState(remote.state);
      saveBase(remote.state, remote.sha);
      ready = true;
      return true;
    }

    const base = loadBase();
    snapshotBackup('before-merge');
    if (!base) {
      try { localStorage.setItem(PRIOR_LOCAL_KEY, JSON.stringify(local)); } catch (e) { /* too big — skip */ }
    }
    const merged = merge3(base, remote.state, local);
    adapter.replaceState(merged);
    saveBase(remote.state, remote.sha);
    ready = true;
    await pushNow();
    return true;
  }

  async function ensureSynced() {
    if (ready) return true;
    return syncOnLoad();
  }

  function pushNow() {
    if (pushing) return pushing;
    pushing = doPush().finally(() => { pushing = null; });
    return pushing;
  }

  async function doPush() {
    if (!isConnected() || !adapter) return;
    setStatus('syncing');
    try {
      if (!(await ensureSynced())) {
        // Couldn't pull the remote first (offline?) — leave everything dirty
        // so it merges safely next time instead of risking an overwrite.
        setStatus('error', 'Could not load the latest from GitHub first — your changes are kept on this device and will sync when it works.');
        return;
      }

      for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
        if (adapter.isFake()) { setStatus('idle'); return; } // Fake Mode data never leaves the device

        const state = adapter.getState();
        if (lastRemoteState && wouldWipe(lastRemoteState, state)) {
          setStatus('error', 'Sync paused: saving now would erase most of your drafted / My Team players on GitHub. Nothing was sent. Reload this page, or use "Recover Draft Data" in Sources.');
          return;
        }

        const changeAtStringify = changeCounter;
        const json = JSON.stringify(state);
        const body = { message: 'Update draft data', content: utf8ToBase64(json), branch: BRANCH };
        if (sha) body.sha = sha;

        const res = await fetch(apiUrl(), {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify(body)
        });

        if (res.ok) {
          const result = await res.json();
          sha = result.content.sha;
          const pushed = JSON.parse(json);
          lastRemoteState = pushed;
          saveBase(pushed, sha);
          if (changeCounter === changeAtStringify) clearDirty();
          if (global.Backups) global.Backups.add(pushed, 'synced');
          setStatus('idle');
          return;
        }

        if (res.status === 409 || res.status === 422) {
          // Someone else's write landed first. Pull it and MERGE — never
          // retry the same body over the top of it.
          const remote = await pullRemote();
          if (!remote) return;
          if (remote.missing) continue;
          snapshotBackup('before-merge');
          const merged = merge3(loadBase(), remote.state, adapter.getState());
          adapter.replaceState(merged);
          saveBase(remote.state, remote.sha);
          setStatus('syncing');
          continue;
        }

        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.message || `GitHub API error (${res.status})`);
      }
      setStatus('error', 'GitHub kept changing while saving — will retry on the next change.');
    } catch (err) {
      setStatus('error', err.message || 'Failed to save to GitHub');
    }
  }

  // Called on every App.persist(). Debounces so a burst of local changes
  // (e.g. a drag-reorder, several quick edits) collapses into one commit
  // instead of one per change. Marks dirty immediately (not just once the
  // debounce fires) — the whole point is to catch a change that never made
  // it out because the tab was refreshed or closed before that happened.
  function scheduleSync() {
    if (!isConnected()) return;
    markDirty();
    changeCounter += 1;
    hasPending = true;
    setStatus('pending');
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      hasPending = false;
      pushNow();
    }, DEBOUNCE_MS);
  }

  // Sends whatever's waiting out the debounce right now instead of later.
  // Fake Mode calls this before it swaps in scrambled data (and doPush also
  // refuses to send while Fake Mode is on).
  function flushPending() {
    if (!hasPending) return;
    clearTimeout(debounceTimer);
    hasPending = false;
    pushNow();
  }

  // ---- history, for the Recover Draft Data card ----------------------

  // Most recent commits that touched the state file, newest first:
  // [{ sha, date }] (up to 100).
  async function listHistory() {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(FILE_PATH)}&sha=${BRANCH}&per_page=100`;
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `GitHub API error (${res.status})`);
    }
    const commits = await res.json();
    return commits.map((c) => ({ sha: c.sha, date: c.commit.author.date }));
  }

  // The full state as it was at a given commit.
  async function fetchVersion(commitSha) {
    const file = await fetchFile(commitSha);
    if (!file) throw new Error('That version no longer exists.');
    return JSON.parse(file.text);
  }

  global.GithubSync = {
    on, getToken, setToken, isConnected, getStatus, setAdapter,
    syncOnLoad, scheduleSync, pushNow, isDirty, flushPending,
    listHistory, fetchVersion, merge3, wouldWipe, buildBase
  };
})(window);
