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

  // err.name -> 給使用者看的中文說明，讓失敗原因肉眼可見，不用猜
  function friendlyError(err) {
    const map = {
      NotAllowedError: '尚未授權相機權限，請到瀏覽器/系統設定允許相機存取後再試一次',
      PermissionDeniedError: '尚未授權相機權限，請到瀏覽器/系統設定允許相機存取後再試一次',
      NotFoundError: '找不到可用的相機裝置',
      NotReadableError: '相機目前被其他程式占用中，請關閉其他使用相機的 App 後再試一次',
      OverconstrainedError: '這台裝置的相機不支援指定的拍攝模式',
      SecurityError: '目前網址不是安全連線（需要 https:// 或 localhost），無法使用相機',
      TimeoutError: '相機權限請求一直沒有回應，請檢查瀏覽器網址列或通知是否有跳出相機權限詢問，允許後再按「重試」',
    };
    const e = new Error(map[err.name] || `無法開啟相機（${err.name || err.message}）`);
    e.original = err;
    return e;
  }

  // getUserMedia 若卡在瀏覽器原生的權限詢問視窗（使用者還沒點允許/拒絕），
  // Promise 會一直不 resolve 也不 reject——這裡加逾時，讓 UI 至少能提示
  // 使用者「去找一下有沒有跳出權限視窗」，而不是讓黑畫面永遠卡住看起來像當機。
  // 逾時之後如果使用者晚一步才點允許，遲到的 stream 在這裡直接關掉釋放鏡頭，
  // 避免鏡頭指示燈一直亮著但畫面上其實已經放棄等待。
  function getUserMediaWithTimeout(constraints, ms) {
    let timedOut = false;
    const raw = navigator.mediaDevices.getUserMedia(constraints);
    raw.then(
      (lateStream) => { if (timedOut) lateStream.getTracks().forEach((t) => t.stop()); },
      () => {}
    );
    return Promise.race([
      raw,
      new Promise((_, reject) => setTimeout(() => {
        timedOut = true;
        reject(Object.assign(new Error('相機權限請求逾時'), { name: 'TimeoutError' }));
      }, ms)),
    ]);
  }

  async function openCamera() {
    try {
      return await getUserMediaWithTimeout({ video: { facingMode: 'environment' }, audio: false }, 12000);
    } catch (err) {
      if (err.name === 'OverconstrainedError') {
        // 部分裝置對 facingMode 的 ideal 值仍會擋下，退而求其次不指定鏡頭方向
        try {
          return await getUserMediaWithTimeout({ video: true, audio: false }, 12000);
        } catch (err2) {
          throw friendlyError(err2);
        }
      }
      throw friendlyError(err);
    }
  }

  async function start(video, resultCallback) {
    if (scanning) return;
    videoEl = video;
    onResult = resultCallback;

    stream = await openCamera();
    videoEl.srcObject = stream;
    try {
      await videoEl.play();
    } catch (err) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
      throw friendlyError(err);
    }

    if (await supportsBarcodeDetector()) {
      detector = new window.BarcodeDetector({ formats: ['qr_code'] });
    } else {
      detector = null;
      canvasEl = document.createElement('canvas');
      canvasCtx = canvasEl.getContext('2d', { willReadFrequently: true });
    }

    scanning = true;
    // 剛打開鏡頭的前幾禎通常還在對焦/使用者還在把手機舉起來對準，
    // 太早開始解碼容易撞到糊掉的畫面誤判，先跳過暖機期再開始嘗試解碼。
    rafId = setTimeout(scheduleNextFrame, 700);
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
