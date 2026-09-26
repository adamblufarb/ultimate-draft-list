/* Per-source "weight" for the combined-average filter — shared by Draft
   List, Draft Board, and Player Detail so the same source cycles the same
   way no matter which of those you tap it from.

   A weight is 0 (excluded — the source isn't in the weights object at
   all), 1 (normal chip "on", today's existing behavior), or 1.5 (boosted —
   counts 1.5x as heavily in the combined average). Only "Average"-style
   sources (scoreType 'ly_avg' or 'ty_avg_proj' — Last Year Avg/Game and
   This Year Avg/Game Projection) can ever reach 1.5; every other source
   just cycles the plain 0/1 on-off toggle it always has.

   "Total"-style sources (scoreType 'ly_total' or 'ty_total_proj') start
   excluded by default — a large total number skews a combined *average*
   of ranks/scores the same way an average-style source doesn't, so they
   opt in rather than opt out. Everything else (plain sources with no
   scoreType, plus the boostable averages) defaults to normal (1x) weight,
   same as before this existed. */
(function (global) {
  const BOOSTABLE_SCORE_TYPES = new Set(['ly_avg', 'ty_avg_proj']);
  const DEFAULT_OFF_SCORE_TYPES = new Set(['ly_total', 'ty_total_proj']);

  function isBoostable(source) {
    return BOOSTABLE_SCORE_TYPES.has(source.scoreType);
  }

  function defaultWeights(sources) {
    const weights = {};
    sources.forEach((s) => {
      if (!DEFAULT_OFF_SCORE_TYPES.has(s.scoreType)) weights[s.id] = 1;
    });
    return weights;
  }

  // Drops ids for sources that no longer exist, and adds any newly-added
  // source at its default weight — same reconciliation every tab's
  // onSourcesChanged already did inline when this was a plain id array.
  function reconcileWeights(weights, sources) {
    const next = {};
    const byId = new Map(sources.map((s) => [s.id, s]));
    Object.keys(weights).forEach((id) => {
      if (byId.has(id) && weights[id]) next[id] = weights[id];
    });
    sources.forEach((s) => {
      if (!(s.id in next) && !DEFAULT_OFF_SCORE_TYPES.has(s.scoreType)) {
        next[s.id] = 1;
      }
    });
    return next;
  }

  function getWeight(weights, id) {
    return weights[id] || 0;
  }

  // Tap cycle: 0 -> 1 -> (1.5 if boostable, else back to 0) -> 0.
  function cycleWeight(weights, source) {
    const current = getWeight(weights, source.id);
    const next = Object.assign({}, weights);
    if (current === 0) {
      next[source.id] = 1;
    } else if (current === 1 && isBoostable(source)) {
      next[source.id] = 1.5;
    } else {
      delete next[source.id];
    }
    return next;
  }

  function weightsEqual(a, b) {
    const ids = new Set(Object.keys(a).concat(Object.keys(b)));
    for (const id of ids) {
      if ((a[id] || 0) !== (b[id] || 0)) return false;
    }
    return true;
  }

  global.SourceWeights = { isBoostable, defaultWeights, reconcileWeights, getWeight, cycleWeight, weightsEqual };
})(window);
