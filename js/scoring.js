const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const linear = (value, low, high) => clamp((value - low) / (high - low));

const labels = {
  beard: { green: "青い", tip: "先端のみ枯れ", half: "半分枯れ", brown: "茶色" },
  trichome: { many: "多い", medium: "普通", few: "少ない", none: "ほぼ無い" },
  pattern: { faint: "ぼんやり", normal: "普通", clear: "くっきり" }
};

const maturityValues = {
  beard: { green: 0.12, tip: 0.38, half: 0.68, brown: 0.95 },
  trichome: { many: 0.12, medium: 0.43, few: 0.78, none: 0.96 },
  pattern: { faint: 0.25, normal: 0.58, clear: 0.9 }
};

export const MODEL_VERSION = "rule-v0.1";

function scoreDays(days) {
  if (!Number.isFinite(days)) return 0;
  if (days <= 35) return linear(days, 18, 35);
  if (days <= 43) return 1;
  return clamp(1 - (days - 43) / 25, 0.55, 1);
}

function scoreAudio(audio) {
  const frequencyMaturity = 1 - linear(audio.dominantFrequencyHz, 180, 650);
  const lowRatioMaturity = linear(audio.lowFrequencyRatio, 0.24, 0.78);
  const decayMaturity = linear(audio.decayMs, 18, 160);
  return clamp(frequencyMaturity * 0.55 + lowRatioMaturity * 0.3 + decayMaturity * 0.15);
}

function describeFrequency(frequency) {
  if (frequency < 260) return `主音が低め（${Math.round(frequency)} Hz）で、熟度が進んだ方向の特徴です`;
  if (frequency < 430) return `主音は中低域（${Math.round(frequency)} Hz）です`;
  return `主音が高め（${Math.round(frequency)} Hz）で、若い方向の特徴があります`;
}

function describeDecay(decay) {
  if (decay < 45) return `余韻は短め（約${Math.round(decay)} ms）です`;
  if (decay < 130) return `余韻は中程度（約${Math.round(decay)} ms）です`;
  return `余韻は長め（約${Math.round(decay)} ms）です`;
}

function verdict(score, input) {
  if (score < 48) return { title: "まだ若い可能性", summary: "数日おいて再測定し、目視の状態と合わせて確認してください。" };
  if (score < 70) return { title: "収穫候補に近づいています", summary: "若さを示す手がかりも残っています。継続して比較すると判断しやすくなります。" };
  if (score <= 91) return { title: "収穫適期候補", summary: "音と目視情報は、収穫を検討できる方向で概ね一致しています。" };
  if (input.daysAfterPollination > 42) return { title: "熟度進行・過熟注意", summary: "成熟を示す手がかりが強く、日数も進んでいます。早めの確認をおすすめします。" };
  return { title: "収穫適期候補", summary: "成熟を示す手がかりが強く出ています。最終判断は品種特性と現物を確認してください。" };
}

export function calculateAssessment(input, audio) {
  const components = [
    { key: "days", label: "受粉後日数", weight: 25, normalized: scoreDays(input.daysAfterPollination) },
    { key: "beard", label: "ひげ", weight: 15, normalized: maturityValues.beard[input.beard] ?? 0 },
    { key: "trichome", label: "トライコーム", weight: 15, normalized: maturityValues.trichome[input.trichome] ?? 0 },
    { key: "pattern", label: "模様", weight: 15, normalized: maturityValues.pattern[input.pattern] ?? 0 },
    { key: "audio", label: "打音", weight: 30, normalized: scoreAudio(audio) }
  ].map(component => ({ ...component, points: component.normalized * component.weight }));

  const score = Math.round(components.reduce((sum, component) => sum + component.points, 0));
  const audioReliability = audio.quality.score / 100;
  const confidence = Math.round(clamp(0.48 + audioReliability * 0.32 + (audio.tapCount >= 5 ? 0.08 : 0)) * 100);
  const reasons = [
    `受粉見込み日から${input.daysAfterPollination}日です`,
    `ひげは「${labels.beard[input.beard]}」です`,
    `トライコームは「${labels.trichome[input.trichome]}」です`,
    `模様は「${labels.pattern[input.pattern]}」です`,
    describeFrequency(audio.dominantFrequencyHz),
    `400 Hz以下の低音比率は${Math.round(audio.lowFrequencyRatio * 100)}%です`,
    describeDecay(audio.decayMs),
    ...audio.quality.messages
  ];

  return {
    modelVersion: MODEL_VERSION,
    score,
    confidence,
    verdict: verdict(score, input),
    components,
    reasons,
    caveat: "校正前の暫定ルールによる成熟度指標であり、収穫を保証する値ではありません。"
  };
}
