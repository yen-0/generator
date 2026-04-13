"use client";

import { useMemo, useState } from "react";
import styles from "./image-sheet-generator.module.css";

const SYMBOL_OPTIONS = ["-", "circle", "cross", "triangle"] as const;
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
type Mode = (typeof MODE_OPTIONS)[number]["value"];

const SYMBOL_LABELS: Record<SymbolOption, string> = {
  "-": "なし",
  circle: "〇",
  cross: "✕",
  triangle: "△",
};

type Row = {
  id: number;
  text: string;
  symbols: [SymbolOption, SymbolOption, SymbolOption];
  numerator: number;
  denominator: number;
  fontSize: number;
};

const INITIAL_ROWS: Row[] = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1,
  text: "",
  symbols: ["-", "-", "-"],
  numerator: index + 1,
  denominator: 7,
  fontSize: 400,
}));

function createRow(id: number, numerator = 1): Row {
  return {
    id,
    text: "",
    symbols: ["-", "-", "-"],
    numerator,
    denominator: 7,
    fontSize: 400,
  };
}

export function ImageSheetGenerator() {
  const [mode, setMode] = useState<Mode>("all");
  const [title, setTitle] = useState("");
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

  function updateRowSymbol(id: number, symbolIndex: 0 | 1 | 2, value: SymbolOption) {
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
    setRows((current) => [...current, createRow(nextId, current.length + 1)]);
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
        <section className={styles.hero} aria-label="generator overview">
          <p className={styles.eyebrow}>日本語向け PNG ジェネレーター</p>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <h1>4つのモードで、自然に見える画像セットをまとめて作れます。</h1>
              <p className={styles.lead}>
                文章、記号、タイトル帯、O/O の4系統を、同じ行データから一括で生成します。
                日本語の入力に合わせて、余白や階層が見やすい配置に整えています。
              </p>
            </div>

            <aside className={styles.summaryCard}>
              <div className={styles.summaryTitle}>使い方</div>
              <div className={styles.summaryList}>
                <div className={styles.summaryItem}>
                  <strong>1. タイトルを入れる</strong>
                  <span>mode 3 の見出し帯に使います。</span>
                </div>
                <div className={styles.summaryItem}>
                  <strong>2. 行データを整える</strong>
                  <span>本文、3つの記号、分子、分母を行ごとに入力します。</span>
                </div>
                <div className={styles.summaryItem}>
                  <strong>3. モードを選ぶ</strong>
                  <span>単独出力か、ZIP 一括出力かを切り替えられます。</span>
                </div>
              </div>
            </aside>
          </div>
        </section>

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
                mode 3 の見出し帯に反映されます。空欄のときは TITLE になります。
              </span>
            </label>

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

          <section className={styles.modeSection} aria-label="mode selector">
            <div className={styles.modeTitleRow}>
              <h2>出力モード</h2>
              <p>日本語の作業順に合わせて、選びやすい4つの見せ方に整理しました。</p>
            </div>
            <div className={styles.modeTabs} role="tablist" aria-label="generator modes">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={mode === option.value}
                  className={mode === option.value ? styles.modeTabActive : styles.modeTab}
                  onClick={() => setMode(option.value)}
                >
                  <strong>{option.title}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          </section>

          <div className={styles.metaRow}>
            <span>{rows.length} 行</span>
            <span>{filledRowCount} 行が入力済み</span>
            <span>mode 1 は 7 行を基準に合成します</span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.indexHeader}>#</th>
                  <th>本文</th>
                  <th>記号 1</th>
                  <th>記号 2</th>
                  <th>記号 3</th>
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
                            updateRowSymbol(
                              row.id,
                              symbolIndex as 0 | 1 | 2,
                              event.target.value as SymbolOption,
                            )
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
                        onChange={(event) =>
                          updateRowNumber(row.id, "denominator", event.target.value)
                        }
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
