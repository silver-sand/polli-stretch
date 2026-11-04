import type { StretchChunk } from "../types";

/** Validate the service-worker result after sendMessage has unwrapped its envelope. */
export function requireGeneratedChunks(result: unknown): StretchChunk[] {
  if (!Array.isArray(result)) {
    throw new Error("Service worker returned invalid data for GENERATE.");
  }
  return result as StretchChunk[];
}
