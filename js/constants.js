/* Shared config used across tabs. */
(function (global) {
  const MAX_SOURCES = 8;

  // What the "Score" number in a pasted list means. Selected per-source in
  // the Sources tab (not embedded in the pasted text itself).
  const SCORE_TYPES = [
    { value: 'none', label: 'No score data' },
    { value: 'ly_avg', label: 'Last year – Avg/Game' },
    { value: 'ly_total', label: 'Last year – Total' },
    { value: 'ty_avg_proj', label: 'This year – Avg/Game Projection' },
    { value: 'ty_total_proj', label: 'This year – Total Projection' }
  ];

  function scoreTypeLabel(value) {
    const found = SCORE_TYPES.find((s) => s.value === value);
    return found ? found.label : value;
  }

  function formatScore(score) {
    if (score === null || score === undefined) return null;
    return Number.isInteger(score) ? String(score) : score.toFixed(1);
  }

  global.Constants = { MAX_SOURCES, SCORE_TYPES, scoreTypeLabel, formatScore };
})(window);
