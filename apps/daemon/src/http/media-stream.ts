import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyReply, FastifyRequest } from "fastify";

/** A single HTTP byte range. A browser can seek without buffering the source. */
export function byteRange(
  header: string,
  size: number,
): { start: number; end: number } | undefined {
  const match = /^bytes=(\d*)-(\d*)$/u.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size === 0) return;
  const first = match[1] ? Number(match[1]) : undefined;
  const last = match[2] ? Number(match[2]) : undefined;
  if ([first, last].some((n) => n !== undefined && !Number.isSafeInteger(n)))
    return;
  const start = first ?? Math.max(0, size - (last ?? 0));
  const end =
    first === undefined ? size - 1 : Math.min(last ?? size - 1, size - 1);
  if (start < 0 || start >= size || end < start) return;
  return { start, end };
}

export async function sendMediaFile(
  request: FastifyRequest,
  reply: FastifyReply,
  path: string,
) {
  const info = await stat(path);
  const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
  reply
    .header("Accept-Ranges", "bytes")
    .header("Cache-Control", "private, no-cache")
    .header("ETag", etag)
    .header("Last-Modified", info.mtime.toUTCString());
  const range = request.headers.range;
  const ifRange = request.headers["if-range"];
  if (
    range &&
    (!ifRange || ifRange === etag || ifRange === info.mtime.toUTCString())
  ) {
    const selected = byteRange(range, info.size);
    if (!selected)
      return reply
        .code(416)
        .header("Content-Range", `bytes */${info.size}`)
        .send();
    reply
      .code(206)
      .header(
        "Content-Range",
        `bytes ${selected.start}-${selected.end}/${info.size}`,
      )
      .header("Content-Length", selected.end - selected.start + 1);
    return reply.send(createReadStream(path, selected));
  }
  reply.header("Content-Length", info.size);
  // Fastify strips HEAD bodies itself; sending undefined resets Content-Length.
  return reply.send(createReadStream(path));
}
