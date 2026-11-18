(() => {
  'use strict';

  let deferredInstallPrompt = null;
  let pttMode = 'HOLD';
  let beepOn = true;
  let isTransmitting = false;

  const splashEl = document.getElementById('splash-screen');
  const gateView = document.getElementById('install-gate-view');
  const appView = document.getElementById('app-shell-view');
  const installBtn = document.getElementById('pwa-install-btn');
  const installerSub = document.getElementById('installer-sub');
  const promptHint = document.getElementById('pwa-prompt-status');

  function isStandaloneInstalled() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    if (/android/i.test(ua)) return 'android';
    return 'desktop';
  }

  function showHint(text) {
    promptHint.textContent = text;
    promptHint.classList.remove('hidden');
  }

  async function initServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      } catch {
        // ignore in unsupported or non-HTTPS local file context
      }
    }
  }

  function routeInitialMode() {
    if (isStandaloneInstalled()) {
      gateView.classList.add('hidden');
      appView.classList.remove('hidden');
      initInstalledAppShell();
    } else {
      appView.classList.add('hidden');
      gateView.classList.remove('hidden');
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    installBtn.textContent = 'INSTALL & OPEN';
    promptHint.classList.add('hidden');
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    installerSub.textContent = 'App installed';
    installBtn.textContent = 'OPEN PWT';
    showHint('Open PWT from your Home Screen or App icon.');
  });

  installBtn.addEventListener('click', async () => {
    if (isStandaloneInstalled()) {
      routeInitialMode();
      return;
    }
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const result = await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      if (result.outcome === 'accepted') {
        installerSub.textContent = 'Installing...';
        promptHint.classList.add('hidden');
      } else {
        showHint('Tap INSTALL & OPEN to install.');
      }
      return;
    }

    const platform = detectPlatform();
    if (platform === 'ios') {
      showHint('Tap Share → Add to Home Screen.');
    } else if (platform === 'android') {
      showHint('Tap browser menu (⋮) → Install app.');
    } else {
      showHint('Click the Install icon in the address bar.');
    }
  });

  function playRogerBeep(start) {
    if (!beepOn) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = start ? 1050 : 780;
      gain.gain.value = 0.08;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
      setTimeout(() => ctx.close().catch(() => {}), 140);
    } catch {
      // ignore
    }
  }

  function initInstalledAppShell() {
    const gidInput = document.getElementById('group-id-input');
    const genGid = () => {
      const num = Math.floor(1000 + Math.random() * 9000);
      const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      return `PWT-${num}-${letters[Math.floor(Math.random() * 26)]}${letters[Math.floor(Math.random() * 26)]}`;
    };
    gidInput.value = genGid();
    document.getElementById('regen-gid-btn').addEventListener('click', () => {
      gidInput.value = genGid();
    });

    const switchScreen = (name) => {
      document.querySelectorAll('.screen').forEach((s) => {
        s.classList.toggle('active', s.id === `screen-${name}`);
      });
    };

    document.querySelectorAll('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => switchScreen(btn.getAttribute('data-nav')));
    });

    document.querySelectorAll('[data-back-comm]').forEach((btn) => {
      btn.addEventListener('click', () => switchScreen('comm'));
    });

    document.getElementById('pwa-callsign').addEventListener('input', (e) => {
      const name = (e.target.value || 'ALPHA-1').trim().toUpperCase();
      document.getElementById('hw-user-pill').textContent = `USER: ${name} (YOU)`;
    });

    document.getElementById('create-group-submit').addEventListener('click', () => {
      const gName = (document.getElementById('group-name-input').value || 'DISPATCH').trim().toUpperCase();
      const gId = gidInput.value.trim();
      const gPass = document.getElementById('group-pass-input').value;
      const msgEl = document.getElementById('create-group-msg');
      if (gPass.length < 4) {
        msgEl.textContent = 'Minimum 4 characters.';
        return;
      }
      const digits = gId.replace(/\D/g, '').slice(0, 2).padStart(2, '0');
      document.getElementById('comm-group-title').textContent = `GROUP: ${gName}`;
      document.getElementById('hw-seven-seg').textContent = digits;
      document.getElementById('hw-ch-small').textContent = `CH ${digits}`;
      msgEl.textContent = '';
      switchScreen('comm');
    });

    document.getElementById('dock-mode-btn').addEventListener('click', () => {
      pttMode = pttMode === 'HOLD' ? 'LOCK' : 'HOLD';
      document.getElementById('dock-mode-val').textContent = pttMode;
      document.getElementById('ptt-label').innerHTML =
        pttMode === 'HOLD' ? 'PRESS &amp; HOLD<br />TO SPEAK' : 'TAP TO<br />SPEAK';
    });

    document.getElementById('dock-beep-btn').addEventListener('click', () => {
      beepOn = !beepOn;
      document.getElementById('dock-beep-val').textContent = beepOn ? 'ON' : 'OFF';
    });

    setupPttDome();
  }

  function setupPttDome() {
    const pttBtn = document.getElementById('ptt-button');
    const pttLabel = document.getElementById('ptt-label');
    const pttNote = document.getElementById('ptt-status-note');
    const channelStatus = document.getElementById('comm-channel-status');
    const linkState = document.getElementById('hw-link-state');
    let stream = null;

    async function startMic() {
      if (isTransmitting) return;
      isTransmitting = true;
      playRogerBeep(true);
      pttBtn.classList.add('transmitting');
      pttLabel.innerHTML = 'TRANSMITTING<br />LIVE';
      channelStatus.textContent = 'CHANNEL: MIC ACTIVE';
      linkState.textContent = 'LIVE MIC';
      linkState.classList.add('live');

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          pttNote.textContent = 'LOCAL MIC ACTIVE • USE APK FOR P2P';
        } catch (err) {
          pttNote.textContent = `MIC UNAVAILABLE: ${err.message}`;
        }
      }
    }

    function stopMic() {
      if (!isTransmitting) return;
      isTransmitting = false;
      playRogerBeep(false);
      pttBtn.classList.remove('transmitting');
      pttLabel.innerHTML = pttMode === 'HOLD' ? 'PRESS &amp; HOLD<br />TO SPEAK' : 'TAP TO<br />SPEAK';
      channelStatus.textContent = 'CHANNEL: CLEAR';
      linkState.textContent = 'OFFLINE';
      linkState.classList.remove('live');
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      pttNote.textContent = 'OFFLINE READY • LOCAL WIRELESS';
    }

    pttBtn.addEventListener('pointerdown', () => {
      if (pttMode === 'HOLD') {
        startMic();
      } else if (isTransmitting) {
        stopMic();
      } else {
        startMic();
      }
    });
    pttBtn.addEventListener('pointerup', () => {
      if (pttMode === 'HOLD') stopMic();
    });
    pttBtn.addEventListener('pointercancel', () => {
      if (pttMode === 'HOLD') stopMic();
    });
    pttBtn.addEventListener('pointerleave', () => {
      if (pttMode === 'HOLD') stopMic();
    });
  }

  initServiceWorker();
  routeInitialMode();

  setTimeout(() => {
    splashEl.classList.add('fade-out');
  }, 600);
})();
