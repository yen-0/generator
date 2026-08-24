import { NextResponse } from "next/server";

import { buildGenerationResponse } from "@/features/image-sheet-generator/generator-render";
import { parseGeneratorPayload } from "@/features/image-sheet-generator/generator-shared";

export async function POST(request: Request) {
  try {
    const payload = parseGeneratorPayload(await request.json());
    const rows = payload.rows.map((row) => ({
      text: row.text,
      symbols: row.symbols,
      fontSize: row.fontSize,
      numerator: row.numerator,
      denominator: row.denominator,
    }));
    const generation = await buildGenerationResponse(
      payload.title,
      payload.mode,
      rows,
      payload.denominatorMode,
    );

    return new Response(generation.body, {
      status: 200,
      headers: generation.headers,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
