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

  // Parses an ADP list's raw pasted text into the same [{ rank, name,
  // positions, score }] shape parseRankings produces, so every downstream
  // consumer (Ranking, Smart Search, Player Detail's source squares, the
  // preview table) treats it identically — but the format itself is
  // different: one player per block, blocks separated by a blank line,
  // each block is just Player Name then ADP score, no leading rank line
  // and no positions line. An ADP list's paste order doesn't correlate
  // with its score (e.g. the #1 player by ADP order might have an ADP
  // score of 1.6, not 1), so the score itself — not the block's position
  // in the list — becomes `rank` here, which is what Ranking.combineFromIndex
  // and every other "this source's rank for this player" display actually
  // reads. `positions` and `score` are always null; nothing else in the
  // pasted text carries either.
  function parseADPList(rawText) {
    const text = (rawText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const blocks = text.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean);
    const entries = [];
    const warnings = [];
    const seenKeys = new Set();

    blocks.forEach((block, blockIndex) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) {
        warnings.push(`Skipped block ${blockIndex + 1}: needs a name and an ADP score.`);
        return;
      }
      const name = lines[0];
      if (!isNumericToken(lines[1])) {
        warnings.push(`Skipped block ${blockIndex + 1}: "${lines[1]}" isn't a valid ADP score.`);
        return;
      }
      const adp = parseFloat(lines[1]);

      const key = name.toLowerCase();
      if (seenKeys.has(key)) {
        warnings.push(`Duplicate entry skipped: "${name}"`);
        return;
      }
      seenKeys.add(key);
      entries.push({ rank: adp, name, positions: null, score: null });
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
  // than column position (or, for the plain-header flavor older seasons'
  // pages export, by header label — see readPlainTable), so it doesn't matter which stats a given export
  // includes or what order they're in. 'ranker' (the table's own row
  // number) and 'name_display' (used as the row key, not a stat) are
  // dropped from the returned columns, along with age/position (shown
  // elsewhere already — Data List, the position badge — not wanted here).
  // Team is kept — Player Detail's season stats push it to the bottom of the
  // list, and it also feeds Player Detail's 🔁 team-change indicator.
  // A player traded mid-season appears as multiple rows (one per team) plus
  // one combined-season row whose team is "2TM"/"3TM"/etc. — that combined
  // row is preferred when present, since it's the player's real full-season
  // line.
  // Some Basketball-Reference exports (older seasons' pages) have plain
  // header cells — "Player", "G", "3P%" — and plain <td>s, with none of the
  // data-stat attributes the newer pages carry. This maps those header
  // labels onto the same column ids the newer exports use, so a season
  // uploaded either way looks and behaves identically everywhere else (the
  // Avg/Tot fantasy points, the health/trend emoji, the stat arrows...).
  const HEADER_LABEL_IDS = {
    'Rk': 'ranker', 'Player': 'name_display', 'Age': 'age', 'Team': 'team_name_abbr', 'Tm': 'team_name_abbr',
    'Pos': 'pos', 'G': 'games', 'GS': 'games_started', 'MP': 'mp_per_g', 'FG': 'fg_per_g', 'FGA': 'fga_per_g',
    'FG%': 'fg_pct', '3P': 'fg3_per_g', '3PA': 'fg3a_per_g', '3P%': 'fg3_pct', '2P': 'fg2_per_g',
    '2PA': 'fg2a_per_g', '2P%': 'fg2_pct', 'eFG%': 'efg_pct', 'FT': 'ft_per_g', 'FTA': 'fta_per_g',
    'FT%': 'ft_pct', 'ORB': 'orb_per_g', 'DRB': 'drb_per_g', 'TRB': 'trb_per_g', 'AST': 'ast_per_g',
    'STL': 'stl_per_g', 'BLK': 'blk_per_g', 'TOV': 'tov_per_g', 'PF': 'pf_per_g', 'PTS': 'pts_per_g',
    'Awards': 'awards'
  };

  // The plain-header flavor: returns { headers: [{ id, label }], rows: [{ [id]: text }] } or null if
  // the table doesn't look like one (no recognisable Player column).
  function readPlainTable(table) {
    const headerCells = Array.from(table.querySelectorAll('thead th, thead td'));
    const headers = headerCells.map((th) => {
      const label = th.textContent.trim();
      return { id: HEADER_LABEL_IDS[label] || ('col_' + label.toLowerCase().replace(/[^a-z0-9]+/g, '_')), label };
    });
    if (!headers.some((h) => h.id === 'name_display')) return null;
    const rows = [];
    Array.from(table.querySelectorAll('tbody tr')).forEach((tr) => {
      const cells = Array.from(tr.querySelectorAll('td, th'));
      const row = {};
      headers.forEach((h, i) => { row[h.id] = cells[i] ? cells[i].textContent.trim() : ''; });
      if (row.name_display === 'Player' || row.ranker === 'Rk') return; // repeated header row
      rows.push(row);
    });
    return { headers, rows };
  }

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

    const SKIP_COLUMNS = new Set(['ranker', 'name_display', 'age', 'pos']);
    const hasDataStat = !!table.querySelector('thead th[data-stat]');
    const plain = hasDataStat ? null : readPlainTable(table);
    if (!hasDataStat && !plain) {
      return { columns: [], players: [], warnings: ['No player rows found in this file.'] };
    }

    let columns;
    let rowObjects;
    if (plain) {
      // An Awards column that's nothing but "x" (this export's placeholder)
      // carries no information — drop it rather than show "Awards: x".
      const awardsEmpty = plain.rows.every((r) => !r.awards || r.awards === 'x');
      columns = plain.headers
        .filter((h) => !SKIP_COLUMNS.has(h.id) && !(h.id === 'awards' && awardsEmpty))
        .map((h) => ({ id: h.id, label: h.label }));
      rowObjects = plain.rows;
    } else {
      columns = Array.from(table.querySelectorAll('thead th[data-stat]'))
        .filter((th) => !SKIP_COLUMNS.has(th.getAttribute('data-stat')))
        .map((th) => ({
          id: th.getAttribute('data-stat'),
          label: th.getAttribute('aria-label') || th.textContent.trim()
        }));
      rowObjects = [];
      Array.from(table.querySelectorAll('tbody tr')).forEach((tr) => {
        // Some exports repeat the header row every N rows for readability —
        // never real player data.
        if (tr.classList.contains('thead')) return;
        const rowValues = {};
        Array.from(tr.querySelectorAll('th[data-stat], td[data-stat]')).forEach((cell) => {
          rowValues[cell.getAttribute('data-stat')] = cell.textContent.trim();
        });
        rowObjects.push(rowValues);
      });
    }

    const byName = new Map();
    rowObjects.forEach((rowValues) => {
      const name = rowValues.name_display;
      if (!name) return;
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(rowValues);
    });

    const players = [];
    byName.forEach((rows, name) => {
      let chosen = rows[0];
      if (rows.length > 1) {
        const combinedRow = rows.find((r) => /^(\d+TM|TOT)$/.test((r.team_name_abbr || '').trim()));
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

  global.Parser = { parseRankings, parseADPList, parseDataList, parseSeasonStatsHtml };
})(window);
