// MP3 frame helpers (MPEG-1 Layer III, 44.1 kHz): frame list, cut by time, duration. Frame = 1152 samples = 26.12 ms.
const BR = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const SR = [44100, 48000, 32000];
export type Frame = { off: number; len: number };
export function frameList(b: Uint8Array): Frame[] {
  let i = 0;
  if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) i = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  const out: Frame[] = [];
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff || (b[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (b[i + 1] >> 3) & 3, lay = (b[i + 1] >> 1) & 3, bri = b[i + 2] >> 4, sri = (b[i + 2] >> 2) & 3;
    if (ver !== 3 || lay !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const len = Math.floor(144 * BR[bri] * 1000 / SR[sri]) + ((b[i + 2] >> 1) & 1);
    if (i + len > b.length) break;
    out.push({ off: i, len }); i += len;
  }
  // drop a Xing/Info header frame (it would carry the whole file's frame count)
  if (out.length) {
    const h = new TextDecoder().decode(b.subarray(out[0].off, out[0].off + Math.min(64, out[0].len)));
    if (h.includes("Xing") || h.includes("Info")) out.shift();
  }
  return out;
}
export const FRAME_S = 1152 / 44100;
/** bytes of frames [f0, f1) */
export function slice(b: Uint8Array, fr: Frame[], f0: number, f1: number): Uint8Array {
  f0 = Math.max(0, f0); f1 = Math.min(fr.length, f1);
  if (f1 <= f0) return new Uint8Array(0);
  return b.slice(fr[f0].off, fr[f1 - 1].off + fr[f1 - 1].len);
}
