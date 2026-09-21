/* Combined/average ranking math, plus a cross-source player index used by
   the Rankings/Draft tabs (positions, combined rank) and the player detail
   view (every source's rank/score for one player). */
(function (global) {
  const { normalize } = global.NameMatch;

  // buildIndex re-normalizes every player name across every source (real
  // lists run into the hundreds per source), and used to get called fresh
  // on every filter click/keystroke and every single player-detail open —
  // by far the biggest cost in either interaction. The result only changes
  // when the sources themselves do, so it's cached here and invalidated
  // centrally (see App.emit in app.js) on 'sources-changed' /
  // 'remote-state-loaded' — the two events every add/edit/delete/reorder
  // and remote-sync path already emits.
  let cachedIndex = null;

  function invalidateIndexCache() {
    cachedIndex = null;
  }

  // sources: [{ id, name, scoreType, players: [{rank, name, positions, score}] }]
  // Returns Map<key, { key, displayName, positions, bySource: { sourceId: {rank, positions, score} } }>
  // built from ALL sources, regardless of any Tab 1 selection — positions
  // and per-source detail shouldn't disappear just because a source is
  // unchecked in the combined-average view.
  function buildIndex(sources) {
    if (cachedIndex) return cachedIndex;
    const map = new Map();
    sources.forEach((source) => {
      source.players.forEach((p) => {
        const key = normalize(p.name);
        if (!map.has(key)) {
          map.set(key, { key, displayName: p.name, positions: p.positions || null, bySource: {} });
        }
        const entry = map.get(key);
        if (!entry.positions && p.positions) entry.positions = p.positions;
        entry.bySource[source.id] = {
          rank: p.rank,
          positions: p.positions || null,
          score: p.score === undefined ? null : p.score
        };
      });
    });
    cachedIndex = map;
    return map;
  }

  // Averages rank over selectedIds only. Players unranked by every selected
  // source are excluded (they still exist in the index for lookups elsewhere).
  function combineFromIndex(index, selectedIds) {
    const result = [];
    for (const entry of index.values()) {
      let sum = 0;
      let count = 0;
      const perSource = {};
      selectedIds.forEach((id) => {
        const bySource = entry.bySource[id];
        if (bySource) {
          sum += bySource.rank;
          count += 1;
          perSource[id] = bySource.rank;
        }
      });
      if (count === 0) continue;
      result.push({
        key: entry.key,
        displayName: entry.displayName,
        positions: entry.positions,
        avg: sum / count,
        sourceCount: count,
        totalSelected: selectedIds.length,
        perSource
      });
    }

    result.sort((a, b) => {
      if (a.avg !== b.avg) return a.avg - b.avg;
      return a.displayName.localeCompare(b.displayName);
    });

    return result;
  }

  function computeCombined(sources, selectedIds) {
    return combineFromIndex(buildIndex(sources), selectedIds);
  }

  global.Ranking = { computeCombined, buildIndex, combineFromIndex, invalidateIndexCache };
})(window);
