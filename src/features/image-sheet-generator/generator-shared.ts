export const SYMBOL_OPTIONS = ["-", "circle", "cross", "triangle", "?"] as const;
export const DEFAULT_DENOMINATOR = 7;
export const MODE_OPTIONS = [
  {
    value: "all",
    title: "全部まとめ",
    description: "タイトル、本文、分数表示をまとめてZIP化します。",
  },
] as const;

export type SymbolOption = (typeof SYMBOL_OPTIONS)[number];
export type DenominatorMode = number;
export type Mode = (typeof MODE_OPTIONS)[number]["value"];
export type SymbolColumnCount = number;

export type GeneratorRow = {
  id: number;
  text: string;
  symbols: SymbolOption[];
  numerator: number;
  denominator: number;
  fontSize: number;
};

export type GeneratorPayload = {
  mode: Mode;
  title: string;
  denominatorMode: DenominatorMode;
  symbolColumnCount: SymbolColumnCount;
  rows: GeneratorRow[];
};

export type NormalizedRow = Omit<GeneratorRow, "id">;

export const INITIAL_SYMBOL_COLUMN_COUNT = 3;

export const SYMBOL_LABELS: Record<SymbolOption, string> = {
  "-": "なし",
  circle: "◯",
  cross: "✕",
  triangle: "△",
  "?": "?",
};

export function createSymbols(count: SymbolColumnCount): SymbolOption[] {
  return Array.from({ length: count }, () => "-");
}

export function createDefaultRows(
  denominator: DenominatorMode,
  symbolColumnCount: SymbolColumnCount,
): GeneratorRow[] {
  return Array.from({ length: denominator }, (_, index) => ({
    id: index + 1,
    text: "",
    symbols: createSymbols(symbolColumnCount),
    numerator: index + 1,
    denominator,
    fontSize: 400,
  }));
}

export function createRow(
  id: number,
  numerator = 1,
  denominator: DenominatorMode = 7,
  symbolColumnCount: SymbolColumnCount = INITIAL_SYMBOL_COLUMN_COUNT,
): GeneratorRow {
  return {
    id,
    text: "",
    symbols: createSymbols(symbolColumnCount),
    numerator,
    denominator,
    fontSize: 400,
  };
}

export function normalizeSymbolColumnCount(value: unknown): SymbolColumnCount {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return INITIAL_SYMBOL_COLUMN_COUNT;
  }

  return Math.max(1, Math.trunc(value));
}

export function normalizeFontSize(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 400;
  }

  return Math.max(1, Math.trunc(value));
}

export function normalizeText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

export function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);
}

export function getZipName(title: string, mode: Mode) {
  const prefix = sanitizeFileName(title) || "generated-images";
  return `${prefix}_${mode}.zip`;
}

export function clampPreviewIndex(index: number, rowCount: number) {
  if (rowCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(index, 0), rowCount - 1);
}

export function getPreviewCount(rowCount: number) {
  return Math.max(rowCount, 1);
}
