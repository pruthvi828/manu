/* ═══════════════════════════════════════════════════════════
   MANU — App Logic
   API key management · Audio recorder · Visualizer
   ═══════════════════════════════════════════════════════════ */

;(function () {
  'use strict';

  // ── DOM refs ──────────────────────────────────────────────
  const $  = (s) => document.querySelector(s);
  const apiInput        = $('#apiKeyInput');
  const toggleBtn       = $('#toggleVisibility');
  const pasteBtn        = $('#pasteBtn');
  const saveKeyBtn      = $('#saveKeyBtn');
  const clearKeyBtn     = $('#clearKeyBtn');
  const apiStatus       = $('#apiStatus');
  const statusDot       = $('#statusDot');
  const statusLabel     = $('#statusLabel');
  const recBtn          = $('#recBtn');
  const recIcon         = $('#recIcon');
  const pauseBtn        = $('#pauseBtn');
  const timerEl         = $('#timer');
  const visCanvas       = $('#visCanvas');
  const visRing         = $('#visRing');
  const playbackSection = $('#playbackSection');
  const audioPlayback   = $('#audioPlayback');
  const downloadBtn     = $('#downloadBtn');

  const micSvg    = recIcon.querySelector('.mic-svg');
  const stopSquare = recIcon.querySelector('.stop-square');
  const eyeOpen   = toggleBtn.querySelector('.eye-open');
  const eyeClosed = toggleBtn.querySelector('.eye-closed');

  // ── State ─────────────────────────────────────────────────
  let isPasswordVisible = false;
  let mediaRecorder     = null;
  let audioChunks       = [];
  let isRecording       = false;
  let isPaused          = false;
  let timerInterval     = null;
  let seconds           = 0;
  let audioCtx          = null;
  let analyser          = null;
  let dataArray         = null;
  let animFrameId       = null;
  let audioStream       = null;

  // ── Canvas setup ──────────────────────────────────────────
  const ctx = visCanvas.getContext('2d');
  const canvasSize = 220;

  function setCanvasSize() {
    const ring = visRing;
    const w = ring.offsetWidth || 220;
    visCanvas.width  = w * 2; // retina
    visCanvas.height = w * 2;
    visCanvas.style.width  = w + 'px';
    visCanvas.style.height = w + 'px';
  }
  setCanvasSize();
  window.addEventListener('resize', setCanvasSize);

  // ── Toast ─────────────────────────────────────────────────
  function showToast(icon, msg) {
    let toast = document.querySelector('.toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'toast';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="toast-icon">${icon}</span><span>${msg}</span>`;
    // Reset
    toast.classList.remove('show');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('show'));
    });
    clearTimeout(toast._tid);
    toast._tid = setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // ── API Key — Toggle Visibility ───────────────────────────
  toggleBtn.addEventListener('click', () => {
    isPasswordVisible = !isPasswordVisible;
    apiInput.type = isPasswordVisible ? 'text' : 'password';
    eyeOpen.style.display   = isPasswordVisible ? 'none' : '';
    eyeClosed.style.display = isPasswordVisible ? '' : 'none';
  });

  // ── API Key — Paste ───────────────────────────────────────
  pasteBtn.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        apiInput.value = text;
        apiInput.focus();
        showToast('📋', 'Pasted from clipboard');
      }
    } catch {
      showToast('⚠️', 'Clipboard access denied');
    }
  });

  // ── API Key — Save ────────────────────────────────────────
  function updateApiStatus(hasSaved) {
    if (hasSaved) {
      apiStatus.classList.add('saved');
      apiStatus.querySelector('span').textContent = 'Key saved securely';
      statusDot.classList.add('online');
      statusLabel.textContent = 'Connected';
    } else {
      apiStatus.classList.remove('saved');
      apiStatus.querySelector('span').textContent = 'No key saved';
      statusDot.classList.remove('online');
      statusLabel.textContent = 'Offline';
    }
  }

  saveKeyBtn.addEventListener('click', () => {
    const key = apiInput.value.trim();
    if (!key) {
      showToast('⚠️', 'Enter an API key first');
      return;
    }
    localStorage.setItem('manu_api_key', key);
    updateApiStatus(true);
    showToast('✅', 'API key saved');
  });

  clearKeyBtn.addEventListener('click', () => {
    apiInput.value = '';
    localStorage.removeItem('manu_api_key');
    updateApiStatus(false);
    showToast('🗑️', 'API key cleared');
  });

  // Load saved key on start
  const savedKey = localStorage.getItem('manu_api_key');
  if (savedKey) {
    apiInput.value = savedKey;
    updateApiStatus(true);
  }

  // ── Visualizer Drawing ────────────────────────────────────
  function drawIdleRing() {
    const w = visCanvas.width;
    const h = visCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r  = (Math.min(w, h) / 2) - 20;
    const t  = Date.now() / 1000;

    ctx.clearRect(0, 0, w, h);

    // Draw subtle idle ring
    ctx.beginPath();
    const segments = 128;
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2 - Math.PI / 2;
      const wobble = Math.sin(angle * 3 + t * 1.2) * 3 + Math.sin(angle * 5 + t * 0.8) * 2;
      const px = cx + (r + wobble) * Math.cos(angle);
      const py = cy + (r + wobble) * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.12)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (!isRecording) {
      animFrameId = requestAnimationFrame(drawIdleRing);
    }
  }

  function drawActiveRing() {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);

    const w = visCanvas.width;
    const h = visCanvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r  = (Math.min(w, h) / 2) - 20;
    const t  = Date.now() / 1000;

    ctx.clearRect(0, 0, w, h);

    // Outer glow ring
    const segments = 128;
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2 - Math.PI / 2;
      const freqIndex = Math.floor((i / segments) * dataArray.length * 0.5);
      const amplitude = (dataArray[freqIndex] || 0) / 255;
      const wobble = amplitude * 28 + Math.sin(angle * 4 + t * 2) * 4;
      const px = cx + (r + wobble) * Math.cos(angle);
      const py = cy + (r + wobble) * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();

    // Gradient stroke
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, 'rgba(167, 139, 250, 0.7)');
    grad.addColorStop(0.5, 'rgba(96, 165, 250, 0.6)');
    grad.addColorStop(1, 'rgba(248, 113, 113, 0.5)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(167, 139, 250, 0.3)';
    ctx.shadowBlur = 16;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Inner mirror ring
    ctx.beginPath();
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2 - Math.PI / 2;
      const freqIndex = Math.floor((i / segments) * dataArray.length * 0.4);
      const amplitude = (dataArray[freqIndex] || 0) / 255;
      const wobble = amplitude * 14 + Math.sin(angle * 6 + t * 3) * 2;
      const innerR = r - 20;
      const px = cx + (innerR + wobble) * Math.cos(angle);
      const py = cy + (innerR + wobble) * Math.sin(angle);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.strokeStyle = 'rgba(167, 139, 250, 0.15)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (isRecording && !isPaused) {
      animFrameId = requestAnimationFrame(drawActiveRing);
    }
  }

  // Start idle animation
  drawIdleRing();

  // ── Timer ─────────────────────────────────────────────────
  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0');
  }

  function startTimer() {
    seconds = 0;
    timerEl.textContent = '00:00';
    timerEl.classList.add('active');
    timerInterval = setInterval(() => {
      seconds++;
      timerEl.textContent = formatTime(seconds);
    }, 1000);
  }

  function stopTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerEl.classList.remove('active');
  }

  function pauseTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  function resumeTimer() {
    timerInterval = setInterval(() => {
      seconds++;
      timerEl.textContent = formatTime(seconds);
    }, 1000);
  }

  // ── Recorder ──────────────────────────────────────────────
  async function startRecording() {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Audio context for visualizer
      audioCtx  = new (window.AudioContext || window.webkitAudioContext)();
      analyser  = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      const source = audioCtx.createMediaStreamSource(audioStream);
      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);

      // MediaRecorder
      mediaRecorder = new MediaRecorder(audioStream);
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        const url  = URL.createObjectURL(blob);
        audioPlayback.src = url;
        downloadBtn.href  = url;
        downloadBtn.download = `manu-recording-${Date.now()}.webm`;
        playbackSection.style.display = '';
      };

      mediaRecorder.start();
      isRecording = true;
      isPaused    = false;

      // UI
      micSvg.style.display     = 'none';
      stopSquare.style.display  = '';
      recBtn.classList.add('recording');
      visRing.classList.add('active');
      pauseBtn.disabled = false;
      playbackSection.style.display = 'none';
      startTimer();

      // Switch to active visualizer
      cancelAnimationFrame(animFrameId);
      drawActiveRing();

      showToast('🎙️', 'Recording started');
    } catch (err) {
      showToast('⚠️', 'Microphone access denied');
      console.error(err);
    }
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    if (audioStream) {
      audioStream.getTracks().forEach(t => t.stop());
    }
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
      analyser = null;
    }

    isRecording = false;
    isPaused    = false;

    // UI
    micSvg.style.display     = '';
    stopSquare.style.display  = 'none';
    recBtn.classList.remove('recording');
    visRing.classList.remove('active');
    pauseBtn.disabled = true;
    pauseBtn.querySelector('span').textContent = 'Pause';
    stopTimer();

    // Back to idle vis
    cancelAnimationFrame(animFrameId);
    drawIdleRing();

    showToast('✅', 'Recording saved');
  }

  recBtn.addEventListener('click', () => {
    if (!isRecording) {
      startRecording();
    } else {
      stopRecording();
    }
  });

  // ── Pause / Resume ────────────────────────────────────────
  pauseBtn.addEventListener('click', () => {
    if (!mediaRecorder) return;
    if (!isPaused) {
      mediaRecorder.pause();
      isPaused = true;
      pauseBtn.querySelector('span').textContent = 'Resume';
      pauseTimer();
      cancelAnimationFrame(animFrameId);
      showToast('⏸️', 'Paused');
    } else {
      mediaRecorder.resume();
      isPaused = false;
      pauseBtn.querySelector('span').textContent = 'Pause';
      resumeTimer();
      drawActiveRing();
      showToast('▶️', 'Resumed');
    }
  });

  // ── Keyboard shortcut: Space to toggle record ─────────────
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      recBtn.click();
    }
  });

})();
