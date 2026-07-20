import { analyzeAudio, decodeAudioFile, drawWaveform } from "./audio-analyzer.js";
import { calculateAssessment } from "./scoring.js";

const elements = {
  form: document.querySelector("#assessment-form"),
  pollinationDate: document.querySelector("#pollination-date"),
  measurementDate: document.querySelector("#measurement-date"),
  daysOutput: document.querySelector("#days-output"),
  fileInput: document.querySelector("#audio-file"),
  fileDrop: document.querySelector("#file-drop"),
  fileName: document.querySelector("#file-name"),
  audioStatus: document.querySelector("#audio-status"),
  audioPreview: document.querySelector("#audio-preview"),
  audioError: document.querySelector("#audio-error"),
  waveform: document.querySelector("#waveform"),
  durationLabel: document.querySelector("#duration-label"),
  featureGrid: document.querySelector("#feature-grid"),
  analysisDebug: document.querySelector("#analysis-debug"),
  sensitivity: document.querySelector("#sensitivity"),
  sensitivityValue: document.querySelector("#sensitivity-value"),
  reanalyzeButton: document.querySelector("#reanalyze-button"),
  resultSection: document.querySelector("#result-section"),
  scoreValue: document.querySelector("#score-value"),
  resultTitle: document.querySelector("#result-title"),
  resultSummary: document.querySelector("#result-summary"),
  confidenceBadge: document.querySelector("#confidence-badge"),
  contributionList: document.querySelector("#contribution-list"),
  reasonList: document.querySelector("#reason-list"),
  exportButton: document.querySelector("#export-button"),
  resetButton: document.querySelector("#reset-button")
};

const state = {
  file: null,
  decoded: null,
  audioAnalysis: null,
  assessment: null,
  input: null
};

function localIsoDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function parseLocalDate(value) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calculateDays() {
  const pollination = parseLocalDate(elements.pollinationDate.value);
  const measurement = parseLocalDate(elements.measurementDate.value);
  if (!pollination || !measurement) {
    elements.daysOutput.value = "未入力";
    return null;
  }
  const days = Math.round((measurement - pollination) / 86_400_000);
  elements.daysOutput.value = days >= 0 ? `${days}日` : "日付を確認";
  return days;
}

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setAudioError(message = "") {
  elements.audioError.hidden = !message;
  elements.audioError.textContent = message;
}

function sensitivityLabel(value) {
  if (value < 0.9) return "高め";
  if (value > 1.1) return "低め";
  return "標準";
}

function renderFeatures() {
  const audio = state.audioAnalysis;
  const features = [
    ["検出打音", `${audio.tapCount} 回`],
    ["主周波数", `${Math.round(audio.dominantFrequencyHz)} Hz`],
    ["低音比率", `${Math.round(audio.lowFrequencyRatio * 100)} %`],
    ["余韻", `${Math.round(audio.decayMs)} ms`]
  ];
  elements.featureGrid.replaceChildren(...features.map(([label, value]) => {
    const node = document.createElement("div");
    node.className = "feature";
    node.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    return node;
  }));
  elements.analysisDebug.textContent = JSON.stringify({
    sampleRate: state.decoded.sampleRate,
    durationSeconds: Number(state.decoded.duration.toFixed(3)),
    channels: state.decoded.channels,
    tapCount: audio.tapCount,
    tapTimesSeconds: audio.tapTimes.map(value => Number(value.toFixed(3))),
    dominantFrequencyHz: Number(audio.dominantFrequencyHz.toFixed(2)),
    frequencyStdDevHz: Number(audio.frequencyStdDevHz.toFixed(2)),
    lowFrequencyRatio: Number(audio.lowFrequencyRatio.toFixed(4)),
    decayMs: Number(audio.decayMs.toFixed(2)),
    quality: audio.quality,
    detection: audio.detection
  }, null, 2);
  elements.durationLabel.textContent = `${state.decoded.duration.toFixed(1)}秒 · ${state.decoded.sampleRate.toLocaleString()} Hz`;
  drawWaveform(elements.waveform, state.decoded, state.audioAnalysis);
}

function analyzeCurrentAudio() {
  if (!state.decoded) return;
  const sensitivity = Number(elements.sensitivity.value);
  state.audioAnalysis = analyzeAudio(state.decoded, sensitivity);
  renderFeatures();
  elements.audioStatus.textContent = `${state.audioAnalysis.tapCount}回検出`;
  elements.audioStatus.classList.add("is-ready");
  state.assessment = null;
  elements.resultSection.hidden = true;
}

async function loadAudioFile(file) {
  if (!file) return;
  state.file = file;
  state.decoded = null;
  state.audioAnalysis = null;
  state.assessment = null;
  elements.resultSection.hidden = true;
  elements.audioPreview.hidden = true;
  elements.audioStatus.textContent = "読込中…";
  elements.audioStatus.classList.remove("is-ready");
  elements.fileName.textContent = `${file.name} · ${formatFileSize(file.size)}`;
  setAudioError();

  try {
    state.decoded = await decodeAudioFile(file);
    analyzeCurrentAudio();
    elements.audioPreview.hidden = false;
  } catch (error) {
    elements.audioStatus.textContent = "読込失敗";
    setAudioError(error.message);
  }
}

function getCheckedValue(name) {
  return elements.form.elements[name]?.value || "";
}

function collectInput() {
  return {
    pollinationDate: elements.pollinationDate.value,
    measurementDate: elements.measurementDate.value,
    daysAfterPollination: calculateDays(),
    beard: getCheckedValue("beard"),
    trichome: getCheckedValue("trichome"),
    pattern: getCheckedValue("pattern")
  };
}

function renderAssessment() {
  const assessment = state.assessment;
  elements.scoreValue.textContent = assessment.score;
  elements.resultTitle.textContent = assessment.verdict.title;
  elements.resultSummary.textContent = assessment.verdict.summary;
  elements.confidenceBadge.textContent = `暫定確信度 ${assessment.confidence}%`;
  elements.resultSection.style.setProperty("--score-angle", `${assessment.score * 3.6}deg`);

  elements.contributionList.replaceChildren(...assessment.components.map(component => {
    const node = document.createElement("div");
    node.className = "contribution";
    node.innerHTML = `<span>${component.label}</span><div class="contribution__bar"><i style="width:${component.normalized * 100}%"></i></div><strong>${component.points.toFixed(1)}</strong>`;
    return node;
  }));
  elements.reasonList.replaceChildren(...assessment.reasons.map(reason => {
    const node = document.createElement("li");
    node.textContent = reason;
    return node;
  }));
  elements.resultSection.hidden = false;
  elements.resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function validationMessage(input) {
  if (input.daysAfterPollination === null || input.daysAfterPollination < 0) return "受粉見込み日と測定日を確認してください。";
  if (!input.beard || !input.trichome || !input.pattern) return "ひげ、トライコーム、模様をそれぞれ選択してください。";
  if (!state.audioAnalysis) return "解析できる音声ファイルを選択してください。";
  if (!Number.isFinite(state.audioAnalysis.dominantFrequencyHz) || state.audioAnalysis.tapCount === 0) return "打音を検出できませんでした。感度を上げるか、別の録音を選択してください。";
  return "";
}

function exportResult() {
  if (!state.assessment) return;
  const record = {
    schemaVersion: "kodama-assessment-v0.1",
    exportedAt: new Date().toISOString(),
    input: state.input,
    audioFile: {
      name: state.file.name,
      type: state.file.type || "unknown",
      sizeBytes: state.file.size,
      lastModified: state.file.lastModified ? new Date(state.file.lastModified).toISOString() : null,
      note: "音声本体はJSONに含まれません"
    },
    audioAnalysis: {
      sampleRate: state.decoded.sampleRate,
      durationSeconds: state.decoded.duration,
      channels: state.decoded.channels,
      tapCount: state.audioAnalysis.tapCount,
      tapTimesSeconds: state.audioAnalysis.tapTimes,
      dominantFrequencyHz: state.audioAnalysis.dominantFrequencyHz,
      frequencyStdDevHz: state.audioAnalysis.frequencyStdDevHz,
      frequencyCoefficientOfVariation: state.audioAnalysis.frequencyCoefficientOfVariation,
      lowFrequencyRatio: state.audioAnalysis.lowFrequencyRatio,
      decayMs: state.audioAnalysis.decayMs,
      quality: state.audioAnalysis.quality,
      detection: state.audioAnalysis.detection,
      perTap: state.audioAnalysis.perTap
    },
    assessment: state.assessment
  };
  const blob = new Blob([JSON.stringify(record, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const safeDate = state.input.measurementDate.replaceAll("-", "");
  link.href = url;
  link.download = `kodama_${safeDate}_${Date.now()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function resetApp() {
  elements.form.reset();
  elements.measurementDate.value = localIsoDate();
  elements.daysOutput.value = "未入力";
  elements.fileName.textContent = "";
  elements.audioStatus.textContent = "未選択";
  elements.audioStatus.classList.remove("is-ready");
  elements.audioPreview.hidden = true;
  elements.resultSection.hidden = true;
  elements.sensitivity.value = "1";
  elements.sensitivityValue.value = "標準";
  setAudioError();
  Object.assign(state, { file: null, decoded: null, audioAnalysis: null, assessment: null, input: null });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

elements.measurementDate.value = localIsoDate();
elements.pollinationDate.addEventListener("change", calculateDays);
elements.measurementDate.addEventListener("change", calculateDays);
elements.fileInput.addEventListener("change", event => loadAudioFile(event.target.files[0]));
elements.reanalyzeButton.addEventListener("click", analyzeCurrentAudio);
elements.sensitivity.addEventListener("input", () => {
  elements.sensitivityValue.value = sensitivityLabel(Number(elements.sensitivity.value));
});
elements.exportButton.addEventListener("click", exportResult);
elements.resetButton.addEventListener("click", resetApp);

for (const eventName of ["dragenter", "dragover"]) {
  elements.fileDrop.addEventListener(eventName, event => {
    event.preventDefault();
    elements.fileDrop.classList.add("is-dragging");
  });
}
for (const eventName of ["dragleave", "drop"]) {
  elements.fileDrop.addEventListener(eventName, event => {
    event.preventDefault();
    elements.fileDrop.classList.remove("is-dragging");
  });
}
elements.fileDrop.addEventListener("drop", event => {
  const [file] = event.dataTransfer.files;
  if (file) loadAudioFile(file);
});

elements.form.addEventListener("submit", event => {
  event.preventDefault();
  const input = collectInput();
  const error = validationMessage(input);
  if (error) {
    setAudioError(error);
    elements.audioError.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  setAudioError();
  state.input = input;
  state.assessment = calculateAssessment(input, state.audioAnalysis);
  renderAssessment();
});

let resizeTimer;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (state.decoded && state.audioAnalysis) drawWaveform(elements.waveform, state.decoded, state.audioAnalysis);
  }, 120);
});
