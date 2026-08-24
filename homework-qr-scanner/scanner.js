(() => {
  'use strict';

  const TOKEN_PATTERN = /^HQ1-[A-Z0-9]{24,40}$/;
  const MESSAGE_SOURCE = 'homework-qr-camera';
  const PARENT_SOURCE = 'homework-qr-app';
  const params = new URLSearchParams(window.location.search);
  const channel = params.get('channel') || '';
  const parentOrigin = params.get('parentOrigin') || '';
  const parentWindow = window.opener;

  const elements = {
    badge: document.getElementById('connectionBadge'),
    frame: document.getElementById('cameraFrame'),
    video: document.getElementById('cameraPreview'),
    message: document.getElementById('cameraMessage'),
    status: document.getElementById('liveStatus'),
    cameraControlsStatus: document.getElementById('cameraControlsStatus'),
    button: document.getElementById('cameraButton'),
    switchCamera: document.getElementById('switchCameraButton'),
    mirror: document.getElementById('mirrorButton'),
    close: document.getElementById('closeButton'),
    count: document.getElementById('scanCount'),
    lastRead: document.getElementById('lastRead')
  };
  const state = {
    connected: false,
    active: false,
    reader: null,
    controls: null,
    scanCount: 0,
    successTimer: null,
    requestedFacingMode: 'environment',
    actualFacingMode: 'unknown',
    mirrorEnabled: false,
    starting: false,
    switching: false,
    lastSeen: new Map()
  };

  function validConnection() {
    if (!parentWindow || !channel || channel.length < 12 || !parentOrigin) return false;
    try {
      const origin = new URL(parentOrigin).origin;
      return /^https:$/.test(new URL(parentOrigin).protocol) && origin !== window.location.origin;
    } catch (_) {
      return false;
    }
  }

  function postToParent(message) {
    if (!validConnection()) return;
    parentWindow.postMessage({ source: MESSAGE_SOURCE, channel, ...message }, new URL(parentOrigin).origin);
  }

  function setStatus(message, kind) {
    elements.status.textContent = message;
    elements.status.className = 'live-status' + (kind ? ' ' + kind : '');
  }

  function cameraLabel(facingMode) {
    if (facingMode === 'user') return '内カメラ';
    if (facingMode === 'environment') return '外カメラ';
    return 'カメラ';
  }

  function updateCameraControls() {
    const currentMode = state.actualFacingMode === 'unknown' ? state.requestedFacingMode : state.actualFacingMode;
    const targetMode = currentMode === 'user' ? 'environment' : 'user';
    const controlsDisabled = !state.active || state.starting || state.switching;
    elements.button.disabled = !state.connected || state.starting || state.switching;
    elements.switchCamera.disabled = controlsDisabled;
    elements.mirror.disabled = controlsDisabled;
    elements.switchCamera.textContent = cameraLabel(targetMode) + 'に切り替え';
    elements.mirror.textContent = '左右反転：' + (state.mirrorEnabled ? 'ON' : 'OFF');
    elements.mirror.setAttribute('aria-pressed', String(state.mirrorEnabled));
    elements.cameraControlsStatus.textContent = cameraLabel(currentMode) + '・左右反転' + (state.mirrorEnabled ? 'あり' : 'なし');
  }

  function setConnected(connected) {
    state.connected = connected;
    elements.badge.classList.toggle('is-connected', connected);
    elements.badge.textContent = connected ? 'GAS接続済み' : 'GAS接続待ち';
    elements.button.disabled = !connected;
    if (!connected) {
      elements.button.textContent = 'GAS画面から起動';
      setStatus('GAS画面との接続を待っています');
    } else if (!state.active) {
      elements.button.textContent = 'カメラを開始';
      setStatus('カメラを起動しています…');
    }
    updateCameraControls();
  }

  function errorText(error) {
    const name = error && error.name;
    if (!window.isSecureContext) return 'HTTPSのページで開いてください。安全な接続でないとカメラを使えません。';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'カメラが許可されていません。ChromeまたはSafariのサイト設定でカメラを許可してください。';
    if (name === 'NotReadableError') return 'カメラが他のアプリで使用中です。ほかのカメラアプリを閉じてください。';
    if (name === 'NotFoundError') return '利用できるカメラが見つかりません。';
    return 'カメラを開始できませんでした。もう一度お試しください。';
  }

  function applyCameraOrientation() {
    const stream = elements.video.srcObject;
    const track = stream && typeof stream.getVideoTracks === 'function' ? stream.getVideoTracks()[0] : null;
    const settings = track && typeof track.getSettings === 'function' ? track.getSettings() : {};
    const facingMode = String(settings.facingMode || '').toLowerCase();
    state.actualFacingMode = facingMode === 'user' || facingMode === 'environment' ? facingMode : 'unknown';
    state.mirrorEnabled = state.actualFacingMode === 'user';
    elements.video.classList.toggle('camera-preview--mirrored', state.mirrorEnabled);
    updateCameraControls();
  }

  function handleToken(rawToken) {
    const token = String(rawToken || '').trim().toUpperCase();
    if (!TOKEN_PATTERN.test(token)) return;
    const now = Date.now();
    const previous = state.lastSeen.get(token) || 0;
    if (now - previous < 900) return;
    state.lastSeen.set(token, now);
    for (const [key, seenAt] of state.lastSeen.entries()) {
      if (now - seenAt > 15000) state.lastSeen.delete(key);
    }
    state.scanCount += 1;
    elements.count.textContent = '本日の読取 ' + state.scanCount;
    elements.lastRead.hidden = false;
    elements.lastRead.textContent = '直近の読取：固定QRを受け付けました（' + token.slice(0, 8) + '…）';
    setStatus('読み取り完了。次のノートへ', 'success');
    elements.frame.classList.add('scan-success');
    window.clearTimeout(state.successTimer);
    state.successTimer = window.setTimeout(() => elements.frame.classList.remove('scan-success'), 420);
    postToParent({ type: 'TOKEN', token });
    if ('vibrate' in navigator && typeof navigator.vibrate === 'function') navigator.vibrate(35);
  }

  async function startCamera() {
    if (!state.connected || state.active || state.starting) return;
    if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserQRCodeReader || !navigator.mediaDevices?.getUserMedia) {
      setStatus('このブラウザではカメラを利用できません', 'error');
      postToParent({ type: 'ERROR', message: 'カメラAPIを利用できません' });
      return;
    }
    state.starting = true;
    updateCameraControls();
    setStatus('カメラを起動しています…');
    try {
      const reader = new window.ZXingBrowser.BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: 90
      });
      state.reader = reader;
      state.controls = await reader.decodeFromConstraints({
        audio: false,
        video: {
          facingMode: { ideal: state.requestedFacingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      }, elements.video, result => {
        if (result) handleToken(result.getText());
      });
      applyCameraOrientation();
      state.active = true;
      elements.frame.classList.add('is-active');
      elements.message.hidden = true;
      elements.button.textContent = 'カメラを停止';
      setStatus('読取中です。ノートの固定QRを順番に映してください');
      postToParent({ type: 'SCANNING' });
    } catch (error) {
      state.controls?.stop?.();
      state.controls = null;
      state.reader = null;
      state.active = false;
      elements.video.classList.remove('camera-preview--mirrored');
      elements.frame.classList.remove('is-active');
      elements.message.hidden = false;
      elements.button.textContent = 'カメラを開始';
      setStatus(errorText(error), 'error');
      postToParent({ type: 'ERROR', message: errorText(error) });
    } finally {
      state.starting = false;
      updateCameraControls();
    }
  }

  function stopCamera(notify = true) {
    state.controls?.stop?.();
    state.controls = null;
    state.reader = null;
    const stream = elements.video.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach(track => track.stop());
    elements.video.srcObject = null;
    state.active = false;
    state.actualFacingMode = 'unknown';
    state.mirrorEnabled = false;
    elements.video.classList.remove('camera-preview--mirrored');
    elements.frame.classList.remove('is-active');
    elements.message.hidden = false;
    elements.button.textContent = 'カメラを開始';
    setStatus(state.connected ? 'カメラは停止中です' : 'GAS画面との接続を待っています');
    updateCameraControls();
    if (notify) postToParent({ type: 'STOPPED' });
  }

  async function switchCamera() {
    if (!state.active || state.switching) return;
    const currentMode = state.actualFacingMode === 'unknown' ? state.requestedFacingMode : state.actualFacingMode;
    state.requestedFacingMode = currentMode === 'user' ? 'environment' : 'user';
    state.switching = true;
    updateCameraControls();
    setStatus(cameraLabel(state.requestedFacingMode) + 'を起動しています…');
    stopCamera(false);
    try {
      await startCamera();
    } finally {
      state.switching = false;
      updateCameraControls();
    }
  }

  function toggleMirror() {
    if (!state.active || state.starting || state.switching) return;
    state.mirrorEnabled = !state.mirrorEnabled;
    elements.video.classList.toggle('camera-preview--mirrored', state.mirrorEnabled);
    updateCameraControls();
  }

  function onParentMessage(event) {
    if (!validConnection() || event.source !== parentWindow || event.origin !== new URL(parentOrigin).origin) return;
    const message = event.data;
    if (!message || message.source !== PARENT_SOURCE || message.channel !== channel) return;
    if (message.type === 'CONNECTED') {
      setConnected(true);
      void startCamera();
    } else if (message.type === 'CLOSE') {
      stopCamera(false);
      window.close();
    }
  }

  elements.button.addEventListener('click', () => {
    if (state.active) stopCamera();
    else void startCamera();
  });
  elements.switchCamera.addEventListener('click', () => void switchCamera());
  elements.mirror.addEventListener('click', toggleMirror);
  elements.close.addEventListener('click', () => {
    stopCamera();
    window.close();
    setStatus('このタブは閉じられません。ブラウザの戻る操作で戻ってください');
  });
  window.addEventListener('message', onParentMessage);
  window.addEventListener('beforeunload', () => stopCamera());

  setConnected(validConnection());
  if (validConnection()) {
    postToParent({ type: 'READY' });
    void startCamera();
  } else {
    setStatus('GAS画面の「共有スキャン画面を開く」から起動してください', 'error');
  }
})();
