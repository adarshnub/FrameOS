const sampleRate = 8_000;
const durationSeconds = 4;
const samples = Buffer.alloc(sampleRate * durationSeconds * 4);

for (let index = 0; index < sampleRate * durationSeconds; index += 1) {
  const seconds = index / sampleRate;
  const inPulse = [1, 2, 3].some(
    (beat) => seconds >= beat && seconds < beat + 0.1,
  );
  samples.writeFloatLE(inPulse ? 0.8 : 0.01, index * 4);
}

process.stdout.write(samples);
