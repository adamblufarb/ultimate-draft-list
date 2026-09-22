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

  global.Parser = { parseRankings, parseDataList };
})(window);
