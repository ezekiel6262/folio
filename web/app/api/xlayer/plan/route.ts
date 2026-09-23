import { NextResponse } from "next/server";
import { allocateXLayer } from "@/lib/xlayer-allocator";

export const dynamic = "force-dynamic";

/** The folio agent. A sentence in, a signed-by-the-user basket out. Folio does not hold the assets. */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { prompt?: string; locked?: boolean };
    const prompt = (body.prompt ?? "").trim();
    if (!prompt) return NextResponse.json({ error: "Describe the folio first" }, { status: 400 });
    if (prompt.length > 280) return NextResponse.json({ error: "Keep the sentence under 280 characters" }, { status: 400 });
    const allocation = allocateXLayer({ prompt, locked: Boolean(body.locked) });
    return NextResponse.json({ allocation });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
