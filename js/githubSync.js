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
   3b. Nothing GitHub sends back is trusted until it passes validateState():
      it must actually look like app state. (On 2026-10-09 the state file
      grew past 1 MB, GitHub started answering with file *metadata* instead of
      the contents, that metadata was mistaken for the data, and it wiped
      everything and was pushed back.) Large files are now read through the
      Git Blobs API, every request bypasses the browser cache, and a push
      that would shrink the file to under 40% of what GitHub holds, or empty
      out sources / drafted / My Team, is refused.
   3c. A device holding clearly more draft data than GitHub does (because
      GitHub got wiped) never adopts the smaller remote: it merges instead,
      which repairs GitHub from the good copy.
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
  // The state file. Moved from data/state.json on 2026-10-09: pages still
  // running the old sync code (which could overwrite a newer remote with a
  // stale local copy) kept wiping the draft, and an already-open page can't
  // be forced to reload — so the new code simply uses a different file, and
  // old pages can only ever write to the old ones (LEGACY_FILE_PATHS), which
  // nothing reads any more except Recover Draft Data's history browser.
  // Moved again on 2026-10-09 (see the incident note in the header): pages
  // still open with the broken big-file code can only touch the earlier
  // files, never this one.
  const FILE_PATH = 'data/draft-v3.json';
  const LEGACY_FILE_PATHS = ['data/draft-state.json', 'data/state.json'];
  const DEBOUNCE_MS = 2500;
  const MAX_PUSH_ATTEMPTS = 4;

  // Fields that can't be re-created from a paste, and so get the careful,
  // entry-by-entry merge.
  const LIST_FIELDS = ['draftedKeys', 'myTeamKeys', 'targetKeys', 'doNotDraftKeys', 'pinnedKeys']; // arrays of keys
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
  let lastRemoteLength = 0;   // its size in characters, for the shrink guard
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

  function apiUrl(path) {
    return `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path || FILE_PATH}`;
  }

  function authHeaders(accept) {
    const headers = { Accept: accept || 'application/vnd.github+json' };
    if (getToken()) headers.Authorization = `Bearer ${getToken()}`;
    return headers;
  }

  // Every GitHub request: never served from (or stored in) the browser cache.
  function ghFetch(url, options) {
    return fetch(url, Object.assign({ cache: 'no-store' }, options || {}));
  }

  // Does this look like the app's state? (Not, say, GitHub's metadata about
  // the file, an error body, or a half-empty object.) Throws if not.
  function validateState(obj, fillMissing) {
    const bad = (why) => { throw new Error('GitHub sent back something that is not your app data (' + why + '). Nothing was changed.'); };
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) bad('not an object');
    ['encoding', '_links', 'download_url', 'git_url', 'html_url'].forEach((k) => { if (k in obj) bad('it is file metadata'); });
    // fillMissing is for browsing old history, where early versions of the
    // file predate some fields; the live file is always written in full.
    if (fillMissing && global.Storage) obj = Object.assign(global.Storage.defaultState(), obj);
    ['sources', 'draftedKeys', 'myTeamKeys', 'targetKeys', 'seasonStats'].forEach((k) => { if (!Array.isArray(obj[k])) bad('missing ' + k); });
    return obj;
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

  // Season Stats slots that are completely empty don't count as content:
  // an older version of the app had fewer slots, so "this device added a
  // blank slot" must not look like "this device changed Season Stats".
  function canonical(name, value) {
    if (name === 'seasonStats' && Array.isArray(value)) {
      const slots = value.slice();
      while (slots.length && !slots[slots.length - 1].fileName && !(slots[slots.length - 1].players || []).length) slots.pop();
      return slots;
    }
    return value;
  }

  function fieldHash(value, name) {
    const v = canonical(name, value);
    return hashString(JSON.stringify(v === undefined ? null : v));
  }

  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }

  function buildBase(state, remoteSha) {
    const hashes = {};
    Object.keys(state).forEach((k) => { hashes[k] = fieldHash(state[k], k); });
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

  // Arrays of { id, ... } (notes, saved searches), matched by id. Order:
  // items this device added since the base go to the FRONT (notes are
  // newest-first, so a new note must stay on top); if this device reordered
  // the list and the remote didn't, this device's order is kept; otherwise
  // the remote's order wins.
  function mergeItems(base, remote, local) {
    const byId = (arr) => new Map((arr || []).map((item) => [item.id, item]));
    const baseById = base ? byId(base) : null;
    const localById = byId(local);
    const kept = [];
    const seen = new Set();
    remote.forEach((r) => {
      const l = localById.get(r.id);
      seen.add(r.id);
      if (baseById && baseById.has(r.id) && !l) return; // removed on this device
      if (l && baseById && !same(l, baseById.get(r.id))) kept.push(l);
      else kept.push(r);
    });
    const added = [];
    local.forEach((l) => {
      if (seen.has(l.id)) return;
      // In the base but not the remote: removed over there — unless this
      // device edited it since, in which case keep the edit.
      if (baseById && baseById.has(l.id) && same(l, baseById.get(l.id))) return;
      added.push(l);
    });
    let ordered = kept;
    if (base) {
      const ids = (arr) => arr.map((x) => x.id).join('|');
      const baseIds = base.map((x) => x.id);
      const remoteIds = remote.map((x) => x.id);
      const sameMembers = baseIds.length === remoteIds.length && baseIds.every((id) => remoteIds.indexOf(id) !== -1);
      if (sameMembers && ids(base) === ids(remote)) {
        // Remote order untouched since the base: this device's order (if it changed) wins.
        const localOrder = new Map(local.map((x, i) => [x.id, i]));
        ordered = kept.slice().sort((x, y) => (localOrder.has(x.id) ? localOrder.get(x.id) : 1e9) - (localOrder.has(y.id) ? localOrder.get(y.id) : 1e9));
      }
    }
    return added.concat(ordered);
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
        const localChanged = fieldHash(l, k) !== base.hashes[k];
        merged[k] = localChanged ? l : r; // both changed: this device's edit wins
      }
    });
    return stripJunk(merged);
  }

  function countDraft(state) {
    return ((state && state.draftedKeys) || []).length + ((state && state.myTeamKeys) || []).length;
  }

  // The last-resort guard (rule 3).
  function wouldWipe(remote, state) {
    const had = countDraft(remote);
    if (had >= 5 && countDraft(state) < had / 2) return true;
    const n = (obj, k) => ((obj && obj[k]) || []).length;
    // Whole sections emptied out: sources, the Data List, the uploaded stats.
    if (n(remote, 'sources') > 0 && n(state, 'sources') === 0) return true;
    const dlN = (o) => ((o && o.dataList && o.dataList.players) || []).length;
    if (dlN(remote) > 0 && dlN(state) === 0) return true;
    const statsN = (o) => ((o && o.seasonStats) || []).reduce((t, x) => t + ((x && x.players) || []).length, 0);
    if (statsN(remote) > 0 && statsN(state) === 0) return true;
    return false;
  }

  // Removes GitHub's own response fields from a state object, in place.
  function stripJunk(obj) {
    Constants.GITHUB_RESPONSE_KEYS.forEach((k) => { delete obj[k]; });
    return obj;
  }

  function snapshotBackup(reason) {
    if (global.Backups && adapter) {
      try { global.Backups.add(adapter.getState(), reason); } catch (e) { /* ignore */ }
    }
  }

  // ---- talking to GitHub ---------------------------------------------

  // Fetches the file at `ref` (branch name or commit sha). Returns
  // { text, sha } or null if the file doesn't exist there; throws on any
  // other failure. The Contents API only includes the file's contents for
  // files up to 1 MB — beyond that it answers with metadata and an empty
  // `content` — so then the contents are read from the Git Blobs API by sha
  // (a different address, always base64 JSON, good to 100 MB).
  async function fetchFile(ref, path) {
    const res = await ghFetch(`${apiUrl(path)}?ref=${encodeURIComponent(ref)}`, { headers: authHeaders() });
    if (res.status === 404) return null;
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.message || `GitHub API error (${res.status})`);
    }
    const body = await res.json();
    if (body.content && body.encoding === 'base64') {
      return { text: base64ToUtf8(body.content), sha: body.sha };
    }
    if (!body.sha) throw new Error('GitHub sent back an unexpected response.');
    const blobRes = await ghFetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${body.sha}`, { headers: authHeaders() });
    if (!blobRes.ok) throw new Error(`GitHub API error (${blobRes.status})`);
    const blob = await blobRes.json();
    if (blob.encoding !== 'base64' || !blob.content) throw new Error('GitHub sent back an unexpected response.');
    return { text: base64ToUtf8(blob.content), sha: body.sha };
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
      const state = validateState(JSON.parse(file.text));
      sha = file.sha;
      lastRemoteState = state;
      lastRemoteLength = file.text.length;
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
    // If this device clearly holds more draft data than GitHub does, GitHub
    // is the one that's been wiped — don't adopt it, merge (which keeps this
    // device's data) and push the repaired result.
    const remoteLooksWiped = countDraft(local) >= 5 && countDraft(remote.state) < countDraft(local) / 2;
    if (!isDirty() && !remoteLooksWiped) {
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

      let repairedOnce = false;
      for (let attempt = 0; attempt < MAX_PUSH_ATTEMPTS; attempt++) {
        if (adapter.isFake()) { setStatus('idle'); return; } // Fake Mode data never leaves the device

        const state = stripJunk(adapter.getState());
        if (lastRemoteState && wouldWipe(lastRemoteState, state)) {
          // This device holds far less than GitHub. Don't just stop: pull
          // GitHub's copy and merge it in (union, so nothing on either side
          // is lost) — once. If it still looks like a wipe, give up loudly.
          if (!repairedOnce) {
            repairedOnce = true;
            const remote = await pullRemote();
            if (!remote || remote.missing) return;
            snapshotBackup('before-repair');
            adapter.replaceState(merge3(null, remote.state, state));
            saveBase(remote.state, remote.sha);
            setStatus('syncing');
            continue;
          }
          setStatus('error', 'Sync paused: saving now would erase your drafted / My Team players or other data on GitHub. Nothing was sent. Reload this page, or use "Recover Draft Data" in Sources.');
          return;
        }

        const changeAtStringify = changeCounter;
        const json = JSON.stringify(state);
        if (lastRemoteLength > 100000 && json.length < lastRemoteLength * 0.4) {
          setStatus('error', 'Sync paused: this save would shrink your data on GitHub by more than half. Nothing was sent. Reload this page, or use "Recover Draft Data" in Sources.');
          return;
        }
        const body = { message: 'Update draft data', content: utf8ToBase64(json), branch: BRANCH };
        if (sha) body.sha = sha;

        const res = await ghFetch(apiUrl(), {
          method: 'PUT',
          headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
          body: JSON.stringify(body)
        });

        if (res.ok) {
          const result = await res.json();
          sha = result.content.sha;
          const pushed = JSON.parse(json);
          lastRemoteState = pushed;
          lastRemoteLength = json.length;
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

  // Most recent saves of the state file — the current file and the legacy
  // one it replaced — newest first: [{ sha, date, path }] (up to 100 each).
  async function listHistory() {
    const one = async (path) => {
      const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits?path=${encodeURIComponent(path)}&sha=${BRANCH}&per_page=100`;
      const res = await ghFetch(url, { headers: authHeaders() });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message || `GitHub API error (${res.status})`);
      }
      const commits = await res.json();
      return commits.map((c) => ({ sha: c.sha, date: c.commit.author.date, path }));
    };
    const all = (await Promise.all([FILE_PATH].concat(LEGACY_FILE_PATHS).map(one))).flat();
    return all.sort((a, b) => Date.parse(b.date) - Date.parse(a.date)).slice(0, 200);
  }

  // The full state as it was at a given commit, from the given file path.
  async function fetchVersion(commitSha, path) {
    const file = await fetchFile(commitSha, path || FILE_PATH);
    if (!file) throw new Error('That version no longer exists.');
    return validateState(JSON.parse(file.text), true);
  }

  global.GithubSync = {
    on, getToken, setToken, isConnected, getStatus, setAdapter,
    syncOnLoad, scheduleSync, pushNow, isDirty, flushPending,
    listHistory, fetchVersion, merge3, wouldWipe, buildBase, validateState, stripJunk
  };
})(window);
