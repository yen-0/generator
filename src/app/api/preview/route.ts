import { NextResponse } from "next/server";

import { renderPreviewPng } from "@/features/image-sheet-generator/generator-render";
import { parsePreviewPayload } from "@/features/image-sheet-generator/generator-shared";

export async function POST(request: Request) {
  try {
    const payload = parsePreviewPayload(await request.json());
    const png = await renderPreviewPng(payload);

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Content-Length": String(png.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Preview generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
