(() => {
  'use strict';

  const WSS_BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ];

  let deferredInstallPrompt = null;
  let pttMode = 'HOLD';
  let beepOn = true;
  let isTransmitting = false;
  let rxVolume = 1.0;

  let activeGroupName = 'DISPATCH';
  let activePassword = '';
  let localCallsign = 'ALPHA-1';
  const localPeerId = 'pwt-' + Math.random().toString(36).slice(2, 10);

  // Signaling & WebRTC Peer state
  let mqttSocket = null;
  let mqttKeepaliveTimer = null;
  let mqttTopic = '';
  let roomAesKey = null;
  let activeTransportLabel = 'OFFLINE';
  let manualLanPc = null;

  const peers = new Map(); // peerId -> { pc, dc, name, sender, audioEl }
  let activeFloorSpeakerId = null;
  let activeFloorSpeakerName = '';
  let localMicStream = null;
  let localMicTrack = null;

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
        // ignore in unsupported contexts
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
    showHint('Open PWT from your Home Screen or Desktop App icon.');
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

  function channelNumberFromName(name) {
    const clean = (name || 'DISPATCH').trim().toUpperCase();
    if (clean === 'DISPATCH') return '01';
    let hash = 0;
    for (let i = 0; i < clean.length; i++) {
      hash = (hash * 31 + clean.charCodeAt(i)) % 98;
    }
    return String(hash + 2).padStart(2, '0');
  }

  // ==========================================================
  // WebCrypto AES-256-GCM Room Key & Topic Derivation
  // ==========================================================
  async function deriveRoomSecurity(groupName, password) {
    const enc = new TextEncoder();
    const roomSeed = `${groupName.trim().toUpperCase()}::${password}`;
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(roomSeed));
    const hex = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const key = await crypto.subtle.importKey(
      'raw',
      digest,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
    return { topic: `pwt/v2/${hex.slice(0, 28)}`, key };
  }

  async function encryptEnvelope(obj) {
    if (!roomAesKey) return null;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(obj));
    const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, roomAesKey, data);
    const out = new Uint8Array(12 + cipher.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(cipher), 12);
    let bin = '';
    for (let i = 0; i < out.length; i++) bin += String.fromCharCode(out[i]);
    return btoa(bin);
  }

  async function decryptEnvelope(b64) {
    if (!roomAesKey) return null;
    try {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.length < 13) return null;
      const iv = bytes.slice(0, 12);
      const ct = bytes.slice(12);
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, roomAesKey, ct);
      return JSON.parse(new TextDecoder().decode(plain));
    } catch {
      return null;
    }
  }

  // ==========================================================
  // Minimal MQTT 3.1.1 Binary Packet Framing over WSS
  // ==========================================================
  function encodeVarLen(len) {
    const out = [];
    do {
      let b = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) b |= 128;
      out.push(b);
    } while (len > 0);
    return out;
  }

  function encodeMqttStr(str) {
    const b = new TextEncoder().encode(str);
    return [(b.length >> 8) & 0xff, b.length & 0xff, ...b];
  }

  function buildMqttConnect(clientId) {
    const vh = [0, 4, 77, 81, 84, 84, 4, 2, 0, 30];
    const pl = encodeMqttStr(clientId);
    const rem = vh.length + pl.length;
    return new Uint8Array([0x10, ...encodeVarLen(rem), ...vh, ...pl]);
  }

  function buildMqttSubscribe(packetId, topic) {
    const vh = [(packetId >> 8) & 0xff, packetId & 0xff];
    const pl = [...encodeMqttStr(topic), 0x00];
    const rem = vh.length + pl.length;
    return new Uint8Array([0x82, ...encodeVarLen(rem), ...vh, ...pl]);
  }

  function buildMqttPublish(topic, payloadText) {
    const tBytes = encodeMqttStr(topic);
    const pBytes = Array.from(new TextEncoder().encode(payloadText));
    const rem = tBytes.length + pBytes.length;
    return new Uint8Array([0x30, ...encodeVarLen(rem), ...tBytes, ...pBytes]);
  }

  function parseMqttPackets(buffer) {
    const bytes = new Uint8Array(buffer);
    const messages = [];
    let i = 0;
    while (i < bytes.length) {
      const header = bytes[i++];
      let mult = 1;
      let remLen = 0;
      let digit = 0;
      do {
        if (i >= bytes.length) return messages;
        digit = bytes[i++];
        remLen += (digit & 127) * mult;
        mult *= 128;
      } while (digit & 128);

      const end = i + remLen;
      if (end > bytes.length) break;

      const pktType = header >> 4;
      if (pktType === 2) {
        messages.push({ type: 'CONNACK' });
      } else if (pktType === 3) {
        const tLen = (bytes[i] << 8) | bytes[i + 1];
        let pos = i + 2 + tLen;
        if ((header & 0x06) > 0) pos += 2;
        const payload = new TextDecoder().decode(bytes.slice(pos, end));
        messages.push({ type: 'PUBLISH', payload });
      }
      i = end;
    }
    return messages;
  }

  async function publishSignal(obj) {
    if (!mqttSocket || mqttSocket.readyState !== WebSocket.OPEN || !mqttTopic) return;
    const encrypted = await encryptEnvelope({ ...obj, from: localPeerId, name: localCallsign });
    if (encrypted) {
      mqttSocket.send(buildMqttPublish(mqttTopic, encrypted));
    }
  }

  // ==========================================================
  // WebRTC Peer Connection Management (Online & Offline LAN)
  // ==========================================================
  function getConnectedPeerCount() {
    let count = 0;
    peers.forEach((p) => {
      if (p.pc && (p.pc.connectionState === 'connected' || p.pc.iceConnectionState === 'connected' || p.pc.iceConnectionState === 'completed')) {
        count++;
      }
    });
    return count;
  }

  function updateTransceiverUi() {
    const remoteCount = getConnectedPeerCount();
    const totalOnline = 1 + remoteCount;
    const onlineEl = document.getElementById('hw-online-count');
    const peopleVal = document.getElementById('dock-people-val');
    const linkState = document.getElementById('hw-link-state');
    const radioWaves = document.getElementById('hw-radio-waves');
    const sigBars = document.getElementById('hw-signal-bars');
    const note = document.getElementById('ptt-status-note');
    const pttBtn = document.getElementById('ptt-button');
    const pttLabel = document.getElementById('ptt-label');
    const chStatus = document.getElementById('comm-channel-status');

    onlineEl.textContent = `${totalOnline} ONLINE`;
    peopleVal.textContent = `${totalOnline} LIVE`;

    const isConnected = remoteCount > 0;
    onlineEl.classList.toggle('live', isConnected);
    sigBars.classList.toggle('connected', isConnected);

    const busyByOther = activeFloorSpeakerId && activeFloorSpeakerId !== localPeerId;
    pttBtn.classList.toggle('busy', Boolean(busyByOther));

    if (isTransmitting) {
      linkState.textContent = 'LIVE TX';
      linkState.classList.add('live');
      radioWaves.classList.add('live');
      chStatus.textContent = 'CHANNEL: TRANSMITTING';
      pttLabel.innerHTML = 'TRANSMITTING<br />LIVE';
      note.textContent = isConnected
        ? `VOICE ENCRYPTED (${activeTransportLabel})`
        : 'LOCAL MIC READY • NO REMOTE PEERS';
    } else if (busyByOther) {
      linkState.textContent = 'ONLINE';
      linkState.classList.add('live');
      radioWaves.classList.add('live');
      chStatus.textContent = `CHANNEL: RX ${activeFloorSpeakerName}`;
      pttLabel.innerHTML = `CHANNEL BUSY<br />${activeFloorSpeakerName}`;
      note.textContent = `SPEAKING: ${activeFloorSpeakerName}`;
    } else if (isConnected) {
      linkState.textContent = 'ONLINE';
      linkState.classList.add('live');
      radioWaves.classList.remove('live');
      chStatus.textContent = 'CHANNEL: CLEAR';
      pttLabel.innerHTML = defaultPttLabel();
      note.textContent = `${remoteCount} PEER CONNECTED (${activeTransportLabel})`;
    } else {
      linkState.textContent = activeTransportLabel === 'LINKING' ? 'LINKING' : 'OFFLINE';
      linkState.classList.remove('live');
      radioWaves.classList.remove('live');
      chStatus.textContent = 'CHANNEL: CLEAR';
      pttLabel.innerHTML = defaultPttLabel();
      if (activePassword && navigator.onLine) {
        note.textContent = 'WAITING FOR PEERS WITH SAME GROUP & PASSWORD';
      } else if (!navigator.onLine) {
        note.textContent = 'NO INTERNET • USE LAN PAIR OR ANDROID APK';
      } else {
        note.textContent = 'SET GROUP & PASSWORD TO CONNECT';
      }
    }
  }

  function defaultPttLabel() {
    const isDesktop = detectPlatform() === 'desktop';
    if (pttMode === 'HOLD') {
      return isDesktop ? 'HOLD / SPACE<br />TO SPEAK' : 'PRESS &amp; HOLD<br />TO SPEAK';
    }
    return isDesktop ? 'CLICK / SPACE<br />TO SPEAK' : 'TAP TO<br />SPEAK';
  }

  function createPeerRecord(peerId, peerName, useStun) {
    const iceServers = useStun ? [{ urls: 'stun:stun.l.google.com:19302' }] : [];
    const pc = new RTCPeerConnection({ iceServers });
    const transceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const audioEl = document.createElement('audio');
    audioEl.autoplay = true;
    audioEl.playsInline = true;
    audioEl.volume = rxVolume;
    document.getElementById('remote-audio-container').appendChild(audioEl);

    const record = {
      pc,
      dc: null,
      name: peerName || 'PEER',
      sender: transceiver.sender,
      audioEl
    };
    peers.set(peerId, record);

    if (localMicTrack && isTransmitting) {
      record.sender.replaceTrack(localMicTrack).catch(() => {});
    }

    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) {
        audioEl.srcObject = ev.streams[0];
      } else {
        audioEl.srcObject = new MediaStream([ev.track]);
      }
      audioEl.play().catch(() => {});
    };

    const bindDataChannel = (dc) => {
      record.dc = dc;
      dc.onopen = () => {
        dc.send(JSON.stringify({ type: 'HELLO', id: localPeerId, name: localCallsign }));
        updateTransceiverUi();
      };
      dc.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'HELLO') {
            record.name = (msg.name || 'PEER').toUpperCase();
          } else if (msg.type === 'FLOOR_REQ') {
            activeFloorSpeakerId = msg.id;
            activeFloorSpeakerName = (msg.name || record.name).toUpperCase();
            updateTransceiverUi();
          } else if (msg.type === 'FLOOR_REL') {
            if (activeFloorSpeakerId === msg.id) {
              activeFloorSpeakerId = null;
              activeFloorSpeakerName = '';
              updateTransceiverUi();
            }
          }
        } catch {
          // ignore
        }
      };
    };

    pc.ondatachannel = (ev) => bindDataChannel(ev.channel);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === 'failed' || st === 'closed') {
        cleanupPeer(peerId);
      } else {
        updateTransceiverUi();
      }
    };
    pc.oniceconnectionstatechange = () => updateTransceiverUi();

    return { record, bindDataChannel };
  }

  function cleanupPeer(peerId) {
    const rec = peers.get(peerId);
    if (!rec) return;
    peers.delete(peerId);
    if (activeFloorSpeakerId === peerId) {
      activeFloorSpeakerId = null;
      activeFloorSpeakerName = '';
    }
    try { rec.dc?.close(); } catch {}
    try { rec.pc?.close(); } catch {}
    try { rec.audioEl?.remove(); } catch {}
    updateTransceiverUi();
  }

  function disconnectAllPeers() {
    Array.from(peers.keys()).forEach(cleanupPeer);
    if (mqttKeepaliveTimer) {
      clearInterval(mqttKeepaliveTimer);
      mqttKeepaliveTimer = null;
    }
    if (mqttSocket) {
      try { mqttSocket.close(); } catch {}
      mqttSocket = null;
    }
    if (manualLanPc) {
      try { manualLanPc.close(); } catch {}
      manualLanPc = null;
    }
    activeTransportLabel = 'OFFLINE';
    updateTransceiverUi();
  }

  async function handleIncomingSignal(msg) {
    if (!msg || msg.from === localPeerId) return;
    const fromId = msg.from;
    const fromName = (msg.name || 'PEER').toUpperCase();

    if (msg.type === 'PRESENCE') {
      if (!peers.has(fromId) && localPeerId < fromId) {
        const { record, bindDataChannel } = createPeerRecord(fromId, fromName, true);
        const dc = record.pc.createDataChannel('pwt-floor');
        bindDataChannel(dc);
        record.pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            publishSignal({ type: 'ICE', to: fromId, candidate: ev.candidate });
          }
        };
        const offer = await record.pc.createOffer();
        await record.pc.setLocalDescription(offer);
        await publishSignal({ type: 'OFFER', to: fromId, sdp: offer });
      } else if (!peers.has(fromId)) {
        await publishSignal({ type: 'PRESENCE_ACK', to: fromId });
      }
      return;
    }

    if (msg.to && msg.to !== localPeerId) return;

    if (msg.type === 'PRESENCE_ACK' && !peers.has(fromId) && localPeerId < fromId) {
      const { record, bindDataChannel } = createPeerRecord(fromId, fromName, true);
      const dc = record.pc.createDataChannel('pwt-floor');
      bindDataChannel(dc);
      record.pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          publishSignal({ type: 'ICE', to: fromId, candidate: ev.candidate });
        }
      };
      const offer = await record.pc.createOffer();
      await record.pc.setLocalDescription(offer);
      await publishSignal({ type: 'OFFER', to: fromId, sdp: offer });
      return;
    }

    if (msg.type === 'OFFER') {
      if (peers.has(fromId)) cleanupPeer(fromId);
      const { record } = createPeerRecord(fromId, fromName, true);
      record.pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          publishSignal({ type: 'ICE', to: fromId, candidate: ev.candidate });
        }
      };
      await record.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await record.pc.createAnswer();
      await record.pc.setLocalDescription(answer);
      await publishSignal({ type: 'ANSWER', to: fromId, sdp: answer });
      return;
    }

    if (msg.type === 'ANSWER') {
      const rec = peers.get(fromId);
      if (rec && rec.pc.signalingState !== 'stable') {
        await rec.pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      }
      return;
    }

    if (msg.type === 'ICE') {
      const rec = peers.get(fromId);
      if (rec && msg.candidate) {
        try {
          await rec.pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        } catch {}
      }
    }
  }

  async function connectOnlineRoom(groupName, password) {
    disconnectAllPeers();
    activeGroupName = groupName.trim().toUpperCase();
    activePassword = password;
    const chNum = channelNumberFromName(activeGroupName);
    document.getElementById('comm-group-title').textContent = `GROUP: ${activeGroupName}`;
    document.getElementById('hw-seven-seg').textContent = chNum;
    document.getElementById('hw-ch-small').textContent = `CH ${chNum}`;

    if (!password || password.length < 4) {
      updateTransceiverUi();
      return;
    }

    if (!navigator.onLine) {
      activeTransportLabel = 'OFFLINE';
      updateTransceiverUi();
      return;
    }

    activeTransportLabel = 'LINKING';
    updateTransceiverUi();

    const sec = await deriveRoomSecurity(activeGroupName, password);
    mqttTopic = sec.topic;
    roomAesKey = sec.key;

    const tryBroker = (idx) => {
      if (idx >= WSS_BROKERS.length || !activePassword) {
        activeTransportLabel = 'OFFLINE';
        updateTransceiverUi();
        return;
      }
      let settled = false;
      const ws = new WebSocket(WSS_BROKERS[idx], 'mqtt');
      ws.binaryType = 'arraybuffer';
      mqttSocket = ws;

      const timeout = setTimeout(() => {
        if (!settled) {
          try { ws.close(); } catch {}
          tryBroker(idx + 1);
        }
      }, 5000);

      ws.onopen = () => {
        ws.send(buildMqttConnect(localPeerId));
      };

      ws.onmessage = async (ev) => {
        const pkts = parseMqttPackets(ev.data);
        for (const p of pkts) {
          if (p.type === 'CONNACK') {
            settled = true;
            clearTimeout(timeout);
            activeTransportLabel = 'WEBRTC';
            ws.send(buildMqttSubscribe(1, mqttTopic));
            await publishSignal({ type: 'PRESENCE' });
            mqttKeepaliveTimer = setInterval(() => {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(new Uint8Array([0xc0, 0x00]));
              }
            }, 25000);
            updateTransceiverUi();
          } else if (p.type === 'PUBLISH') {
            const decoded = await decryptEnvelope(p.payload);
            if (decoded) await handleIncomingSignal(decoded);
          }
        }
      };

      ws.onerror = () => {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          tryBroker(idx + 1);
        }
      };
    };

    tryBroker(0);
  }

  // ==========================================================
  // Offline No-Internet Local Wi-Fi / Hotspot Direct WebRTC Pair
  // ==========================================================
  function waitForIceComplete(pc) {
    return new Promise((resolve) => {
      if (pc.iceGatheringState === 'complete') {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, 1400);
      pc.onicegatheringstatechange = () => {
        if (pc.iceGatheringState === 'complete') {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  function setupOfflineLanPairing() {
    const box = document.getElementById('lan-signal-box');
    const status = document.getElementById('lan-pair-status');

    document.getElementById('lan-create-offer-btn').addEventListener('click', async () => {
      try {
        disconnectAllPeers();
        activeTransportLabel = 'LOCAL LAN';
        const lanId = 'lan-peer';
        const { record, bindDataChannel } = createPeerRecord(lanId, 'LAN PEER', false);
        manualLanPc = record.pc;
        bindDataChannel(record.pc.createDataChannel('pwt-floor'));

        const offer = await record.pc.createOffer();
        await record.pc.setLocalDescription(offer);
        status.textContent = 'Gathering local Wi-Fi address...';
        await waitForIceComplete(record.pc);

        const token = btoa(unescape(encodeURIComponent(JSON.stringify(record.pc.localDescription))));
        box.value = token;
        status.textContent = 'Copy Offer -> Paste on 2nd Phone/Laptop.';
      } catch (err) {
        status.textContent = `Error: ${err.message}`;
      }
    });

    document.getElementById('lan-create-answer-btn').addEventListener('click', async () => {
      try {
        const raw = box.value.trim();
        if (!raw) {
          status.textContent = 'Paste Host Offer code in box first.';
          return;
        }
        const offer = JSON.parse(decodeURIComponent(escape(atob(raw))));
        disconnectAllPeers();
        activeTransportLabel = 'LOCAL LAN';
        const { record } = createPeerRecord('lan-host', 'LAN HOST', false);
        manualLanPc = record.pc;

        await record.pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await record.pc.createAnswer();
        await record.pc.setLocalDescription(answer);
        status.textContent = 'Creating Reply...';
        await waitForIceComplete(record.pc);

        const token = btoa(unescape(encodeURIComponent(JSON.stringify(record.pc.localDescription))));
        box.value = token;
        status.textContent = 'Copy Reply -> Paste on Host (step 3).';
      } catch {
        status.textContent = 'Invalid Offer code.';
      }
    });

    document.getElementById('lan-accept-answer-btn').addEventListener('click', async () => {
      try {
        if (!manualLanPc) {
          status.textContent = 'Run step 1 (Create Offer) first.';
          return;
        }
        const raw = box.value.trim();
        const answer = JSON.parse(decodeURIComponent(escape(atob(raw))));
        await manualLanPc.setRemoteDescription(new RTCSessionDescription(answer));
        status.textContent = 'Connecting over Local Wi-Fi / Hotspot...';
      } catch {
        status.textContent = 'Invalid Reply code.';
      }
    });

    document.getElementById('lan-copy-btn').addEventListener('click', async () => {
      if (!box.value) return;
      try {
        await navigator.clipboard.writeText(box.value);
        status.textContent = 'Copied!';
      } catch {
        box.select();
        document.execCommand('copy');
        status.textContent = 'Selected & Copied.';
      }
    });
  }

  function broadcastFloorMsg(type) {
    const payload = JSON.stringify({ type, id: localPeerId, name: localCallsign });
    peers.forEach((p) => {
      if (p.dc && p.dc.readyState === 'open') {
        try { p.dc.send(payload); } catch {}
      }
    });
  }

  // ==========================================================
  // Transceiver App Shell & PTT Controls (Touch + Mouse + Laptop Spacebar)
  // ==========================================================
  function initInstalledAppShell() {
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
      localCallsign = (e.target.value || 'ALPHA-1').trim().toUpperCase();
      document.getElementById('hw-user-pill').textContent = `USER: ${localCallsign} (YOU)`;
    });

    document.getElementById('pwa-volume').addEventListener('input', (e) => {
      const pct = Number(e.target.value);
      rxVolume = Math.max(0, Math.min(1, pct / 100));
      document.getElementById('pwa-volume-val').textContent = String(pct);
      document.getElementById('hw-vol-label').textContent = `VOL ${pct}`;
      peers.forEach((p) => {
        if (p.audioEl) p.audioEl.volume = rxVolume;
      });
    });

    document.getElementById('create-group-submit').addEventListener('click', async () => {
      const gName = (document.getElementById('group-name-input').value || 'DISPATCH').trim().toUpperCase();
      const gPass = document.getElementById('group-pass-input').value;
      const msgEl = document.getElementById('create-group-msg');
      if (!gName) {
        msgEl.textContent = 'Enter Group Name.';
        return;
      }
      if (gPass.length < 4) {
        msgEl.textContent = 'Password minimum 4 characters.';
        return;
      }
      msgEl.textContent = '';
      switchScreen('comm');
      await connectOnlineRoom(gName, gPass);
    });

    document.getElementById('disconnect-room-btn').addEventListener('click', () => {
      activePassword = '';
      disconnectAllPeers();
      document.getElementById('lan-pair-status').textContent = 'Disconnected.';
      switchScreen('comm');
    });

    document.getElementById('dock-mode-btn').addEventListener('click', () => {
      pttMode = pttMode === 'HOLD' ? 'LOCK' : 'HOLD';
      document.getElementById('dock-mode-val').textContent = pttMode;
      updateTransceiverUi();
    });

    document.getElementById('dock-beep-btn').addEventListener('click', () => {
      beepOn = !beepOn;
      document.getElementById('dock-beep-val').textContent = beepOn ? 'ON' : 'OFF';
    });

    setupOfflineLanPairing();
    setupPttDome();
    updateTransceiverUi();
  }

  function setupPttDome() {
    const pttBtn = document.getElementById('ptt-button');
    let spaceHeld = false;

    pttBtn.addEventListener('contextmenu', (e) => e.preventDefault());
    pttBtn.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

    async function startMic() {
      if (isTransmitting) return;
      if (activeFloorSpeakerId && activeFloorSpeakerId !== localPeerId) return;

      isTransmitting = true;
      activeFloorSpeakerId = localPeerId;
      activeFloorSpeakerName = localCallsign;
      playRogerBeep(true);
      pttBtn.classList.add('transmitting');
      broadcastFloorMsg('FLOOR_REQ');
      updateTransceiverUi();

      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          localMicStream = await navigator.mediaDevices.getUserMedia({
            audio: {
              channelCount: 1,
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
          if (!isTransmitting) {
            localMicStream.getTracks().forEach((t) => t.stop());
            localMicStream = null;
            return;
          }
          localMicTrack = localMicStream.getAudioTracks()[0] || null;
          if (localMicTrack) {
            peers.forEach((p) => {
              if (p.sender) p.sender.replaceTrack(localMicTrack).catch(() => {});
            });
          }
        } catch (err) {
          document.getElementById('ptt-status-note').textContent = `MIC UNAVAILABLE: ${err.message}`;
        }
      }
    }

    function stopMic() {
      if (!isTransmitting) return;
      isTransmitting = false;
      if (activeFloorSpeakerId === localPeerId) {
        activeFloorSpeakerId = null;
        activeFloorSpeakerName = '';
      }
      playRogerBeep(false);
      pttBtn.classList.remove('transmitting');
      broadcastFloorMsg('FLOOR_REL');
      peers.forEach((p) => {
        if (p.sender) p.sender.replaceTrack(null).catch(() => {});
      });
      if (localMicStream) {
        localMicStream.getTracks().forEach((t) => t.stop());
        localMicStream = null;
        localMicTrack = null;
      }
      updateTransceiverUi();
    }

    pttBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
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

    // Global Laptop / Desktop Spacebar Push-to-Talk (disabled when typing in inputs)
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        spaceHeld = true;
        if (pttMode === 'HOLD') startMic();
        else if (isTransmitting) stopMic();
        else startMic();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code === 'Space' && spaceHeld) {
        spaceHeld = false;
        if (pttMode === 'HOLD') stopMic();
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) stopMic();
    });
    window.addEventListener('pagehide', stopMic);
    window.addEventListener('blur', stopMic);
    window.addEventListener('online', () => {
      if (activePassword && !mqttSocket) {
        connectOnlineRoom(activeGroupName, activePassword);
      } else {
        updateTransceiverUi();
      }
    });
    window.addEventListener('offline', () => {
      if (mqttSocket) {
        try { mqttSocket.close(); } catch {}
        mqttSocket = null;
      }
      updateTransceiverUi();
    });
  }

  initServiceWorker();
  routeInitialMode();

  setTimeout(() => {
    splashEl.classList.add('fade-out');
  }, 600);
})();
