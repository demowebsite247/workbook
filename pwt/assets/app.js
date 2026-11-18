(() => {
  'use strict';

  const APK_RELEASE_URL = null;

  const I18N = {
    en: {
      gateTagline: 'Install PWT to unlock the application',
      gateHeading: 'Installation Required Before Use',
      gateDesc:
        'For offline App Shell caching and standalone execution, Create Group, Join Group, and Voice Communication stay locked until PWT is installed and opened as an installed app.',
      installPwaBtn: 'INSTALL PWT APP',
      manualInstallTitle: 'Manual Installation Guide (Android & Desktop)',
      apkTitle: 'Native Android APK (com.pwt.offlinetalk)',
      apkDesc:
        'Full routerless Wi-Fi Direct (WifiP2pManager) multi-phone communication and screen-off Foreground Service require the native Android APK built from this repository.',
      apkPendingBtn: 'Release APK Not Uploaded Yet',
      apkDownloadBtn: 'Download Android APK',
      createGroupHeading: 'Create Local Group Profile',
      groupNameLabel: 'Group Name',
      groupIdLabel: 'Unique Group ID',
      groupPassLabel: 'Group Password',
      createGroupBtn: 'Apply Channel Profile',
      joinGroupHeading: 'Secure Room & Wi-Fi Direct',
      browserLimitTitle: 'Browser Hardware Limitation',
      browserLimitDesc:
        'Web browsers/PWAs cannot access Android Wi-Fi Direct (WifiP2pManager) peer discovery APIs. Install the Native Android APK (com.pwt.offlinetalk) for multi-phone routerless voice relay.',
      tabCreate: 'Create Group Profile',
      aboutTitle: 'Menu & Settings',
      callsignLabel: 'Your Callsign',
      chooseLangLabel: 'Language'
    },
    bn: {
      gateTagline: 'অ্যাপ ব্যবহার করতে আগে PWT ইনস্টল করুন',
      gateHeading: 'ব্যবহারের আগে ইনস্টলেশন বাধ্যতামূলক',
      gateDesc:
        'অফলাইন অ্যাপ শেল ও স্ট্যান্ডঅ্যালোন মোডে চালাতে PWT ইনস্টল না করা পর্যন্ত Create Group, Join Group এবং Voice Communication লক করা থাকবে।',
      installPwaBtn: 'INSTALL PWT APP',
      manualInstallTitle: 'ম্যানুয়াল ইনস্টলেশন নির্দেশনা (Android ও Computer)',
      apkTitle: 'Native Android APK (com.pwt.offlinetalk)',
      apkDesc:
        'রাউটার ছাড়া প্রকৃত Wi-Fi Direct (WifiP2pManager) ভয়েস যোগাযোগ এবং স্ক্রিন বন্ধ রেখে ব্যাকগ্রাউন্ড সার্ভিসের জন্য এই প্রজেক্টের Native Android APK ব্যবহার করুন।',
      apkPendingBtn: 'রিলিজ APK এখনো আপলোড হয়নি',
      apkDownloadBtn: 'Android APK ডাউনলোড করুন',
      createGroupHeading: 'লোকাল গ্রুপ প্রোফাইল তৈরি',
      groupNameLabel: 'গ্রুপের নাম',
      groupIdLabel: 'ইউনিক গ্রুপ আইডি',
      groupPassLabel: 'গ্রুপ পাসওয়ার্ড',
      createGroupBtn: 'চ্যানেল প্রোফাইল চালু করুন',
      joinGroupHeading: 'সিকিউর রুম ও Wi-Fi Direct',
      browserLimitTitle: 'ব্রাউজার স্যান্ডবক্স সীমাবদ্ধতা',
      browserLimitDesc:
        'ওয়েব ব্রাউজার/PWA সরাসরি Android Wi-Fi Direct P2P ডিভাইস খুঁজে পায় না। কাছাকাছি ফোনে অফলাইন ওয়াকি-টকি চালাতে Native Android APK (com.pwt.offlinetalk) ইনস্টল করুন।',
      tabCreate: 'নতুন গ্রুপ প্রোফাইল',
      aboutTitle: 'মেনু ও সেটিংস',
      callsignLabel: 'আপনার কলসাইন / নাম',
      chooseLangLabel: 'ভাষা'
    }
  };

  let currentLang = 'en';
  let deferredInstallPrompt = null;
  let pttMode = 'HOLD';
  let beepOn = true;
  let isTransmitting = false;

  const splashEl = document.getElementById('splash-screen');
  const gateView = document.getElementById('install-gate-view');
  const appView = document.getElementById('app-shell-view');
  const installBtn = document.getElementById('pwa-install-btn');
  const promptStatus = document.getElementById('pwa-prompt-status');
  const manualStepsEl = document.getElementById('manual-install-steps');

  function isStandaloneInstalled() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  }

  function detectPlatform() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    return 'desktop';
  }

  function renderManualInstructions() {
    const platform = detectPlatform();
    const isBn = currentLang === 'bn';
    let html = '';
    if (platform === 'android') {
      html = isBn
        ? `<ol>
            <li>Google Chrome বা Microsoft Edge দিয়ে এই পেজটি খুলুন।</li>
            <li>উপরের <strong>INSTALL PWT APP</strong> বাটনে চাপুন বা <strong>⋮ → Install app</strong> সিলেক্ট করুন।</li>
            <li>ফোনের Home Screen থেকে ইনস্টল করা <strong>PWT</strong> আইকন দিয়ে চালু করুন।</li>
          </ol>`
        : `<ol>
            <li>Open this page in Google Chrome or Microsoft Edge on Android.</li>
            <li>Tap <strong>INSTALL PWT APP</strong> above or open <strong>⋮ → Install app / Add to Home screen</strong>.</li>
            <li>Launch <strong>PWT</strong> from your Home Screen.</li>
          </ol>`;
    } else if (platform === 'ios') {
      html = isBn
        ? `<ol><li>iOS Safari-তে <strong>Share → Add to Home Screen</strong> সিলেক্ট করুন।</li></ol>`
        : `<ol><li>In iOS Safari, tap <strong>Share → Add to Home Screen</strong>.</li></ol>`;
    } else {
      html = isBn
        ? `<ol><li>Windows/Desktop Chrome বা Edge-এ address bar-এর <strong>Install app</strong> আইকনে ক্লিক করুন।</li></ol>`
        : `<ol><li>In Chrome or Edge on Desktop, click the <strong>Install app</strong> icon in the address bar.</li></ol>`;
    }
    manualStepsEl.innerHTML = html;
  }

  function applyLanguage(lang) {
    currentLang = lang;
    const dict = I18N[lang] || I18N.en;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (dict[key]) el.textContent = dict[key];
    });
    document.querySelectorAll('.lang-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-lang') === lang);
    });
    renderManualInstructions();
  }

  function updateGateDiagnostics(swStatus, manifestStatus) {
    const standalone = isStandaloneInstalled();
    document.getElementById('diag-display').textContent = standalone ? 'Standalone (Installed)' : 'Browser Tab';
    document.getElementById('diag-https').textContent = window.isSecureContext ? 'Secure (HTTPS)' : 'Non-HTTPS';
    if (swStatus) document.getElementById('diag-sw').textContent = swStatus;
    if (manifestStatus) document.getElementById('diag-manifest').textContent = manifestStatus;
  }

  async function initServiceWorkerAndManifest() {
    let manifestOk = 'Error';
    try {
      const res = await fetch('./manifest.json', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        manifestOk = data && data.start_url ? 'Valid' : 'Invalid';
      }
    } catch {
      manifestOk = 'Offline/Cached';
    }

    let swState = 'Unsupported';
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
        swState = reg.active ? 'Active (./)' : 'Registered (./)';
      } catch {
        swState = 'Blocked / Error';
      }
    }
    updateGateDiagnostics(swState, manifestOk);
  }

  async function checkApkAvailability() {
    const apkBtn = document.getElementById('apk-download-btn');
    const apkNote = document.getElementById('apk-status-note');
    if (APK_RELEASE_URL) {
      apkBtn.href = APK_RELEASE_URL;
      apkBtn.setAttribute('download', 'pwt-release.apk');
      apkBtn.classList.remove('disabled');
      apkBtn.setAttribute('aria-disabled', 'false');
      apkBtn.querySelector('span').setAttribute('data-i18n', 'apkDownloadBtn');
      applyLanguage(currentLang);
      apkNote.textContent = 'Verified Release APK link configured.';
      return;
    }
    try {
      const res = await fetch('./downloads/pwt-release.apk', { method: 'HEAD' });
      if (res.ok) {
        apkBtn.href = './downloads/pwt-release.apk';
        apkBtn.setAttribute('download', 'pwt-release.apk');
        apkBtn.classList.remove('disabled');
        apkBtn.setAttribute('aria-disabled', 'false');
        apkBtn.querySelector('span').setAttribute('data-i18n', 'apkDownloadBtn');
        applyLanguage(currentLang);
        apkNote.textContent = 'Local APK artifact verified.';
        return;
      }
    } catch {
      // ignore
    }
    apkNote.textContent =
      'No signed APK uploaded yet. Build from Android source (gradle :app:assembleRelease) and attach to GitHub Releases.';
  }

  function routeInitialMode() {
    if (isStandaloneInstalled()) {
      gateView.classList.add('hidden');
      appView.classList.remove('hidden');
      initInstalledAppShell();
    } else {
      appView.classList.add('hidden');
      gateView.classList.remove('hidden');
      promptStatus.textContent = window.isSecureContext
        ? 'Waiting for browser install prompt or follow the manual steps below.'
        : 'HTTPS is required for PWA installation (host via GitHub Pages or localhost).';
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    promptStatus.textContent = 'Browser install prompt ready. Tap INSTALL PWT APP to install.';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const pill = document.getElementById('gate-install-pill');
    const pillText = document.getElementById('gate-install-pill-text');
    pill.classList.remove('status-pending');
    pill.classList.add('status-ok');
    pillText.textContent = 'Installed — Launch PWT from Home Screen / Desktop';
    promptStatus.textContent =
      'PWT installed! Close this browser tab and open PWT from your Home Screen or Desktop App icon.';
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredInstallPrompt) {
      promptStatus.textContent =
        'One-click prompt unavailable in this browser. Follow the manual installation instructions below.';
      return;
    }
    deferredInstallPrompt.prompt();
    const result = await deferredInstallPrompt.userChoice;
    promptStatus.textContent =
      result.outcome === 'accepted'
        ? 'Installation accepted. Waiting for OS confirmation...'
        : 'Installation dismissed. Communication interface remains locked.';
    deferredInstallPrompt = null;
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
        msgEl.textContent = 'Enter a password (min 4 characters).';
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
      channelStatus.textContent = 'CHANNEL: MIC TEST ACTIVE';
      linkState.textContent = 'LOCAL MIC';
      linkState.classList.add('live');

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          pttNote.textContent =
            'Local microphone active. For multi-phone offline Wi-Fi Direct voice relay, install Native Android APK.';
        } catch (err) {
          pttNote.textContent = `Microphone permission denied/unavailable: ${err.message}`;
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

  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyLanguage(btn.getAttribute('data-lang')));
  });

  applyLanguage('en');
  routeInitialMode();
  initServiceWorkerAndManifest();
  checkApkAvailability();

  setTimeout(() => {
    splashEl.classList.add('fade-out');
  }, 850);
})();
