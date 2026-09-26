/* Parses raw pasted text into an ordered [{ rank, name, positions, score }]
   list. Format: one player per block, blocks separated by a blank line.
   Each block is:
     Rank
     Player Name
     Positions   (optional)
     Score       (optional)
   Positions and Score can each be omitted; whichever of the two remaining
   lines look like a plain number is treated as Score, the rest as Positions
   (Score's meaning — last year avg/total, projection, etc. — is chosen
   per-source in the UI, not encoded in the text). */
(function (global) {
  function isNumericToken(line) {
    return /^-?\d+(\.\d+)?$/.test(line.trim());
  }

  function parseBlock(lines, blockIndex, warnings) {
    if (lines.length < 2) {
      warnings.push(`Skipped block ${blockIndex + 1}: needs at least a rank and a name.`);
      return null;
    }
    if (!isNumericToken(lines[0])) {
      warnings.push(`Skipped block ${blockIndex + 1}: first line "${lines[0]}" isn't a rank number.`);
      return null;
    }
    const rank = parseInt(lines[0], 10);
    const name = lines[1];

    let positions = null;
    let score = null;
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i];
      if (isNumericToken(line) && score === null) {
        score = parseFloat(line);
      } else if (!isNumericToken(line) && positions === null) {
        positions = line;
      }
    }

    return { rank, name, positions, score };
  }

  function parseRankings(rawText) {
    const text = (rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    const entries = [];
    const warnings = [];
    const seenKeys = new Set();

    blocks.forEach((block, blockIndex) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      const parsed = parseBlock(lines, blockIndex, warnings);
      if (!parsed) return;

      const key = parsed.name.toLowerCase();
      if (seenKeys.has(key)) {
        warnings.push(`Duplicate entry skipped: "${parsed.name}"`);
        return;
      }
      seenKeys.add(key);
      entries.push(parsed);
    });

    entries.sort((a, b) => a.rank - b.rank);
    return { entries, warnings };
  }

  // Parses the Data List's raw pasted text into [{ name, age, team, height }].
  // Same blank-line-separated block format as rankings, but each block is:
  //   Player Name
  //   Age
  //   Team     (optional)
  //   Height   (optional)
  // No rank, no positions, no score — this list never feeds any ranking.
  function parseDataList(rawText) {
    const text = (rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    const entries = [];
    const warnings = [];
    const seenKeys = new Set();

    blocks.forEach((block, blockIndex) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        warnings.push(`Skipped block ${blockIndex + 1}: needs a name and an age.`);
        return;
      }
      const name = lines[0];
      if (!isNumericToken(lines[1])) {
        warnings.push(`Skipped block ${blockIndex + 1}: "${lines[1]}" isn't a valid age.`);
        return;
      }
      const age = parseInt(lines[1], 10);
      const team = lines[2] || null;
      const height = lines[3] || null;

      const key = name.toLowerCase();
      if (seenKeys.has(key)) {
        warnings.push(`Duplicate entry skipped: "${name}"`);
        return;
      }
      seenKeys.add(key);
      entries.push({ name, age, team, height });
    });

    return { entries, warnings };
  }

  // Parses an uploaded season-stats file — an HTML table (the format
  // Basketball-Reference's "Export as Excel" actually produces, despite the
  // .xls extension), keyed by each <th>/<td>'s data-stat attribute rather
  // than column position, so it doesn't matter which stats a given export
  // includes or what order they're in. 'ranker' (the table's own row
  // number) and 'name_display' (used as the row key, not a stat) are
  // dropped from the returned columns, along with age/team/position (shown
  // elsewhere already — Data List, the position badge — not wanted here).
  // A player traded mid-season appears as multiple rows (one per team) plus
  // one combined-season row whose team is "2TM"/"3TM"/etc. — that combined
  // row is preferred when present, since it's the player's real full-season
  // line (still true even though the team column itself is dropped below).
  function parseSeasonStatsHtml(rawHtml) {
    const warnings = [];
    let doc;
    try {
      doc = new DOMParser().parseFromString(rawHtml || '', 'text/html');
    } catch (e) {
      return { columns: [], players: [], warnings: ['Could not read this file as HTML.'] };
    }
    const table = doc.querySelector('table');
    if (!table) {
      return { columns: [], players: [], warnings: ['No table found in this file — expected an HTML-format .xls export.'] };
    }

    const SKIP_COLUMNS = new Set(['ranker', 'name_display', 'age', 'team_name_abbr', 'pos']);
    const columns = Array.from(table.querySelectorAll('thead th[data-stat]'))
      .filter((th) => !SKIP_COLUMNS.has(th.getAttribute('data-stat')))
      .map((th) => ({
        id: th.getAttribute('data-stat'),
        label: th.getAttribute('aria-label') || th.textContent.trim()
      }));

    const byName = new Map();
    Array.from(table.querySelectorAll('tbody tr')).forEach((tr) => {
      // Some exports repeat the header row every N rows for readability —
      // never real player data.
      if (tr.classList.contains('thead')) return;
      const rowValues = {};
      Array.from(tr.querySelectorAll('th[data-stat], td[data-stat]')).forEach((cell) => {
        rowValues[cell.getAttribute('data-stat')] = cell.textContent.trim();
      });
      const name = rowValues.name_display;
      if (!name) return;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(rowValues);
    });

    const players = [];
    byName.forEach((rows, name) => {
      let chosen = rows[0];
      if (rows.length > 1) {
        const combinedRow = rows.find((r) => /^\d+TM$/.test((r.team_name_abbr || '').trim()));
        if (combinedRow) chosen = combinedRow;
      }
      const values = {};
      columns.forEach((col) => { values[col.id] = chosen[col.id] || ''; });
      players.push({ key: NameMatch.normalize(name), displayName: name, values });
    });

    if (players.length === 0) {
      warnings.push('No player rows found in this file.');
    }

    return { columns, players, warnings };
  }

  global.Parser = { parseRankings, parseDataList, parseSeasonStatsHtml };
})(window);
