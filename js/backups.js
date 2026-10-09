/* Local safety net for the draft data. Keeps a rolling set of snapshots of
   the things that can't be rebuilt from a paste — who's been drafted, your
   My Team picks, and your tags — in this browser's localStorage, separate
   from the app state and from GitHub. Sources/season stats are left out on
   purpose: they're big, and re-uploadable.

   A snapshot is added (a) automatically before anything replaces local data
   with data from GitHub, (b) after each successful sync when something
   changed, and (c) right before a restore, so a restore can itself be
   undone. Snapshots identical to the newest one are skipped, an all-empty
   draft is never worth saving, and when the list is full the oldest goes —
   except the fullest one (most drafted + My Team players) is always kept,
   so a later wipe can never push the best copy out. The Sources tab's
   "Recover Draft Data" card lists them. */
(function (global) {
  const KEY = 'udo_backups';
  const MAX = 40;
  const LIST_FIELDS = ['draftedKeys', 'myTeamKeys', 'targetKeys', 'doNotDraftKeys', 'pinnedKeys'];
  const MAP_FIELDS = ['breakoutLevels', 'sleeperLevels'];
  const FIELDS = LIST_FIELDS.concat(MAP_FIELDS);

  function pick(state) {
    const data = {};
    LIST_FIELDS.forEach((k) => { data[k] = (state[k] || []).slice(); });
    MAP_FIELDS.forEach((k) => { data[k] = Object.assign({}, state[k] || {}); });
    return data;
  }

  function isEmpty(data) {
    return LIST_FIELDS.every((k) => data[k].length === 0) && MAP_FIELDS.every((k) => Object.keys(data[k]).length === 0);
  }

  function weight(entry) {
    return entry.data.draftedKeys.length + entry.data.myTeamKeys.length;
  }

  function load() {
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage full — skip */ }
  }

  // Oldest-first list on disk; returned newest-first.
  function list() {
    return load().slice().reverse();
  }

  function add(state, reason) {
    const data = pick(state);
    if (isEmpty(data)) return;
    const all = load();
    const last = all[all.length - 1];
    if (last && JSON.stringify(last.data) === JSON.stringify(data)) return;
    all.push({ t: Date.now(), reason: reason || 'auto', data });
    while (all.length > MAX) {
      let fullest = 0;
      all.forEach((e, i) => { if (weight(e) > weight(all[fullest])) fullest = i; });
      const evict = fullest === 0 ? 1 : 0;
      all.splice(evict, 1);
    }
    save(all);
  }

  global.Backups = { add, list, pick, FIELDS, LIST_FIELDS, MAP_FIELDS };
})(window);
