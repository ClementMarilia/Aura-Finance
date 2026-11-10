import { encodeWav } from "./aiRecorder";

test("recordings use bounded mono PCM WAV at 16 kHz", () => {
  const encoded = encodeWav(new Float32Array(44100 * 31), 44100);
  const binary = atob(encoded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  expect(binary.slice(0, 4)).toBe("RIFF");
  expect(binary.slice(8, 12)).toBe("WAVE");
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(40, true)).toBe(480000 * 2);
  expect(binary.length).toBe(960044);
});

test("PCM samples are clipped and preserve signed amplitudes", () => {
  const binary = atob(encodeWav(new Float32Array([-2, 0, 2]), 16000));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  expect(view.getInt16(44, true)).toBe(-32768);
  expect(view.getInt16(46, true)).toBe(0);
  expect(view.getInt16(48, true)).toBe(32767);
});
