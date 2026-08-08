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
    button: document.getElementById('cameraButton'),
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
  }

  function errorText(error) {
    const name = error && error.name;
    if (!window.isSecureContext) return 'HTTPSのページで開いてください。安全な接続でないとカメラを使えません。';
    if (name === 'NotAllowedError' || name === 'SecurityError') return 'カメラが許可されていません。ChromeまたはSafariのサイト設定でカメラを許可してください。';
    if (name === 'NotReadableError') return 'カメラが他のアプリで使用中です。ほかのカメラアプリを閉じてください。';
    if (name === 'NotFoundError') return '利用できるカメラが見つかりません。';
    return 'カメラを開始できませんでした。もう一度お試しください。';
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
    setStatus('読み取りました。次のノートへ', 'success');
    postToParent({ type: 'TOKEN', token });
    if ('vibrate' in navigator && typeof navigator.vibrate === 'function') navigator.vibrate(35);
  }

  async function startCamera() {
    if (!state.connected || state.active) return;
    if (!window.ZXingBrowser || !window.ZXingBrowser.BrowserQRCodeReader || !navigator.mediaDevices?.getUserMedia) {
      setStatus('このブラウザではカメラを利用できません', 'error');
      postToParent({ type: 'ERROR', message: 'カメラAPIを利用できません' });
      return;
    }
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
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      }, elements.video, result => {
        if (result) handleToken(result.getText());
      });
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
      elements.frame.classList.remove('is-active');
      elements.message.hidden = false;
      elements.button.textContent = 'カメラを開始';
      setStatus(errorText(error), 'error');
      postToParent({ type: 'ERROR', message: errorText(error) });
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
    elements.frame.classList.remove('is-active');
    elements.message.hidden = false;
    elements.button.textContent = 'カメラを開始';
    setStatus(state.connected ? 'カメラは停止中です' : 'GAS画面との接続を待っています');
    if (notify) postToParent({ type: 'STOPPED' });
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
