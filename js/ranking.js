/* Combined/average ranking math, plus a cross-source player index used by
   the Rankings/Draft tabs (positions, combined rank) and the player detail
   view (every source's rank/score for one player). */
(function (global) {
  const { normalize } = global.NameMatch;

  // sources: [{ id, name, scoreType, players: [{rank, name, positions, score}] }]
  // Returns Map<key, { key, displayName, positions, bySource: { sourceId: {rank, positions, score} } }>
  // built from ALL sources, regardless of any Tab 1 selection — positions
  // and per-source detail shouldn't disappear just because a source is
  // unchecked in the combined-average view.
  function buildIndex(sources) {
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

  global.Ranking = { computeCombined, buildIndex, combineFromIndex };
})(window);
