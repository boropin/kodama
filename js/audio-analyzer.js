const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * fraction), 0, sorted.length - 1);
  return sorted[index];
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const average = mean(values);
  return Math.sqrt(mean(values.map(value => (value - average) ** 2)));
}

function nextPowerOfTwo(value) {
  return 2 ** Math.ceil(Math.log2(value));
}

function fftReal(samples) {
  const size = samples.length;
  const real = Float64Array.from(samples);
  const imaginary = new Float64Array(size);

  for (let i = 1, j = 0; i < size; i += 1) {
    let bit = size >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    const wLengthReal = Math.cos(angle);
    const wLengthImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let wReal = 1;
      let wImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * wReal - imaginary[odd] * wImaginary;
        const oddImaginary = real[odd] * wImaginary + imaginary[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;

        const nextReal = wReal * wLengthReal - wImaginary * wLengthImaginary;
        wImaginary = wReal * wLengthImaginary + wImaginary * wLengthReal;
        wReal = nextReal;
      }
    }
  }

  return { real, imaginary };
}

function downmix(audioBuffer) {
  const mono = new Float32Array(audioBuffer.length);
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) mono[i] += data[i] / audioBuffer.numberOfChannels;
  }
  return mono;
}

function removeDcOffset(samples) {
  const dc = mean(samples);
  const cleaned = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) cleaned[i] = samples[i] - dc;
  return cleaned;
}

function calculateEnvelope(samples, sampleRate) {
  const frameSize = Math.max(64, Math.round(sampleRate * 0.006));
  const hopSize = Math.max(32, Math.round(sampleRate * 0.003));
  const envelope = [];

  for (let start = 0; start + frameSize <= samples.length; start += hopSize) {
    let energy = 0;
    for (let i = start; i < start + frameSize; i += 1) energy += samples[i] ** 2;
    envelope.push(Math.sqrt(energy / frameSize));
  }

  return { envelope, frameSize, hopSize };
}

function detectTaps(samples, sampleRate, sensitivity = 1) {
  const { envelope, hopSize } = calculateEnvelope(samples, sampleRate);
  const noiseFloor = percentile(envelope, 0.2);
  const highLevel = percentile(envelope, 0.96);
  const dynamicRange = Math.max(highLevel - noiseFloor, 1e-6);
  const threshold = noiseFloor + dynamicRange * (0.24 * sensitivity);
  const minimumGapFrames = Math.max(1, Math.round(0.16 * sampleRate / hopSize));
  const candidates = [];

  for (let i = 1; i < envelope.length - 1; i += 1) {
    if (envelope[i] >= threshold && envelope[i] >= envelope[i - 1] && envelope[i] > envelope[i + 1]) {
      const previous = candidates.at(-1);
      if (!previous || i - previous.frame >= minimumGapFrames) {
        candidates.push({ frame: i, level: envelope[i] });
      } else if (envelope[i] > previous.level) {
        candidates[candidates.length - 1] = { frame: i, level: envelope[i] };
      }
    }
  }

  const tapSamples = candidates.map(candidate => {
    const approximate = candidate.frame * hopSize;
    const radius = Math.round(sampleRate * 0.018);
    const start = Math.max(0, approximate - radius);
    const end = Math.min(samples.length, approximate + radius);
    let peakSample = approximate;
    let peakAmplitude = 0;
    for (let i = start; i < end; i += 1) {
      const amplitude = Math.abs(samples[i]);
      if (amplitude > peakAmplitude) {
        peakAmplitude = amplitude;
        peakSample = i;
      }
    }
    return { sample: peakSample, time: peakSample / sampleRate, amplitude: peakAmplitude, envelopeLevel: candidate.level };
  });

  return { taps: tapSamples, envelope, noiseFloor, highLevel, threshold, hopSize };
}

function analyzeSpectrum(samples, sampleRate, tapSample) {
  const fftSize = clamp(nextPowerOfTwo(Math.round(sampleRate * 0.085)), 2048, 8192);
  const start = Math.max(0, Math.min(samples.length - fftSize, tapSample + Math.round(sampleRate * 0.004)));
  const windowed = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) {
    const hann = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    windowed[i] = (samples[start + i] || 0) * hann;
  }

  const { real, imaginary } = fftReal(windowed);
  const binWidth = sampleRate / fftSize;
  let dominantFrequency = 0;
  let dominantEnergy = -Infinity;
  let lowEnergy = 0;
  let analysisEnergy = 0;

  for (let bin = 1; bin < fftSize / 2; bin += 1) {
    const frequency = bin * binWidth;
    const energy = real[bin] ** 2 + imaginary[bin] ** 2;
    if (frequency >= 80 && frequency <= 1200) {
      analysisEnergy += energy;
      if (frequency <= 400) lowEnergy += energy;
      if (frequency <= 900 && energy > dominantEnergy) {
        dominantEnergy = energy;
        dominantFrequency = frequency;
      }
    }
  }

  return {
    dominantFrequency,
    lowFrequencyRatio: analysisEnergy > 0 ? lowEnergy / analysisEnergy : 0,
    fftSize
  };
}

function estimateDecay(samples, sampleRate, tapSample) {
  const frameSize = Math.max(64, Math.round(sampleRate * 0.006));
  const hopSize = Math.max(32, Math.round(sampleRate * 0.003));
  const endSample = Math.min(samples.length, tapSample + Math.round(sampleRate * 0.45));
  const levels = [];

  for (let start = tapSample; start + frameSize < endSample; start += hopSize) {
    let energy = 0;
    for (let i = start; i < start + frameSize; i += 1) energy += samples[i] ** 2;
    levels.push(Math.sqrt(energy / frameSize));
  }

  const peak = Math.max(...levels, 0);
  if (!peak) return 0;
  const cutoff = peak * 0.2;
  const holdFrames = 4;
  for (let i = 1; i <= levels.length - holdFrames; i += 1) {
    if (levels.slice(i, i + holdFrames).every(level => level < cutoff)) {
      return (i * hopSize / sampleRate) * 1000;
    }
  }
  return ((levels.length - 1) * hopSize / sampleRate) * 1000;
}

function qualityAssessment(taps, noiseFloor, highLevel, frequencyCv) {
  const signalToNoise = noiseFloor > 0 ? highLevel / noiseFloor : 99;
  let quality = 100;
  const messages = [];

  if (taps.length < 3) {
    quality -= 50;
    messages.push("打音が3回未満です");
  } else if (taps.length > 15) {
    quality -= 25;
    messages.push("打音以外の音を含む可能性があります");
  } else {
    messages.push(`${taps.length}回の打音を検出しました`);
  }

  if (signalToNoise < 3) {
    quality -= 35;
    messages.push("周囲雑音が大きめです");
  }
  if (frequencyCv > 0.35) {
    quality -= 25;
    messages.push("打音ごとの差が大きめです");
  } else if (frequencyCv <= 0.18 && taps.length >= 3) {
    messages.push("打音のばらつきは小さめです");
  }

  return { score: clamp(Math.round(quality), 0, 100), signalToNoise, messages };
}

export async function decodeAudioFile(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error("このブラウザはWeb Audio APIに対応していません。");
  const context = new AudioContextClass();
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(arrayBuffer.slice(0));
    return {
      samples: removeDcOffset(downmix(buffer)),
      sampleRate: buffer.sampleRate,
      duration: buffer.duration,
      channels: buffer.numberOfChannels
    };
  } catch (error) {
    throw new Error("音声を読み込めませんでした。iPhoneのボイスメモから書き出したM4A、WAV、またはMP3を選び直してください。", { cause: error });
  } finally {
    await context.close();
  }
}

export function analyzeAudio(decoded, sensitivity = 1) {
  const detection = detectTaps(decoded.samples, decoded.sampleRate, sensitivity);
  const perTap = detection.taps.map(tap => ({
    timeSeconds: tap.time,
    amplitude: tap.amplitude,
    ...analyzeSpectrum(decoded.samples, decoded.sampleRate, tap.sample),
    decayMs: estimateDecay(decoded.samples, decoded.sampleRate, tap.sample)
  }));

  const frequencies = perTap.map(item => item.dominantFrequency).filter(Boolean);
  const lowRatios = perTap.map(item => item.lowFrequencyRatio).filter(Number.isFinite);
  const decays = perTap.map(item => item.decayMs).filter(Number.isFinite);
  const averageFrequency = mean(frequencies);
  const frequencyCv = averageFrequency ? standardDeviation(frequencies) / averageFrequency : 1;
  const quality = qualityAssessment(detection.taps, detection.noiseFloor, detection.highLevel, frequencyCv);

  return {
    tapCount: detection.taps.length,
    tapTimes: detection.taps.map(tap => tap.time),
    dominantFrequencyHz: averageFrequency,
    frequencyStdDevHz: standardDeviation(frequencies),
    frequencyCoefficientOfVariation: frequencyCv,
    lowFrequencyRatio: mean(lowRatios),
    decayMs: mean(decays),
    perTap,
    quality,
    detection: {
      sensitivity,
      noiseFloor: detection.noiseFloor,
      highLevel: detection.highLevel,
      threshold: detection.threshold
    }
  };
}

export function drawWaveform(canvas, decoded, analysis) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.round(rect.width * ratio));
  canvas.height = Math.round(180 * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  const width = canvas.width / ratio;
  const height = canvas.height / ratio;
  context.clearRect(0, 0, width, height);

  const center = height / 2;
  const columns = Math.max(1, Math.floor(width));
  const samplesPerColumn = Math.max(1, Math.floor(decoded.samples.length / columns));
  context.strokeStyle = "rgba(217, 239, 206, .78)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 0; x < columns; x += 1) {
    const start = x * samplesPerColumn;
    let min = 1;
    let max = -1;
    for (let i = start; i < Math.min(decoded.samples.length, start + samplesPerColumn); i += 1) {
      min = Math.min(min, decoded.samples[i]);
      max = Math.max(max, decoded.samples[i]);
    }
    context.moveTo(x, center + min * center * .86);
    context.lineTo(x, center + max * center * .86);
  }
  context.stroke();

  context.fillStyle = "#f45d4d";
  context.strokeStyle = "rgba(244, 93, 77, .55)";
  context.font = "700 10px sans-serif";
  analysis.tapTimes.forEach((time, index) => {
    const x = (time / decoded.duration) * width;
    context.beginPath();
    context.moveTo(x, 18);
    context.lineTo(x, height - 12);
    context.stroke();
    context.beginPath();
    context.arc(x, 13, 4, 0, Math.PI * 2);
    context.fill();
    context.fillText(String(index + 1), Math.min(width - 15, x + 5), 16);
  });
}
