// Camera capture + QR decode. Prefers the native BarcodeDetector API
// (Android Chrome / ChromeOS only) and falls back to the vendored jsQR
// decoder everywhere else — including this project's Windows dev machine,
// where BarcodeDetector is never present, so the jsQR path is what actually
// gets exercised during development.

const Scanner = (() => {
  let stream = null;
  let videoEl = null;
  let canvasEl = null;
  let canvasCtx = null;
  let detector = null;
  let rafId = null;
  let onResult = null;
  let scanning = false;

  async function supportsBarcodeDetector() {
    if (!('BarcodeDetector' in window)) return false;
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      return formats.includes('qr_code');
    } catch {
      return false;
    }
  }

  async function start(video, resultCallback) {
    if (scanning) return;
    videoEl = video;
    onResult = resultCallback;

    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    videoEl.srcObject = stream;
    await videoEl.play();

    if (await supportsBarcodeDetector()) {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } else {
      detector = null;
      canvasEl = document.createElement('canvas');
      canvasCtx = canvasEl.getContext('2d', { willReadFrequently: true });
    }

    scanning = true;
    scheduleNextFrame();
  }

  function scheduleNextFrame() {
    // Throttle to roughly 6fps decode attempts — full 60fps is wasted
    // battery for a QR decode loop.
    rafId = setTimeout(tick, 160);
  }

  async function tick() {
    if (!scanning) return;
    try {
      const codes = detector ? await detectNative() : detectFallback();
      if (codes && codes.length > 0) {
        const raw = codes[0];
        stop();
        onResult({ ok: true, raw });
        return;
      }
    } catch (err) {
      // Transient decode errors are expected on out-of-focus frames; keep scanning.
    }
    scheduleNextFrame();
  }

  async function detectNative() {
    if (videoEl.readyState < 2) return null;
    const results = await detector.detect(videoEl);
    return results.map((r) => r.rawValue);
  }

  function detectFallback() {
    if (videoEl.readyState < 2 || videoEl.videoWidth === 0) return null;
    canvasEl.width = videoEl.videoWidth;
    canvasEl.height = videoEl.videoHeight;
    canvasCtx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
    const imageData = canvasCtx.getImageData(0, 0, canvasEl.width, canvasEl.height);
    const result = window.jsQR(imageData.data, imageData.width, imageData.height);
    return result ? [result.data] : null;
  }

  function stop() {
    scanning = false;
    if (rafId) clearTimeout(rafId);
    rafId = null;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (videoEl) videoEl.srcObject = null;
  }

  return { start, stop };
})();

window.Scanner = Scanner;
