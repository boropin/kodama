import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAudio } from "../js/audio-analyzer.js";
import { calculateAssessment } from "../js/scoring.js";

function syntheticTaps({ frequency = 230, count = 10, sampleRate = 48_000 } = {}) {
  const duration = count * 0.45 + 0.5;
  const samples = new Float32Array(Math.round(duration * sampleRate));
  for (let tap = 0; tap < count; tap += 1) {
    const onset = Math.round((0.25 + tap * 0.45) * sampleRate);
    const length = Math.round(0.14 * sampleRate);
    for (let i = 0; i < length && onset + i < samples.length; i += 1) {
      const time = i / sampleRate;
      const envelope = Math.exp(-time * 36);
      const impact = i < 20 ? (1 - i / 20) * 0.32 : 0;
      samples[onset + i] += Math.sin(2 * Math.PI * frequency * time) * envelope * 0.72 + impact;
    }
  }
  return { samples, sampleRate, duration, channels: 1 };
}

test("detects repeated low-frequency tap events", () => {
  const analysis = analyzeAudio(syntheticTaps(), 1);
  assert.equal(analysis.tapCount, 10);
  assert.ok(Math.abs(analysis.dominantFrequencyHz - 230) < 25, `frequency=${analysis.dominantFrequencyHz}`);
  assert.ok(analysis.lowFrequencyRatio > 0.65, `ratio=${analysis.lowFrequencyRatio}`);
  assert.ok(analysis.decayMs > 20);
});

test("produces a traceable weighted assessment", () => {
  const audio = analyzeAudio(syntheticTaps(), 1);
  const result = calculateAssessment({
    pollinationDate: "2026-06-15",
    measurementDate: "2026-07-20",
    daysAfterPollination: 35,
    beard: "brown",
    trichome: "few",
    pattern: "clear"
  }, audio);
  assert.equal(result.modelVersion, "rule-v0.1");
  assert.equal(result.components.length, 5);
  assert.ok(result.score >= 70 && result.score <= 100, `score=${result.score}`);
  assert.ok(result.reasons.length >= 8);
});
