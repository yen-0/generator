import JSZip from "jszip";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

const SYMBOL_VALUES = new Set(["-", "circle", "cross", "triangle"]);
const PYTHON_SCRIPT = path.join(process.cwd(), "python", "render_images.py");

type SymbolOption = "-" | "circle" | "cross" | "triangle";

type RequestRow = {
  text: string;
  symbols: [SymbolOption, SymbolOption, SymbolOption];
};

type PythonOutput = {
  files: Array<{
    name: string;
    outputPath: string;
  }>;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      title?: unknown;
      rows?: unknown;
    };

    const title =
      typeof body.title === "string"
        ? body.title
        : "";
    const rows = validateRows(body.rows);
    const rowsToRender = rows.filter((row) => row.text.trim().length > 0);

    if (rowsToRender.length === 0) {
      return NextResponse.json(
        { error: "Add text to at least one row before generating images." },
        { status: 400 },
      );
    }

    const tempDirectory = await fs.mkdtemp(
      path.join(os.tmpdir(), "sheet-image-generator-"),
    );

    try {
      const renderedFiles = await runPythonRenderer({
        title,
        rows: rowsToRender,
        outputDir: tempDirectory,
      });

      const zip = new JSZip();
      await Promise.all(
        renderedFiles.files.map(async (file) => {
          const contents = await fs.readFile(file.outputPath);
          zip.file(file.name, contents);
        }),
      );

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });
      const archiveName = `${sanitizeFileComponent(title) || "generated-images"}.zip`;

      return new Response(new Uint8Array(zipBuffer), {
        status: 200,
        headers: {
          "Content-Type": "application/zip",
          "Content-Disposition": `attachment; filename="${archiveName}"`,
        },
      });
    } finally {
      await fs.rm(tempDirectory, { recursive: true, force: true });
    }
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

async function runPythonRenderer(input: {
  title: string;
  rows: RequestRow[];
  outputDir: string;
}) {
  const payload = JSON.stringify(input);

  return await new Promise<PythonOutput>((resolve, reject) => {
    const child = spawn("python", [PYTHON_SCRIPT], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUTF8: "1",
      },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python renderer failed with code ${code}.`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout) as PythonOutput;
        resolve(parsed);
      } catch {
        reject(new Error("Python renderer returned invalid output."));
      }
    });

    child.stdin.write(payload, "utf8");
    child.stdin.end();
  });
}

function sanitizeFileComponent(value: string) {
  return value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "_")
    .replace(/\.+$/g, "")
    .slice(0, 80);
}
