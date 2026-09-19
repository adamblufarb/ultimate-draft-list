/* Central app state + a tiny pub/sub bus so tabs can react to each other
   without being tightly coupled. State is the single source of truth and
   is persisted to localStorage on every mutation, and — when a GitHub sync
   token is configured on this device — pushed (debounced) to the repo too. */
(function (global) {
  const state = Storage.load();
  const listeners = {};

  function on(event, cb) {
    (listeners[event] = listeners[event] || []).push(cb);
  }

  function emit(event, payload) {
    (listeners[event] || []).forEach((cb) => cb(payload));
  }

  function persist() {
    Storage.save(state);
    GithubSync.scheduleSync(state);
  }

  function genId() {
    return 'src_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }

  function isDrafted(key) {
    return state.draftedKeys.includes(key);
  }

  function setDrafted(key, drafted) {
    const set = new Set(state.draftedKeys);
    if (drafted) set.add(key); else set.delete(key);
    state.draftedKeys = Array.from(set);
    // Undrafting (e.g. via the plain "Undraft" button, not "Remove from My
    // Team") puts the player back on the board — they can't simultaneously
    // be "available" and "on my roster", so drop them from My Team too.
    if (!drafted && state.myTeamKeys.includes(key)) {
      state.myTeamKeys = state.myTeamKeys.filter((k) => k !== key);
      emit('my-team-changed', { key, onTeam: false });
    }
    persist();
    emit('drafted-changed', { key, drafted });
  }

  // Whether hidden (drafted) players should still be shown, dimmed, in the
  // lists. A session-only preference — always starts hidden on a fresh load,
  // matching Tab 1's "default view" behavior.
  let includeDrafted = false;

  function getIncludeDrafted() {
    return includeDrafted;
  }

  function setIncludeDrafted(value) {
    includeDrafted = value;
    emit('include-drafted-changed', value);
  }

  function isLocked(key) {
    return state.lockedKeys.includes(key);
  }

  function setLocked(key, locked) {
    const set = new Set(state.lockedKeys);
    if (locked) set.add(key); else set.delete(key);
    state.lockedKeys = Array.from(set);
    persist();
    emit('locked-changed', { key, locked });
  }

  function unlockAll() {
    state.lockedKeys = [];
    persist();
    emit('locked-changed');
  }

  function isOnMyTeam(key) {
    return state.myTeamKeys.includes(key);
  }

  // Marks a player drafted (if not already) and appends them to My Team, in
  // pick order. Idempotent.
  function draftedByMe(key) {
    if (!state.draftedKeys.includes(key)) {
      state.draftedKeys = state.draftedKeys.concat(key);
    }
    if (!state.myTeamKeys.includes(key)) {
      state.myTeamKeys = state.myTeamKeys.concat(key);
    }
    persist();
    emit('drafted-changed', { key, drafted: true });
    emit('my-team-changed', { key, onTeam: true });
  }

  // Fully reverses draftedByMe: back on the board, off the roster.
  function removeFromMyTeam(key) {
    state.myTeamKeys = state.myTeamKeys.filter((k) => k !== key);
    state.draftedKeys = state.draftedKeys.filter((k) => k !== key);
    persist();
    emit('my-team-changed', { key, onTeam: false });
    emit('drafted-changed', { key, drafted: false });
  }

  global.App = {
    state, on, emit, persist, genId,
    isDrafted, setDrafted, getIncludeDrafted, setIncludeDrafted,
    isLocked, setLocked, unlockAll,
    isOnMyTeam, draftedByMe, removeFromMyTeam
  };
})(window);
