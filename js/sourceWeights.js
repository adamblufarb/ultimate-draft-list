/* Per-source "weight" for the combined-average filter — shared by Draft
   List, Draft Board, and Player Detail so the same source cycles the same
   way no matter which of those you tap it from.

   A weight is 0 (excluded — the source isn't in the weights object at
   all), 1 (normal chip "on", today's existing behavior), 2 or 3 (boosted —
   counts that many times as heavily in the combined average). Only "Average"-style
   sources (scoreType 'ly_avg' or 'ty_avg_proj' — Last Year Avg/Game and
   This Year Avg/Game Projection) and ADP sources (scoreType 'adp' — a
   continuous consensus score, the same spirit as an average) can ever
   reach 2 or 3; every other source just cycles the plain 0/1 on-off toggle it
   always has.

   "Total"-style sources (scoreType 'ly_total' or 'ty_total_proj') start
   excluded by default — a large total number skews a combined *average*
   of ranks/scores the same way an average-style source doesn't, so they
   opt in rather than opt out. Everything else (plain sources with no
   scoreType, ADP, plus the boostable averages) defaults to normal (1x)
   weight, same as before this existed. */
(function (global) {
  const BOOSTABLE_SCORE_TYPES = new Set(['ly_avg', 'ty_avg_proj', 'adp']);
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

  // Tap cycle: 0 -> 1 -> (2 -> 3 if boostable, else back to 0) -> 0.
  function cycleWeight(weights, source) {
    const current = getWeight(weights, source.id);
    const next = Object.assign({}, weights);
    if (current === 0) {
      next[source.id] = 1;
    } else if (isBoostable(source) && current < 3) {
      next[source.id] = current + 1;
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

  // Label suffix for a boosted weight (" · 2x"/" · 3x"), '' otherwise —
  // shared by every chip/square so they all read the same.
  function boostLabel(weight) {
    return weight > 1 ? ' · ' + weight + 'x' : '';
  }

  // Extra CSS class for a boosted weight (darker blue; darker still at 3x).
  function boostClass(weight, base) {
    if (weight > 2) return ' ' + base + ' ' + base + '-3';
    return weight > 1 ? ' ' + base : '';
  }

  global.SourceWeights = { boostLabel, boostClass, isBoostable, defaultWeights, reconcileWeights, getWeight, cycleWeight, weightsEqual };
})(window);
