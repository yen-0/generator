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

export type PreviewPayload = GeneratorPayload & {
  previewIndex: number;
};

export type NormalizedRow = Omit<GeneratorRow, "id">;

const SYMBOL_VALUES = new Set<string>(SYMBOL_OPTIONS);
const MODE_VALUES = new Set<string>(MODE_OPTIONS.map((option) => option.value));

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

export function normalizeDenominatorMode(value: unknown): DenominatorMode {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_DENOMINATOR;
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

export function validateRows(value: unknown, symbolColumnCount: SymbolColumnCount): NormalizedRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid request payload.");
  }

  return value.map((row) => {
    const record = row as Partial<GeneratorRow> | null;

    if (
      typeof record !== "object" ||
      record === null ||
      typeof record.text !== "string" ||
      !Array.isArray(record.symbols) ||
      record.symbols.length !== symbolColumnCount ||
      typeof record.numerator !== "number" ||
      typeof record.denominator !== "number"
    ) {
      throw new Error(
        `Each row must include text, ${symbolColumnCount} symbols, numerator, denominator, and an optional font size.`,
      );
    }

    const symbols = record.symbols.map((symbol) => {
      if (typeof symbol !== "string" || !SYMBOL_VALUES.has(symbol)) {
        throw new Error("Invalid symbol value.");
      }

      return symbol;
    }) as SymbolOption[];

    return {
      text: record.text,
      symbols,
      fontSize: normalizeFontSize(record.fontSize),
      numerator: Math.max(1, Math.trunc(record.numerator)),
      denominator: Math.max(1, Math.trunc(record.denominator)),
    };
  });
}

export function parseGeneratorPayload(body: unknown): GeneratorPayload {
  const data = (body ?? {}) as Partial<GeneratorPayload>;
  const symbolColumnCount = normalizeSymbolColumnCount(data.symbolColumnCount);

  return {
    mode:
      typeof data.mode === "string" && MODE_VALUES.has(data.mode)
        ? (data.mode as Mode)
        : "all",
    title: typeof data.title === "string" ? data.title : "",
    denominatorMode: normalizeDenominatorMode(data.denominatorMode),
    symbolColumnCount,
    rows: validateRows(data.rows, symbolColumnCount).map((row, index) => ({
      id: index + 1,
      ...row,
    })),
  };
}

export function parsePreviewPayload(body: unknown): PreviewPayload {
  const payload = parseGeneratorPayload(body);
  const previewIndexValue = (body as { previewIndex?: unknown } | null)?.previewIndex;

  return {
    ...payload,
    previewIndex: clampPreviewIndex(
      typeof previewIndexValue === "number" && Number.isFinite(previewIndexValue)
        ? Math.trunc(previewIndexValue)
        : 0,
      payload.rows.length,
    ),
  };
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

export function toAsciiDownloadName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
  const cleaned = normalized.replace(/["\\]/g, "").trim();
  return cleaned || "generated-images.zip";
}

export function buildContentDisposition(asciiName: string, utf8Name: string) {
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRFC5987ValueChars(utf8Name)}`;
}

function encodeRFC5987ValueChars(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}
