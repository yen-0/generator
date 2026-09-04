"use client";

import { sanitizeFileName, type SymbolOption } from "./generator-shared";

export const PHOTO_CANVAS_WIDTH = 1080;
export const PHOTO_CANVAS_HEIGHT = 1920;
export const PHOTO_CANVAS_ASPECT_RATIO = PHOTO_CANVAS_WIDTH / PHOTO_CANVAS_HEIGHT;
export const PHOTO_COUNT_MIN = 1;
export const PHOTO_ROW_COUNT_MIN = 1;
export const PHOTO_EXPORT_FPS = 30;
export const PHOTO_SYMBOL_MARGIN_SECONDS = 0.08;

const PHOTO_AREA_RATIO = 1 / 3;
const SLOT_OUTER_PADDING_X = 12;
const SLOT_OUTER_PADDING_Y = 12;
const SLOT_GAP = 6;
const SLOT_ROW_GAP = 4;
const SLOT_BORDER_WIDTH = 4;
const ANCHOR_RADIUS = 18;
const LABEL_BOX_HEIGHT = 88;
const LABEL_BOX_PADDING_X = 24;
const LABEL_FONT_SIZE = 42;
const LABEL_FONT_FAMILY = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';

type SupportedAnimatedSymbol = Extract<SymbolOption, "circle" | "cross" | "triangle">;

export type PhotoSlotData = {
  id: number;
  fileName: string | null;
  dataUrl: string | null;
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type Point = {
  x: number;
  y: number;
};

export type PhotoSlotLayout = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type DrawRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PhotoRenderAssets = {
  slotImages: Array<HTMLCanvasElement | null>;
  symbolImages: Partial<Record<SupportedAnimatedSymbol, HTMLImageElement>>;
};

export type PhotoRenderConfig = {
  photoCount: number;
  photoRowCount: number;
  photoSlots: PhotoSlotData[];
  symbolColumnCount: number;
  symbolColumnNotes: string[];
  anchors: Array<Point | null>;
  symbolScale?: number;
  symbolOffsetX?: number;
  symbolOffsetY?: number;
  labelScale?: number;
  labelOffsetX?: number;
  labelOffsetY?: number;
  renderSymbolGuides?: boolean;
  symbolsToShow?: SymbolOption[];
  renderAnchorNumbers?: boolean;
  showAnchors?: boolean;
  activeSlotIndex?: number | null;
  activeSlotIndices?: number[];
  fillBackground?: boolean;
};

const LABEL_TEXT_COLORS = [
  "#b62025",
  "#163d72",
  "#d56a00",
  "#6e3a9b",
  "#cc4f8c",
  "#0c7f67",
];

const EMPTY_SLOT_FILL = "rgba(255,255,255,0.28)";
const PLACEHOLDER_BORDER = "rgba(39, 55, 76, 0.3)";
const PLACEHOLDER_ACTIVE_BORDER = "#2c6e88";
const PLACEHOLDER_TEXT = "#425569";
const ANCHOR_FILL = "#11243b";
const ANCHOR_STROKE = "#ffffff";
const LABEL_BACKGROUND = "#e7d98b";
const LABEL_BORDER = "rgba(64, 50, 10, 0.22)";

export function clampPhotoCount(value: number) {
  return Math.max(PHOTO_COUNT_MIN, Math.trunc(value || PHOTO_COUNT_MIN));
}

export function clampPhotoRowCount(value: number, photoCount: number) {
  void photoCount;
  return Math.max(PHOTO_ROW_COUNT_MIN, Math.trunc(value || PHOTO_ROW_COUNT_MIN));
}

export function createPhotoSlots(count: number): PhotoSlotData[] {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    fileName: null,
    dataUrl: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  }));
}

export function normalizePhotoSlots(current: PhotoSlotData[], count: number): PhotoSlotData[] {
  const next = current.slice(0, count);
  while (next.length < count) {
    next.push({
      id: next.length + 1,
      fileName: null,
      dataUrl: null,
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  }

  return next;
}

export function createAnchorArray(symbolColumnCount: number) {
  return Array.from({ length: symbolColumnCount }, () => null as Point | null);
}

export function normalizeAnchors(current: Array<Point | null>, symbolColumnCount: number) {
  const next = current.slice(0, symbolColumnCount);
  while (next.length < symbolColumnCount) {
    next.push(null);
  }

  return next;
}

export function computePhotoSlotLayouts(
  photoCount: number,
  photoRowCount = PHOTO_ROW_COUNT_MIN,
): PhotoSlotLayout[] {
  const safeCount = clampPhotoCount(photoCount);
  const safeRowCount = clampPhotoRowCount(photoRowCount, safeCount);
  const areaHeight = PHOTO_CANVAS_HEIGHT * PHOTO_AREA_RATIO;
  const areaTop = PHOTO_CANVAS_HEIGHT - areaHeight;
  const columnCount = Math.ceil(safeCount / safeRowCount);
  const usableWidth =
    PHOTO_CANVAS_WIDTH - SLOT_OUTER_PADDING_X * 2 - SLOT_GAP * Math.max(0, columnCount - 1);
  const usableHeight =
    areaHeight - SLOT_OUTER_PADDING_Y * 2 - SLOT_ROW_GAP * Math.max(0, safeRowCount - 1);
  const slotWidth = usableWidth / columnCount;
  const slotHeight = usableHeight / safeRowCount;

  return Array.from({ length: safeCount }, (_, index) => {
    const rowIndex = Math.floor(index / columnCount);
    const columnIndex = index % columnCount;
    const x = SLOT_OUTER_PADDING_X + columnIndex * (slotWidth + SLOT_GAP);
    const y = areaTop + SLOT_OUTER_PADDING_Y + rowIndex * (slotHeight + SLOT_ROW_GAP);
    return {
      index,
      x,
      y,
      width: slotWidth,
      height: slotHeight,
      centerX: x + slotWidth / 2,
      centerY: y + slotHeight / 2,
    };
  });
}

export function getAutomaticAnchors(
  photoCount: number,
  symbolColumnCount: number,
  photoRowCount = PHOTO_ROW_COUNT_MIN,
) {
  if (photoCount !== symbolColumnCount) {
    return createAnchorArray(symbolColumnCount);
  }

  return computePhotoSlotLayouts(photoCount, photoRowCount).map((layout) => ({
    x: layout.centerX,
    y: layout.centerY,
  }));
}

export function drawPhotoPreview(
  context: CanvasRenderingContext2D,
  assets: PhotoRenderAssets,
  config: PhotoRenderConfig,
) {
  if (config.fillBackground ?? true) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, PHOTO_CANVAS_WIDTH, PHOTO_CANVAS_HEIGHT);
  } else {
    context.clearRect(0, 0, PHOTO_CANVAS_WIDTH, PHOTO_CANVAS_HEIGHT);
  }
  const layouts = computePhotoSlotLayouts(config.photoCount, config.photoRowCount);
  const visibleSymbols = (config.symbolsToShow ?? []).slice(0, config.symbolColumnCount);
  const fallbackSlot: PhotoSlotData = {
    id: -1,
    fileName: null,
    dataUrl: null,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };

  for (const layout of layouts) {
    const isSelected =
      config.activeSlotIndices?.includes(layout.index) ?? config.activeSlotIndex === layout.index;
    drawPlaceholder(
      context,
      layout,
      assets.slotImages[layout.index] ?? null,
      config.photoSlots[layout.index] ?? fallbackSlot,
      isSelected,
    );
  }

  config.anchors.forEach((anchor, index) => {
    if (!anchor) {
      return;
    }

    if (config.renderSymbolGuides) {
      drawSymbolGuide(context, anchor, config);
    }

    const label = config.symbolColumnNotes[index]?.trim() ?? "";
    if (config.showAnchors ?? true) {
      drawAnchor(context, anchor, index + 1, config.renderAnchorNumbers ?? false);
    }
    if (label.length > 0) {
      drawLabel(context, anchor, label, index, config);
    }
  });

  visibleSymbols.forEach((symbol, index) => {
    if (symbol === "-") {
      return;
    }

    const anchor = config.anchors[index];
    if (!anchor) {
      return;
    }

    drawSymbol(context, assets.symbolImages, symbol, anchor, config);
  });

  return layouts;
}

export async function loadPreviewAssets(
  photoSlots: PhotoSlotData[],
): Promise<PhotoRenderAssets> {
  const [slotImages, circle, cross, triangle] = await Promise.all([
    Promise.all(photoSlots.map((slot) => loadProcessedSlotImage(slot.dataUrl))),
    loadImage("/mark_maru.png"),
    loadImage("/mark_batsu.png"),
    loadImage("/mark_sankaku.png"),
  ]);

  return {
    slotImages,
    symbolImages: {
      circle: circle ?? undefined,
      cross: cross ?? undefined,
      triangle: triangle ?? undefined,
    },
  };
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = "image/png", quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error("Canvas export failed."));
    }, type, quality);
  });
}

export function buildMovFileName(rowNumber: number, text: string) {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
  const safeText = sanitizeFileName(normalized) || `row_${rowNumber}`;
  return `${rowNumber}_${safeText}.mov`;
}

export function getVisibleAnimatedSymbols(symbols: SymbolOption[]) {
  return symbols.filter(
    (symbol): symbol is SupportedAnimatedSymbol =>
      symbol === "circle" || symbol === "cross" || symbol === "triangle",
  );
}

export function buildFrameSymbolSequence(symbols: SymbolOption[], symbolColumnCount: number) {
  const next: SymbolOption[] = [];
  for (let index = 0; index < symbolColumnCount; index += 1) {
    next.push(symbols[index] ?? "-");
  }

  return next;
}

export function frameCountForDuration(durationSeconds: number) {
  return Math.max(1, Math.ceil(Math.max(durationSeconds, 0.08) * PHOTO_EXPORT_FPS));
}

export async function fileToDataUrl(file: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read image."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image."));
    reader.readAsDataURL(file);
  });
}

async function loadImage(source: string | null) {
  if (!source) {
    return null;
  }

  const image = new Image();
  image.decoding = "async";
  image.src = source;

  if (typeof image.decode === "function") {
    await image.decode();
    return image;
  }

  return new Promise<HTMLImageElement>((resolve, reject) => {
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${source}`));
  });
}

function drawPlaceholder(
  context: CanvasRenderingContext2D,
  layout: PhotoSlotLayout,
  image: HTMLCanvasElement | null,
  slot: PhotoSlotData,
  isActive: boolean,
) {
  context.save();
  context.beginPath();
  context.rect(layout.x, layout.y, layout.width, layout.height);

  if (image) {
    const imageRect = getCoverImageRect(image, layout, slot);

    context.save();
    context.clip();
    context.drawImage(image, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    context.restore();

    const visibleRect = getIntersectedRect(imageRect, {
      x: layout.x,
      y: layout.y,
      width: layout.width,
      height: layout.height,
    });
    if (visibleRect) {
      context.lineWidth = SLOT_BORDER_WIDTH;
      context.strokeStyle = isActive ? PLACEHOLDER_ACTIVE_BORDER : PLACEHOLDER_BORDER;
      context.strokeRect(
        visibleRect.x + SLOT_BORDER_WIDTH / 2,
        visibleRect.y + SLOT_BORDER_WIDTH / 2,
        Math.max(0, visibleRect.width - SLOT_BORDER_WIDTH),
        Math.max(0, visibleRect.height - SLOT_BORDER_WIDTH),
      );
    }
  } else {
    context.fillStyle = EMPTY_SLOT_FILL;
    context.fill();

    context.lineWidth = SLOT_BORDER_WIDTH;
    context.strokeStyle = isActive ? PLACEHOLDER_ACTIVE_BORDER : PLACEHOLDER_BORDER;
    context.stroke();
  }

  if (!image) {
    context.fillStyle = PLACEHOLDER_TEXT;
    context.font = `700 36px ${LABEL_FONT_FAMILY}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText("Drag / Upload / Paste", layout.centerX, layout.centerY - 18);
    context.font = `500 24px ${LABEL_FONT_FAMILY}`;
    context.fillText(`写真 ${layout.index + 1}`, layout.centerX, layout.centerY + 28);
  }

  context.restore();
}

function drawAnchor(
  context: CanvasRenderingContext2D,
  anchor: Point,
  index: number,
  renderNumber: boolean,
) {
  context.save();
  context.beginPath();
  context.arc(anchor.x, anchor.y, ANCHOR_RADIUS, 0, Math.PI * 2);
  context.fillStyle = ANCHOR_FILL;
  context.strokeStyle = ANCHOR_STROKE;
  context.lineWidth = 4;
  context.fill();
  context.stroke();

  if (renderNumber) {
    context.fillStyle = "#ffffff";
    context.font = `700 22px ${LABEL_FONT_FAMILY}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(index), anchor.x, anchor.y + 1);
  }

  context.restore();
}

function drawLabel(
  context: CanvasRenderingContext2D,
  anchor: Point,
  text: string,
  index: number,
  config: PhotoRenderConfig,
) {
  context.save();
  const labelScale = Math.max(0.4, config.labelScale ?? 1);
  const labelOffsetX = config.labelOffsetX ?? 0;
  const labelOffsetY = config.labelOffsetY ?? 0;
  const fontSize = LABEL_FONT_SIZE * labelScale;
  const boxHeight = LABEL_BOX_HEIGHT * labelScale;
  const paddingX = LABEL_BOX_PADDING_X * labelScale;

  context.font = `700 ${fontSize}px ${LABEL_FONT_FAMILY}`;
  const textMetrics = context.measureText(text);
  const labelWidth = Math.min(
    PHOTO_CANVAS_WIDTH - SLOT_OUTER_PADDING_X * 2,
    Math.max(180 * labelScale, textMetrics.width + paddingX * 2),
  );
  const x = clamp(
    anchor.x - labelWidth / 2 + labelOffsetX,
    SLOT_OUTER_PADDING_X,
    PHOTO_CANVAS_WIDTH - SLOT_OUTER_PADDING_X - labelWidth,
  );
  const y = clamp(
    anchor.y + 44 + labelOffsetY,
    0,
    PHOTO_CANVAS_HEIGHT - boxHeight - 14,
  );
  context.beginPath();
  context.rect(x, y, labelWidth, boxHeight);
  context.fillStyle = LABEL_BACKGROUND;
  context.strokeStyle = LABEL_BORDER;
  context.lineWidth = 2;
  context.fill();
  context.stroke();
  context.fillStyle = LABEL_TEXT_COLORS[index % LABEL_TEXT_COLORS.length];
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x + labelWidth / 2, y + boxHeight / 2 + 2 * labelScale);
  context.restore();
}

function drawSymbol(
  context: CanvasRenderingContext2D,
  symbolImages: PhotoRenderAssets["symbolImages"],
  symbol: SymbolOption,
  anchor: Point,
  config: PhotoRenderConfig,
) {
  const image = symbolImages[symbol as SupportedAnimatedSymbol];
  const { x, y, size } = getSymbolRect(anchor, config);

  if (!image) {
    return;
  }

  context.drawImage(image, x, y, size, size);
}

function drawSymbolGuide(
  context: CanvasRenderingContext2D,
  anchor: Point,
  config: PhotoRenderConfig,
) {
  const { x, y, size } = getSymbolRect(anchor, config);
  context.save();
  context.setLineDash([10, 8]);
  context.lineWidth = 3;
  context.strokeStyle = "rgba(44, 110, 136, 0.95)";
  context.strokeRect(x, y, size, size);
  context.restore();
}

function getSymbolRect(anchor: Point, config: PhotoRenderConfig) {
  const size = 176 * Math.max(0.3, config.symbolScale ?? 1);
  return {
    x: anchor.x - size / 2 + (config.symbolOffsetX ?? 0),
    y: anchor.y - size / 2 + (config.symbolOffsetY ?? 0),
    size,
  };
}

function getCoverImageRect(
  image: HTMLCanvasElement,
  layout: PhotoSlotLayout,
  slot: PhotoSlotData,
): DrawRect {
  const baseScale = Math.max(layout.width / image.width, layout.height / image.height);
  const scale = baseScale * Math.max(0.2, slot.scale || 1);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  return {
    x: layout.x + (layout.width - drawWidth) / 2 + slot.offsetX,
    y: layout.y + (layout.height - drawHeight) / 2 + slot.offsetY,
    width: drawWidth,
    height: drawHeight,
  };
}

function getIntersectedRect(a: DrawRect, b: DrawRect): DrawRect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) {
    return null;
  }

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

async function loadProcessedSlotImage(source: string | null) {
  const image = await loadImage(source);
  if (!image) {
    return null;
  }

  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  context.drawImage(image, 0, 0);
  return canvas;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
