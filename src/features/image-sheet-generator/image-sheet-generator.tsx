"use client";

import { useMemo, useState } from "react";
import styles from "./image-sheet-generator.module.css";

const SYMBOL_OPTIONS = ["-", "circle", "cross", "triangle", "?"] as const;
const SYMBOL_COLUMN_OPTIONS = [2, 3, 4] as const;
const DENOMINATOR_OPTIONS = [5, 7, 10] as const;
const MODE_OPTIONS = [
  {
    value: "all",
    title: "まとめて生成",
    description: "4つの出力をひとつのZIPにまとめます。",
  },
  {
    value: "text",
    title: "本文＋記号",
    description: "行ごとの本文と3つの記号をそのまま出力します。",
  },
  {
    value: "title",
    title: "タイトル帯",
    description: "金色の見出しバナーだけを出力します。",
  },
  {
    value: "oo",
    title: "O/O",
    description: "分子と分母のペアを1行ずつ出力します。",
  },
] as const;

type SymbolOption = (typeof SYMBOL_OPTIONS)[number];
type SymbolColumnCount = (typeof SYMBOL_COLUMN_OPTIONS)[number];
type Mode = (typeof MODE_OPTIONS)[number]["value"];
type DenominatorMode = (typeof DENOMINATOR_OPTIONS)[number];

const SYMBOL_LABELS: Record<SymbolOption, string> = {
  "-": "なし",
  circle: "〇",
  cross: "✕",
  triangle: "△",
  "?": "?",
};

type Row = {
  id: number;
  text: string;
  symbols: SymbolOption[];
  numerator: number;
  denominator: number;
  fontSize: number;
};

function createSymbols(count: SymbolColumnCount): SymbolOption[] {
  return Array.from({ length: count }, () => "-") as SymbolOption[];
}

function createDefaultRows(denominator: DenominatorMode, symbolColumnCount: SymbolColumnCount): Row[] {
  return Array.from({ length: denominator }, (_, index) => ({
    id: index + 1,
    text: "",
    symbols: createSymbols(symbolColumnCount),
    numerator: index + 1,
    denominator,
    fontSize: 400,
  }));
}

function createRow(
  id: number,
  numerator = 1,
  denominator: DenominatorMode = 7,
  symbolColumnCount: SymbolColumnCount = 3,
): Row {
  return {
    id,
    text: "",
    symbols: createSymbols(symbolColumnCount),
    numerator,
    denominator,
    fontSize: 400,
  };
}

const INITIAL_SYMBOL_COLUMN_COUNT: SymbolColumnCount = 3;
const INITIAL_ROWS: Row[] = createDefaultRows(7, INITIAL_SYMBOL_COLUMN_COUNT);

export function ImageSheetGenerator() {
  const [mode, setMode] = useState<Mode>("all");
  const [title, setTitle] = useState("");
  const [denominatorMode, setDenominatorMode] = useState<DenominatorMode>(7);
  const [symbolColumnCount, setSymbolColumnCount] =
    useState<SymbolColumnCount>(INITIAL_SYMBOL_COLUMN_COUNT);
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [nextId, setNextId] = useState(INITIAL_ROWS.length + 1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const filledRowCount = useMemo(
    () => rows.filter((row) => row.text.trim().length > 0).length,
    [rows],
  );

  function updateRowText(id: number, text: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, text } : row)));
  }

  function updateRowSymbol(id: number, symbolIndex: number, value: SymbolOption) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) {
          return row;
        }

        const symbols = [...row.symbols] as Row["symbols"];
        symbols[symbolIndex] = value;

        return { ...row, symbols };
      }),
    );
  }

  function updateSymbolColumnCount(value: SymbolColumnCount) {
    setSymbolColumnCount(value);
    setRows((current) =>
      current.map((row) => {
        const symbols = row.symbols.slice(0, value);
        while (symbols.length < value) {
          symbols.push("-");
        }

        return { ...row, symbols };
      }),
    );
  }

  function updateRowNumber(id: number, field: "numerator" | "denominator", value: string) {
    const parsed = Number.parseInt(value, 10);
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, [field]: Number.isFinite(parsed) ? parsed : row[field] }
          : row,
      ),
    );
  }

  function updateDenominatorMode(value: DenominatorMode) {
    setDenominatorMode(value);
    setRows((current) => {
      const nextRows: Row[] = current.slice(0, value).map((row, index) => ({
        ...row,
        numerator: index + 1,
        denominator: value,
      }));

      while (nextRows.length < value) {
        nextRows.push(
          createRow(nextRows.length + 1, nextRows.length + 1, value, symbolColumnCount),
        );
      }

      return nextRows;
    });
    setNextId((current) => Math.max(current, value + 1));
  }

  function updateRowFontSize(id: number, value: string) {
    const parsed = Number.parseInt(value, 10);
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, fontSize: Number.isFinite(parsed) ? Math.max(1, parsed) : row.fontSize }
          : row,
      ),
    );
  }

  function addRow() {
    setRows((current) => [
      ...current,
      createRow(nextId, current.length + 1, denominatorMode, symbolColumnCount),
    ]);
    setNextId((current) => current + 1);
  }

  function removeRow(id: number) {
    setRows((current) => {
      if (current.length === 1) {
        return current;
      }

      return current.filter((row) => row.id !== id);
    });
  }

  async function generateImages() {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsGenerating(true);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          mode,
          title,
          denominatorMode,
          symbolColumnCount,
          rows,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "画像の生成に失敗しました。");
      }

      const blob = await response.blob();
      const zipName = getZipName(title, mode);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = zipName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setStatusMessage(`${zipName} をダウンロードしました`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "画像の生成に失敗しました。");
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <section className={styles.panel}>
          <div className={styles.topBar}>
            <label className={styles.titleField}>
              <span className={styles.fieldLabel}>タイトル</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例: この二人の偉人をあてる"
              />
              <span className={styles.supportText}>
                空欄のときは TITLE になります。
              </span>
            </label>

            <div className={styles.controlStrip} aria-label="generator controls">
              <label className={styles.modeField}>
                <span className={styles.fieldLabel}>出力モード</span>
                <select
                  className={styles.selector}
                  value={mode}
                  onChange={(event) => setMode(event.target.value as Mode)}
                >
                  {MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.title}
                    </option>
                  ))}
                </select>
                <span className={styles.supportText}>
                  {MODE_OPTIONS.find((option) => option.value === mode)?.description}
                </span>
              </label>

              <label className={styles.symbolColumnField}>
                <span className={styles.fieldLabel}>記号列</span>
                <select
                  className={styles.selector}
                  value={symbolColumnCount}
                  onChange={(event) =>
                    updateSymbolColumnCount(
                      Number.parseInt(event.target.value, 10) as SymbolColumnCount,
                    )
                  }
                >
                  {SYMBOL_COLUMN_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option} 列
                    </option>
                  ))}
                </select>
                <span className={styles.supportText}>
                  入力欄の記号列数を 2 / 3 / 4 で切り替えます。
                </span>
              </label>

              <label className={styles.denominatorField}>
                <span className={styles.fieldLabel}>分母</span>
                <select
                  className={styles.selector}
                  value={denominatorMode}
                  onChange={(event) =>
                    updateDenominatorMode(
                      Number.parseInt(event.target.value, 10) as DenominatorMode,
                    )
                  }
                >
                  {DENOMINATOR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <span className={styles.supportText}>
                  行数と分母の既定値を 5 / 7 / 10 で切り替えます。
                </span>
              </label>
            </div>

            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={addRow}>
                行を追加
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={generateImages}
                disabled={isGenerating}
              >
                {isGenerating ? "生成中..." : "ZIP を生成"}
              </button>
            </div>
          </div>

          <div className={styles.metaRow}>
            <span>{rows.length} 行</span>
            <span>{filledRowCount} 行が入力済み</span>
            <span>{symbolColumnCount} 列の記号入力</span>
            <span>mode 1 は {denominatorMode} 行を基準に合成します</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table} style={{ minWidth: `${920 + symbolColumnCount * 90}px` }}>
              <thead>
                <tr>
                  <th className={styles.indexHeader}>#</th>
                  <th>本文</th>
                  {Array.from({ length: symbolColumnCount }, (_, index) => (
                    <th key={index}>記号 {index + 1}</th>
                  ))}
                  <th>文字サイズ</th>
                  <th>分子</th>
                  <th>分母</th>
                  <th className={styles.controlHeader}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, rowIndex) => (
                  <tr key={row.id}>
                    <td className={styles.indexCell}>{rowIndex + 1}</td>
                    <td>
                      <textarea
                        className={styles.textarea}
                        value={row.text}
                        onChange={(event) => updateRowText(row.id, event.target.value)}
                        placeholder={"1行または\n複数行"}
                        rows={3}
                      />
                    </td>
                    {row.symbols.map((symbol, symbolIndex) => (
                      <td key={`${row.id}-${symbolIndex}`}>
                        <select
                          className={styles.select}
                          value={symbol}
                          onChange={(event) =>
                            updateRowSymbol(row.id, symbolIndex, event.target.value as SymbolOption)
                          }
                        >
                          {SYMBOL_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {SYMBOL_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td>
                      <input
                        className={styles.numberInput}
                        type="number"
                        min={1}
                        value={row.fontSize}
                        onChange={(event) => updateRowFontSize(row.id, event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        className={styles.numberInput}
                        type="number"
                        min={1}
                        value={row.numerator}
                        onChange={(event) =>
                          updateRowNumber(row.id, "numerator", event.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        className={styles.numberInput}
                        type="number"
                        min={1}
                        value={row.denominator}
                        readOnly
                      />
                    </td>
                    <td className={styles.rowActionCell}>
                      <button
                        type="button"
                        className={styles.removeButton}
                        onClick={() => removeRow(row.id)}
                        disabled={rows.length === 1}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(statusMessage || errorMessage) && (
            <p className={errorMessage ? styles.errorMessage : styles.statusMessage}>
              {errorMessage ?? statusMessage}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function getZipName(title: string, mode: Mode) {
  const prefix = sanitizeFileName(title) || "generated-images";
  return `${prefix}_${mode}.zip`;
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);
}
