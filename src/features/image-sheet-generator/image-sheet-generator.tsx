"use client";

import {
  startTransition,
  useDeferredValue,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type UIEvent,
  type ReactNode,
} from "react";
import type { FFmpeg } from "@ffmpeg/ffmpeg";
import Image from "next/image";
import JSZip from "jszip";

import {
  clampPreviewIndex,
  createDefaultRows,
  createRow,
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
import {
  renderClientPreviewBlob,
  renderClientZipBlob,
} from "./generator-client-render";
import {
  buildFrameSymbolSequence,
  buildMovFileName,
  canvasToBlob,
  clampPhotoCount,
  clampPhotoRowCount,
  computePhotoSlotLayouts,
  createAnchorArray,
  createPhotoSlots,
  drawPhotoPreview,
  fileToDataUrl,
  frameCountForDuration,
  getAutomaticAnchors,
  getVisibleAnimatedSymbols,
  loadPreviewAssets,
  normalizeAnchors,
  normalizePhotoSlots,
  PHOTO_CANVAS_ASPECT_RATIO,
  PHOTO_CANVAS_HEIGHT,
  PHOTO_CANVAS_WIDTH,
  PHOTO_COUNT_MIN,
  PHOTO_EXPORT_FPS,
  PHOTO_SYMBOL_MARGIN_SECONDS,
  PHOTO_ROW_COUNT_MIN,
  type PhotoRenderAssets,
  type PhotoSlotData,
  type Point,
} from "./photo-panel";
import styles from "./image-sheet-generator.module.css";

type ProgressPhase = "idle" | "preparing" | "rendering" | "downloading" | "complete" | "error";
type PreviewTab = "preview" | "photo";
type SupportedAnimatedSymbol = Extract<SymbolOption, "circle" | "cross" | "triangle">;

function normalizeSelectedPhotoSlotIndices(
  indices: number[],
  count: number,
  fallbackIndex: number | null,
) {
  const next = Array.from(
    new Set(indices.filter((index) => index >= 0 && index < count)),
  ).sort((left, right) => left - right);

  if (next.length > 0) {
    return next;
  }

  return [Math.max(0, Math.min(fallbackIndex ?? 0, count - 1))];
}

const INITIAL_ROWS = createDefaultRows(7, INITIAL_SYMBOL_COLUMN_COUNT);
const PREVIEW_DEBOUNCE_MS = 220;
const SYMBOL_COLUMN_MIN = 1;
const DENOMINATOR_MIN = 1;
const PHOTO_SCALE_STEP = 0.1;
const PHOTO_SCALE_MIN = 0.5;
const PHOTO_SCALE_MAX = 3;
const OVERLAY_SCALE_STEP = 0.1;
const OVERLAY_OFFSET_STEP = 24;

const SYMBOL_COLORS: Record<SymbolOption, string> = {
  "-": "var(--text-faint)",
  circle: "#2166F3",
  cross: "#E23D2E",
  triangle: "#F28C28",
  "?": "#9e00fe",
};

const HELP_TEXT = [
  "プレビュータブでは従来どおり画像プレビューとPNG ZIPを書き出します。",
  "写真タブでは 9:16 の透明キャンバス下部 1/3 に写真枠を配置します。",
  "図の数と記号数が同じ場合、アンカーは写真枠の中央に自動配置されます。",
  "図の数と記号数が違う場合は「アンカーを設定」を押して、プレビュー上を順番にクリックしてください。",
  "メモ欄の内容はアンカー下のラベルとして左から順に表示されます。",
  "MOV生成では 0_preview.png と各行の MOV をまとめた ZIP をブラウザ内で作成します。",
];

const SOUND_PATHS: Record<SupportedAnimatedSymbol, string> = {
  circle: "/nakamura_maru.m4a",
  cross: "/nakamura_batsu.m4a",
  triangle: "/nakamura_sankaku.m4a",
};

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
  const [photoCount, setPhotoCount] = useState(INITIAL_SYMBOL_COLUMN_COUNT);
  const [photoRowCount, setPhotoRowCount] = useState(PHOTO_ROW_COUNT_MIN);
  const [photoSlots, setPhotoSlots] = useState<PhotoSlotData[]>(
    () => createPhotoSlots(INITIAL_SYMBOL_COLUMN_COUNT),
  );
  const [photoAnchors, setPhotoAnchors] = useState<Array<Point | null>>(
    () => getAutomaticAnchors(INITIAL_SYMBOL_COLUMN_COUNT, INITIAL_SYMBOL_COLUMN_COUNT, PHOTO_ROW_COUNT_MIN),
  );
  const [photoSymbolScale, setPhotoSymbolScale] = useState(1);
  const [photoSymbolOffsetX, setPhotoSymbolOffsetX] = useState(0);
  const [photoSymbolOffsetY, setPhotoSymbolOffsetY] = useState(0);
  const [photoLabelScale, setPhotoLabelScale] = useState(1);
  const [photoLabelOffsetX, setPhotoLabelOffsetX] = useState(0);
  const [photoLabelOffsetY, setPhotoLabelOffsetY] = useState(0);
  const [isPhotoPanelCollapsed, setIsPhotoPanelCollapsed] = useState(false);
  const [activePhotoSlotIndex, setActivePhotoSlotIndex] = useState<number | null>(0);
  const [selectedPhotoSlotIndices, setSelectedPhotoSlotIndices] = useState<number[]>([0]);
  const [isAnchorPlacementMode, setIsAnchorPlacementMode] = useState(false);
  const [anchorPlacementIndex, setAnchorPlacementIndex] = useState(0);
  const [photoAssets, setPhotoAssets] = useState<PhotoRenderAssets | null>(null);

  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const previewPanelRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const photoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const pendingPhotoSlotIndexRef = useRef<number | null>(null);
  const symbolStripScrollFrameRef = useRef<number | null>(null);
  const symbolStripScrollLeftRef = useRef(0);
  const photoDragStateRef = useRef<{
    pointerId: number;
    slotIndex: number;
    startPoint: Point;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const ffmpegLoadPromiseRef = useRef<Promise<FFmpeg> | null>(null);
  const audioBufferCacheRef = useRef<Map<SupportedAnimatedSymbol, AudioBuffer> | null>(null);

  const previewCount = getPreviewCount(rows.length);
  const safePreviewIndex = clampPreviewIndex(previewIndex, rows.length);
  const photoNeedsManualAnchors = photoCount !== symbolColumnCount;

  useEffect(() => {
    if (safePreviewIndex !== previewIndex) {
      setPreviewIndex(safePreviewIndex);
    }
  }, [previewIndex, rows.length, safePreviewIndex]);

  useEffect(() => {
    let cancelled = false;

    loadPreviewAssets(photoSlots)
      .then((assets) => {
        if (!cancelled) {
          setPhotoAssets(assets);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setErrorMessage(error instanceof Error ? error.message : "写真アセットの読み込みに失敗しました。");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [photoSlots]);

  useEffect(() => {
    setPhotoSlots((current) => normalizePhotoSlots(current, photoCount));
    setPhotoRowCount((current) => clampPhotoRowCount(current, photoCount));
    setSelectedPhotoSlotIndices((current) =>
      normalizeSelectedPhotoSlotIndices(current, photoCount, 0),
    );
    setActivePhotoSlotIndex((current) => {
      if (photoCount <= 0) {
        return null;
      }
      if (current === null) {
        return 0;
      }
      return Math.min(current, photoCount - 1);
    });
  }, [photoCount]);

  const applySymbolStripScrollLeft = (scrollLeft: number) => {
    symbolStripScrollLeftRef.current = scrollLeft;

    if (symbolStripScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(symbolStripScrollFrameRef.current);
    }

    symbolStripScrollFrameRef.current = window.requestAnimationFrame(() => {
      tableRef.current?.style.setProperty("--symbol-strip-scroll-left", `${symbolStripScrollLeftRef.current}px`);
      symbolStripScrollFrameRef.current = null;
    });
  };

  useEffect(() => {
    applySymbolStripScrollLeft(0);
  }, [symbolColumnCount]);

  useEffect(() => {
    if (photoCount === symbolColumnCount) {
      setPhotoAnchors(getAutomaticAnchors(photoCount, symbolColumnCount, photoRowCount));
      setIsAnchorPlacementMode(false);
      setAnchorPlacementIndex(symbolColumnCount);
      return;
    }

    setPhotoAnchors((current) => normalizeAnchors(current, symbolColumnCount));
    setAnchorPlacementIndex((current) => Math.min(current, Math.max(0, symbolColumnCount - 1)));
  }, [photoCount, photoRowCount, symbolColumnCount]);

  const redrawPhotoCanvas = useEffectEvent(() => {
    if (!photoAssets) {
      return;
    }

    const canvas = photoCanvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    drawPhotoPreview(context, photoAssets, {
      photoCount,
      photoRowCount,
      photoSlots,
      symbolColumnCount,
      symbolColumnNotes,
      anchors: photoAnchors,
      symbolsToShow: rows[safePreviewIndex]?.symbols ?? [],
      symbolScale: photoSymbolScale,
      symbolOffsetX: photoSymbolOffsetX,
      symbolOffsetY: photoSymbolOffsetY,
      labelScale: photoLabelScale,
      labelOffsetX: photoLabelOffsetX,
      labelOffsetY: photoLabelOffsetY,
      renderSymbolGuides: true,
      renderAnchorNumbers: isAnchorPlacementMode,
      activeSlotIndex: activePhotoSlotIndex,
      activeSlotIndices: selectedPhotoSlotIndices,
      fillBackground: true,
    });
  });

  useEffect(() => {
    if (activePreviewTab !== "photo") {
      return;
    }

    redrawPhotoCanvas();
  }, [
    activePreviewTab,
    activePhotoSlotIndex,
    isAnchorPlacementMode,
    photoAnchors,
    photoAssets,
    photoCount,
    photoRowCount,
    photoLabelOffsetX,
    photoLabelOffsetY,
    photoLabelScale,
    photoSlots,
    rows,
    safePreviewIndex,
    photoSymbolOffsetX,
    photoSymbolOffsetY,
    photoSymbolScale,
    selectedPhotoSlotIndices,
    symbolColumnCount,
    symbolColumnNotes,
  ]);

  useEffect(() => {
    if (activePreviewTab !== "photo") {
      return;
    }

    redrawPhotoCanvas();
  }, [activePreviewTab]);

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
    const timeoutId = window.setTimeout(async () => {
      setIsPreviewLoading(true);
      setPreviewError(null);

      try {
        const blob = await renderClientPreviewBlob(deferredPreviewPayload, safePreviewIndex);

        const objectUrl = URL.createObjectURL(blob);
        setPreviewUrl((current) => {
          if (current) {
            URL.revokeObjectURL(current);
          }
          return objectUrl;
        });
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : "Preview generation failed.");
      } finally {
        setIsPreviewLoading(false);
      }
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
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
    if (event.key === "ArrowLeft" && activePreviewTab === "preview") {
      event.preventDefault();
      goToPreviousPreview();
    }

    if (event.key === "ArrowRight" && activePreviewTab === "preview") {
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

  const handleWindowPaste = useEffectEvent(async (event: ClipboardEvent) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const item = items.find((entry) => entry.type.startsWith("image/"));
    if (!item) {
      return;
    }

    event.preventDefault();
    const file = item.getAsFile();
    if (!file) {
      return;
    }

    await setPhotoSlotFromFile(activePhotoSlotIndex ?? 0, file);
  });

  useEffect(() => {
    if (activePreviewTab !== "photo") {
      return;
    }

    window.addEventListener("paste", handleWindowPaste);
    return () => {
      window.removeEventListener("paste", handleWindowPaste);
    };
  }, [activePreviewTab]);

  useEffect(() => {
    return () => {
      ffmpegRef.current?.terminate();
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
    const nextValue = Math.max(DENOMINATOR_MIN, Math.trunc(value));
    setDenominatorMode(nextValue);
    setRows((current) => {
      const nextRows: GeneratorRow[] = current.slice(0, nextValue).map((row, index) => ({
        ...row,
        numerator: index + 1,
        denominator: nextValue,
      }));

      while (nextRows.length < nextValue) {
        nextRows.push(createRow(nextRows.length + 1, nextRows.length + 1, nextValue, symbolColumnCount));
      }

      return nextRows;
    });
    setNextId((current) => Math.max(current, nextValue + 1));
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

  function updatePhotoCount(value: number) {
    const nextValue = clampPhotoCount(value);
    setPhotoCount(nextValue);
  }

  function updatePhotoRowCount(value: number) {
    setPhotoRowCount(clampPhotoRowCount(value, photoCount));
  }

  function setPhotoSelection(indices: number[]) {
    setSelectedPhotoSlotIndices(normalizeSelectedPhotoSlotIndices(indices, photoCount, activePhotoSlotIndex));
  }

  function selectActivePhotoSlot(index: number) {
    setActivePhotoSlotIndex(index);
    setPhotoSelection([index]);
  }

  function selectAllPhotoSlots() {
    setSelectedPhotoSlotIndices(Array.from({ length: photoCount }, (_, index) => index));
    setActivePhotoSlotIndex((current) => current ?? 0);
  }

  function resetToSinglePhotoSelection() {
    if (activePhotoSlotIndex === null) {
      return;
    }

    setPhotoSelection([activePhotoSlotIndex]);
  }

  async function setPhotoSlotFromFile(index: number, file: Blob) {
    const dataUrl = await fileToDataUrl(file);
    setPhotoSlots((current) => {
      const next = normalizePhotoSlots(current, photoCount);
      if (!next[index]) {
        return next;
      }

      next[index] = {
        ...next[index],
        dataUrl,
        fileName: file instanceof File ? file.name : next[index].fileName,
        scale: 1,
        offsetX: 0,
        offsetY: 0,
      };
      return next;
    });
    selectActivePhotoSlot(index);
  }

  async function setPhotoSlotsFromFiles(startIndex: number, files: Blob[]) {
    const items = await Promise.all(files.map(async (file) => ({
      file,
      dataUrl: await fileToDataUrl(file),
    })));

    setPhotoSlots((current) => {
      const next = normalizePhotoSlots(current, photoCount);

      items.forEach(({ file, dataUrl }, offset) => {
        const slotIndex = startIndex + offset;
        if (!next[slotIndex]) {
          return;
        }

        next[slotIndex] = {
          ...next[slotIndex],
          dataUrl,
          fileName: file instanceof File ? file.name : next[slotIndex].fileName,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        };
      });

      return next;
    });

    const nextActiveIndex = Math.min(startIndex + items.length - 1, photoCount - 1);
    if (nextActiveIndex >= 0) {
      setActivePhotoSlotIndex(nextActiveIndex);
      setPhotoSelection(Array.from({ length: items.length }, (_, offset) => startIndex + offset));
    } else {
      setActivePhotoSlotIndex(null);
    }
  }

  function clampPhotoScale(value: number) {
    return Math.max(PHOTO_SCALE_MIN, Math.min(PHOTO_SCALE_MAX, value));
  }

  function updatePhotoSlotTransform(
    index: number,
    updates: Partial<Pick<PhotoSlotData, "scale" | "offsetX" | "offsetY">>,
  ) {
    setPhotoSlots((current) =>
      current.map((slot, slotIndex) => {
        if (slotIndex !== index) {
          return slot;
        }

        return {
          ...slot,
          scale: clampPhotoScale(updates.scale ?? slot.scale),
          offsetX: updates.offsetX ?? slot.offsetX,
          offsetY: updates.offsetY ?? slot.offsetY,
        };
      }),
    );
  }

  function stepSelectedPhotoScale(delta: number) {
    const targets = selectedPhotoSlotIndices.filter((index) => photoSlots[index]?.dataUrl);
    if (targets.length === 0) {
      return;
    }

    setPhotoSlots((current) =>
      current.map((slot, slotIndex) => {
        if (!targets.includes(slotIndex) || !slot.dataUrl) {
          return slot;
        }

        return {
          ...slot,
          scale: clampPhotoScale(slot.scale + delta),
        };
      }),
    );
  }

  function resetSelectedPhotoTransform() {
    const targets = selectedPhotoSlotIndices.filter((index) => photoSlots[index]?.dataUrl);
    if (targets.length === 0) {
      return;
    }

    setPhotoSlots((current) =>
      current.map((slot, slotIndex) => {
        if (!targets.includes(slotIndex) || !slot.dataUrl) {
          return slot;
        }

        return {
          ...slot,
          scale: 1,
          offsetX: 0,
          offsetY: 0,
        };
      }),
    );
  }

  function clampOverlayScale(value: number) {
    return Math.max(0.3, Math.min(3, value));
  }

  function stepPhotoSymbolScale(delta: number) {
    setPhotoSymbolScale((current) => clampOverlayScale(current + delta));
  }

  function movePhotoSymbols(deltaX: number, deltaY: number) {
    setPhotoSymbolOffsetX((current) => current + deltaX);
    setPhotoSymbolOffsetY((current) => current + deltaY);
  }

  function resetPhotoSymbols() {
    setPhotoSymbolScale(1);
    setPhotoSymbolOffsetX(0);
    setPhotoSymbolOffsetY(0);
  }

  function stepPhotoLabelScale(delta: number) {
    setPhotoLabelScale((current) => clampOverlayScale(current + delta));
  }

  function movePhotoLabels(deltaX: number, deltaY: number) {
    setPhotoLabelOffsetX((current) => current + deltaX);
    setPhotoLabelOffsetY((current) => current + deltaY);
  }

  function resetPhotoLabels() {
    setPhotoLabelScale(1);
    setPhotoLabelOffsetX(0);
    setPhotoLabelOffsetY(0);
  }

  function openPhotoPicker(index: number) {
    pendingPhotoSlotIndexRef.current = index;
    selectActivePhotoSlot(index);
    photoInputRef.current?.click();
  }

  function startAnchorPlacement() {
    setIsAnchorPlacementMode(true);
    setAnchorPlacementIndex(0);
    setPhotoAnchors(createAnchorArray(symbolColumnCount));
  }

  function clearSelectedPhoto() {
    const targets = selectedPhotoSlotIndices.filter((index) => photoSlots[index]);
    if (targets.length === 0) {
      return;
    }

    setPhotoSlots((current) =>
      current.map((slot, index) =>
        targets.includes(index)
          ? { ...slot, dataUrl: null, fileName: null, scale: 1, offsetX: 0, offsetY: 0 }
          : slot,
      ),
    );
  }

  function handlePhotoInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const index = pendingPhotoSlotIndexRef.current ?? activePhotoSlotIndex ?? 0;
    if (files.length === 1) {
      void setPhotoSlotFromFile(index, files[0]);
    } else if (files.length > 1) {
      void setPhotoSlotsFromFiles(index, files);
    }

    event.target.value = "";
  }

  async function handlePhotoDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = Array.from(event.dataTransfer.files).find((entry) => entry.type.startsWith("image/"));
    if (!file) {
      return;
    }

    const point = mapCanvasPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    const slotIndex = getPhotoSlotIndexAtPoint(point.x, point.y);
    if (slotIndex === null) {
      return;
    }

    await setPhotoSlotFromFile(slotIndex, file);
  }

  function handlePhotoCanvasClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    if (photoDragStateRef.current) {
      return;
    }

    const point = mapCanvasPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    if (isAnchorPlacementMode) {
      setPhotoAnchors((current) => {
        const next = normalizeAnchors(current, symbolColumnCount);
        next[anchorPlacementIndex] = point;
        return next;
      });

      if (anchorPlacementIndex >= symbolColumnCount - 1) {
        setIsAnchorPlacementMode(false);
        setAnchorPlacementIndex(symbolColumnCount);
      } else {
        setAnchorPlacementIndex((current) => current + 1);
      }
      return;
    }

    const slotIndex = getPhotoSlotIndexAtPoint(point.x, point.y);
    if (slotIndex !== null) {
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        setActivePhotoSlotIndex(slotIndex);
      setSelectedPhotoSlotIndices((current) => {
        const next = normalizeSelectedPhotoSlotIndices(current, photoCount, activePhotoSlotIndex);
        if (next.includes(slotIndex)) {
          const filtered = next.filter((index) => index !== slotIndex);
          return filtered.length > 0 ? filtered : [slotIndex];
        }

        return [...next, slotIndex];
      });
      } else {
        selectActivePhotoSlot(slotIndex);
      }
      if (!photoSlots[slotIndex]?.dataUrl) {
        openPhotoPicker(slotIndex);
      }
    }
  }

  function handlePhotoCanvasDoubleClick(event: ReactMouseEvent<HTMLCanvasElement>) {
    const point = mapCanvasPointFromClient(event.clientX, event.clientY);
    if (!point || isAnchorPlacementMode) {
      return;
    }

    const slotIndex = getPhotoSlotIndexAtPoint(point.x, point.y);
    if (slotIndex !== null) {
      openPhotoPicker(slotIndex);
    }
  }

  function handlePhotoCanvasPointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (isAnchorPlacementMode || event.button !== 0) {
      return;
    }

    const point = mapCanvasPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    const slotIndex = getPhotoSlotIndexAtPoint(point.x, point.y);
    if (slotIndex === null) {
      return;
    }

    const slot = photoSlots[slotIndex];
    selectActivePhotoSlot(slotIndex);
    if (!slot?.dataUrl) {
      return;
    }

    photoDragStateRef.current = {
      pointerId: event.pointerId,
      slotIndex,
      startPoint: point,
      startOffsetX: slot.offsetX,
      startOffsetY: slot.offsetY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePhotoCanvasPointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const dragState = photoDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const point = mapCanvasPointFromClient(event.clientX, event.clientY);
    if (!point) {
      return;
    }

    updatePhotoSlotTransform(dragState.slotIndex, {
      offsetX: dragState.startOffsetX + (point.x - dragState.startPoint.x),
      offsetY: dragState.startOffsetY + (point.y - dragState.startPoint.y),
    });
  }

  function handlePhotoCanvasPointerEnd(event: ReactPointerEvent<HTMLCanvasElement>) {
    const dragState = photoDragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    photoDragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  async function generateImages() {
    setErrorMessage(null);
    setStatusMessage(null);
    setIsGenerating(true);
    setProgressPhase("preparing");
    setProgressValue(8);

    let renderingTimer: number | null = null;

    try {
      setProgressPhase("rendering");
      renderingTimer = window.setInterval(() => {
        setProgressValue((current) => (current >= 72 ? current : current + 4));
      }, 180);

      const generation = await renderClientZipBlob(previewPayload);

      if (renderingTimer) {
        window.clearInterval(renderingTimer);
        renderingTimer = null;
      }

      setProgressPhase("downloading");
      setProgressValue(98);
      downloadBlob(generation.blob, generation.fileName);

      setProgressPhase("complete");
      setProgressValue(100);
      setStatusMessage(`${generation.fileName} downloaded.`);
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

  async function generatePhotoVideos() {
    if (!photoAssets) {
      setErrorMessage("写真アセットがまだ準備できていません。");
      return;
    }

    if (photoNeedsManualAnchors && photoAnchors.some((anchor) => anchor === null)) {
      setErrorMessage("Please set all anchors before exporting.");
      return;
    }

    setErrorMessage(null);
    setStatusMessage(null);
    setIsGenerating(true);
    setProgressPhase("preparing");
    setProgressValue(6);

    try {
      const ffmpeg = await ensureFfmpegLoaded();
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = PHOTO_CANVAS_WIDTH;
      exportCanvas.height = PHOTO_CANVAS_HEIGHT;
      const exportContext = exportCanvas.getContext("2d");
      if (!exportContext) {
        throw new Error("Canvas context is unavailable.");
      }

      const zip = new JSZip();

      drawPhotoPreview(exportContext, photoAssets, {
        photoCount,
        photoRowCount,
        photoSlots,
        symbolColumnCount,
        symbolColumnNotes,
        anchors: photoAnchors,
        symbolScale: photoSymbolScale,
        symbolOffsetX: photoSymbolOffsetX,
        symbolOffsetY: photoSymbolOffsetY,
        labelScale: photoLabelScale,
        labelOffsetX: photoLabelOffsetX,
        labelOffsetY: photoLabelOffsetY,
        showAnchors: false,
        fillBackground: false,
      });
      const previewBlob = await canvasToBlob(exportCanvas, "image/png");
      zip.file("0_preview.png", previewBlob);

      setProgressPhase("rendering");
      setProgressValue(18);

      for (const [rowIndex, row] of rows.entries()) {
        const rowNumber = rowIndex + 1;
        const baseSymbolSequence = buildFrameSymbolSequence(row.symbols, symbolColumnCount);
        const supportedSymbols = getVisibleAnimatedSymbols(baseSymbolSequence);
        const timeline = await buildAudioTimeline(supportedSymbols);
        const frameCount = frameCountForDuration(timeline.totalDurationSeconds);
        const audioBlob = audioBufferToWavBlob(timeline.audioBuffer);
        const dir = `/job-${Date.now()}-${rowNumber}`;

        await ensureDirectory(ffmpeg, dir);

        for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
          const elapsedSeconds = frameIndex / PHOTO_EXPORT_FPS;
          const visibleCount = timeline.symbolStarts.filter(
            (symbolStart) => symbolStart <= elapsedSeconds,
          ).length;
          const partialSymbols = limitAnimatedSymbols(baseSymbolSequence, visibleCount);
          drawPhotoPreview(exportContext, photoAssets, {
            photoCount,
            photoRowCount,
            photoSlots,
            symbolColumnCount,
            symbolColumnNotes,
            anchors: photoAnchors,
            symbolScale: photoSymbolScale,
            symbolOffsetX: photoSymbolOffsetX,
            symbolOffsetY: photoSymbolOffsetY,
            labelScale: photoLabelScale,
            labelOffsetX: photoLabelOffsetX,
            labelOffsetY: photoLabelOffsetY,
            symbolsToShow: partialSymbols,
            showAnchors: false,
            fillBackground: false,
          });
          const frameBlob = await canvasToBlob(exportCanvas, "image/png");
          const bytes = new Uint8Array(await frameBlob.arrayBuffer());
          await ffmpeg.writeFile(`${dir}/frame-${String(frameIndex).padStart(4, "0")}.png`, bytes);
        }

        await ffmpeg.writeFile(`${dir}/audio.wav`, new Uint8Array(await audioBlob.arrayBuffer()));

        const outputFile = `${dir}/output.mov`;
        const exitCode = await ffmpeg.exec([
          "-framerate",
          String(PHOTO_EXPORT_FPS),
          "-i",
          `${dir}/frame-%04d.png`,
          "-i",
          `${dir}/audio.wav`,
          "-c:v",
          "png",
          "-pix_fmt",
          "rgba",
          "-c:a",
          "aac",
          "-shortest",
          outputFile,
        ]);

        if (exitCode !== 0) {
          throw new Error(`MOV generation failed for row ${rowNumber}.`);
        }

        const movBytes = await ffmpeg.readFile(outputFile);
        zip.file(buildMovFileName(rowNumber, row.text), new Uint8Array(movBytes as Uint8Array));
        await cleanupDirectory(ffmpeg, dir);

        setProgressValue(Math.min(92, Math.round(18 + ((rowIndex + 1) / rows.length) * 70)));
      }

      setProgressPhase("downloading");
      setProgressValue(96);
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const zipName = getZipName(title, "all");
      downloadBlob(zipBlob, zipName);
      setProgressPhase("complete");
      setProgressValue(100);
      setStatusMessage(`${zipName} downloaded.`);
    } catch (error) {
      setProgressPhase("error");
      setProgressValue(100);
      setErrorMessage(error instanceof Error ? error.message : "MOV generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleGenerate() {
    if (activePreviewTab === "photo") {
      await generatePhotoVideos();
      return;
    }

    await generateImages();
  }

  async function ensureFfmpegLoaded() {
    if (ffmpegRef.current?.loaded) {
      return ffmpegRef.current;
    }

    if (ffmpegLoadPromiseRef.current) {
      return ffmpegLoadPromiseRef.current;
    }

    ffmpegLoadPromiseRef.current = (async () => {
      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const instance = new FFmpeg();
      await instance.load({
        coreURL: "/ffmpeg/ffmpeg-core.js",
        wasmURL: "/ffmpeg/ffmpeg-core.wasm",
      });
      ffmpegRef.current = instance;
      return instance;
    })();

    try {
      return await ffmpegLoadPromiseRef.current;
    } finally {
      ffmpegLoadPromiseRef.current = null;
    }
  }

  async function buildAudioTimeline(symbols: SupportedAnimatedSymbol[]) {
    const audioBuffers = await loadSymbolAudioBuffers();
    const symbolStarts: number[] = [];
    let currentTime = PHOTO_SYMBOL_MARGIN_SECONDS;

    for (const symbol of symbols) {
      symbolStarts.push(currentTime);
      const audioBuffer = audioBuffers.get(symbol);
      currentTime += (audioBuffer?.duration ?? 0) + PHOTO_SYMBOL_MARGIN_SECONDS;
    }

    const totalDurationSeconds = Math.max(currentTime, PHOTO_SYMBOL_MARGIN_SECONDS * 2);
    const sampleRate = 44100;
    const offlineContext = new OfflineAudioContext(
      2,
      Math.ceil(totalDurationSeconds * sampleRate),
      sampleRate,
    );

    symbols.forEach((symbol, index) => {
      const source = offlineContext.createBufferSource();
      source.buffer = audioBuffers.get(symbol) ?? null;
      if (!source.buffer) {
        return;
      }

      source.connect(offlineContext.destination);
      source.start(symbolStarts[index] ?? PHOTO_SYMBOL_MARGIN_SECONDS);
    });

    return {
      symbolStarts,
      totalDurationSeconds,
      audioBuffer: await offlineContext.startRendering(),
    };
  }

  async function loadSymbolAudioBuffers() {
    if (audioBufferCacheRef.current) {
      return audioBufferCacheRef.current;
    }

    const AudioContextClass = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error("AudioContext is unavailable in this browser.");
    }

    const context = new AudioContextClass();
    const entries = await Promise.all(
      (Object.keys(SOUND_PATHS) as SupportedAnimatedSymbol[]).map(async (symbol) => {
        const response = await fetch(SOUND_PATHS[symbol]);
        if (!response.ok) {
          throw new Error(`Failed to load sound: ${symbol}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));
        return [symbol, audioBuffer] as const;
      }),
    );
    await context.close();

    const cache = new Map<SupportedAnimatedSymbol, AudioBuffer>(entries);
    audioBufferCacheRef.current = cache;
    return cache;
  }

  function mapCanvasPointFromClient(clientX: number, clientY: number) {
    const canvas = photoCanvasRef.current;
    if (!canvas) {
      return null;
    }

    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }

    return {
      x: ((clientX - rect.left) / rect.width) * PHOTO_CANVAS_WIDTH,
      y: ((clientY - rect.top) / rect.height) * PHOTO_CANVAS_HEIGHT,
    };
  }

  function getPhotoSlotIndexAtPoint(x: number, y: number) {
    const layouts = computePhotoSlotLayouts(photoCount, photoRowCount);
    const match = layouts.find(
      (layout) =>
        x >= layout.x &&
        x <= layout.x + layout.width &&
        y >= layout.y &&
        y <= layout.y + layout.height,
    );
    return match?.index ?? null;
  }

  const addRowColspan = 7;
  const selectedPhotoCount = selectedPhotoSlotIndices.length;
  const selectedPhotoName =
    selectedPhotoCount === 1 && activePhotoSlotIndex !== null
      ? photoSlots[activePhotoSlotIndex]?.fileName ?? null
      : null;
  const selectedPhotoScale =
    selectedPhotoCount === 1 && activePhotoSlotIndex !== null ? photoSlots[activePhotoSlotIndex]?.scale ?? 1 : 1;
  const hasSelectedPhotoData = selectedPhotoSlotIndices.some((index) => photoSlots[index]?.dataUrl);
  const photoSelectionLabel = selectedPhotoName ? `${Math.round(selectedPhotoScale * 100)}%` : "Controls";
  const isPhotoDragging = photoDragStateRef.current !== null;

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
            <span className={styles.wordmark}>複数アキネーター生成</span>
            <div className={styles.divider} />
            <div className={styles.titleField}>
              <input
                className={styles.titleInput}
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="タイトル"
              />
            </div>
            <div className={styles.spacer} />
            <button
              ref={helpButtonRef}
              type="button"
              className={styles.iconButton}
              title="使い方"
              aria-label="使い方"
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
              onClick={() => void handleGenerate()}
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
                  {activePreviewTab === "photo" ? "MOV生成" : "ZIP生成"}
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
              <table ref={tableRef} className={styles.table}>
                <colgroup>
                  <col style={{ width: "36px" }} />
                  <col style={{ width: "180px" }} />
                  <col />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "80px" }} />
                  <col style={{ width: "32px" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th className={styles.indexColumn} style={{ textAlign: "center" }}>
                      #
                    </th>
                    <th className={styles.textColumn}>本文</th>
                    <th className={styles.symbolAreaColumn}>
                      <div className={styles.symbolAreaHeader}>
                        <div className={styles.headerStepper}>
                          <span>記号</span>
                          <NumberStepper
                            value={symbolColumnCount}
                            min={SYMBOL_COLUMN_MIN}
                            onChange={updateSymbolColumnCount}
                            ariaLabel="記号"
                            inputClassName={styles.countInput}
                          />
                        </div>
                        <SymbolStrip
                          className={styles.symbolStripViewport}
                          onScroll={(event) => {
                            applySymbolStripScrollLeft(event.currentTarget.scrollLeft);
                          }}
                        >
                          <div className={styles.symbolStripGrid}>
                            {symbolColumnNotes.map((note, index) => (
                              <div key={index} className={styles.symbolStripCell}>
                                <input
                                  className={styles.symbolNoteInput}
                                  type="text"
                                  value={note}
                                  onChange={(event) => updateSymbolColumnNote(index, event.target.value)}
                                  placeholder="メモ"
                                />
                              </div>
                            ))}
                          </div>
                        </SymbolStrip>
                      </div>
                    </th>
                    <th className={styles.valueColumn} style={{ textAlign: "center" }}>
                      記号
                    </th>
                    <th className={styles.valueColumn} style={{ textAlign: "center" }}>
                      分子
                    </th>
                    <th className={styles.valueColumn} style={{ textAlign: "center" }}>
                      <div className={styles.headerStepper}>
                        <span>分母</span>
                        <NumberStepper
                          value={denominatorMode}
                          min={DENOMINATOR_MIN}
                          onChange={updateDenominatorMode}
                          ariaLabel="分母"
                          inputClassName={styles.countInput}
                        />
                      </div>
                    </th>
                    <th className={styles.actionColumn} />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={row.id} className={styles.dataRow} data-active={safePreviewIndex === rowIndex}>
                      <td className={styles.indexColumn} style={{ textAlign: "center" }}>
                        <button
                          type="button"
                          className={styles.indexButton}
                          onClick={() => setPreviewIndex(rowIndex)}
                        >
                          {rowIndex + 1}
                        </button>
                      </td>
                      <td className={styles.textColumn}>
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
                      <td className={styles.symbolAreaColumn}>
                        <SymbolStrip
                          className={styles.symbolStripClipped}
                          mirrorScroll
                        >
                          <div className={styles.symbolStripGrid}>
                            {row.symbols.map((symbol, symbolIndex) => (
                              <div key={`${row.id}-${symbolIndex}`} className={styles.symbolStripCell}>
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
                              </div>
                            ))}
                          </div>
                        </SymbolStrip>
                      </td>
                      <td className={styles.valueColumn}>
                        <NumberStepper
                          value={row.fontSize}
                          min={1}
                          onChange={(value) => updateRowFontSize(row.id, String(value))}
                          ariaLabel={`行 ${rowIndex + 1} の文字サイズ`}
                          size="compact"
                          inputClassName={styles.numericStepperInputCompact}
                        />
                      </td>
                      <td className={styles.valueColumn}>
                        <NumberStepper
                          value={row.numerator}
                          min={1}
                          onChange={(value) => updateRowNumber(row.id, "numerator", String(value))}
                          ariaLabel={`行 ${rowIndex + 1} の分子`}
                          size="compact"
                          inputClassName={styles.numericStepperInputCompact}
                        />
                      </td>
                      <td className={styles.valueColumn}>
                        <input className={styles.numberInput} type="number" value={row.denominator} readOnly />
                      </td>
                      <td className={styles.actionColumn} style={{ textAlign: "center" }}>
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
            data-photo-tab={activePreviewTab === "photo"}
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
              <>
                <div
                  className={styles.photoPane}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => void handlePhotoDrop(event)}
                >
                  <div className={styles.photoControlRail}>
                    <div className={styles.photoFloatingPanel} data-collapsed={isPhotoPanelCollapsed}>
                      <div className={styles.photoFloatingHeader}>
                        <span className={styles.photoLabel}>{photoSelectionLabel}</span>
                        <button
                          type="button"
                          className={styles.ghostButton}
                          onClick={() => setIsPhotoPanelCollapsed((current) => !current)}
                          aria-expanded={!isPhotoPanelCollapsed}
                        >
                          {isPhotoPanelCollapsed ? "開く" : "閉じる"}
                        </button>
                      </div>
                      {!isPhotoPanelCollapsed && (
                        <>
                          <div className={styles.photoToolbarGroup}>
                            <span className={styles.photoLabel}>写真数</span>
                            <NumberStepper
                              value={photoCount}
                              min={PHOTO_COUNT_MIN}
                              onChange={updatePhotoCount}
                              ariaLabel="写真数"
                              size="compact"
                              inputClassName={styles.countInput}
                            />
                          </div>
                          <div className={styles.photoToolbarGroup}>
                            <span className={styles.photoLabel}>行数</span>
                            <NumberStepper
                              value={photoRowCount}
                              min={PHOTO_ROW_COUNT_MIN}
                              onChange={updatePhotoRowCount}
                              ariaLabel="行数"
                              size="compact"
                              inputClassName={styles.countInput}
                            />
                          </div>
                          <div className={styles.photoToolbarGroup}>
                            <button type="button" className={styles.ghostButton} onClick={selectAllPhotoSlots}>
                              すべて選択
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={resetToSinglePhotoSelection}
                              disabled={selectedPhotoCount <= 1}
                            >
                              1枚選択に戻す
                            </button>
                          </div>
                          <div className={styles.photoToolbarGroup}>
                            {photoNeedsManualAnchors && (
                              <button type="button" className={styles.ghostButton} onClick={startAnchorPlacement}>
                                アンカーを設定
                              </button>
                            )}
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => openPhotoPicker(activePhotoSlotIndex ?? 0)}
                            >
                              画像を選択
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={clearSelectedPhoto}
                              disabled={selectedPhotoCount === 0}
                            >
                              クリア
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => stepSelectedPhotoScale(-PHOTO_SCALE_STEP)}
                              disabled={!hasSelectedPhotoData}
                            >
                              縮小
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => stepSelectedPhotoScale(PHOTO_SCALE_STEP)}
                              disabled={!hasSelectedPhotoData}
                            >
                              拡大
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={resetSelectedPhotoTransform}
                              disabled={!hasSelectedPhotoData}
                            >
                              位置をリセット
                            </button>
                          </div>
                          <div className={styles.photoToolbarGroup}>
                            <span className={styles.photoLabel}>Marks</span>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => stepPhotoSymbolScale(-OVERLAY_SCALE_STEP)}
                            >
                              -
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => stepPhotoSymbolScale(OVERLAY_SCALE_STEP)}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoSymbols(-OVERLAY_OFFSET_STEP, 0)}
                            >
                              左
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoSymbols(OVERLAY_OFFSET_STEP, 0)}
                            >
                              右
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoSymbols(0, -OVERLAY_OFFSET_STEP)}
                            >
                              上
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoSymbols(0, OVERLAY_OFFSET_STEP)}
                            >
                              下
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={resetPhotoSymbols}
                            >
                              0
                            </button>
                          </div>
                          <div className={styles.photoToolbarGroup}>
                            <span className={styles.photoLabel}>Labels</span>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => stepPhotoLabelScale(-OVERLAY_SCALE_STEP)}
                            >
                              -
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => stepPhotoLabelScale(OVERLAY_SCALE_STEP)}
                            >
                              +
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoLabels(-OVERLAY_OFFSET_STEP, 0)}
                            >
                              左
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoLabels(OVERLAY_OFFSET_STEP, 0)}
                            >
                              右
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoLabels(0, -OVERLAY_OFFSET_STEP)}
                            >
                              上
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={() => movePhotoLabels(0, OVERLAY_OFFSET_STEP)}
                            >
                              下
                            </button>
                            <button
                              type="button"
                              className={styles.ghostButton}
                              onClick={resetPhotoLabels}
                            >
                              0
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <div className={styles.photoCanvasShell}>
                    <canvas
                      ref={photoCanvasRef}
                      className={styles.photoCanvas}
                      data-dragging={isPhotoDragging}
                      width={PHOTO_CANVAS_WIDTH}
                      height={PHOTO_CANVAS_HEIGHT}
                      style={{ aspectRatio: String(PHOTO_CANVAS_ASPECT_RATIO) }}
                      onClick={handlePhotoCanvasClick}
                      onDoubleClick={handlePhotoCanvasDoubleClick}
                      onPointerDown={handlePhotoCanvasPointerDown}
                      onPointerMove={handlePhotoCanvasPointerMove}
                      onPointerUp={handlePhotoCanvasPointerEnd}
                      onPointerCancel={handlePhotoCanvasPointerEnd}
                    />
                  </div>
                </div>
                <input
                  ref={photoInputRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handlePhotoInputChange}
                />
              </>
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
                <p className={styles.modalEyebrow}>How To</p>
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
              {HELP_TEXT.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </main>
  );
}

type NumberStepperProps = {
  value: number;
  onChange: (value: number) => void;
  ariaLabel: string;
  min?: number;
  max?: number;
  step?: number;
  size?: "regular" | "compact";
  inputClassName?: string;
};

function NumberStepper({
  value,
  onChange,
  ariaLabel,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  size = "regular",
  inputClassName,
}: NumberStepperProps) {
  const [draft, setDraft] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);
  const displayValue = isFocused ? draft : String(value);

  function clamp(nextValue: number) {
    return Math.max(min, Math.min(max, Math.trunc(nextValue)));
  }

  function commit(rawValue: string) {
    setDraft(rawValue);
    if (rawValue.trim().length === 0) {
      return;
    }

    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      onChange(clamp(parsed));
    }
  }

  function handleBlur() {
    setIsFocused(false);
    if (draft.trim().length === 0) {
      setDraft(String(value));
      return;
    }

    const parsed = Number(draft);
    if (Number.isFinite(parsed)) {
      onChange(clamp(parsed));
      return;
    }

    setDraft(String(value));
  }

  function stepBy(delta: number) {
    onChange(clamp(value + delta));
  }

  return (
    <span className={styles.numericStepper} data-size={size}>
      <button
        type="button"
        className={size === "compact" ? styles.numericStepperButtonCompact : styles.numericStepperButton}
        onClick={() => stepBy(-step)}
        aria-label={`${ariaLabel}を減らす`}
      >
        -
      </button>
      <input
        className={inputClassName ?? styles.numericStepperInput}
        type="number"
        inputMode="numeric"
        value={displayValue}
        onFocus={() => {
          setDraft(String(value));
          setIsFocused(true);
        }}
        onChange={(event) => commit(event.target.value)}
        onBlur={handleBlur}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        className={size === "compact" ? styles.numericStepperButtonCompact : styles.numericStepperButton}
        onClick={() => stepBy(step)}
        aria-label={`${ariaLabel}を増やす`}
      >
        +
      </button>
    </span>
  );
}

type SymbolStripProps = {
  children: ReactNode;
  className?: string;
  mirrorScroll?: boolean;
  onScroll?: (event: UIEvent<HTMLDivElement>) => void;
};

function SymbolStrip({ children, className, mirrorScroll = false, onScroll }: SymbolStripProps) {
  return (
    <div className={className} onScroll={onScroll}>
      <div className={mirrorScroll ? styles.symbolStripTrackMirror : styles.symbolStripTrack}>
        {children}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, fileName: string) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(objectUrl);
}

function limitAnimatedSymbols(symbols: SymbolOption[], visibleSupportedCount: number) {
  const next: SymbolOption[] = [];
  let supportedSeen = 0;

  for (const symbol of symbols) {
    if (symbol === "circle" || symbol === "cross" || symbol === "triangle") {
      if (supportedSeen < visibleSupportedCount) {
        next.push(symbol);
      } else {
        next.push("-");
      }
      supportedSeen += 1;
      continue;
    }

    next.push("-");
  }

  return next;
}

async function ensureDirectory(ffmpeg: FFmpeg, dir: string) {
  try {
    await ffmpeg.createDir(dir);
  } catch {
    // Reuse existing job directory names if needed.
  }
}

async function cleanupDirectory(ffmpeg: FFmpeg, dir: string) {
  try {
    const entries = await ffmpeg.listDir(dir);
    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") {
        continue;
      }

      const filePath = `${dir}/${entry.name}`;
      if (entry.isDir) {
        await cleanupDirectory(ffmpeg, filePath);
      } else {
        await ffmpeg.deleteFile(filePath);
      }
    }

    await ffmpeg.deleteDir(dir);
  } catch {
    // Best-effort cleanup only.
  }
}

function audioBufferToWavBlob(audioBuffer: AudioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const sampleCount = audioBuffer.length;
  const interleaved = new Float32Array(sampleCount * channelCount);

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      interleaved[sampleIndex * channelCount + channelIndex] =
        audioBuffer.getChannelData(channelIndex)[sampleIndex] ?? 0;
    }
  }

  const buffer = new ArrayBuffer(44 + interleaved.length * 2);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + interleaved.length * 2, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, audioBuffer.sampleRate, true);
  view.setUint32(28, audioBuffer.sampleRate * channelCount * 2, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, interleaved.length * 2, true);

  let offset = 44;
  for (let index = 0; index < interleaved.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, interleaved[index] ?? 0));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}





