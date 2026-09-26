"""Original, deterministic vending SFX. Standard library only; no recordings.

Creates three listening examples and the default retro cues. Existing output
files are never overwritten; choose another --output-root to audition changes.
"""
from pathlib import Path
import argparse
import array
import math
import random
import sys
import wave

RATE = 44100
TAU = 2 * math.pi


def blank(seconds):
    return [0.0] * round(seconds * RATE)


def add(dst, src, offset=0.0, gain=1.0):
    first = round(offset * RATE)
    for i, sample in enumerate(src):
        if first + i < len(dst):
            dst[first + i] += sample * gain


def tone(seconds, freq, amp, decay=5.0, end_freq=None, retro=False):
    samples = blank(seconds)
    phase = 0.0
    for i in range(len(samples)):
        t = i / RATE
        u = t / seconds
        f = freq + ((end_freq or freq) - freq) * u
        phase += TAU * f / RATE
        body = math.sin(phase)
        if retro:
            body = (body + math.sin(3 * phase) / 5 + math.sin(5 * phase) / 12) / 1.28
        edge = min(1.0, t / .005, (seconds - t) / .012)
        samples[i] = body * amp * edge * math.exp(-decay * u)
    return samples


def friction(seconds, amp, seed, motor=0.0):
    rng = random.Random(seed)
    samples = blank(seconds)
    smooth = 0.0
    for i in range(len(samples)):
        t = i / RATE
        u = t / seconds
        smooth = .82 * smooth + .18 * rng.uniform(-1, 1)
        envelope = min(1.0, t / .035, (seconds - t) / .07)
        envelope *= .72 + .28 * math.sin(TAU * 8 * t) ** 2
        rotor = math.sin(TAU * (motor * t + 15 * t * t)) if motor else 0
        samples[i] = amp * envelope * (smooth * .65 + rotor * .12)
    return samples


def thump(seconds, amp, seed, frequency=115):
    signal = tone(seconds, frequency, amp, 6, frequency * .55)
    rng = random.Random(seed)
    for i in range(len(signal)):
        t = i / RATE
        signal[i] += rng.uniform(-1, 1) * amp * .14 * math.exp(-70 * t) * min(1, t / .002)
    return signal


def cues(style):
    press, dispense, pickup = blank(.24), blank(.96), blank(.38)
    if style == "retro":
        add(press, tone(.095, 880, .17, 3, retro=True))
        add(press, tone(.10, 1320, .13, 4, retro=True), .065)
        add(dispense, friction(.61, .22, 41, 105), .03)
        for start, freq in [(.12, 240), (.26, 270), (.40, 310)]:
            add(dispense, tone(.06, freq, .05, 5, retro=True), start)
        add(dispense, thump(.23, .31, 43), .63)
        add(dispense, thump(.11, .10, 44, 180), .77)
        add(pickup, thump(.13, .13, 45, 220))
        add(pickup, tone(.17, 1046.5, .12, 5, retro=True), .045)
        add(pickup, tone(.22, 1568, .10, 5, retro=True), .12)
    elif style == "warm":
        add(press, tone(.18, 660, .17, 4))
        add(press, tone(.17, 990, .06, 5), .025)
        add(dispense, friction(.66, .18, 51, 75), .025)
        add(dispense, thump(.26, .28, 52, 90), .62)
        add(dispense, thump(.12, .08, 53, 150), .76)
        add(pickup, friction(.12, .10, 54), .01)
        add(pickup, tone(.29, 784, .16, 6), .03)
        add(pickup, tone(.24, 1176, .06, 6), .065)
    else:
        add(press, thump(.07, .15, 61, 520))
        add(press, tone(.10, 1180, .07, 3), .055)
        add(dispense, friction(.66, .30, 62, 145), .015)
        for i in range(6):
            add(dispense, thump(.035, .065, 63 + i, 360), .06 + i * .085)
        add(dispense, thump(.24, .34, 70, 140), .64)
        add(dispense, thump(.09, .11, 71, 280), .80)
        add(pickup, friction(.16, .24, 72))
        add(pickup, thump(.15, .17, 73, 280), .17)
    return {"press": press, "dispense": dispense, "pickup": pickup}


def write_wav(path, signal):
    # Keep the quiet balance between cues; only attenuate if a mix exceeds -6dBFS.
    peak = max(abs(x) for x in signal) or 1
    gain = min(1, .5 / peak)
    samples = array.array("h", [round(max(-1, min(1, x * gain)) * 32767) for x in signal])
    if sys.byteorder != "little":
        samples.byteswap()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("xb") as output:
        with wave.open(output, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes(samples.tobytes())
    print(f"{path}: {len(signal) / RATE:.2f}s, peak {20 * math.log10(peak * gain):.1f} dBFS")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "audio")
    args = parser.parse_args()
    planned = [args.output_root / f"vending-{name}.wav" for name in ["press", "dispense", "pickup"]]
    planned += [args.output_root / "vending-samples" / f"{style}.wav" for style in ["retro", "warm", "mechanical"]]
    existing = [str(p) for p in planned if p.exists()]
    if existing:
        raise SystemExit("Refusing to overwrite existing files: " + ", ".join(existing))
    for style in ["retro", "warm", "mechanical"]:
        sound = cues(style)
        if style == "retro":
            for name, signal in sound.items():
                write_wav(args.output_root / f"vending-{name}.wav", signal)
        demo = blank(3.0)
        add(demo, sound["press"], .15)
        add(demo, sound["dispense"], .70)
        add(demo, sound["pickup"], 1.90)
        write_wav(args.output_root / "vending-samples" / f"{style}.wav", demo)


if __name__ == "__main__":
    main()
