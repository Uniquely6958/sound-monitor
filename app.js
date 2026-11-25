const thresholdInput = document.querySelector("#threshold-input");
const durationInput = document.querySelector("#duration-input");
const thresholdValue = document.querySelector("#threshold-value");
const thresholdMarker = document.querySelector("#threshold-marker");
const levelNumber = document.querySelector("#level-number");
const levelCaption = document.querySelector("#level-caption");
const levelMeter = document.querySelector("#level-meter");
const meterFill = document.querySelector("#meter-fill");
const monitorButton = document.querySelector("#monitor-button");
const buttonLabel = document.querySelector("#button-label");
const buttonIcon = document.querySelector("#button-icon");
const monitorHint = document.querySelector("#monitor-hint");
const sessionChip = document.querySelector("#session-chip");
const sessionState = document.querySelector("#session-state");
const monitorPanel = document.querySelector(".monitor-panel");
const alertStatus = document.querySelector("#alert-status");
const alertStatusText = document.querySelector("#alert-status-text");
const announcement = document.querySelector("#announcement");
const waveform = document.querySelector("#waveform");
const waveState = document.querySelector("#wave-state");
const monitorTime = document.querySelector("#monitor-time");
const vibrationNote = document.querySelector("#vibration-note");

let audioContext;
let analyser;
let microphoneStream;
let animationFrame;
let sessionStartedAt = 0;
let clockInterval;
let wakeLock;
let smoothedDb = -60;
let soundHistory = [];
let alarmActive = false;
let alertMode = "sound";
let alarmInterval;
let lastCountdownSecond = -1;

const audioData = new Float32Array(2048);
const canvasContext = waveform.getContext("2d");

function displayThreshold() {
  const threshold = Number(thresholdInput.value);
  thresholdValue.value = `${threshold < 0 ? "−" : ""}${Math.abs(threshold)} dBFS`;
  thresholdValue.textContent = thresholdValue.value;
  thresholdMarker.style.left = `${((threshold + 60) / 60) * 100}%`;
}

function updateVibrationNote() {
  vibrationNote.textContent = "vibrate" in navigator
    ? "Vibration works on supported phones and browsers."
    : "Vibration is not supported in this browser; sound alerts remain available.";
}

function getAlertDuration() {
  const parsedDuration = Number.parseInt(durationInput.value, 10);
  return Number.isFinite(parsedDuration) ? Math.min(60, Math.max(1, parsedDuration)) : 5;
}

function getAverageLevel(now, durationMs) {
  const windowStart = now - durationMs;
  if (!soundHistory.length || soundHistory[0].time > windowStart) return null;

  let totalPower = 0;
  let totalTime = 0;
  for (let index = 0; index < soundHistory.length; index += 1) {
    const sample = soundHistory[index];
    const segmentStart = Math.max(sample.time, windowStart);
    const segmentEnd = Math.min(soundHistory[index + 1]?.time ?? now, now);
    const segmentDuration = Math.max(0, segmentEnd - segmentStart);
    totalPower += sample.power * segmentDuration;
    totalTime += segmentDuration;
  }

  if (totalTime < durationMs * 0.98) return null;
  const averagePower = totalPower / totalTime;
  return averagePower > 0 ? Math.max(-60, 10 * Math.log10(averagePower)) : -60;
}

function resizeWaveform() {
  const bounds = waveform.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  waveform.width = Math.max(1, Math.floor(bounds.width * ratio));
  waveform.height = Math.max(1, Math.floor(bounds.height * ratio));
  canvasContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  drawIdleWaveform();
}

function drawIdleWaveform() {
  const width = waveform.clientWidth;
  const height = waveform.clientHeight;
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.beginPath();
  canvasContext.moveTo(0, height / 2);
  canvasContext.lineTo(width, height / 2);
  canvasContext.strokeStyle = "rgba(214, 250, 112, .38)";
  canvasContext.lineWidth = 1.5;
  canvasContext.stroke();
}

function drawWaveform() {
  const width = waveform.clientWidth;
  const height = waveform.clientHeight;
  const middle = height / 2;
  const amplitude = height * 0.44;
  canvasContext.clearRect(0, 0, width, height);
  canvasContext.beginPath();
  for (let index = 0; index < audioData.length; index += 1) {
    const x = (index / (audioData.length - 1)) * width;
    const y = middle + audioData[index] * amplitude;
    if (index === 0) canvasContext.moveTo(x, y);
    else canvasContext.lineTo(x, y);
  }
  canvasContext.strokeStyle = alarmActive ? "#ff806d" : "#d6fa70";
  canvasContext.lineWidth = 1.7;
  canvasContext.shadowColor = alarmActive ? "rgba(255, 101, 79, .35)" : "rgba(214, 250, 112, .28)";
  canvasContext.shadowBlur = 7;
  canvasContext.stroke();
  canvasContext.shadowBlur = 0;
}

function updateLevel() {
  if (!analyser) return;
  analyser.getFloatTimeDomainData(audioData);
  let sum = 0;
  for (const sample of audioData) sum += sample * sample;
  const rms = Math.sqrt(sum / audioData.length);
  const rawDb = rms > 0 ? 20 * Math.log10(rms) : -60;
  const currentDb = Math.max(-60, Math.min(0, rawDb));
  smoothedDb = smoothedDb * 0.72 + currentDb * 0.28;

  const now = performance.now();
  soundHistory.push({ time: now, power: rms * rms });
  while (soundHistory.length > 1 && soundHistory[0].time < now - 61000) soundHistory.shift();

  const durationMs = getAlertDuration() * 1000;
  const averageDb = getAverageLevel(now, durationMs);
  const displayedDb = averageDb ?? smoothedDb;
  const shownDb = Math.round(displayedDb);
  const meterPercent = Math.max(0, Math.min(100, ((displayedDb + 60) / 60) * 100));
  const threshold = Number(thresholdInput.value);
  levelNumber.textContent = `${shownDb < 0 ? "−" : ""}${Math.abs(shownDb)}`;
  meterFill.style.width = `${meterPercent}%`;
  levelMeter.setAttribute("aria-valuenow", String(shownDb));
  levelMeter.setAttribute("aria-valuetext", `${shownDb} dBFS`);

  if (averageDb === null) {
    const elapsedSeconds = (now - (soundHistory[0]?.time ?? now)) / 1000;
    const secondsRemaining = Math.max(1, Math.ceil(getAlertDuration() - elapsedSeconds));
    if (secondsRemaining !== lastCountdownSecond) {
      levelCaption.textContent = `Building ${getAlertDuration()}s average · ${secondsRemaining}s left`;
      lastCountdownSecond = secondsRemaining;
    }
    if (alarmActive) stopAlarm();
  } else {
    lastCountdownSecond = -1;
    if (averageDb >= threshold) {
      levelCaption.textContent = "Average above your alert level";
      if (!alarmActive) startAlarm();
    } else {
      levelCaption.textContent = `${getAlertDuration()}s average below your alert level`;
      if (alarmActive) stopAlarm();
      else alertStatusText.textContent = "Listening for average sound above your limit";
    }
  }

  meterFill.classList.toggle("is-hot", averageDb !== null && averageDb >= threshold);
  if (alarmActive) {
    levelCaption.textContent = "Average above your alert level · alarm sounding";
    meterFill.classList.add("is-hot");
  }

  monitorPanel.classList.toggle("is-alerting", alarmActive);
  drawWaveform();
  animationFrame = requestAnimationFrame(updateLevel);
}

function playBeep(context = audioContext) {
  if (!context || context.state !== "running") return;
  const startAt = context.currentTime;
  const frequencies = [880, 1174, 880];
  for (let index = 0; index < frequencies.length; index += 1) {
    const start = startAt + index * 0.3;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequencies[index];
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.32, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.25);
  }
}

function playAlertSignal() {
  if (alertMode === "sound" || alertMode === "both") playBeep();
  if ((alertMode === "vibration" || alertMode === "both") && "vibrate" in navigator) {
    navigator.vibrate([180, 90, 180]);
  }
}

function startAlarm() {
  alarmActive = true;
  monitorPanel.classList.add("is-alerting");
  alertStatus.classList.add("is-alerting");
  alertStatusText.textContent = "Average sound level crossed your limit";
  announcement.textContent = "Alert. Average sound level crossed your limit.";
  vibrationNote.textContent = "Alert triggered. Adjust the threshold to suit your space.";
  levelCaption.textContent = "Average above your alert level · alarm sounding";
  playAlertSignal();
  alarmInterval = window.setInterval(playAlertSignal, 1100);
}

function stopAlarm() {
  window.clearInterval(alarmInterval);
  alarmActive = false;
  monitorPanel.classList.remove("is-alerting");
  alertStatus.classList.remove("is-alerting");
  alertStatusText.textContent = "Average back below your alert level";
  levelCaption.textContent = `${getAlertDuration()}s average below your alert level`;
  if ("vibrate" in navigator) navigator.vibrate(0);
}

function updateClock() {
  if (!sessionStartedAt) return;
  const seconds = Math.floor((Date.now() - sessionStartedAt) / 1000);
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  monitorTime.textContent = `SESSION ${minutes}:${remainder}`;
}

async function requestWakeLock() {
  if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

async function startMonitoring() {
  if (!navigator.mediaDevices?.getUserMedia) {
    monitorHint.textContent = "Microphone access needs a modern browser on HTTPS or localhost.";
    return;
  }

  monitorButton.disabled = true;
  buttonLabel.textContent = "Connecting microphone…";
  monitorHint.textContent = "Approve microphone access in your browser.";
  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();
    await audioContext.resume();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    audioContext.createMediaStreamSource(microphoneStream).connect(analyser);

    smoothedDb = -60;
    soundHistory = [];
    alarmActive = false;
    sessionStartedAt = Date.now();
    sessionChip.classList.add("is-live");
    sessionState.textContent = "Monitoring live";
    buttonLabel.textContent = "Stop monitoring";
    buttonIcon.textContent = "■";
    monitorButton.classList.add("is-stop");
    monitorHint.textContent = "Keep this page open for continuous monitoring.";
    waveState.textContent = "LISTENING";
    levelCaption.textContent = "Listening to your surroundings";
    alertStatusText.textContent = "Listening for average sound above your limit";
    clockInterval = window.setInterval(updateClock, 1000);
    await requestWakeLock();
    updateLevel();
  } catch (error) {
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    const denied = error.name === "NotAllowedError" || error.name === "PermissionDeniedError";
    monitorHint.textContent = denied ? "Microphone access was blocked. Allow it in your browser settings, then try again." : "Could not start the microphone. Check that it is connected and try again.";
    buttonLabel.textContent = "Start monitoring";
    buttonIcon.textContent = "▶";
  } finally {
    monitorButton.disabled = false;
  }
}

async function stopMonitoring() {
  cancelAnimationFrame(animationFrame);
  window.clearInterval(alarmInterval);
  window.clearInterval(clockInterval);
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  analyser = null;
  if (audioContext && audioContext.state !== "closed") await audioContext.close();
  audioContext = null;
  if (wakeLock) await wakeLock.release();
  wakeLock = null;
  sessionStartedAt = 0;
  soundHistory = [];
  alarmActive = false;
  smoothedDb = -60;
  sessionChip.classList.remove("is-live");
  sessionState.textContent = "Not monitoring";
  buttonLabel.textContent = "Start monitoring";
  buttonIcon.textContent = "▶";
  monitorButton.classList.remove("is-stop");
  monitorHint.textContent = "Your browser will ask for microphone access.";
  waveState.textContent = "WAITING FOR INPUT";
  levelNumber.textContent = "--";
  levelCaption.textContent = "Start monitoring to see live levels";
  meterFill.style.width = "0%";
  levelMeter.setAttribute("aria-valuenow", "-60");
  monitorTime.textContent = "SESSION 00:00";
  monitorPanel.classList.remove("is-alerting");
  alertStatus.classList.remove("is-alerting");
  alertStatusText.textContent = "Ready when you are";
  if ("vibrate" in navigator) navigator.vibrate(0);
  drawIdleWaveform();
}

thresholdInput.addEventListener("input", displayThreshold);
durationInput.addEventListener("change", () => {
  durationInput.value = String(getAlertDuration());
});
monitorButton.addEventListener("click", () => {
  if (microphoneStream) stopMonitoring();
  else startMonitoring();
});
document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => {
    alertMode = button.dataset.mode;
    document.querySelectorAll(".mode-button").forEach((option) => {
      const selected = option === button;
      option.classList.toggle("is-selected", selected);
      option.setAttribute("aria-pressed", String(selected));
    });
    updateVibrationNote();
  });
});
document.querySelector("#test-button").addEventListener("click", async () => {
  if (alertMode === "sound" || alertMode === "both") {
    try {
      const testContext = audioContext || new (window.AudioContext || window.webkitAudioContext)();
      await testContext.resume();
      playBeep(testContext);
      if (testContext !== audioContext) window.setTimeout(() => testContext.close(), 600);
    } catch {
      vibrationNote.textContent = "Could not play the test alert. Check your device audio settings.";
    }
  }
  if ((alertMode === "vibration" || alertMode === "both") && "vibrate" in navigator) navigator.vibrate([180, 90, 180]);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && microphoneStream) requestWakeLock();
});
window.addEventListener("resize", resizeWaveform);

displayThreshold();
updateVibrationNote();
resizeWaveform();