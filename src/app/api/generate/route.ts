import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import opentype, { type Font } from "opentype.js";
import sharp from "sharp";
import { NextResponse } from "next/server";

const SYMBOL_VALUES = new Set(["-", "circle", "cross", "triangle"]);
const MODES = new Set(["all", "text", "title", "oo"]);
const RENDER_SCALE = 2;
const OO_RENDER_SCALE = 3;

const CANVAS_WIDTH = 850 * RENDER_SCALE;
const PANEL_GAP = 8 * RENDER_SCALE;
const PANEL_BORDER_WIDTH = 8 * RENDER_SCALE;
const OUTER_PADDING = 28 * RENDER_SCALE;

const TEXT_TOP_PADDING = 13 * RENDER_SCALE;
const TEXT_BOTTOM_PADDING = 28 * RENDER_SCALE;
const TEXT_SIZE = 200 * RENDER_SCALE;
const TEXT_LINE_SPACING = 5 * RENDER_SCALE;
const SYMBOL_WIDTH = 144 * RENDER_SCALE;
const SYMBOL_STROKE = 28 * RENDER_SCALE;
const SYMBOL_GROUP_SPACING = 72 * RENDER_SCALE;
const SYMBOL_TOP_GAP = 5 * RENDER_SCALE;
const BOTTOM_PADDING = 24 * RENDER_SCALE;
const CIRCLE_RADIUS_BONUS = 8 * RENDER_SCALE;

const TITLE_BANNER_HEIGHT = 132 * RENDER_SCALE;
const TITLE_BANNER_WIDTH = 850 * RENDER_SCALE;
const TITLE_TEXT_PADDING_X = 60 * RENDER_SCALE;
const TITLE_MIN_FONT_SIZE = 52 * RENDER_SCALE;
const TITLE_MAX_FONT_SIZE = 132 * RENDER_SCALE;

const OO_BOX_HEIGHT = 72 * OO_RENDER_SCALE;
// Keep mode 4 panels a consistent width so the box does not expand with the fraction label.
const OO_BOX_WIDTH = 128 * OO_RENDER_SCALE;
// Slightly tighter padding keeps the split-box digits a bit more compact.
const OO_BOX_PADDING_X = 15 * OO_RENDER_SCALE;
const OO_BOX_PADDING_Y = 6 * OO_RENDER_SCALE;
const OO_BOX_FONT_SIZE = 163 * OO_RENDER_SCALE;
const OO_SLASH_FONT_SCALE = 0.65;
const OO_BOX_BORDER = 2 * OO_RENDER_SCALE;

const TEXT_COLOR = "#000000";
const BACKGROUND = "#FFFFFF";
const BLUE = "#2166F3";
const RED = "#E23D2E";
const ORANGE = "#F28C28";
const PINK = "#FF9CC8";
const GOLD_TOP = "#f8e8a6";
const GOLD_MID = "#d6a33d";
const GOLD_BOTTOM = "#8d5f11";
const TITLE_RED = "#e82a2f";

const EMBEDDED_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@fontsource",
  "noto-sans-jp",
  "files",
  "noto-sans-jp-japanese-700-normal.woff",
);
const OO_MINCHO_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@fontsource",
  "shippori-mincho",
  "files",
  "shippori-mincho-japanese-700-normal.woff",
);

type SymbolOption = "-" | "circle" | "cross" | "triangle";
type Mode = "all" | "text" | "title" | "oo";

type RequestRow = {
  text: string;
  symbols: [SymbolOption, SymbolOption, SymbolOption];
  fontSize: number;
  numerator: number;
  denominator: number;
};

let embeddedFontPromise: Promise<Font> | null = null;
let ooMinchoFontPromise: Promise<Font> | null = null;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      mode?: unknown;
      title?: unknown;
      rows?: unknown;
    };

    const mode = typeof body.mode === "string" && MODES.has(body.mode) ? (body.mode as Mode) : "all";
    const title = typeof body.title === "string" ? body.title : "";
    const rows = validateRows(body.rows);
    const rowsToRender = rows.map((row) => ({
      text: normalizeText(row.text),
      symbols: row.symbols,
      fontSize: row.fontSize,
      numerator: row.numerator,
      denominator: row.denominator,
    }));

    const zip = new JSZip();
    const baseName = sanitizeFileComponent(title) || "generated-images";

    if (mode === "all") {
      const outputs = await renderAllModeOutputs(title, rowsToRender);
      for (const output of outputs) {
        zip.file(output.fileName, output.png);
      }
    } else if (mode === "text") {
      const outputs = await renderTextModeOutputs(baseName, rowsToRender);
      for (const output of outputs) {
        zip.file(output.fileName, output.png);
      }
    } else if (mode === "title") {
      zip.file(`${baseName}_title_banner.png`, await renderTitleBannerPng(title));
    } else if (mode === "oo") {
      const outputs = await renderOoModeOutputs(baseName, rowsToRender);
      for (const output of outputs) {
        zip.file(output.fileName, output.png);
      }
    }

    if (zip.file(/.*/).length === 0) {
      return NextResponse.json({ error: "Nothing to generate." }, { status: 400 });
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const archiveName = `${baseName}_${mode}.zip`;
    const asciiArchiveName = toAsciiDownloadName(archiveName);

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": buildContentDisposition(asciiArchiveName, archiveName),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function validateRows(value: unknown): RequestRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid request payload.");
  }

  return value.map((row) => {
    const fontSizeValue = (row as { fontSize?: unknown }).fontSize;

    if (
      typeof row !== "object" ||
      row === null ||
      typeof (row as { text?: unknown }).text !== "string" ||
      !Array.isArray((row as { symbols?: unknown }).symbols) ||
      (row as { symbols: unknown[] }).symbols.length !== 3 ||
      (typeof fontSizeValue !== "undefined" && typeof fontSizeValue !== "number") ||
      typeof (row as { numerator?: unknown }).numerator !== "number" ||
      typeof (row as { denominator?: unknown }).denominator !== "number"
    ) {
      throw new Error(
        "Each row must include text, three symbols, numerator, denominator, and an optional font size.",
      );
    }

    const symbols = (row as { symbols: unknown[] }).symbols.map((symbol) => {
      if (typeof symbol !== "string" || !SYMBOL_VALUES.has(symbol)) {
        throw new Error("Invalid symbol value.");
      }

      return symbol;
    }) as RequestRow["symbols"];

    return {
      text: (row as { text: string }).text,
      symbols,
      fontSize: normalizeFontSize(fontSizeValue as number | undefined),
      numerator: Math.max(1, Math.trunc((row as { numerator: number }).numerator)),
      denominator: Math.max(1, Math.trunc((row as { denominator: number }).denominator)),
    };
  });
}

function normalizeFontSize(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return TEXT_SIZE;
  }

  return Math.max(1, Math.trunc(value));
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

async function renderAllModeOutputs(title: string, rows: RequestRow[]) {
  const [titleBanner, textPanels, ooPanels] = await Promise.all([
    renderTitleBannerPng(title),
    renderCumulativePanelPngs(rows),
    renderOoPanels(rows),
  ]);
  const outputs: Array<{ fileName: string; png: Buffer }> = [];
  const modeOneFrames: Array<{ textPanel: Buffer | null; ooPanel: Buffer }> = [
    {
      textPanel: null,
      ooPanel: await renderOoPanelPng(0, 7),
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
    const png = await renderModeOnePanel(titleBanner, frame.textPanel, frame.ooPanel);
    outputs.push({ fileName: `mode1_all_component_${outputIndex}.png`, png });
  }
  textPanels.forEach((png, index) => {
    outputs.push({ fileName: `mode2_text_symbols_${index + 1}.png`, png });
  });
  rows.forEach((_, index) => {
    // Duplicate the banner per row so the ZIP stays row-indexed across all modes.
    outputs.push({ fileName: `mode3_title_banner_${index + 1}.png`, png: titleBanner });
  });
  ooPanels.forEach((png, index) => {
    outputs.push({ fileName: `mode4_oo_${index + 1}.png`, png });
  });

  return outputs;
}

async function renderTextModeOutputs(baseName: string, rows: RequestRow[]) {
  const renderedPanels = await renderCumulativePanelPngs(rows);
  return renderedPanels.map((png, index) => ({
    fileName: `${baseName}_text_panels_1_to_${index + 1}.png`,
    png,
  }));
}

async function renderOoModeOutputs(baseName: string, rows: RequestRow[]) {
  const renderedPanels = await renderOoPanels(rows);
  return renderedPanels.map((png, index) => ({
    fileName: `${baseName}_oo_column_${index + 1}.png`,
    png,
  }));
}

async function renderModeOnePanel(
  titleBanner: Buffer,
  textPanel: Buffer | null,
  ooPanel: Buffer | null,
) {
  const panels = await renderModeOnePanels(
    titleBanner,
    textPanel ? [textPanel] : [],
    ooPanel ? [ooPanel] : [],
  );
  return panels[0];
}

async function renderModeOnePanels(
  titleBanner: Buffer,
  textPanels: Buffer[],
  ooPanels: Buffer[],
) {
  const width = TITLE_BANNER_WIDTH;
  const height = Math.round((width * 16) / 9);
  const bannerHeight = TITLE_BANNER_HEIGHT;
  const overlap = 18 * RENDER_SCALE;
  const quarterWidth = Math.floor(width / 4);
  const textWidth = quarterWidth;
  const ooWidth = Math.round(quarterWidth * 1.14);
  const sideInset = Math.round(width * 0.03);
  const textLeft = sideInset;
  const ooLeft = width - ooWidth - sideInset;
  const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
  const outputs: Buffer[] = [];
  const panelCount = Math.max(textPanels.length, ooPanels.length);

  for (let index = 0; index < panelCount; index += 1) {
    const textPanel = textPanels[index];
    const ooPanel = ooPanels[index];
    const composites: { input: Buffer; top: number; left: number }[] = [
      { input: titleBanner, top: 0, left: 0 },
    ];

    if (textPanel) {
      const resizedText = await sharp(textPanel)
        .resize({
          width: textWidth,
          fit: "inside",
        })
        .trim()
        .png()
        .toBuffer();
      composites.push({ input: resizedText, top: bannerHeight - overlap, left: textLeft });
    }

    if (ooPanel) {
      const resizedOo = await sharp(ooPanel)
        .resize({
          width: ooWidth,
          fit: "inside",
        })
        .png()
        .toBuffer();
      composites.push({ input: resizedOo, top: bannerHeight - overlap, left: ooLeft });
    }

    outputs.push(
      await sharp({
        create: {
          width,
          height,
          channels: 4,
          background: transparent,
        },
      })
        .composite(composites)
        .png()
        .toBuffer(),
    );
  }

  return outputs;
}

async function renderCumulativePanelPngs(rows: RequestRow[]) {
  const renderedPanels = await Promise.all(
    rows.map(async (row) => ({
      png: await renderTextPanelPng(row.text, row.symbols, row.fontSize),
    })),
  );
  const panelWidths = await Promise.all(renderedPanels.map(async ({ png }) => sharp(png).metadata()));
  const fullWidth = Math.max(...panelWidths.map((metadata) => metadata.width ?? 0)) + OUTER_PADDING * 2;
  const fullHeight =
    panelWidths.reduce((sum, metadata) => sum + (metadata.height ?? 0), 0) +
    Math.max(0, renderedPanels.length - 1) * PANEL_GAP +
    OUTER_PADDING * 2;

  return Promise.all(
    renderedPanels.map(async (_, index) => {
      let currentTop = OUTER_PADDING;
      const composites = renderedPanels.slice(0, index + 1).map(({ png }) => png);
      const layers: { input: Buffer; top: number; left: number }[] = [];

      for (const panel of composites) {
        const metadata = await sharp(panel).metadata();
        layers.push({
          input: panel,
          top: currentTop,
          left: OUTER_PADDING,
        });
        currentTop += (metadata.height ?? 0) + PANEL_GAP;
      }

      return sharp({
        create: {
          width: fullWidth,
          height: fullHeight,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(layers)
        .png()
        .toBuffer();
    }),
  );
}

async function renderOoPanels(rows: RequestRow[]) {
  return Promise.all(rows.map(async (row) => renderOoPanelPng(row.numerator, row.denominator)));
}

async function renderTextPanelPng(
  text: string,
  symbols: RequestRow["symbols"],
  fontSize: number,
) {
  const font = await getEmbeddedFont();
  const visibleSymbols = symbols.filter(
    (symbol): symbol is Exclude<SymbolOption, "-"> => symbol !== "-",
  );
  const lines = text.split("\n");
  const normalizedFontSize = normalizeFontSize(fontSize);
  const metrics = measureLines(lines, font, normalizedFontSize);
  const textBlockHeight = metrics.totalHeight + (lines.length - 1) * TEXT_LINE_SPACING;
  const textHeight = textBlockHeight + TEXT_TOP_PADDING + TEXT_BOTTOM_PADDING;
  const panelHeight = textHeight + SYMBOL_TOP_GAP + SYMBOL_WIDTH + BOTTOM_PADDING;
  const svg = `
    <svg width="${CANVAS_WIDTH}" height="${panelHeight}" viewBox="0 0 ${CANVAS_WIDTH} ${panelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${BACKGROUND}" stroke="${PINK}" stroke-width="${PANEL_BORDER_WIDTH}" />
      ${renderTextPaths(lines, font, metrics, normalizedFontSize)}
      ${renderSymbols(visibleSymbols, textHeight)}
    </svg>
  `;

  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}

async function renderTitleBannerPng(title: string) {
  const font = await getEmbeddedFont();
  const safeTitle = title.trim() || "TITLE";
  const fontSize = fitTitleFontSize(safeTitle, font);
  const pathData = font.getPath(safeTitle, 0, 0, fontSize).toPathData(3);
  const bounds = font.getPath(safeTitle, 0, 0, fontSize).getBoundingBox();
  const textWidth = Math.max(0, bounds.x2 - bounds.x1);
  const textHeight = Math.max(fontSize, bounds.y2 - bounds.y1);
  const x = Math.max(TITLE_TEXT_PADDING_X, (TITLE_BANNER_WIDTH - textWidth) / 2);
  const baseline = TITLE_BANNER_HEIGHT / 2 + textHeight / 2 - bounds.y2;

  const svg = `
    <svg width="${TITLE_BANNER_WIDTH}" height="${TITLE_BANNER_HEIGHT}" viewBox="0 0 ${TITLE_BANNER_WIDTH} ${TITLE_BANNER_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="gold" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#fff7cf" />
          <stop offset="16%" stop-color="${GOLD_TOP}" />
          <stop offset="36%" stop-color="#f0cf78" />
          <stop offset="50%" stop-color="${GOLD_MID}" />
          <stop offset="68%" stop-color="#b97f1f" />
          <stop offset="100%" stop-color="${GOLD_BOTTOM}" />
        </linearGradient>
        <linearGradient id="shine" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.35" />
          <stop offset="35%" stop-color="#ffffff" stop-opacity="0.05" />
          <stop offset="70%" stop-color="#ffffff" stop-opacity="0.18" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
        </linearGradient>
      </defs>
      <rect width="100%" height="100%" rx="0" fill="${TITLE_RED}" />
      <path d="${pathData}" fill="url(#gold)" stroke="#000000" stroke-width="${8 * RENDER_SCALE}" paint-order="stroke fill" transform="translate(${x - bounds.x1}, ${baseline})" />
      <path d="${pathData}" fill="url(#shine)" opacity="0.85" transform="translate(${x - bounds.x1}, ${baseline})" />
    </svg>
  `;

  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}

async function renderOoPanelPng(numerator: number, denominator: number) {
  const font = await getOoMinchoFont();
  const numeratorText = String(numerator);
  const denominatorText = String(denominator);
  const fontSize = fitOoFontSize([numeratorText, denominatorText], font, OO_BOX_WIDTH / 2);
  const slashFontSize = Math.max(24 * OO_RENDER_SCALE, Math.round(fontSize * OO_SLASH_FONT_SCALE));
  const numeratorPath = font.getPath(numeratorText, 0, 0, fontSize);
  const slashPath = font.getPath("/", 0, 0, slashFontSize);
  const denominatorPath = font.getPath(denominatorText, 0, 0, fontSize);
  const numeratorBounds = numeratorPath.getBoundingBox();
  const slashBounds = slashPath.getBoundingBox();
  const denominatorBounds = denominatorPath.getBoundingBox();
  const boxWidth = OO_BOX_WIDTH;
  const width = boxWidth + OO_BOX_BORDER * 2;
  const height = OO_BOX_HEIGHT + OO_BOX_BORDER * 2;
  const boxLeft = OO_BOX_BORDER;
  const boxTop = OO_BOX_BORDER;
  const boxCenterY = boxTop + OO_BOX_HEIGHT / 2;
  const leftCenterX = boxLeft + OO_BOX_WIDTH / 4;
  const middleCenterX = boxLeft + OO_BOX_WIDTH / 2;
  const rightCenterX = boxLeft + (OO_BOX_WIDTH * 3) / 4;
  const numeratorTransform = centerPathInBox(numeratorBounds, leftCenterX, boxCenterY);
  const slashTransform = centerPathInBox(slashBounds, middleCenterX, boxCenterY);
  const denominatorTransform = centerPathInBox(denominatorBounds, rightCenterX, boxCenterY);

  const svg = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${OO_BOX_BORDER}" y="${OO_BOX_BORDER}" width="${boxWidth}" height="${OO_BOX_HEIGHT}" fill="#ffffff" stroke="#000000" stroke-width="${OO_BOX_BORDER}" />
      <path d="${numeratorPath.toPathData(3)}" fill="#000000" transform="translate(${numeratorTransform.x}, ${numeratorTransform.y})" />
      <path d="${slashPath.toPathData(3)}" fill="#000000" transform="translate(${slashTransform.x}, ${slashTransform.y})" />
      <path d="${denominatorPath.toPathData(3)}" fill="#000000" transform="translate(${denominatorTransform.x}, ${denominatorTransform.y})" />
    </svg>
  `;

  return sharp(Buffer.from(svg, "utf8")).png().toBuffer();
}

function fitOoFontSize(labels: string[], font: Font, boxWidth: number) {
  const maxTextHeight = OO_BOX_HEIGHT - OO_BOX_PADDING_Y * 2;
  const maxTextWidth = Math.max(1, boxWidth - OO_BOX_PADDING_X * 2);

  for (let size = OO_BOX_FONT_SIZE; size >= 24 * OO_RENDER_SCALE; size -= OO_RENDER_SCALE) {
    const fits = labels.every((label) => {
      const bounds = font.getPath(label, 0, 0, size).getBoundingBox();
      const width = Math.max(0, bounds.x2 - bounds.x1);
      const height = Math.max(0, bounds.y2 - bounds.y1);
      return width <= maxTextWidth && height <= maxTextHeight;
    });

    if (fits) {
      return size;
    }
  }

  return 24 * OO_RENDER_SCALE;
}

function fitTitleFontSize(title: string, font: Font) {
  const maxTextHeight = TITLE_BANNER_HEIGHT - 24;
  for (let size = TITLE_MAX_FONT_SIZE; size >= TITLE_MIN_FONT_SIZE; size -= 2) {
    const bounds = font.getPath(title, 0, 0, size).getBoundingBox();
    const width = Math.max(0, bounds.x2 - bounds.x1);
    const height = Math.max(0, bounds.y2 - bounds.y1);
    if (
      width <= TITLE_BANNER_WIDTH - TITLE_TEXT_PADDING_X * 2 &&
      height <= maxTextHeight
    ) {
      return size;
    }
  }

  return TITLE_MIN_FONT_SIZE;
}

function centerPathInBox(bounds: { x1: number; y1: number; x2: number; y2: number }, centerX: number, centerY: number) {
  return {
    x: centerX - (bounds.x1 + bounds.x2) / 2,
    y: centerY - (bounds.y1 + bounds.y2) / 2,
  };
}

function renderSymbols(
  symbols: Array<Exclude<SymbolOption, "-">>,
  textHeight: number,
  offsetX = 0,
  offsetY = 0,
) {
  if (symbols.length === 0) {
    return "";
  }

  const totalWidth =
    symbols.length * SYMBOL_WIDTH + (symbols.length - 1) * SYMBOL_GROUP_SPACING;
  const startX = (CANVAS_WIDTH - totalWidth) / 2;
  const topY = textHeight + SYMBOL_TOP_GAP;

  return symbols
    .map((symbol, index) => {
      const left = startX + index * (SYMBOL_WIDTH + SYMBOL_GROUP_SPACING);
      switch (symbol) {
        case "circle":
          return `<circle cx="${offsetX + left + SYMBOL_WIDTH / 2}" cy="${offsetY + topY + SYMBOL_WIDTH / 2}" r="${SYMBOL_WIDTH / 2 - SYMBOL_STROKE / 2 + CIRCLE_RADIUS_BONUS}" fill="none" stroke="${BLUE}" stroke-width="${SYMBOL_STROKE}" />`;
        case "cross":
          return [
            `<line x1="${offsetX + left + 18 * RENDER_SCALE}" y1="${offsetY + topY + 18 * RENDER_SCALE}" x2="${offsetX + left + SYMBOL_WIDTH - 18 * RENDER_SCALE}" y2="${offsetY + topY + SYMBOL_WIDTH - 18 * RENDER_SCALE}" stroke="${RED}" stroke-width="${SYMBOL_STROKE + 12 * RENDER_SCALE}" stroke-linecap="square" />`,
            `<line x1="${offsetX + left + SYMBOL_WIDTH - 18 * RENDER_SCALE}" y1="${offsetY + topY + 18 * RENDER_SCALE}" x2="${offsetX + left + 18 * RENDER_SCALE}" y2="${offsetY + topY + SYMBOL_WIDTH - 18 * RENDER_SCALE}" stroke="${RED}" stroke-width="${SYMBOL_STROKE + 12 * RENDER_SCALE}" stroke-linecap="square" />`,
          ].join("");
        case "triangle":
          return `<polygon points="${offsetX + left + SYMBOL_WIDTH / 2},${offsetY + topY + 8 * RENDER_SCALE} ${offsetX + left + SYMBOL_WIDTH - 10 * RENDER_SCALE},${offsetY + topY + SYMBOL_WIDTH - 12 * RENDER_SCALE} ${offsetX + left + 10 * RENDER_SCALE},${offsetY + topY + SYMBOL_WIDTH - 12 * RENDER_SCALE}" fill="none" stroke="${ORANGE}" stroke-width="${SYMBOL_STROKE}" stroke-linejoin="miter" />`;
        default:
          return "";
      }
    })
    .join("");
}

function renderTextPaths(
  lines: string[],
  font: Font,
  metrics: {
    lineMetrics: Array<{ left: number; width: number; height: number; top: number }>;
    totalHeight: number;
  },
  fontSize: number,
  offsetX = 0,
  offsetY = 0,
) {
  let currentTop = TEXT_TOP_PADDING;

  return lines
    .map((line, index) => {
      const lineMetric = metrics.lineMetrics[index];
      // Center the visible outline, not just the glyph advance box.
      const x = offsetX + (CANVAS_WIDTH - lineMetric.width) / 2 - lineMetric.left;
      const baselineY = offsetY + currentTop - lineMetric.top;
      currentTop += lineMetric.height + TEXT_LINE_SPACING;

      const pathData = font.getPath(line, x, baselineY, fontSize).toPathData(3);
      return `<path d="${pathData}" fill="${TEXT_COLOR}" />`;
    })
    .join("");
}

function measureLines(lines: string[], font: Font, fontSize: number) {
  const lineMetrics = lines.map((line) => {
    const path = font.getPath(line, 0, 0, fontSize);
    const box = path.getBoundingBox();
    return {
      left: box.x1,
      width: Math.max(0, box.x2 - box.x1),
      height: Math.max(fontSize, box.y2 - box.y1),
      top: box.y1,
    };
  });

  const totalHeight = lineMetrics.reduce((sum, metric) => sum + metric.height, 0);
  return { lineMetrics, totalHeight };
}

function toAsciiDownloadName(value: string) {
  const normalized = value.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
  const cleaned = normalized.replace(/["\\]/g, "").trim();
  return cleaned || "generated-images.zip";
}

function buildContentDisposition(asciiName: string, utf8Name: string) {
  return `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeRFC5987ValueChars(utf8Name)}`;
}

function encodeRFC5987ValueChars(value: string) {
  return encodeURIComponent(value)
    .replace(/['()]/g, escape)
    .replace(/\*/g, "%2A");
}

async function getEmbeddedFont() {
  if (!embeddedFontPromise) {
    embeddedFontPromise = readFile(EMBEDDED_FONT_PATH).then((fontBuffer) =>
      opentype.parse(fontBuffer.buffer.slice(
        fontBuffer.byteOffset,
        fontBuffer.byteOffset + fontBuffer.byteLength,
      )),
    );
  }

  return embeddedFontPromise;
}

async function getOoMinchoFont() {
  if (!ooMinchoFontPromise) {
    ooMinchoFontPromise = readFile(OO_MINCHO_FONT_PATH).then((fontBuffer) =>
      opentype.parse(fontBuffer.buffer.slice(
        fontBuffer.byteOffset,
        fontBuffer.byteOffset + fontBuffer.byteLength,
      )),
    );
  }

  return ooMinchoFontPromise;
}

function sanitizeFileComponent(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);
}
