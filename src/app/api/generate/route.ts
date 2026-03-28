import JSZip from "jszip";
import { readFile } from "node:fs/promises";
import path from "node:path";
import opentype, { type Font } from "opentype.js";
import sharp from "sharp";
import { NextResponse } from "next/server";

const SYMBOL_VALUES = new Set(["-", "circle", "cross", "triangle"]);

const CANVAS_WIDTH = 850;
const TEXT_TOP_PADDING = 5;
const TEXT_BOTTOM_PADDING = 28;
const BOTTOM_PADDING = 24;
const TEXT_SIZE = 200;
const TEXT_LINE_SPACING = 5;
const SYMBOL_WIDTH = 144;
const SYMBOL_STROKE = 28;
const SYMBOL_GROUP_SPACING = 72;
const SYMBOL_TOP_GAP = 5;
const OUTER_PADDING = 28;
const PANEL_GAP = 8;
const PANEL_BORDER_WIDTH = 8;

const TEXT_COLOR = "#000000";
const BACKGROUND = "#FFFFFF";
const BLUE = "#2166F3";
const RED = "#E23D2E";
const ORANGE = "#F28C28";
const PINK = "#FF9CC8";
const EMBEDDED_FONT_PATH = path.join(
  process.cwd(),
  "node_modules",
  "@fontsource",
  "noto-sans-jp",
  "files",
  "noto-sans-jp-japanese-700-normal.woff",
);

type SymbolOption = "-" | "circle" | "cross" | "triangle";

type RequestRow = {
  text: string;
  symbols: [SymbolOption, SymbolOption, SymbolOption];
};

let embeddedFontPromise: Promise<Font> | null = null;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: unknown;
      rows?: unknown;
    };

    const title = typeof body.title === "string" ? body.title : "";
    const rows = validateRows(body.rows);
    const rowsToRender = rows
      .map((row) => ({
        text: normalizeText(row.text),
        symbols: row.symbols,
      }))
      .filter((row) => row.text.length > 0);

    if (rowsToRender.length === 0) {
      return NextResponse.json(
        { error: "Add text to at least one row before generating images." },
        { status: 400 },
      );
    }

    const seenNames = new Map<string, number>();
    const zip = new JSZip();

    const baseFileName = buildCompositeBaseFileName(title);
    const renderedSteps = await renderCumulativePanelPngs(rowsToRender);

    for (const step of renderedSteps) {
      const fileName = uniquifyFilename(
        buildCompositeFileName(baseFileName, step.panelCount),
        seenNames,
      );
      zip.file(fileName, step.png);
    }

    if (zip.file(/.*/).length === 0) {
      return NextResponse.json(
        { error: "Add text to at least one row before generating images." },
        { status: 400 },
      );
    }

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
    const archiveName = `${sanitizeFileComponent(title) || "generated-images"}.zip`;
    const asciiArchiveName = toAsciiDownloadName(archiveName);

    return new Response(new Uint8Array(zipBuffer), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": buildContentDisposition(
          asciiArchiveName,
          archiveName,
        ),
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Image generation failed.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function validateRows(value: unknown): RequestRow[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid request payload.");
  }

  return value.map((row) => {
    if (
      typeof row !== "object" ||
      row === null ||
      typeof (row as { text?: unknown }).text !== "string" ||
      !Array.isArray((row as { symbols?: unknown }).symbols) ||
      (row as { symbols: unknown[] }).symbols.length !== 3
    ) {
      throw new Error("Each row must include text and three symbol selections.");
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
    };
  });
}

function normalizeText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

function buildCompositeBaseFileName(title: string) {
  return sanitizeFileComponent(title) || "generated-images";
}

function buildCompositeFileName(baseName: string, panelCount: number) {
  return `${baseName}_panels_1_to_${panelCount}.png`;
}

function sanitizeFileComponent(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);
}

function uniquifyFilename(filename: string, seenNames: Map<string, number>) {
  const count = seenNames.get(filename) ?? 0;
  if (count === 0) {
    seenNames.set(filename, 1);
    return filename;
  }

  const extensionIndex = filename.lastIndexOf(".");
  const stem =
    extensionIndex === -1 ? filename : filename.slice(0, extensionIndex);
  const suffix = extensionIndex === -1 ? "" : filename.slice(extensionIndex);
  const candidate = `${stem}_${count + 1}${suffix}`;
  seenNames.set(filename, count + 1);
  seenNames.set(candidate, 1);
  return candidate;
}

async function renderCumulativePanelPngs(rows: RequestRow[]) {
  const renderedPanels = await Promise.all(
    rows.map(async (row) => ({
      png: await renderPanelPng(row.text, row.symbols),
    })),
  );
  const panelWidths = await Promise.all(
    renderedPanels.map(async ({ png }) => sharp(png).metadata()),
  );
  const fullWidth =
    Math.max(...panelWidths.map((metadata) => metadata.width ?? 0)) +
    OUTER_PADDING * 2;
  const fullHeight =
    panelWidths.reduce((sum, metadata) => sum + (metadata.height ?? 0), 0) +
    Math.max(0, renderedPanels.length - 1) * PANEL_GAP +
    OUTER_PADDING * 2;

  return Promise.all(
    renderedPanels.map(async (_, index) => {
      let currentTop = OUTER_PADDING;
      const composites = renderedPanels
        .slice(0, index + 1)
        .map(({ png }) => png);
      const layers = [];

      for (const panel of composites) {
        const metadata = await sharp(panel).metadata();
        layers.push({
          input: panel,
          top: currentTop,
          left: OUTER_PADDING,
        });
        currentTop += (metadata.height ?? 0) + PANEL_GAP;
      }

      const png = await sharp({
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

      return {
        panelCount: index + 1,
        png,
      };
    }),
  );
}

async function renderPanelPng(text: string, symbols: RequestRow["symbols"]) {
  const font = await getEmbeddedFont();
  const visibleSymbols = symbols.filter(
    (symbol): symbol is Exclude<SymbolOption, "-"> => symbol !== "-",
  );
  const lines = text.split("\n");
  const metrics = measureLines(lines, font);
  const textBlockHeight =
    metrics.totalHeight + (lines.length - 1) * TEXT_LINE_SPACING;
  const textHeight = textBlockHeight + TEXT_TOP_PADDING + TEXT_BOTTOM_PADDING;
  const panelHeight = textHeight + SYMBOL_TOP_GAP + SYMBOL_WIDTH + BOTTOM_PADDING;
  const svg = `
    <svg width="${CANVAS_WIDTH}" height="${panelHeight}" viewBox="0 0 ${CANVAS_WIDTH} ${panelHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${BACKGROUND}" stroke="${PINK}" stroke-width="${PANEL_BORDER_WIDTH}" />
      ${renderTextPaths(lines, font, metrics)}
      ${renderSymbols(visibleSymbols, textHeight)}
    </svg>
  `;

  return await sharp(Buffer.from(svg, "utf8")).png().toBuffer();
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
          return `<circle cx="${offsetX + left + SYMBOL_WIDTH / 2}" cy="${offsetY + topY + SYMBOL_WIDTH / 2}" r="${SYMBOL_WIDTH / 2 - SYMBOL_STROKE / 2}" fill="none" stroke="${BLUE}" stroke-width="${SYMBOL_STROKE}" />`;
        case "cross":
          return [
            `<line x1="${offsetX + left + 18}" y1="${offsetY + topY + 18}" x2="${offsetX + left + SYMBOL_WIDTH - 18}" y2="${offsetY + topY + SYMBOL_WIDTH - 18}" stroke="${RED}" stroke-width="${SYMBOL_STROKE + 12}" stroke-linecap="square" />`,
            `<line x1="${offsetX + left + SYMBOL_WIDTH - 18}" y1="${offsetY + topY + 18}" x2="${offsetX + left + 18}" y2="${offsetY + topY + SYMBOL_WIDTH - 18}" stroke="${RED}" stroke-width="${SYMBOL_STROKE + 12}" stroke-linecap="square" />`,
          ].join("");
        case "triangle":
          return `<polygon points="${offsetX + left + SYMBOL_WIDTH / 2},${offsetY + topY + 8} ${offsetX + left + SYMBOL_WIDTH - 10},${offsetY + topY + SYMBOL_WIDTH - 12} ${offsetX + left + 10},${offsetY + topY + SYMBOL_WIDTH - 12}" fill="none" stroke="${ORANGE}" stroke-width="${SYMBOL_STROKE}" stroke-linejoin="miter" />`;
        default:
          return "";
      }
    })
    .join("");
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

function renderTextPaths(
  lines: string[],
  font: Font,
  metrics: {
    lineMetrics: Array<{ width: number; height: number; top: number }>;
    totalHeight: number;
  },
  offsetX = 0,
  offsetY = 0,
) {
  let currentTop = TEXT_TOP_PADDING;

  return lines
    .map((line, index) => {
      const lineMetric = metrics.lineMetrics[index];
      const x = offsetX + (CANVAS_WIDTH - lineMetric.width) / 2;
      const baselineY = offsetY + currentTop - lineMetric.top;
      currentTop += lineMetric.height + TEXT_LINE_SPACING;

      const pathData = font
        .getPath(line, x, baselineY, TEXT_SIZE)
        .toPathData(3);

      return `<path d="${pathData}" fill="${TEXT_COLOR}" />`;
    })
    .join("");
}

function measureLines(lines: string[], font: Font) {
  const lineMetrics = lines.map((line) => {
    const path = font.getPath(line, 0, 0, TEXT_SIZE);
    const box = path.getBoundingBox();
    return {
      width: Math.max(0, box.x2 - box.x1),
      height: Math.max(TEXT_SIZE, box.y2 - box.y1),
      top: box.y1,
    };
  });

  const totalHeight = lineMetrics.reduce((sum, metric) => sum + metric.height, 0);

  return {
    lineMetrics,
    totalHeight,
  };
}
