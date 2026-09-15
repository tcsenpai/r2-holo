/** Sliced reads: never load a multi-MB transcript fully into memory. */
import { open } from "node:fs/promises";

export async function readSlice(path: string, start: number, length: number) {
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const from = Math.max(0, Math.min(start, size));
    const len = Math.max(0, Math.min(length, size - from));
    if (len === 0) return "";
    const buf = Buffer.alloc(len);
    await f.read(buf, 0, len, from);
    return buf.toString("utf8");
  } finally {
    await f.close();
  }
}

export async function readTail(path: string, bytes: number) {
  const f = await open(path, "r");
  try {
    const { size } = await f.stat();
    const from = Math.max(0, size - bytes);
    const len = size - from;
    if (len === 0) return { text: "", size };
    const buf = Buffer.alloc(len);
    await f.read(buf, 0, len, from);
    return { text: buf.toString("utf8"), size };
  } finally {
    await f.close();
  }
}
