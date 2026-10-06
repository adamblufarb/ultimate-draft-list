/* Per-source "weight" for the combined-average filter — shared by Draft
   List, Draft Board, and Player Detail so the same source cycles the same
   way no matter which of those you tap it from.

   A weight is 0 (excluded — the source isn't in the weights object at
   all), 1 (normal chip "on", today's existing behavior), 1.5 or 2.5 (boosted —
   counts that many times as heavily in the combined average). Only "Average"-style
   sources (scoreType 'ly_avg' or 'ty_avg_proj' — Last Year Avg/Game and
   This Year Avg/Game Projection) and ADP sources (scoreType 'adp' — a
   continuous consensus score, the same spirit as an average) can ever
   reach 1.5 or 2.5; every other source just cycles the plain 0/1 on-off toggle it
   always has.

   "Total"-style sources (scoreType 'ly_total' or 'ty_total_proj') start
   excluded by default — a large total number skews a combined *average*
   of ranks/scores the same way an average-style source doesn't, so they
   opt in rather than opt out. Everything else (plain sources with no
   scoreType, ADP, plus the boostable averages) defaults to normal (1x)
   weight, same as before this existed.

   Iso mode: double-tapping a source's chip/square isolates it — only that
   source counts (weights become { [id]: 1 }), so the combined rank shown
   is just that source's own rank. The weights from before are kept
   (iso = { id, saved }) and a single tap on the isolated source puts them
   back. Tapping a different source while isolated also exits iso first,
   then taps that source normally; double-tapping a different one moves the
   iso to it (keeping the original saved weights). tap() is a pure
   state-in/state-out helper — { weights, iso, lastTap } — so Draft List,
   Draft Board, and Player Detail all get identical behavior. The first tap
   of a double-tap is applied right away (no tap delay) and undone when the
   second one lands. */
(function (global) {
  const BOOSTABLE_SCORE_TYPES = new Set(['ly_avg', 'ty_avg_proj', 'adp']);
  const DEFAULT_OFF_SCORE_TYPES = new Set(['ly_total', 'ty_total_proj']);

  // The weights a boostable source steps through, in tap order.
  const BOOST_STEPS = [1, 1.5, 2.5];

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

  // Tap cycle: 0 -> 1 -> (1.5 -> 2.5 if boostable, else back to 0) -> 0.
  function cycleWeight(weights, source) {
    const current = getWeight(weights, source.id);
    const next = Object.assign({}, weights);
    if (current === 0) {
      next[source.id] = 1;
    } else if (isBoostable(source) && current < BOOST_STEPS[BOOST_STEPS.length - 1]) {
      next[source.id] = BOOST_STEPS[BOOST_STEPS.indexOf(current) + 1];
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

  // Label suffix for a boosted weight (" · 1.5x"/" · 2.5x"), '' otherwise —
  // shared by every chip/square so they all read the same.
  function boostLabel(weight) {
    return weight > 1 ? ' · ' + weight + 'x' : '';
  }

  // Extra CSS class for a boosted weight (darker blue; darker still at 2.5x).
  function boostClass(weight, base) {
    if (weight > 1.5) return ' ' + base + ' ' + base + '-3';
    return weight > 1 ? ' ' + base : '';
  }

  const DOUBLE_TAP_MS = 300;

  function enterIso(weights, iso, id) {
    const only = {};
    only[id] = 1;
    return { weights: only, iso: { id, saved: iso ? iso.saved : weights } };
  }

  function tap(state, source) {
    const now = Date.now();
    const last = state.lastTap;
    if (last && last.id === source.id && now - last.time < DOUBLE_TAP_MS) {
      const entered = enterIso(last.prev.weights, last.prev.iso, source.id);
      return { weights: entered.weights, iso: entered.iso, lastTap: null };
    }
    const lastTap = { id: source.id, time: now, prev: { weights: state.weights, iso: state.iso } };
    if (state.iso) {
      const restored = state.iso.saved;
      const wasThis = state.iso.id === source.id;
      return { weights: wasThis ? restored : cycleWeight(restored, source), iso: null, lastTap };
    }
    return { weights: cycleWeight(state.weights, source), iso: null, lastTap };
  }

  // reconcileWeights, iso-aware: the saved weights are reconciled too, and
  // iso quietly ends if its source was deleted.
  function reconcileIso(weights, iso, sources) {
    if (!iso) return { weights: reconcileWeights(weights, sources), iso: null };
    const saved = reconcileWeights(iso.saved, sources);
    if (!sources.some((s) => s.id === iso.id)) return { weights: saved, iso: null };
    return { weights, iso: { id: iso.id, saved } };
  }

  function isIso(iso, id) {
    return !!iso && iso.id === id;
  }

  // Tab/overlay snapshots differ if the effective weights or which source
  // (if any) is isolated changed.
  function sameFilter(weightsA, isoA, weightsB, isoB) {
    return weightsEqual(weightsA, weightsB) && (isoA ? isoA.id : null) === (isoB ? isoB.id : null);
  }

  global.SourceWeights = { tap, reconcileIso, isIso, sameFilter, boostLabel, boostClass, isBoostable, defaultWeights, reconcileWeights, getWeight, cycleWeight, weightsEqual };
})(window);
