"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import Image from "next/image";

import {
  createDefaultRows,
  createRow,
  clampPreviewIndex,
  getPreviewCount,
  getZipName,
  INITIAL_SYMBOL_COLUMN_COUNT,
  normalizeSymbolColumnCount,
  SYMBOL_LABELS,
  SYMBOL_OPTIONS,
  type DenominatorMode,
  type GeneratorPayload,
  type GeneratorRow,
  type SymbolOption,
} from "./generator-shared";
import styles from "./image-sheet-generator.module.css";

type ProgressPhase = "idle" | "preparing" | "rendering" | "downloading" | "complete" | "error";
type PreviewTab = "preview" | "photo";

const INITIAL_ROWS = createDefaultRows(7, INITIAL_SYMBOL_COLUMN_COUNT);
const PREVIEW_DEBOUNCE_MS = 220;
const SYMBOL_COLUMN_MIN = 1;
const SYMBOL_COLUMN_MAX = 6;
const DENOMINATOR_MIN = 1;
const DENOMINATOR_MAX = 30;

const SYMBOL_COLORS: Record<SymbolOption, string> = {
  "-": "var(--text-faint)",
  circle: "#2166F3",
  cross: "#E23D2E",
  triangle: "#F28C28",
  "?": "#9e00fe",
};

const JAPANESE_INSTRUCTIONS = [
  "タイトルは未入力でも生成できます。空欄の場合は TITLE としてプレビューされます。",
  "問題パネルは行ごとに積み上がるので、上の行ほど早い段階で表示されます。",
  "記号は なし / ◯ / ✕ / △ / ? から選べます。列数を増やすと各行の記号欄も増えます。",
  "分子は行ごとに編集できます。分母は上部の設定に合わせて全行で固定されます。",
  "文字サイズは各行ごとに調整できます。大きすぎる場合はプレビューで見切れを確認してください。",
  "ZIP生成中は進行バーが表示されます。後半は実際のダウンロード量に合わせて進みます。",
];

export function ImageSheetGenerator() {
  const [title, setTitle] = useState("");
  const [denominatorMode, setDenominatorMode] = useState<DenominatorMode>(7);
  const [symbolColumnCount, setSymbolColumnCount] = useState(INITIAL_SYMBOL_COLUMN_COUNT);
  const [symbolColumnNotes, setSymbolColumnNotes] = useState<string[]>(
    () => Array.from({ length: INITIAL_SYMBOL_COLUMN_COUNT }, () => ""),
  );
  const [rows, setRows] = useState(INITIAL_ROWS);
  const [nextId, setNextId] = useState(INITIAL_ROWS.length + 1);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPhase, setProgressPhase] = useState<ProgressPhase>("idle");
  const [progressValue, setProgressValue] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [activePreviewTab, setActivePreviewTab] = useState<PreviewTab>("preview");
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);

  const previewCount = getPreviewCount(rows.length);
  const safePreviewIndex = clampPreviewIndex(previewIndex, rows.length);

  useEffect(() => {
    if (safePreviewIndex !== previewIndex) {
      setPreviewIndex(safePreviewIndex);
    }
  }, [previewIndex, rows.length, safePreviewIndex]);

  const previewPayload = useMemo<GeneratorPayload>(
    () => ({
      mode: "all",
      title,
      denominatorMode,
      symbolColumnCount,
      rows,
    }),
    [denominatorMode, rows, symbolColumnCount, title],
  );
  const deferredPreviewPayload = useDeferredValue(previewPayload);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsPreviewLoading(true);
      setPreviewError(null);

      try {
        const response = await fetch("/api/preview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...deferredPreviewPayload,
            previewIndex: safePreviewIndex,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(payload?.error ?? "Preview generation failed.");
        }

        const blob = await response.blob();
        if (controller.signal.aborted) {
          return;
        }

        const objectUrl = URL.createObjectURL(blob);
        setPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return objectUrl;
        });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        setPreviewError(error instanceof Error ? error.message : "Preview generation failed.");
      } finally {
        if (!controller.signal.aborted) {
          setIsPreviewLoading(false);
        }
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [deferredPreviewPayload, safePreviewIndex]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleDialogKeydown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setIsHelpOpen(false);
    }
  });

  useEffect(() => {
    if (!isHelpOpen) {
      return;
    }

    const helpButton = helpButtonRef.current;
    window.addEventListener("keydown", handleDialogKeydown);
    return () => {
      window.removeEventListener("keydown", handleDialogKeydown);
      helpButton?.focus();
    };
  }, [isHelpOpen]);

  const handlePreviewKeydown = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goToPreviousPreview();
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      goToNextPreview();
    }
  });

  useEffect(() => {
    const node = previewPanelRef.current;
    if (!node) {
      return;
    }

    node.addEventListener("keydown", handlePreviewKeydown);
    return () => {
      node.removeEventListener("keydown", handlePreviewKeydown);
    };
  }, []);

  function updateRowText(id: number, text: string) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, text } : row)));
  }

  function updateRowSymbol(id: number, symbolIndex: number, value: SymbolOption) {
    setRows((current) =>
      current.map((row) => {
        if (row.id !== id) {
          return row;
        }

        const symbols = [...row.symbols];
        symbols[symbolIndex] = value;
        return { ...row, symbols };
      }),
    );
  }

  function updateSymbolColumnCount(value: number) {
    const nextValue = normalizeSymbolColumnCount(value);
    setSymbolColumnCount(nextValue);
    setRows((current) =>
      current.map((row) => {
        const symbols = row.symbols.slice(0, nextValue);
        while (symbols.length < nextValue) {
          symbols.push("-");
        }

        return { ...row, symbols };
      }),
    );
    setSymbolColumnNotes((current) => {
      const notes = current.slice(0, nextValue);
      while (notes.length < nextValue) {
        notes.push("");
      }

      return notes;
    });
  }

  function stepSymbolColumnCount(delta: number) {
    const next = Math.max(SYMBOL_COLUMN_MIN, Math.min(SYMBOL_COLUMN_MAX, symbolColumnCount + delta));
    if (next !== symbolColumnCount) {
      updateSymbolColumnCount(next);
    }
  }

  function updateSymbolColumnNote(index: number, value: string) {
    setSymbolColumnNotes((current) => {
      const next = [...current];
      next[index] = value;
      return next;
    });
  }

  function updateRowNumber(id: number, field: "numerator" | "denominator", value: string) {
    const parsed = Number.parseInt(value, 10);
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? { ...row, [field]: Number.isFinite(parsed) ? Math.max(1, parsed) : row[field] }
          : row,
      ),
    );
  }

  function updateDenominatorMode(value: DenominatorMode) {
    setDenominatorMode(value);
    setRows((current) => {
      const nextRows: GeneratorRow[] = current.slice(0, value).map((row, index) => ({
        ...row,
        numerator: index + 1,
        denominator: value,
      }));

      while (nextRows.length < value) {
        nextRows.push(createRow(nextRows.length + 1, nextRows.length + 1, value, symbolColumnCount));
      }

      return nextRows;
    });
    setNextId((current) => Math.max(current, value + 1));
  }

  function stepDenominatorMode(delta: number) {
    const next = Math.max(DENOMINATOR_MIN, Math.min(DENOMINATOR_MAX, denominatorMode + delta));
    if (next !== denominatorMode) {
      updateDenominatorMode(next);
    }
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
    setRows((current) => {
      const nextRows = [
        ...current,
        createRow(nextId, current.length + 1, denominatorMode, symbolColumnCount),
      ];
      startTransition(() => {
        setPreviewIndex(nextRows.length - 1);
      });
      return nextRows;
    });
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

  function goToPreviousPreview() {
    startTransition(() => {
      setPreviewIndex((current) => Math.max(0, current - 1));
    });
  }

  function goToNextPreview() {
    startTransition(() => {
      setPreviewIndex((current) => Math.min(previewCount - 1, current + 1));
    });
  }

  async function generateImages() {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsGenerating(true);
    setProgressPhase("preparing");
    setProgressValue(8);

    let renderingTimer: number | null = null;

    try {
      const responsePromise = fetch("/api/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(previewPayload),
      });

      setProgressPhase("rendering");
      renderingTimer = window.setInterval(() => {
        setProgressValue((current) => (current >= 72 ? current : current + 4));
      }, 180);

      const response = await responsePromise;

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? "Image generation failed.");
      }

      if (renderingTimer) {
        window.clearInterval(renderingTimer);
        renderingTimer = null;
      }

      const totalBytesHeader = response.headers.get("Content-Length");
      const totalBytes = totalBytesHeader ? Number.parseInt(totalBytesHeader, 10) : NaN;
      const zipName = getZipName(title, "all");
      const bytes = await readResponseBytes(response, totalBytes, (received, total) => {
        setProgressPhase("downloading");
        if (total > 0) {
          const ratio = received / total;
          setProgressValue(Math.min(99, Math.round(75 + ratio * 25)));
        } else {
          setProgressValue((current) => (current >= 95 ? current : current + 1));
        }
      });

      const blob = new Blob([bytes], { type: "application/zip" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = zipName;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);

      setProgressPhase("complete");
      setProgressValue(100);
      setStatusMessage(`${zipName} をダウンロードしました。`);
    } catch (error) {
      if (renderingTimer) {
        window.clearInterval(renderingTimer);
      }
      setProgressPhase("error");
      setProgressValue(100);
      setErrorMessage(error instanceof Error ? error.message : "Image generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  const addRowColspan = 6 + symbolColumnCount;
  const denomStepDownDisabled = denominatorMode <= DENOMINATOR_MIN;
  const denomStepUpDisabled = denominatorMode >= DENOMINATOR_MAX;
  const symbolStepDownDisabled = symbolColumnCount <= SYMBOL_COLUMN_MIN;
  const symbolStepUpDisabled = symbolColumnCount >= SYMBOL_COLUMN_MAX;

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarRow}>
            <a
              className={styles.mark}
              href="https://www.youtube.com/@radicalNaTakurou/shorts"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Image src="/radicaltakurou.jpg" alt="radicalNaTakurou" width={26} height={26} unoptimized />
            </a>
            <span className={styles.wordmark}>複数アキネーター生成器</span>
            <div className={styles.divider} />
            <div className={styles.titleField}>
              <input
                className={styles.titleInput}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例: ひらがなれんしゅう"
              />
            </div>
            <div className={styles.spacer} />
            <button
              ref={helpButtonRef}
              type="button"
              className={styles.iconButton}
              title="日本語ガイド"
              aria-label="日本語ガイド"
              onClick={() => setIsHelpOpen(true)}
            >
              <svg viewBox="0 0 24 24" width="17" height="17">
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="11" x2="12" y2="16.2" />
                <circle cx="12" cy="7.6" r="1.15" style={{ fill: "currentColor", stroke: "none" }} />
              </svg>
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={generateImages}
              disabled={isGenerating}
            >
              {isGenerating ? (
                <>
                  <svg viewBox="0 0 24 24" width="14" height="14" className={styles.spin}>
                    <path d="M12 3a9 9 0 1 0 9 9" />
                  </svg>
                  生成中...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" width="14" height="14">
                    <path d="M12 4v10m0 0-4-4m4 4 4-4" />
                    <path d="M5 16v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" />
                  </svg>
                  ZIPを生成
                </>
              )}
            </button>
          </div>
        </div>

        <div className={styles.progressTrack} data-visible={progressPhase !== "idle"}>
          <div className={styles.progressFill} style={{ width: `${progressValue}%` }} />
        </div>

        <div className={styles.content}>
          <div className={styles.tablePane}>
            <div className={styles.tableScroll}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th rowSpan={2} style={{ width: 34, textAlign: "center" }}>
                      #
                    </th>
                    <th rowSpan={2}>問題</th>
                    <th colSpan={symbolColumnCount} style={{ textAlign: "center" }}>
                      <div className={styles.headerStepper}>
                        <span>記号</span>
                        <button
                          type="button"
                          className={styles.stepBtn}
                          onClick={() => stepSymbolColumnCount(-1)}
                          disabled={symbolStepDownDisabled}
                        >
                          −
                        </button>
                        <span className={styles.stepValue}>{symbolColumnCount}</span>
                        <button
                          type="button"
                          className={styles.stepBtn}
                          onClick={() => stepSymbolColumnCount(1)}
                          disabled={symbolStepUpDisabled}
                        >
                          ＋
                        </button>
                      </div>
                    </th>
                    <th rowSpan={2} style={{ textAlign: "center" }}>
                      サイズ
                    </th>
                    <th rowSpan={2} style={{ textAlign: "center" }}>
                      分子
                    </th>
                    <th rowSpan={2} style={{ textAlign: "center" }}>
                      <div className={styles.headerStepper}>
                        <span>分母</span>
                        <button
                          type="button"
                          className={styles.stepBtn}
                          onClick={() => stepDenominatorMode(-1)}
                          disabled={denomStepDownDisabled}
                        >
                          −
                        </button>
                        <span className={styles.stepValue}>{denominatorMode}</span>
                        <button
                          type="button"
                          className={styles.stepBtn}
                          onClick={() => stepDenominatorMode(1)}
                          disabled={denomStepUpDisabled}
                        >
                          ＋
                        </button>
                      </div>
                    </th>
                    <th rowSpan={2} style={{ width: 32 }} />
                  </tr>
                  <tr>
                    {symbolColumnNotes.map((note, index) => (
                      <th key={index} className={styles.symbolNoteHeader}>
                        <input
                          className={styles.symbolNoteInput}
                          type="text"
                          value={note}
                          onChange={(event) => updateSymbolColumnNote(index, event.target.value)}
                          placeholder="メモ"
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.id} className={styles.dataRow} data-active={safePreviewIndex === rowIndex}>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className={styles.indexButton}
                          onClick={() => setPreviewIndex(rowIndex)}
                        >
                          {rowIndex + 1}
                        </button>
                      </td>
                      <td>
                        <textarea
                          className={styles.textCell}
                          value={row.text}
                          onChange={(event) => updateRowText(row.id, event.target.value)}
                          placeholder={"1行目\n2行目"}
                          rows={1}
                          spellCheck={false}
                          autoCorrect="off"
                          data-ms-editor="false"
                          data-gramm="false"
                        />
                      </td>
                      {row.symbols.map((symbol, symbolIndex) => (
                        <td key={`${row.id}-${symbolIndex}`}>
                          <select
                            className={styles.symbolSelect}
                            value={symbol}
                            style={{ color: SYMBOL_COLORS[symbol] }}
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
                          onChange={(event) => updateRowNumber(row.id, "numerator", event.target.value)}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.numberInput}
                          type="number"
                          value={row.denominator}
                          readOnly
                        />
                      </td>
                      <td style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className={styles.deleteButton}
                          onClick={() => removeRow(row.id)}
                          disabled={rows.length === 1}
                        >
                          <svg viewBox="0 0 24 24" width="12" height="12">
                            <path d="M4 7h16M9 7V4.8c0-.4.3-.8.8-.8h4.4c.5 0 .8.4.8.8V7M6 7l1 12.2c0 1 .8 1.8 1.8 1.8h6.4c1 0 1.8-.8 1.8-1.8L18 7" />
                            <path d="M10 11v6M14 11v6" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={addRowColspan} style={{ padding: 0, borderBottom: "none" }}>
                      <button
                        type="button"
                        className={styles.addRowButton}
                        onClick={addRow}
                        title="行を追加"
                        aria-label="行を追加"
                      >
                        <svg viewBox="0 0 24 24" width="13" height="13">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {(statusMessage || errorMessage) && (
              <div
                className={`${styles.message} ${errorMessage ? styles.errorMessage : styles.statusMessage}`}
              >
                <span className={styles.messageDot} />
                {errorMessage ?? statusMessage}
              </div>
            )}
          </div>

          <div className={styles.verticalDivider} />

          <div
            ref={previewPanelRef}
            className={styles.previewPane}
            tabIndex={0}
            aria-label="Preview panel"
          >
            <div className={styles.previewTabs}>
              <button
                type="button"
                className={styles.previewTab}
                data-active={activePreviewTab === "preview"}
                onClick={() => setActivePreviewTab("preview")}
              >
                プレビュー
              </button>
              <button
                type="button"
                className={styles.previewTab}
                data-active={activePreviewTab === "photo"}
                onClick={() => setActivePreviewTab("photo")}
              >
                写真
              </button>
            </div>

            {activePreviewTab === "preview" && (
              <>
                <div className={styles.previewHeader}>
                  <div className={styles.previewTitle}>
                    <span className={styles.liveDot} />
                    <h2>Row {safePreviewIndex + 1}</h2>
                  </div>
                  <div className={styles.previewNav}>
                    <button
                      type="button"
                      className={styles.navButton}
                      onClick={goToPreviousPreview}
                      disabled={safePreviewIndex <= 0}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13">
                        <path d="M15 5l-7 7 7 7" />
                      </svg>
                    </button>
                    <span className={styles.counter}>
                      {safePreviewIndex + 1} / {previewCount}
                    </span>
                    <button
                      type="button"
                      className={styles.navButton}
                      onClick={goToNextPreview}
                      disabled={safePreviewIndex >= previewCount - 1}
                    >
                      <svg viewBox="0 0 24 24" width="13" height="13">
                        <path d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  </div>
                </div>

                <div className={styles.previewFrame}>
                  {isPreviewLoading && <div className={styles.previewSkeleton}>Preview loading...</div>}
                  {!isPreviewLoading && previewUrl && (
                    <Image
                      className={styles.previewImage}
                      src={previewUrl}
                      alt="Generated preview"
                      width={1200}
                      height={675}
                      unoptimized
                    />
                  )}
                  {!isPreviewLoading && !previewUrl && !previewError && (
                    <div className={styles.previewPlaceholder}>Preview will appear here.</div>
                  )}
                  {previewError && <div className={styles.previewErrorText}>{previewError}</div>}
                </div>
              </>
            )}

            {activePreviewTab === "photo" && (
              <div className={styles.previewFrame}>
                <div className={styles.previewPlaceholder}>写真タブの内容は準備中です。</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {isHelpOpen && (
        <div className={styles.modalRoot} role="presentation" onClick={() => setIsHelpOpen(false)}>
          <div
            className={styles.modalCard}
            role="dialog"
            aria-modal="true"
            aria-labelledby="jp-instructions-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <div>
                <p className={styles.modalEyebrow}>日本語ガイド</p>
                <h2 id="jp-instructions-title">使い方</h2>
              </div>
              <button
                type="button"
                className={styles.navButton}
                onClick={() => setIsHelpOpen(false)}
                aria-label="Close instructions"
              >
                <svg viewBox="0 0 24 24" width="13" height="13">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <ol className={styles.instructionsList}>
              {JAPANESE_INSTRUCTIONS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </main>
  );
}

async function readResponseBytes(
  response: Response,
  totalBytes: number,
  onProgress: (received: number, total: number) => void,
) {
  if (!response.body) {
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    onProgress(bytes.byteLength, bytes.byteLength);
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    chunks.push(value);
    received += value.byteLength;
    onProgress(received, Number.isFinite(totalBytes) ? totalBytes : 0);
  }

  const combined = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}
