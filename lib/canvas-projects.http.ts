import { NextResponse } from "next/server";
import { CanvasContractError } from "@/lib/canvas-contract";
import { CanvasProjectError } from "@/lib/canvas-projects.server";

export function canvasProjectErrorResponse(error: unknown, fallback: string) {
  if (error instanceof CanvasProjectError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof CanvasContractError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ error: fallback }, { status: 500 });
}
