"use client";

import { useMemo, useState } from "react";
import styles from "./generator-app.module.css";

const SYMBOL_OPTIONS = ["-", "circle", "cross", "triangle"] as const;

type SymbolOption = (typeof SYMBOL_OPTIONS)[number];

const SYMBOL_LABELS: Record<SymbolOption, string> = {
  "-": "-",
  circle: "〇",
  cross: "✕",
  triangle: "△",
};

type Row = {
  id: number;
  text: string;
  symbols: [SymbolOption, SymbolOption, SymbolOption];
};

const INITIAL_ROWS: Row[] = Array.from({ length: 6 }, (_, index) => ({
  id: index + 1,
  text: "",
  symbols: ["-", "-", "-"],
}));

function createRow(id: number): Row {
  return {
    id,
    text: "",
    symbols: ["-", "-", "-"],
  };
}

export function GeneratorApp() {
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
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, text } : row)),
    );
  }

  function updateRowSymbol(
    id: number,
    symbolIndex: 0 | 1 | 2,
    value: SymbolOption,
  ) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) {
          return row;
        }

        const symbols = [...row.symbols] as Row["symbols"];
        symbols[symbolIndex] = value;

        return {
          ...row,
          symbols,
        };
      }),
    );
  }

  function addRow() {
    setRows((current) => [...current, createRow(nextId)]);
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
          title,
          rows,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;

        throw new Error(payload?.error ?? "画像の生成に失敗しました。");
      }

      const blob = await response.blob();
      const zipName = getZipName(title);
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
      setErrorMessage(
        error instanceof Error ? error.message : "画像の生成に失敗しました。",
      );
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <p className={styles.eyebrow}>PNGジェネレーター</p>
        <h1>表のように入力して、PNGをまとめてZIPで書き出します。</h1>
        <p className={styles.lead}>
          各行は元のまま1つのパネルとして描画され、書き出し時には1枚目、1枚目+2枚目、1枚目+2枚目+3枚目…という累積の縦長PNGを作成します。すべてのPNGは最後の合成画像と同じサイズで、外側は透明余白になります。
        </p>
      </section>

      <section className={styles.panel}>
        <div className={styles.topBar}>
          <label className={styles.titleField}>
            <span>タイトル</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="ファイル名の先頭に付けるタイトル"
            />
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={addRow}
            >
              行を追加
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={generateImages}
              disabled={isGenerating}
            >
              {isGenerating ? "生成中..." : "生成"}
            </button>
          </div>
        </div>

        <div className={styles.metaRow}>
          <span>{rows.length} 行</span>
          <span>{filledRowCount} 行を書き出し対象</span>
          <span>文字が空の行はスキップされます</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.indexHeader}>#</th>
                <th>文字</th>
                <th>記号1</th>
                <th>記号2</th>
                <th>記号3</th>
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
          <p
            className={errorMessage ? styles.errorMessage : styles.statusMessage}
          >
            {errorMessage ?? statusMessage}
          </p>
        )}
      </section>
    </main>
  );
}

function getZipName(title: string) {
  const prefix = sanitizeFileName(title) || "generated-images";
  return `${prefix}.zip`;
}

function sanitizeFileName(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);
}
