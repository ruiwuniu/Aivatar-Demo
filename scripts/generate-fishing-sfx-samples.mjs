import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = resolve(SCRIPT_DIR, "../public/audio/fishing-samples");

let randomState = 0x41_49_56_41;
const random = () => {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 0x1_00_00_00_00;
};

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

const equalPowerPan = (pan) => {
  const angle = ((clamp(pan, -1, 1) + 1) * Math.PI) / 4;
  return [Math.cos(angle), Math.sin(angle)];
};

const envelope = (progress, attack = 0.03, releasePower = 2) => {
  const attackGain = attack <= 0 ? 1 : Math.min(1, progress / attack);
  return attackGain * Math.pow(Math.max(0, 1 - progress), releasePower);
};

class Sound {
  constructor(durationSeconds) {
    this.duration = durationSeconds;
    this.length = Math.ceil(durationSeconds * SAMPLE_RATE);
    this.left = new Float64Array(this.length);
    this.right = new Float64Array(this.length);
  }

  add(index, value, pan = 0) {
    if (index < 0 || index >= this.length) return;
    const [leftGain, rightGain] = equalPowerPan(pan);
    this.left[index] += value * leftGain;
    this.right[index] += value * rightGain;
  }

  tone({
    start = 0,
    duration,
    fromHz,
    toHz = fromHz,
    amplitude = 0.25,
    pan = 0,
    panTo = pan,
    waveform = "sine",
    attack = 0.02,
    releasePower = 2,
    vibratoHz = 0,
    vibratoDepth = 0,
    tremoloHz = 0,
    tremoloDepth = 0,
  }) {
    const startIndex = Math.floor(start * SAMPLE_RATE);
    const sampleCount = Math.ceil(duration * SAMPLE_RATE);
    let phase = 0;
    for (let offset = 0; offset < sampleCount; offset += 1) {
      const progress = offset / Math.max(1, sampleCount - 1);
      const time = offset / SAMPLE_RATE;
      const baseFrequency = fromHz * Math.pow(toHz / fromHz, progress);
      const frequency =
        baseFrequency *
        (1 + Math.sin(time * Math.PI * 2 * vibratoHz) * vibratoDepth);
      phase += (frequency * Math.PI * 2) / SAMPLE_RATE;
      const cycle = phase / (Math.PI * 2);
      let sample;
      if (waveform === "triangle") {
        sample = 2 * Math.abs(2 * (cycle - Math.floor(cycle + 0.5))) - 1;
      } else if (waveform === "square") {
        sample = Math.sin(phase) >= 0 ? 1 : -1;
      } else if (waveform === "soft-square") {
        sample = Math.tanh(Math.sin(phase) * 2.5);
      } else {
        sample = Math.sin(phase);
      }
      const tremolo =
        1 - tremoloDepth + tremoloDepth * (0.5 + Math.sin(time * Math.PI * 2 * tremoloHz) * 0.5);
      const gain = envelope(progress, attack, releasePower);
      this.add(
        startIndex + offset,
        sample * amplitude * gain * tremolo,
        pan + (panTo - pan) * progress,
      );
    }
  }

  noise({
    start = 0,
    duration,
    amplitude = 0.18,
    pan = 0,
    panTo = pan,
    cutoffFrom = 900,
    cutoffTo = cutoffFrom,
    attack = 0.04,
    releasePower = 2,
    highPass = false,
  }) {
    const startIndex = Math.floor(start * SAMPLE_RATE);
    const sampleCount = Math.ceil(duration * SAMPLE_RATE);
    let low = 0;
    let previousLow = 0;
    for (let offset = 0; offset < sampleCount; offset += 1) {
      const progress = offset / Math.max(1, sampleCount - 1);
      const cutoff = cutoffFrom * Math.pow(cutoffTo / cutoffFrom, progress);
      const alpha = 1 - Math.exp((-2 * Math.PI * cutoff) / SAMPLE_RATE);
      const white = random() * 2 - 1;
      previousLow = low;
      low += alpha * (white - low);
      const filtered = highPass ? white - (low + previousLow) * 0.5 : low;
      const gain = envelope(progress, attack, releasePower);
      this.add(
        startIndex + offset,
        filtered * amplitude * gain,
        pan + (panTo - pan) * progress,
      );
    }
  }

  click({ start, amplitude = 0.35, pan = 0, brightness = 1 }) {
    const index = Math.floor(start * SAMPLE_RATE);
    const length = Math.floor((0.008 + brightness * 0.006) * SAMPLE_RATE);
    for (let offset = 0; offset < length; offset += 1) {
      const progress = offset / Math.max(1, length - 1);
      const body =
        (random() * 2 - 1) * 0.65 +
        Math.sin(progress * Math.PI * (5 + brightness * 9)) * 0.35;
      this.add(index + offset, body * amplitude * Math.pow(1 - progress, 4), pan);
    }
  }

  normalize(targetPeak = 0.88) {
    let peak = 0;
    for (let index = 0; index < this.length; index += 1) {
      peak = Math.max(peak, Math.abs(this.left[index]), Math.abs(this.right[index]));
    }
    const scale = peak > 0 ? targetPeak / peak : 1;
    const fadeSamples = Math.floor(SAMPLE_RATE * 0.006);
    for (let index = 0; index < this.length; index += 1) {
      const fadeIn = Math.min(1, index / fadeSamples);
      const fadeOut = Math.min(1, (this.length - 1 - index) / fadeSamples);
      const fade = Math.max(0, Math.min(fadeIn, fadeOut));
      this.left[index] = clamp(this.left[index] * scale * fade, -1, 1);
      this.right[index] = clamp(this.right[index] * scale * fade, -1, 1);
    }
  }

  toWaveBuffer() {
    const bytesPerSample = 2;
    const dataSize = this.length * CHANNELS * bytesPerSample;
    const buffer = Buffer.alloc(44 + dataSize);
    buffer.write("RIFF", 0);
    buffer.writeUInt32LE(36 + dataSize, 4);
    buffer.write("WAVE", 8);
    buffer.write("fmt ", 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(CHANNELS, 22);
    buffer.writeUInt32LE(SAMPLE_RATE, 24);
    buffer.writeUInt32LE(SAMPLE_RATE * CHANNELS * bytesPerSample, 28);
    buffer.writeUInt16LE(CHANNELS * bytesPerSample, 32);
    buffer.writeUInt16LE(bytesPerSample * 8, 34);
    buffer.write("data", 36);
    buffer.writeUInt32LE(dataSize, 40);
    for (let index = 0; index < this.length; index += 1) {
      const outputIndex = 44 + index * 4;
      buffer.writeInt16LE(Math.round(this.left[index] * 32767), outputIndex);
      buffer.writeInt16LE(Math.round(this.right[index] * 32767), outputIndex + 2);
    }
    return buffer;
  }
}

const addWaterDrop = (sound, start, pan = 0, pitch = 1, strength = 1) => {
  sound.tone({
    start,
    duration: 0.22,
    fromHz: 330 * pitch,
    toHz: 105 * pitch,
    amplitude: 0.4 * strength,
    pan,
    attack: 0.005,
    releasePower: 3,
  });
  sound.noise({
    start,
    duration: 0.12,
    amplitude: 0.18 * strength,
    pan,
    cutoffFrom: 2600,
    cutoffTo: 500,
    attack: 0.004,
    releasePower: 4,
  });
};

const addRatchet = (
  sound,
  { start, duration, count, amplitude = 0.22, pan = 0, accelerating = false },
) => {
  for (let index = 0; index < count; index += 1) {
    const progress = index / Math.max(1, count - 1);
    const warped = accelerating ? 1 - Math.pow(1 - progress, 1.65) : progress;
    sound.click({
      start: start + duration * warped,
      amplitude: amplitude * (0.82 + progress * 0.18),
      pan: pan + Math.sin(index * 1.7) * 0.12,
      brightness: 0.55 + progress * 0.45,
    });
  }
};

const samples = [
  {
    file: "fishing-cast-a-natural-swish.wav",
    duration: 0.82,
    make(sound) {
      sound.noise({
        start: 0.02,
        duration: 0.66,
        amplitude: 0.32,
        pan: -0.35,
        panTo: 0.5,
        cutoffFrom: 780,
        cutoffTo: 5200,
        attack: 0.12,
        releasePower: 1.7,
        highPass: true,
      });
      sound.tone({
        start: 0.08,
        duration: 0.48,
        fromHz: 170,
        toHz: 620,
        amplitude: 0.13,
        pan: -0.2,
        panTo: 0.38,
        waveform: "triangle",
        attack: 0.09,
        releasePower: 2.4,
      });
      sound.click({ start: 0.59, amplitude: 0.22, pan: 0.42, brightness: 0.65 });
    },
  },
  {
    file: "fishing-cast-b-pixel-swoop.wav",
    duration: 0.68,
    make(sound) {
      const notes = [247, 294, 370, 494, 659];
      notes.forEach((frequency, index) => {
        sound.tone({
          start: 0.055 + index * 0.075,
          duration: 0.2,
          fromHz: frequency,
          toHz: frequency * 1.06,
          amplitude: 0.18,
          pan: -0.45 + index * 0.22,
          waveform: "soft-square",
          attack: 0.01,
          releasePower: 3.2,
        });
      });
      sound.noise({
        start: 0.04,
        duration: 0.48,
        amplitude: 0.12,
        pan: -0.4,
        panTo: 0.48,
        cutoffFrom: 1700,
        cutoffTo: 6200,
        attack: 0.08,
        releasePower: 2,
        highPass: true,
      });
    },
  },
  {
    file: "fishing-cast-c-line-and-plop.wav",
    duration: 1.04,
    make(sound) {
      sound.noise({
        start: 0.02,
        duration: 0.58,
        amplitude: 0.27,
        pan: -0.5,
        panTo: 0.42,
        cutoffFrom: 950,
        cutoffTo: 4800,
        attack: 0.12,
        releasePower: 1.8,
        highPass: true,
      });
      sound.tone({
        start: 0.08,
        duration: 0.46,
        fromHz: 190,
        toHz: 760,
        amplitude: 0.12,
        pan: -0.35,
        panTo: 0.35,
        waveform: "triangle",
        attack: 0.08,
        releasePower: 2.2,
      });
      addWaterDrop(sound, 0.65, 0.48, 0.76, 0.78);
      addWaterDrop(sound, 0.76, 0.25, 1.35, 0.25);
    },
  },
  {
    file: "fishing-bite-a-bobber-dip.wav",
    duration: 0.5,
    make(sound) {
      addWaterDrop(sound, 0.025, 0.05, 0.72, 1);
      sound.tone({
        start: 0.08,
        duration: 0.31,
        fromHz: 190,
        toHz: 125,
        amplitude: 0.2,
        pan: -0.08,
        waveform: "triangle",
        attack: 0.01,
        releasePower: 3.5,
        vibratoHz: 19,
        vibratoDepth: 0.035,
      });
    },
  },
  {
    file: "fishing-bite-b-double-tug.wav",
    duration: 0.66,
    make(sound) {
      [0.03, 0.26].forEach((start, index) => {
        sound.tone({
          start,
          duration: 0.31,
          fromHz: 280 + index * 60,
          toHz: 150 + index * 24,
          amplitude: 0.31 - index * 0.03,
          pan: index === 0 ? -0.2 : 0.18,
          waveform: "triangle",
          attack: 0.008,
          releasePower: 3.8,
          vibratoHz: 24,
          vibratoDepth: 0.055,
        });
        sound.click({
          start,
          amplitude: 0.19,
          pan: index === 0 ? -0.2 : 0.18,
          brightness: 0.72,
        });
      });
      sound.noise({
        start: 0.24,
        duration: 0.28,
        amplitude: 0.09,
        cutoffFrom: 1800,
        cutoffTo: 700,
        releasePower: 3,
      });
    },
  },
  {
    file: "fishing-bite-c-pixel-alert.wav",
    duration: 0.7,
    make(sound) {
      [0, 0.16, 0.33].forEach((offset, index) => {
        const frequency = [587, 784, 988][index];
        sound.tone({
          start: 0.025 + offset,
          duration: 0.25,
          fromHz: frequency,
          toHz: frequency,
          amplitude: 0.22,
          pan: -0.2 + index * 0.2,
          waveform: "soft-square",
          attack: 0.008,
          releasePower: 3.2,
        });
      });
      addWaterDrop(sound, 0.34, 0.16, 1.1, 0.42);
    },
  },
  {
    file: "fishing-reel-a-ratchet.wav",
    duration: 1.3,
    make(sound) {
      addRatchet(sound, {
        start: 0.035,
        duration: 1.06,
        count: 19,
        amplitude: 0.23,
        accelerating: true,
      });
      sound.tone({
        start: 0.03,
        duration: 1.12,
        fromHz: 98,
        toHz: 156,
        amplitude: 0.12,
        waveform: "triangle",
        attack: 0.06,
        releasePower: 1.2,
        tremoloHz: 15,
        tremoloDepth: 0.65,
      });
      sound.noise({
        start: 0.03,
        duration: 1.12,
        amplitude: 0.1,
        cutoffFrom: 850,
        cutoffTo: 2100,
        attack: 0.05,
        releasePower: 1.4,
        highPass: true,
      });
    },
  },
  {
    file: "fishing-reel-b-line-tension.wav",
    duration: 1.46,
    make(sound) {
      addRatchet(sound, {
        start: 0.05,
        duration: 1.12,
        count: 14,
        amplitude: 0.16,
        pan: -0.08,
      });
      sound.tone({
        start: 0.04,
        duration: 1.24,
        fromHz: 128,
        toHz: 248,
        amplitude: 0.2,
        pan: -0.15,
        panTo: 0.18,
        waveform: "triangle",
        attack: 0.05,
        releasePower: 1.35,
        vibratoHz: 11,
        vibratoDepth: 0.075,
        tremoloHz: 8,
        tremoloDepth: 0.48,
      });
      sound.noise({
        start: 0.18,
        duration: 1.08,
        amplitude: 0.14,
        pan: 0.2,
        panTo: -0.08,
        cutoffFrom: 1600,
        cutoffTo: 3100,
        attack: 0.08,
        releasePower: 1.6,
        highPass: true,
      });
      addWaterDrop(sound, 0.88, 0.35, 1.2, 0.25);
      addWaterDrop(sound, 1.05, 0.18, 1.55, 0.18);
    },
  },
  {
    file: "fishing-reel-c-pixel-crank.wav",
    duration: 1.18,
    make(sound) {
      const notes = [196, 220, 247, 294, 330, 392, 440, 494];
      notes.forEach((frequency, index) => {
        sound.tone({
          start: 0.03 + index * 0.115,
          duration: 0.25,
          fromHz: frequency,
          toHz: frequency * 1.035,
          amplitude: 0.16,
          pan: index % 2 === 0 ? -0.18 : 0.18,
          waveform: "soft-square",
          attack: 0.008,
          releasePower: 2.8,
        });
        sound.click({
          start: 0.035 + index * 0.115,
          amplitude: 0.13,
          pan: index % 2 === 0 ? -0.2 : 0.2,
          brightness: 0.7,
        });
      });
    },
  },
  {
    file: "fishing-display-a-fish-flop-and-glint.wav",
    duration: 1.16,
    make(sound) {
      addWaterDrop(sound, 0.025, -0.25, 0.63, 0.78);
      sound.noise({
        start: 0.04,
        duration: 0.27,
        amplitude: 0.24,
        pan: -0.3,
        panTo: 0.15,
        cutoffFrom: 520,
        cutoffTo: 1500,
        attack: 0.01,
        releasePower: 3.5,
      });
      [659, 880, 1175].forEach((frequency, index) => {
        sound.tone({
          start: 0.27 + index * 0.11,
          duration: 0.64 - index * 0.07,
          fromHz: frequency,
          toHz: frequency,
          amplitude: 0.18 - index * 0.02,
          pan: -0.2 + index * 0.22,
          waveform: "triangle",
          attack: 0.008,
          releasePower: 3,
          vibratoHz: 6,
          vibratoDepth: 0.008,
        });
      });
    },
  },
  {
    file: "fishing-display-b-sparkle.wav",
    duration: 1.05,
    make(sound) {
      [523, 659, 784, 1047, 1319].forEach((frequency, index) => {
        sound.tone({
          start: 0.025 + index * 0.085,
          duration: 0.72 - index * 0.055,
          fromHz: frequency,
          toHz: frequency,
          amplitude: 0.18 - index * 0.016,
          pan: -0.5 + index * 0.25,
          waveform: "triangle",
          attack: 0.006,
          releasePower: 3.4,
          vibratoHz: 7,
          vibratoDepth: 0.006,
        });
      });
      sound.noise({
        start: 0.05,
        duration: 0.58,
        amplitude: 0.075,
        pan: -0.45,
        panTo: 0.45,
        cutoffFrom: 4700,
        cutoffTo: 9200,
        attack: 0.06,
        releasePower: 2.5,
        highPass: true,
      });
    },
  },
  {
    file: "fishing-display-c-pixel-fanfare.wav",
    duration: 1.34,
    make(sound) {
      const sequence = [
        { start: 0.02, frequency: 392, length: 0.22 },
        { start: 0.18, frequency: 523, length: 0.22 },
        { start: 0.34, frequency: 659, length: 0.24 },
        { start: 0.53, frequency: 784, length: 0.54 },
      ];
      sequence.forEach(({ start, frequency, length }, index) => {
        sound.tone({
          start,
          duration: length,
          fromHz: frequency,
          toHz: frequency,
          amplitude: 0.22,
          pan: -0.18 + index * 0.12,
          waveform: "soft-square",
          attack: 0.008,
          releasePower: index === sequence.length - 1 ? 1.8 : 3,
          vibratoHz: index === sequence.length - 1 ? 7 : 0,
          vibratoDepth: index === sequence.length - 1 ? 0.012 : 0,
        });
        sound.tone({
          start,
          duration: length,
          fromHz: frequency / 2,
          toHz: frequency / 2,
          amplitude: 0.09,
          pan: 0.15 - index * 0.08,
          waveform: "triangle",
          attack: 0.008,
          releasePower: 2.6,
        });
      });
      sound.tone({
        start: 0.55,
        duration: 0.56,
        fromHz: 988,
        toHz: 988,
        amplitude: 0.12,
        pan: 0.32,
        waveform: "triangle",
        attack: 0.01,
        releasePower: 2.2,
      });
    },
  },
];

mkdirSync(OUTPUT_DIR, { recursive: true });

for (const sample of samples) {
  const outputPath = resolve(OUTPUT_DIR, sample.file);
  if (existsSync(outputPath)) {
    throw new Error(`Refusing to overwrite existing sample: ${outputPath}`);
  }
  const sound = new Sound(sample.duration);
  sample.make(sound);
  sound.normalize();
  writeFileSync(outputPath, sound.toWaveBuffer());
  console.log(`Created ${outputPath}`);
}
