/**
 * Mimic pandas.DataFrame.to_string() closely enough that agent prompts
 * see the same settlement / transaction tables as the Python app.
 *
 * pandas right-aligns every column, inserts a sign/separator space on
 * numeric values (and on strings when the index is shown), and joins
 * columns with a single space.
 */
export type ColumnKind = "int" | "float" | "str" | "date" | "datetime";

export type ColumnSpec = {
  key: string;
  kind: ColumnKind;
};

function isNumeric(kind: ColumnKind): boolean {
  return kind === "int" || kind === "float";
}

function formatFloat(value: number): string {
  // pandas display.precision defaults to 6 fixed digits, then trailing zeros drop.
  // 0.025 -> "0.025", 0.030000000000000002 -> "0.03".
  return Number(value).toFixed(6).replace(/\.?0+$/, "");
}

function formatRaw(value: unknown, kind: ColumnKind): string {
  if (value === null || value === undefined) return "";
  switch (kind) {
    case "int":
      return String(Math.trunc(Number(value)));
    case "float":
      return formatFloat(Number(value));
    case "date": {
      const s = String(value);
      return s.length >= 10 ? s.slice(0, 10) : s;
    }
    case "datetime":
      return String(value);
    default:
      return String(value);
  }
}

export function pandasToString(
  rows: Record<string, unknown>[],
  columns: ColumnSpec[],
  options: { index?: boolean; indexLabels?: Array<string | number> } = {},
): string {
  const withIndex = options.index !== false;
  const labels = options.indexLabels ?? rows.map((_, i) => i);

  const formatted = rows.map((row) =>
    columns.map((col) => {
      const raw = formatRaw(row[col.key], col.kind);
      // leading_space=True when a row index is printed; numeric columns
      // always include a sign space (the `{x: d}` / `{value: .Nf}` pad).
      const lead = withIndex || isNumeric(col.kind) ? " " : "";
      return lead + raw;
    }),
  );

  const widths = columns.map((col, i) => {
    const headerWidth = col.key.length + (isNumeric(col.kind) ? 1 : 0);
    let width = headerWidth;
    for (const row of formatted) width = Math.max(width, row[i].length);
    return width;
  });

  const pad = (text: string, width: number) => text.padStart(width, " ");

  const headerCells = columns.map((col, i) => pad(col.key, widths[i]));
  const bodyRows = formatted.map((row) => row.map((cell, i) => pad(cell, widths[i])));

  const indexWidth = withIndex
    ? Math.max(1, ...labels.map((label) => String(label).length))
    : 0;
  const prefix = (indexCell: string) =>
    withIndex ? pad(indexCell, indexWidth) + " " : "";

  const headerLine = prefix("") + headerCells.join(" ");
  const lines = bodyRows.map((row, i) => prefix(String(labels[i])) + row.join(" "));
  return [headerLine, ...lines].join("\n");
}

export const SETTLEMENT_COLUMNS: ColumnSpec[] = [
  { key: "settlement_id", kind: "str" },
  { key: "merchant_id", kind: "str" },
  { key: "expected_amount", kind: "int" },
  { key: "settled_amount", kind: "int" },
  { key: "settlement_date", kind: "date" },
  { key: "status", kind: "str" },
  { key: "fee_rate", kind: "float" },
];

export const TRANSACTION_COLUMNS: ColumnSpec[] = [
  { key: "txn_id", kind: "str" },
  { key: "settlement_id", kind: "str" },
  { key: "amount", kind: "int" },
  { key: "txn_date", kind: "datetime" },
  { key: "type", kind: "str" },
];
