/**
 * Minimal RFC-4180 CSV/TSV parser. Handles quoted fields, `""` escaped
 * quotes, delimiters and newlines embedded inside quoted fields, and CRLF
 * (and lone CR) line endings. Ragged rows (differing field counts) are
 * returned as-is — no padding/validation.
 */
export function parseDelimited(
  text: string,
  delimiter: "," | "\t",
): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += c;
        i += 1;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
    } else if (c === delimiter) {
      endField();
      i += 1;
    } else if (c === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
    } else if (c === "\n") {
      endRow();
      i += 1;
    } else {
      field += c;
      i += 1;
    }
  }

  // Trailing newline shouldn't produce a phantom empty row; a genuinely
  // unterminated last row/field still needs flushing.
  if (field !== "" || row.length > 0) {
    endRow();
  }

  return rows;
}
