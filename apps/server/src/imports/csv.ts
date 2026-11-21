// Small RFC 4180 CSV reader for imports (SPEC 6.7): quoted fields, escaped quotes ("" -> "),
// commas/newlines inside quotes, CRLF or LF. Spanish-locale Excel often exports with ";",
// so the delimiter is detected from the header line.

/** Decodes uploaded CSV bytes: UTF-8 (BOM stripped), falling back to Windows-1252 from old Excel. */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder("windows-1252").decode(bytes);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** "," or ";", whichever appears more often outside quotes on the first line. */
export function detectDelimiter(text: string): "," | ";" {
  let commas = 0;
  let semicolons = 0;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === "\n" || ch === "\r")) break;
    else if (!quoted && ch === ",") commas++;
    else if (!quoted && ch === ";") semicolons++;
  }
  return semicolons > commas ? ";" : ",";
}

/** Parses CSV text into rows of cells. Blank lines are kept as [""] so row numbers stay true. */
export function parseCsv(text: string, delimiter: "," | ";" = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let i = 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else {
        cell += ch;
      }
      i++;
      continue;
    }
    if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      endCell();
    } else if (ch === "\r") {
      endRow();
      if (text[i + 1] === "\n") i++;
    } else if (ch === "\n") {
      endRow();
    } else {
      cell += ch;
    }
    i++;
  }
  // Last line without a trailing newline.
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
