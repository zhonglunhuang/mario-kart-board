/* 語音對話：WebRTC 點對點（mesh），Socket.IO 負責交換訊號；需要 HTTPS 才能取用麥克風 */

export class VoiceChat {
  constructor(socket, { onState } = {}) {
    this.socket = socket;
    this.onState = onState || (() => {});
    this.stream = null;
    this.peers = new Map(); // id -> { pc, audio, name }
    this.joined = false;
    this.muted = false;
    this.iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
    this.speaking = new Map();
    this.container = document.createElement('div');
    this.container.style.display = 'none';
    document.body.appendChild(this.container);

    socket.on('voice:peer-joined', ({ id, name }) => {
      if (this.joined && !this.peers.has(id)) this.connectTo(id, name, false);
    });
    socket.on('voice:peer-left', ({ id }) => this.closePeer(id));
    socket.on('voice:signal', async ({ from, name, data }) => {
      if (!this.joined) return;
      let p = this.peers.get(from);
      if (!p) p = this.connectTo(from, name, false);
      try {
        if (data.sdp) {
          await p.pc.setRemoteDescription(data.sdp);
          if (data.sdp.type === 'offer') {
            const ans = await p.pc.createAnswer();
            await p.pc.setLocalDescription(ans);
            socket.emit('voice:signal', { to: from, data: { sdp: p.pc.localDescription } });
          }
        } else if (data.candidate) {
          await p.pc.addIceCandidate(data.candidate).catch(() => {});
        }
      } catch (e) {
        console.warn('voice signal error', e);
      }
    });
  }

  get supported() {
    return !!(navigator.mediaDevices?.getUserMedia && window.RTCPeerConnection);
  }

  get secure() {
    return window.isSecureContext;
  }

  async fetchIce() {
    try {
      const base = location.pathname.replace(/\/[^/]*$/, '');
      const r = await fetch(`${base}/ice`);
      const j = await r.json();
      if (Array.isArray(j.iceServers) && j.iceServers.length) this.iceServers = j.iceServers;
    } catch (e) {
      /* 使用預設 STUN */
    }
  }

  async join() {
    if (this.joined) return true;
    if (!this.supported) throw new Error('此瀏覽器不支援語音');
    if (!this.secure) throw new Error('語音需要 HTTPS 連線');
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    await this.fetchIce();
    this.joined = true;
    this.setMuted(this.muted);
    const res = await new Promise((r) => this.socket.emit('voice:join', r));
    for (const peer of res?.peers || []) this.connectTo(peer.id, peer.name, true);
    this.onState();
    return true;
  }

  leave() {
    if (!this.joined) return;
    this.joined = false;
    this.socket.emit('voice:leave');
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.onState();
  }

  setMuted(m) {
    this.muted = m;
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !m));
    this.onState();
  }

  connectTo(id, name, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.playsInline = true;
    this.container.appendChild(audio);
    const p = { pc, audio, name, connected: false };
    this.peers.set(id, p);
    this.stream?.getTracks().forEach((t) => pc.addTrack(t, this.stream));
    pc.ontrack = (e) => {
      audio.srcObject = e.streams[0];
      audio.play().catch(() => {});
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.socket.emit('voice:signal', { to: id, data: { candidate: e.candidate } });
    };
    pc.onconnectionstatechange = () => {
      p.connected = pc.connectionState === 'connected';
      if (['failed', 'closed'].includes(pc.connectionState)) this.closePeer(id);
      this.onState();
    };
    if (initiator) {
      pc.createOffer()
        .then((o) => pc.setLocalDescription(o))
        .then(() => this.socket.emit('voice:signal', { to: id, data: { sdp: pc.localDescription } }))
        .catch((e) => console.warn('offer failed', e));
    }
    this.onState();
    return p;
  }

  closePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    try {
      p.pc.close();
    } catch (e) {
      /* ignore */
    }
    p.audio.remove();
    this.peers.delete(id);
    this.onState();
  }

  status() {
    const n = [...this.peers.values()].filter((p) => p.connected).length;
    return { joined: this.joined, muted: this.muted, peers: this.peers.size, connected: n };
  }
}
