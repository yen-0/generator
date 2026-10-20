"use client";

import JSZip from "jszip";

import { canvasToBlob } from "./photo-panel";
import {
  clampPreviewIndex,
  getZipName,
  isWholeSymbolOption,
  normalizeText,
  SYMBOL_LABELS,
  type DenominatorMode,
  type GeneratorPayload,
  type NormalizedRow,
  type Orientation,
  type SymbolOption,
} from "./generator-shared";

const RENDER_SCALE = 2;
const OO_RENDER_SCALE = 3;

const CANVAS_WIDTH = 850 * RENDER_SCALE;
const PANEL_GAP = 8 * RENDER_SCALE;
const PANEL_BORDER_WIDTH = 8 * RENDER_SCALE;
const OUTER_PADDING = 28 * RENDER_SCALE;

const TEXT_TOP_PADDING = 13 * RENDER_SCALE;
const TEXT_BOTTOM_PADDING = 28 * RENDER_SCALE;
const TEXT_LINE_SPACING = 5 * RENDER_SCALE;
const SYMBOL_WIDTH = 144 * RENDER_SCALE;
const SYMBOL_STROKE = 28 * RENDER_SCALE;
const SYMBOL_GROUP_SPACING = 72 * RENDER_SCALE;
const SYMBOL_TOP_GAP = 5 * RENDER_SCALE;
const BOTTOM_PADDING = 24 * RENDER_SCALE;
const CIRCLE_RADIUS_BONUS = 8 * RENDER_SCALE;
const SYMBOL_LAYOUT_REFERENCE_COUNT = 4;
const SYMBOL_LAYOUT_REFERENCE_WIDTH =
  SYMBOL_LAYOUT_REFERENCE_COUNT * SYMBOL_WIDTH +
  (SYMBOL_LAYOUT_REFERENCE_COUNT - 1) * SYMBOL_GROUP_SPACING;

const TITLE_BANNER_HEIGHT = 132 * RENDER_SCALE;
const TITLE_BANNER_WIDTH = 850 * RENDER_SCALE;
const LANDSCAPE_TEXT_WIDTH = 1120;
const LANDSCAPE_TEXT_HEIGHT = 680;
const LANDSCAPE_TEXT_GAP = 16;
const LANDSCAPE_TEXT_PADDING = 12;
const TITLE_TEXT_PADDING_X = 60 * RENDER_SCALE;
const TITLE_MIN_FONT_SIZE = 52 * RENDER_SCALE;
const TITLE_MAX_FONT_SIZE = 132 * RENDER_SCALE;

const OO_BOX_HEIGHT = 72 * OO_RENDER_SCALE;
const OO_BOX_WIDTH = 128 * OO_RENDER_SCALE;
const OO_BOX_BORDER = 2 * OO_RENDER_SCALE;
const OO_DIGIT_FONT_SIZE = 196;
const OO_SLASH_FONT_SIZE = 127;

const TEXT_COLOR = "#000000";
const BACKGROUND = "#FFFFFF";
const BLUE = "#2166F3";
const RED = "#E23D2E";
const ORANGE = "#F28C28";
const PINK = "#FF9CC8";
const QUESTION_PURPLE = "#9e00fe";
const GOLD_TOP = "#f8e8a6";
const GOLD_MID = "#d6a33d";
const GOLD_BOTTOM = "#8d5f11";
const TITLE_RED = "#e82a2f";

const SANS_FONT = '"Noto Sans JP", "Hiragino Kaku Gothic ProN", "Yu Gothic", sans-serif';
const SERIF_FONT = '"Shippori Mincho", "Noto Serif JP", serif';

type RenderOutput = {
  fileName: string;
  blob: Blob;
};

export async function renderClientPreviewBlob(payload: GeneratorPayload, previewIndex: number) {
  const rows = payload.rows.map(normalizeRow);
  const safePreviewIndex = clampPreviewIndex(previewIndex, rows.length);

  if (rows.length === 0) {
    const titleBanner = renderTitleBannerCanvas(payload.title);
    return canvasToBlob(titleBanner);
  }

  const titleBanner = renderTitleBannerCanvas(payload.title);
  const textPanels = renderCumulativeTextPanels(rows, payload.orientation);
  const row = rows[safePreviewIndex];
  const ooPanel = renderOoPanelCanvas(row.numerator, row.denominator);
  const canvas = renderModeOneCanvas(titleBanner, textPanels[safePreviewIndex] ?? null, ooPanel, payload.orientation);
  return canvasToBlob(canvas);
}

export async function renderClientZipBlob(payload: GeneratorPayload, saveJson?: string) {
  const rows = payload.rows.map(normalizeRow);
  const outputs = await renderAllModeOutputs(payload.title, rows, payload.denominatorMode, payload.orientation);
  const zip = new JSZip();

  for (const output of outputs) {
    zip.file(output.fileName, output.blob);
  }
  zip.file("generator-state.json", saveJson ?? JSON.stringify(payload, null, 2));

  return {
    blob: await zip.generateAsync({ type: "blob" }),
    fileName: getZipName(payload.title, payload.mode),
  };
}

function normalizeRow(row: GeneratorPayload["rows"][number]): NormalizedRow {
  return {
    text: normalizeText(row.text),
    symbols: row.symbols,
    fontSize: row.fontSize,
    numerator: row.numerator,
    denominator: row.denominator,
  };
}

async function renderAllModeOutputs(
  title: string,
  rows: NormalizedRow[],
  denominatorMode: DenominatorMode,
  orientation: Orientation,
): Promise<RenderOutput[]> {
  const titleBanner = renderTitleBannerCanvas(title);
  const textPanels = renderCumulativeTextPanels(rows, orientation);
  const ooPanels = rows.map((row) => renderOoPanelCanvas(row.numerator, row.denominator));
  const outputs: RenderOutput[] = [];
  const modeOneFrames: Array<{ textPanel: HTMLCanvasElement | null; ooPanel: HTMLCanvasElement }> = [
    {
      textPanel: null,
      ooPanel: renderOoPanelCanvas(0, denominatorMode),
    },
  ];

  if (ooPanels[0]) {
    modeOneFrames.push({
      textPanel: null,
      ooPanel: ooPanels[0],
    });
  }

  for (let index = 0; index < textPanels.length; index += 1) {
    const textPanel = textPanels[index];
    const currentOoPanel = ooPanels[index];
    const nextOoPanel = ooPanels[index + 1];

    if (textPanel && currentOoPanel) {
      modeOneFrames.push({ textPanel, ooPanel: currentOoPanel });
    }

    if (textPanel && nextOoPanel) {
      modeOneFrames.push({ textPanel, ooPanel: nextOoPanel });
    }
  }

  for (const [outputIndex, frame] of modeOneFrames.entries()) {
    outputs.push({
      fileName: `mode1_all_component_${outputIndex}.png`,
      blob: await canvasToBlob(renderModeOneCanvas(titleBanner, frame.textPanel, frame.ooPanel, orientation)),
    });
  }

  for (const [index, canvas] of textPanels.entries()) {
    outputs.push({
      fileName: `mode2_text_symbols_${index + 1}.png`,
      blob: await canvasToBlob(canvas),
    });
  }

  for (let index = 0; index < rows.length; index += 1) {
    outputs.push({
      fileName: `mode3_title_banner_${index + 1}.png`,
      blob: await canvasToBlob(titleBanner),
    });
  }

  for (const [index, canvas] of ooPanels.entries()) {
    outputs.push({
      fileName: `mode4_oo_${index + 1}.png`,
      blob: await canvasToBlob(canvas),
    });
  }

  return outputs;
}

function renderModeOneCanvas(
  titleBanner: HTMLCanvasElement,
  textPanel: HTMLCanvasElement | null,
  ooPanel: HTMLCanvasElement | null,
  orientation: Orientation,
) {
  const width = TITLE_BANNER_WIDTH;
  const height = Math.round((width * (orientation === "portrait" ? 16 / 9 : 9 / 16)));
  const bannerHeight = TITLE_BANNER_HEIGHT;
  const overlap = 18 * RENDER_SCALE;
  const quarterWidth = Math.floor(width / 4);
  const textWidth = quarterWidth;
  const ooWidth = Math.round(quarterWidth * 1.14);
  const sideInset = Math.round(width * 0.03);
  const textLeft = sideInset;
  const ooLeft = width - ooWidth - sideInset;
  const canvas = createCanvas(width, height);
  const context = getCanvasContext(canvas);

  context.drawImage(titleBanner, 0, 0);

  if (orientation === "landscape") {
    if (textPanel) {
      context.drawImage(textPanel, sideInset, bannerHeight - overlap);
    }
    if (ooPanel) {
      drawResizedCanvas(context, ooPanel, width - 400 - sideInset, bannerHeight - overlap, 400);
    }
    return canvas;
  }

  if (textPanel) {
    drawResizedCanvas(context, textPanel, textLeft, bannerHeight - overlap, textWidth);
  }

  if (ooPanel) {
    drawResizedCanvas(context, ooPanel, ooLeft, bannerHeight - overlap, ooWidth);
  }

  return canvas;
}

function renderCumulativeTextPanels(rows: NormalizedRow[], orientation: Orientation) {
  const renderedPanels = rows.map((row) => renderTextPanelCanvas(row.text, row.symbols, row.fontSize));
  if (orientation === "landscape") {
    return renderLandscapeTextPanels(renderedPanels);
  }

  const fullWidth =
    Math.max(...renderedPanels.map((canvas) => canvas.width), CANVAS_WIDTH) + OUTER_PADDING * 2;
  const fullHeight =
    renderedPanels.reduce((sum, canvas) => sum + canvas.height, 0) +
    Math.max(0, renderedPanels.length - 1) * PANEL_GAP +
    OUTER_PADDING * 2;

  return renderedPanels.map((_, index) => {
    const canvas = createCanvas(fullWidth, fullHeight);
    const context = getCanvasContext(canvas);
    let currentTop = OUTER_PADDING;

    for (const panel of renderedPanels.slice(0, index + 1)) {
      context.drawImage(panel, OUTER_PADDING, currentTop);
      currentTop += panel.height + PANEL_GAP;
    }

    return canvas;
  });
}

function renderLandscapeTextPanels(panels: HTMLCanvasElement[]) {
  const availableWidth = LANDSCAPE_TEXT_WIDTH - LANDSCAPE_TEXT_PADDING * 2;
  const availableHeight = LANDSCAPE_TEXT_HEIGHT - LANDSCAPE_TEXT_PADDING * 2;
  const maxPanelWidth = Math.max(...panels.map((panel) => panel.width));
  const maxPanelHeight = Math.max(...panels.map((panel) => panel.height));
  let bestColumns = 1;
  let bestScale = 0;

  for (let columns = 1; columns <= panels.length; columns += 1) {
    const rows = Math.ceil(panels.length / columns);
    const cellWidth = (availableWidth - (columns - 1) * LANDSCAPE_TEXT_GAP) / columns;
    const cellHeight = (availableHeight - (rows - 1) * LANDSCAPE_TEXT_GAP) / rows;
    const scale = Math.min(cellWidth / maxPanelWidth, cellHeight / maxPanelHeight);
    if (scale > bestScale) {
      bestScale = scale;
      bestColumns = columns;
    }
  }

  const rowCount = Math.ceil(panels.length / bestColumns);
  const cellWidth = (availableWidth - (bestColumns - 1) * LANDSCAPE_TEXT_GAP) / bestColumns;
  const cellHeight = (availableHeight - (rowCount - 1) * LANDSCAPE_TEXT_GAP) / rowCount;

  return panels.map((_, index) => {
    const canvas = createCanvas(LANDSCAPE_TEXT_WIDTH, LANDSCAPE_TEXT_HEIGHT);
    const context = getCanvasContext(canvas);
    for (const [panelIndex, panel] of panels.slice(0, index + 1).entries()) {
      const column = panelIndex % bestColumns;
      const row = Math.floor(panelIndex / bestColumns);
      const x = LANDSCAPE_TEXT_PADDING + column * (cellWidth + LANDSCAPE_TEXT_GAP) +
        (cellWidth - panel.width * bestScale) / 2;
      const y = LANDSCAPE_TEXT_PADDING + row * (cellHeight + LANDSCAPE_TEXT_GAP);
      context.drawImage(panel, x, y, panel.width * bestScale, panel.height * bestScale);
    }
    return canvas;
  });
}

function renderTextPanelCanvas(text: string, symbols: NormalizedRow["symbols"], fontSize: number) {
  const wholeSymbol = symbols.find(isWholeSymbolOption);
  const visibleSymbols = symbols.filter((symbol): symbol is Exclude<SymbolOption, "-"> => symbol !== "-");
  const lines = text.length > 0 ? text.split("\n") : [""];
  const normalizedFontSize = Math.max(1, Math.trunc(fontSize));
  const metrics = measureLines(lines, normalizedFontSize);
  const textBlockHeight = metrics.totalHeight + (lines.length - 1) * TEXT_LINE_SPACING;
  const textHeight = textBlockHeight + TEXT_TOP_PADDING + TEXT_BOTTOM_PADDING;
  const panelHeight = textHeight + SYMBOL_TOP_GAP + SYMBOL_WIDTH + BOTTOM_PADDING;
  const canvas = createCanvas(CANVAS_WIDTH, panelHeight);
  const context = getCanvasContext(canvas);

  context.fillStyle = BACKGROUND;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = PINK;
  context.lineWidth = PANEL_BORDER_WIDTH;
  context.strokeRect(0, 0, canvas.width, canvas.height);

  drawTextLines(context, lines, metrics, normalizedFontSize);
  drawSymbols(context, visibleSymbols, textHeight, wholeSymbol ? SYMBOL_LABELS[wholeSymbol] : null);

  return canvas;
}

function renderTitleBannerCanvas(title: string) {
  const safeTitle = title.trim() || "TITLE";
  const canvas = createCanvas(TITLE_BANNER_WIDTH, TITLE_BANNER_HEIGHT);
  const context = getCanvasContext(canvas);
  const fontSize = fitTitleFontSize(context, safeTitle);
  const gradient = context.createLinearGradient(0, 0, 0, TITLE_BANNER_HEIGHT);
  gradient.addColorStop(0, "#fff7cf");
  gradient.addColorStop(0.16, GOLD_TOP);
  gradient.addColorStop(0.36, "#f0cf78");
  gradient.addColorStop(0.5, GOLD_MID);
  gradient.addColorStop(0.68, "#b97f1f");
  gradient.addColorStop(1, GOLD_BOTTOM);

  context.fillStyle = TITLE_RED;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = `700 ${fontSize}px ${SANS_FONT}`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 16;
  context.strokeStyle = "#000000";
  context.strokeText(safeTitle, canvas.width / 2, canvas.height / 2 + 2);
  context.fillStyle = gradient;
  context.fillText(safeTitle, canvas.width / 2, canvas.height / 2 + 2);

  return canvas;
}

function renderOoPanelCanvas(numerator: number, denominator: number) {
  const numeratorText = String(numerator);
  const denominatorText = String(denominator);
  const numeratorColor = numerator > denominator ? RED : TEXT_COLOR;
  const twoDigitScale = numeratorText.length > 1 || denominatorText.length > 1 ? 0.75 : 1;
  const digitFontSize = Math.round(OO_DIGIT_FONT_SIZE * twoDigitScale);
  const slashFontSize = Math.round(OO_SLASH_FONT_SIZE * twoDigitScale);
  const width = OO_BOX_WIDTH + OO_BOX_BORDER * 2;
  const height = OO_BOX_HEIGHT + OO_BOX_BORDER * 2;
  const canvas = createCanvas(width, height);
  const context = getCanvasContext(canvas);
  const boxLeft = OO_BOX_BORDER;
  const boxTop = OO_BOX_BORDER;
  const boxCenterY = boxTop + OO_BOX_HEIGHT / 2;

  context.fillStyle = "#ffffff";
  context.fillRect(boxLeft, boxTop, OO_BOX_WIDTH, OO_BOX_HEIGHT);
  context.strokeStyle = "#000000";
  context.lineWidth = OO_BOX_BORDER;
  context.strokeRect(boxLeft, boxTop, OO_BOX_WIDTH, OO_BOX_HEIGHT);

  context.textAlign = "center";
  context.textBaseline = "middle";

  context.font = `700 ${digitFontSize}px ${SERIF_FONT}`;
  context.fillStyle = numeratorColor;
  context.fillText(numeratorText, boxLeft + OO_BOX_WIDTH / 4, boxCenterY + 10);

  context.font = `700 ${slashFontSize}px ${SERIF_FONT}`;
  context.fillStyle = "#000000";
  context.fillText("/", boxLeft + OO_BOX_WIDTH / 2, boxCenterY + 6);

  context.font = `700 ${digitFontSize}px ${SERIF_FONT}`;
  context.fillText(denominatorText, boxLeft + (OO_BOX_WIDTH * 3) / 4, boxCenterY + 10);

  return canvas;
}

function drawTextLines(
  context: CanvasRenderingContext2D,
  lines: string[],
  metrics: ReturnType<typeof measureLines>,
  fontSize: number,
) {
  let currentTop = TEXT_TOP_PADDING;

  context.fillStyle = TEXT_COLOR;
  context.textAlign = "center";
  context.textBaseline = "top";
  context.font = `700 ${fontSize}px ${SANS_FONT}`;

  lines.forEach((line, index) => {
    const lineMetric = metrics.lineMetrics[index];
    context.fillText(line, CANVAS_WIDTH / 2, currentTop, CANVAS_WIDTH - TITLE_TEXT_PADDING_X * 2);
    currentTop += lineMetric.height + TEXT_LINE_SPACING;
  });
}

function drawSymbols(
  context: CanvasRenderingContext2D,
  symbols: Array<Exclude<SymbolOption, "-">>,
  textHeight: number,
  wholeSymbolText: string | null,
) {
  if (wholeSymbolText) {
    context.save();
    context.fillStyle = wholeSymbolText === "全部×" ? RED : wholeSymbolText === "全部△" ? ORANGE : BLUE;
    context.font = `700 ${Math.round(SYMBOL_WIDTH * 0.78)}px ${SANS_FONT}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(wholeSymbolText, CANVAS_WIDTH / 2, textHeight + SYMBOL_TOP_GAP + SYMBOL_WIDTH / 2);
    context.restore();
    return;
  }

  if (symbols.length === 0) {
    return;
  }

  const layout = getSymbolLayout(symbols.length);
  const totalWidth = layout.totalWidth;
  const startX = (CANVAS_WIDTH - totalWidth) / 2;
  const topY = textHeight + SYMBOL_TOP_GAP;

  context.save();
  context.translate(startX, topY);
  context.scale(layout.scale, layout.scale);

  symbols.forEach((symbol, index) => {
    const left = index * (SYMBOL_WIDTH + SYMBOL_GROUP_SPACING);
    switch (symbol) {
      case "circle": {
        context.beginPath();
        context.strokeStyle = BLUE;
        context.lineWidth = SYMBOL_STROKE;
        context.arc(
          left + SYMBOL_WIDTH / 2,
          SYMBOL_WIDTH / 2,
          SYMBOL_WIDTH / 2 - SYMBOL_STROKE / 2 + CIRCLE_RADIUS_BONUS,
          0,
          Math.PI * 2,
        );
        context.stroke();
        break;
      }
      case "cross": {
        context.strokeStyle = RED;
        context.lineWidth = SYMBOL_STROKE + 12 * RENDER_SCALE;
        context.lineCap = "square";
        context.beginPath();
        context.moveTo(left + 18 * RENDER_SCALE, 18 * RENDER_SCALE);
        context.lineTo(left + SYMBOL_WIDTH - 18 * RENDER_SCALE, SYMBOL_WIDTH - 18 * RENDER_SCALE);
        context.moveTo(left + SYMBOL_WIDTH - 18 * RENDER_SCALE, 18 * RENDER_SCALE);
        context.lineTo(left + 18 * RENDER_SCALE, SYMBOL_WIDTH - 18 * RENDER_SCALE);
        context.stroke();
        break;
      }
      case "triangle": {
        context.strokeStyle = ORANGE;
        context.lineWidth = SYMBOL_STROKE;
        context.lineJoin = "miter";
        context.beginPath();
        context.moveTo(left + SYMBOL_WIDTH / 2, 8 * RENDER_SCALE);
        context.lineTo(left + SYMBOL_WIDTH - 10 * RENDER_SCALE, SYMBOL_WIDTH - 12 * RENDER_SCALE);
        context.lineTo(left + 10 * RENDER_SCALE, SYMBOL_WIDTH - 12 * RENDER_SCALE);
        context.closePath();
        context.stroke();
        break;
      }
      case "?": {
        context.fillStyle = QUESTION_PURPLE;
        context.font = `700 ${Math.round(SYMBOL_WIDTH * 1.2)}px ${SANS_FONT}`;
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.fillText("?", left + SYMBOL_WIDTH / 2, SYMBOL_WIDTH / 2 + 12);
        break;
      }
    }
  });

  context.restore();
}

function measureLines(lines: string[], fontSize: number) {
  const canvas = createCanvas(1, 1);
  const context = getCanvasContext(canvas);
  context.font = `700 ${fontSize}px ${SANS_FONT}`;

  const lineMetrics = lines.map((line) => {
    const metrics = context.measureText(line || " ");
    return {
      width: metrics.width,
      height:
        Math.max(
          fontSize,
          Math.abs(metrics.actualBoundingBoxAscent) + Math.abs(metrics.actualBoundingBoxDescent),
        ) || fontSize,
    };
  });

  const totalHeight = lineMetrics.reduce((sum, metric) => sum + metric.height, 0);
  return { lineMetrics, totalHeight };
}

function fitTitleFontSize(context: CanvasRenderingContext2D, title: string) {
  const maxTextHeight = TITLE_BANNER_HEIGHT - 24;
  for (let size = TITLE_MAX_FONT_SIZE; size >= TITLE_MIN_FONT_SIZE; size -= 2) {
    context.font = `700 ${size}px ${SANS_FONT}`;
    const metrics = context.measureText(title);
    const width = metrics.width;
    const height =
      Math.abs(metrics.actualBoundingBoxAscent) + Math.abs(metrics.actualBoundingBoxDescent) || size;
    if (width <= TITLE_BANNER_WIDTH - TITLE_TEXT_PADDING_X * 2 && height <= maxTextHeight) {
      return size;
    }
  }

  return TITLE_MIN_FONT_SIZE;
}

function getSymbolLayout(symbolCount: number) {
  const rawWidth = symbolCount * SYMBOL_WIDTH + (symbolCount - 1) * SYMBOL_GROUP_SPACING;

  if (symbolCount <= SYMBOL_LAYOUT_REFERENCE_COUNT) {
    return { scale: 1, totalWidth: rawWidth };
  }

  const scale = SYMBOL_LAYOUT_REFERENCE_WIDTH / rawWidth;
  return { scale, totalWidth: rawWidth * scale };
}

function drawResizedCanvas(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  left: number,
  top: number,
  targetWidth: number,
) {
  const ratio = targetWidth / source.width;
  const targetHeight = source.height * ratio;
  context.drawImage(source, left, top, targetWidth, targetHeight);
}

function createCanvas(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function getCanvasContext(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  return context;
}
