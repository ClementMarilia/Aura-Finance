// PCM WAV keeps the server's 30-second validation independent of browser codecs.
export function encodeWav(samples, sampleRate) {
  const count = Math.min(480000, Math.floor(samples.length * 16000 / sampleRate));
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
  text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true); text(8, "WAVE"); text(12, "fmt ");
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, "data"); view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    const start = Math.floor(index * sampleRate / 16000);
    const end = Math.min(samples.length, Math.max(start + 1, Math.floor((index + 1) * sampleRate / 16000)));
    let sum = 0;
    for (let i = start; i < end; i++) sum += samples[i];
    const value = Math.max(-1, Math.min(1, sum / (end - start)));
    view.setInt16(44 + index * 2, value * (value < 0 ? 32768 : 32767), true);
  }
  let binary = "";
  new Uint8Array(buffer).forEach(value => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

export async function startRecording(onComplete) {
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!navigator.mediaDevices?.getUserMedia || !Context) throw new Error("unsupported");
  const context = new Context();
  let stream;
  try {
    await context.resume();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    await context.close();
    throw error;
  }
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const chunks = [];
  let size = 0;
  let ended = false;
  processor.onaudioprocess = event => {
    const chunk = event.inputBuffer.getChannelData(0).slice();
    if (size < context.sampleRate * 30) { chunks.push(chunk); size += chunk.length; }
  };
  source.connect(processor); processor.connect(context.destination);
  const finish = async (cancel = false) => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    processor.disconnect(); source.disconnect(); stream.getTracks().forEach(track => track.stop());
    const samples = new Float32Array(size);
    let offset = 0;
    chunks.forEach(chunk => { samples.set(chunk, offset); offset += chunk.length; });
    const sampleRate = context.sampleRate;
    await context.close();
    if (!cancel) onComplete(encodeWav(samples, sampleRate));
  };
  const timer = setTimeout(() => finish(), 30000);
  return { stop: () => finish(), cancel: () => finish(true) };
}
