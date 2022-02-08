import { useRef, useState } from "react";
import React from 'react';
import './App.css';
import * as Logger from "./logger.js";


function App() {
  const localVideo = useRef();
  const remoteVideo = useRef();
  var [startButtonDisable, setStartButtonDisable] = useState(false);
  var [setUpButtonDisable, setSetUpButtonDisable] = useState(false);
  var [hangUpButtonDisable, setHangUpButtonDisable] = useState(false);
  var [joinCode, setJoinCode] = useState(getRandom());
  let useWebSocket;
  let connectionId;

  let sendVideo = new SendVideo();
  sendVideo.ondisconnect = () => hangUp();



  window.addEventListener('beforeunload', async () => {
    await sendVideo.stop();
  }, true);

  setupConfig();

  //main
  async function setupConfig() {
    //const res = await getServerConfig();
    useWebSocket = true;
    // showWarningIfNeeded(res.startupMode);
  }

  // function showWarningIfNeeded(startupMode) {
  //   const warningDiv = document.getElementById("warning");
  //   if (startupMode === "public") {
  //     warningDiv.innerHTML = "<h4>Warning</h4> This sample is not working on Public Mode.";
  //     warningDiv.hidden = false;
  //   }
  // }
  async function startVideo() {
    setStartButtonDisable(true);
    setSetUpButtonDisable(false);
    await sendVideo.startVideo(localVideo);
  }

  async function setUp() {
    setSetUpButtonDisable(true);
    setHangUpButtonDisable(false);
    connectionId = joinCode;
    await sendVideo.setupConnection(remoteVideo, connectionId, useWebSocket);
  }

  function hangUp() {
    setSetUpButtonDisable(false);
    setHangUpButtonDisable(true);
    sendVideo.hangUp(connectionId);
    joinCode = getRandom();
    connectionId = null;
  }

  function getRandom() {
    const max = 99999;
    const length = String(max).length;
    const number = Math.floor(Math.random() * max);
    return (Array(length).join('0') + number).slice(-length);
  }

  // async function setUpVideoSelect() {
  //   const deviceInfos = await navigator.mediaDevices.enumerateDevices();

  //   for (let i = 0; i !== deviceInfos.length; ++i) {
  //     const deviceInfo = deviceInfos[i];
  //     if (deviceInfo.kind === 'videoinput') {
  //       const option = document.createElement('option');
  //       option.value = deviceInfo.deviceId;  
  //       option.text = deviceInfo.label || `camera ${videoSelect.length + 1}`;
  //       videoSelect.appendChild(option);
  //     }
  //   }
  // }
  return (
  <div id="container">
        <h1>Bidirectional Sample</h1>
        <div id="warning" hidden="true" />
        <div id="select">
          <label htmlFor="videoSource">Video source: </label><select id="videoSource" />
        </div>
        <div id="buttons">
          <button disabled={startButtonDisable} type="button" onClick={startVideo}>Start Video</button>
          <button disabled={setUpButtonDisable} type="button" onClick={setUp}>Set Up</button>
          <button disabled={hangUpButtonDisable} type="button" onClick={hangUp}>Hang Up</button>
        </div>
        <div id="preview">
          <div id="local">
            <h2>Local</h2>
            <video ref = {localVideo} id="local_video" playsInline autoPlay muted="true" />
          </div>
          <div id="remote">
            <h2>Remote</h2>
            <video ref = {remoteVideo} id="remote_video" playsInline autoPlay />
          </div>
          <p>ConnectionID:<br />
          <input
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value) }
                    placeholder="Join with code"
                />
          </p>
          <p>For more information about <code>Bidirectional</code> sample, see <a href="https://docs.unity3d.com/Packages/com.unity.renderstreaming@latest/sample-bidirectional.html">Bidirectional
              sample</a> document page.</p>
        </div>
        <section>
          <a href="https://github.com/Unity-Technologies/UnityRenderStreaming/tree/develop/WebApp/public/bidirectional" title="View source for this page on GitHub" id="viewSource">View source on GitHub</a>
        </section>
    </div>
  );
}


//sendvideo
class SendVideo {
  constructor() {
    this.pc = null;
    this.localVideo = null;
    this.remoteVideo = null;
    this.ondisconnect = function () { };
  }

  async startVideo(localVideo) {
    try {
      this.localVideo = localVideo;
      this.localStream = await navigator.mediaDevices.getUserMedia({
         video: true 
         ,audio : true,
      });
      this.localVideo.current.srcObject = this.localStream;
      await localVideo.play();
    } catch (err) {
      Logger.error(`mediaDevice.getUserMedia() error:${err}`);
    }
  }

  async setupConnection(remoteVideo, connectionId, useWebSocket) {
    const _this = this;
    this.remoteVideo = remoteVideo;
    this.remoteVideo.current.srcObject = new MediaStream();

    if (useWebSocket) {
      this.signaling = new WebSocketSignaling();
    } else {
      //this.signaling = new Signaling();
    }

    this.signaling.addEventListener('connect', async (e) => {
      const data = e.detail;
      _this.prepareNewPeerConnection(data.connectionId, data.polite);
      _this.addTracks(data.connectionId);
    });

    this.signaling.addEventListener('disconnect', async (e) => {
      const data = e.detail;
      if (_this.pc != null && _this.pc.connectionId === data.connectionId) {
        _this.ondisconnect();
      }
    });

    this.signaling.addEventListener('offer', async (e) => {
      const offer = e.detail;
      if (_this.pc == null) {
        _this.prepareNewPeerConnection(offer.connectionId, offer.polite);
        _this.addTracks(offer.connectionId);
      }
      const desc = new RTCSessionDescription({ sdp: offer.sdp, type: "offer" });
      await _this.pc.onGotDescription(offer.connectionId, desc);
    });

    this.signaling.addEventListener('answer', async (e) => {
      const answer = e.detail;
      const desc = new RTCSessionDescription({ sdp: answer.sdp, type: "answer" });
      if (_this.pc != null) {
        await _this.pc.onGotDescription(answer.connectionId, desc);
      }
    });

    this.signaling.addEventListener('candidate', async (e) => {
      const candidate = e.detail;
      const iceCandidate = new RTCIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
      if (_this.pc != null) {
        await _this.pc.onGotCandidate(candidate.connectionId, iceCandidate);
      }
    });

    await this.signaling.start();
    await this.signaling.createConnection(connectionId);
  }

  prepareNewPeerConnection(connectionId, polite) {
    const _this = this;
    // close current RTCPeerConnection
    if (this.pc) {
      Logger.log('Close current PeerConnection');
      this.pc.close();
      this.pc = null;
    }

    // Create peerConnection with proxy server and set up handlers
    this.pc = new Peer(connectionId, polite);
    this.pc.addEventListener('disconnect', () => {
      _this.ondisconnect();
    });
    // this.pc.addEventListener('trackevent', (e) => {
    //   const trackEvent = e.detail;
    //   if (trackEvent.track.kind != "video") {
    //     return;
    //   }
    //   console.log("true");
    //   const direction = trackEvent.transceiver.direction;
    //   if (direction == "sendrecv" || direction == "recvonly") {
    //     _this.remoteVideo.srcObject = new MediaStream();
    //     _this.remoteVideo.srcObject.addTrack(trackEvent.track);
    //   }
    // });
    this.pc.addEventListener('trackevent', (e) => {
      const trackEvent = e.detail;

      if (trackEvent.track.kind === "video") {
        console.log("recieve video");
        const direction = trackEvent.transceiver.direction;
        if (direction === "sendrecv" || direction === "recvonly") {
          _this.remoteVideo.srcObject.addTrack(trackEvent.track);
        }
      }

      if (trackEvent.track.kind  === "audio"){
        console.log("recieve audio");
        const direction = trackEvent.transceiver.direction;
        if (direction === "sendrecv" || direction === "recvonly") {
          _this.remoteVideo.srcObject.addTrack(trackEvent.track);
        }
      }
      console.log("done");
    });
    this.pc.addEventListener('sendoffer', (e) => {
      const offer = e.detail;
      _this.signaling.sendOffer(offer.connectionId, offer.sdp);
    });
    this.pc.addEventListener('sendanswer', (e) => {
      const answer = e.detail;
      _this.signaling.sendAnswer(answer.connectionId, answer.sdp);
    });
    this.pc.addEventListener('sendcandidate', (e) => {
      const candidate = e.detail;
      _this.signaling.sendCandidate(candidate.connectionId, candidate.candidate, candidate.sdpMid, candidate.sdpMLineIndex);
    });
  }

  addTracks(connectionId) {
    const _this = this;
    const vtrack = _this.localVideo.srcObject.getTracks().find(x => x.kind === 'video');
    const atrack = _this.localVideo.srcObject.getTracks().find(x => x.kind === 'audio');
    _this.pc.addTrack(connectionId, vtrack);
    _this.pc.addTrack(connectionId, atrack);
  }

  async hangUp(connectionId) {
    if (this.signaling === null) {
      return;
    }

    this.pc.close();
    this.pc = null;
    Logger.log(`delete connection ${connectionId}`);
    await this.signaling.deleteConnection(connectionId);

    this.remoteVideo.srcObject = null;
    await this.stop();
  }

  async stop() {
    if (this.signaling) {
      await this.signaling.stop();
      this.signaling = null;
    }
  }
}
//config
async function getServerConfig() {
  const protocolEndPoint = window.location.origin + '/config';
  const createResponse = await fetch(protocolEndPoint);
  return await createResponse.json();
}
function getRTCConfiguration() {
  let config = {};
  config.sdpSemantics = 'unified-plan';
  config.iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
  return config;
}
//peer
class Peer extends EventTarget {
  constructor(connectionId, polite, resendIntervalMsec = 5000) {
    super();
    const _this = this;
    this.connectionId = connectionId;
    this.polite = polite;
    this.config = getRTCConfiguration();
    this.pc = new RTCPeerConnection(this.config);
    this.makingOffer = false;
    this.waitingAnswer = false;
    this.ignoreOffer = false;
    this.srdAnswerPending = false;
    this.log = str => void Logger.log(`[${_this.polite ? 'POLITE' : 'IMPOLITE'}] ${str}`);
    this.assert_equals = window.assert_equals ? window.assert_equals : (a, b, msg) => { if (a === b) { return; } throw new Error(`${msg} expected ${b} but got ${a}`); };
    this.interval = resendIntervalMsec;
    this.sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

    this.pc.ontrack = e => {
      _this.log(`ontrack:${e}`);
      _this.dispatchEvent(new CustomEvent('trackevent', { detail: e }));
    };
    this.pc.onicecandidate = ({ candidate }) => {
      _this.log(`send candidate:${candidate}`);
      if (candidate === null) {
        return;
      }
      _this.dispatchEvent(new CustomEvent('sendcandidate', { detail: { connectionId: _this.connectionId, candidate: candidate.candidate, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid } }));
    };

    this.pc.onnegotiationneeded = async () => {
      try {
        _this.log(`SLD due to negotiationneeded`);
        _this.assert_equals(_this.pc.signalingState, 'stable', 'negotiationneeded always fires in stable state');
        _this.assert_equals(_this.makingOffer, false, 'negotiationneeded not already in progress');
        _this.makingOffer = true;
        await _this.pc.setLocalDescription();
        _this.assert_equals(_this.pc.signalingState, 'have-local-offer', 'negotiationneeded not racing with onmessage');
        _this.assert_equals(_this.pc.localDescription.type, 'offer', 'negotiationneeded SLD worked');
        _this.waitingAnswer = true;
        _this.dispatchEvent(new CustomEvent('sendoffer', { detail: { connectionId: _this.connectionId, sdp: _this.pc.localDescription.sdp } }));
      } catch (e) {
        _this.log(e);
      } finally {
        _this.makingOffer = false;
      }
    };

    this.pc.onsignalingstatechange = e => {
      _this.log(`signalingState changed:${e}`);
    };

    this.pc.oniceconnectionstatechange = e => {
      _this.log(`iceConnectionState changed:${e}`);
      if (_this.pc.iceConnectionState === 'disconnected') {
        this.dispatchEvent(new Event('disconnect'));
      }
    };

    this.pc.onicegatheringstatechange = e => {
      _this.log(`iceGatheringState changed:${e}'`);
    };

    this.loopResendOffer();
  }

  async loopResendOffer() {
    while (this.connectionId) {
      if (this.pc != null && this.waitingAnswer) {
        this.dispatchEvent(new CustomEvent('sendoffer', { detail: { connectionId: this.connectionId, sdp: this.pc.localDescription.sdp } }));
      }
      await this.sleep(this.interval);
    }
  }

  close() {
    this.connectionId = null;
    if (this.pc != null) {
      this.pc.close();
      this.pc = null;
    }
  }

  getTransceivers(connectionId) {
    if (this.connectionId != connectionId) {
      return null;
    }

    return this.pc.getTransceivers();
  }

  addTrack(connectionId, track) {
    if (this.connectionId != connectionId) {
      return null;
    }

    const sender = this.pc.addTrack(track);
    const transceiver = this.pc.getTransceivers().find((t) => t.sender === sender);
    transceiver.direction = "sendonly";
    return sender;
  }

  addTransceiver(connectionId, trackOrKind, init) {
    if (this.connectionId != connectionId) {
      return null;
    }

    return this.pc.addTransceiver(trackOrKind, init);
  }

  createDataChannel(connectionId, label) {
    if (this.connectionId != connectionId) {
      return null;
    }

    return this.pc.createDataChannel(label);
  }

  async onGotDescription(connectionId, description) {
    if (this.connectionId != connectionId) {
      return;
    }

    const _this = this;
    const isStable =
      this.pc.signalingState === 'stable' ||
      (this.pc.signalingState === 'have-local-offer' && this.srdAnswerPending);
    this.ignoreOffer =
      description.type === 'offer' && !this.polite && (this.makingOffer || !isStable);

    if (this.ignoreOffer) {
      _this.log(`glare - ignoring offer`);
      return;
    }

    this.waitingAnswer = false;
    this.srdAnswerPending = description.type === 'answer';
    _this.log(`SRD(${description.type})`);
    await this.pc.setRemoteDescription(description);
    this.srdAnswerPending = false;

    if (description.type === 'offer') {
      _this.assert_equals(this.pc.signalingState, 'have-remote-offer', 'Remote offer');
      _this.assert_equals(this.pc.remoteDescription.type, 'offer', 'SRD worked');
      _this.log('SLD to get back to stable');
      await this.pc.setLocalDescription();
      _this.assert_equals(this.pc.signalingState, 'stable', 'onmessage not racing with negotiationneeded');
      _this.assert_equals(this.pc.localDescription.type, 'answer', 'onmessage SLD worked');
      _this.dispatchEvent(new CustomEvent('sendanswer', { detail: { connectionId: _this.connectionId, sdp: _this.pc.localDescription.sdp } }));

    } else {
      _this.assert_equals(this.pc.remoteDescription.type, 'answer', 'Answer was set');
      _this.assert_equals(this.pc.signalingState, 'stable', 'answered');
      this.pc.dispatchEvent(new Event('negotiated'));
    }
  }

  async onGotCandidate(connectionId, candidate) {
    if (this.connectionId != connectionId) {
      return;
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch (e) {
      if (!this.ignoreOffer) this.log(e);
    }
  }
}
//Singaling
// class Signaling extends EventTarget {

//   constructor() {
//     super();
//     this.running = false;
//     this.sleep = msec => new Promise(resolve => setTimeout(resolve, msec));
//   }

//   headers() {
//     if (this.sessionId !== undefined) {
//       return { 'Content-Type': 'application/json', 'Session-Id': this.sessionId };
//     }
//     else {
//       return { 'Content-Type': 'application/json' };
//     }
//   }

//   get interval() {
//     return 1000;
//   }

//   url(method) {
//     return 'ws://169.231.20.22:80' + '/signaling/' + method;
//   }

//   async start() {
//     const createResponse = await fetch(this.url(''), { method: 'PUT', headers: this.headers() });
//     const session = await createResponse.json();
//     this.sessionId = session.sessionId;
//     this.running = true;

//     this.loopGetConnection();
//     this.loopGetOffer();
//     this.loopGetAnswer();
//     this.loopGetCandidate();
//   }

//   async loopGetConnection() {
//     let currentConnections = new Set();
//     while (this.running) {
//       const res = await this.getConnection();
//       const data = await res.json();
//       const connections = data.connections;
//       Logger.log('get connections:', connections);

//       const newSet = new Set();
//       connections.forEach(e => newSet.add(e.connectionId));
//       const deleteConnection = new Set([...currentConnections].filter(e => (!newSet.has(e))));

//       deleteConnection.forEach(connection => {
//         this.dispatchEvent(new CustomEvent('disconnect', { detail: { connectionId: connection } }));
//         currentConnections.delete(connection);
//       });

//       newSet.forEach(e => currentConnections.add(e));

//       await this.sleep(this.interval);
//     }
//   }

//   async loopGetOffer() {
//     let lastTimeRequest = Date.now() - 30000;

//     while (this.running) {
//       const res = await this.getOffer(lastTimeRequest);
//       lastTimeRequest = Date.parse(res.headers.get('Date'));

//       const data = await res.json();
//       const offers = data.offers;
//       Logger.log('get offers:', offers);

//       offers.forEach(offer => {
//         this.dispatchEvent(new CustomEvent('offer', { detail: offer }));
//       });

//       await this.sleep(this.interval);
//     }
//   }

//   async loopGetAnswer() {
//     // receive answer message from 30secs ago
//     let lastTimeRequest = Date.now() - 30000;

//     while (this.running) {
//       const res = await this.getAnswer(lastTimeRequest);
//       lastTimeRequest = Date.parse(res.headers.get('Date'));

//       const data = await res.json();
//       const answers = data.answers;
//       Logger.log('get answers:', answers);

//       answers.forEach(answer => {
//         this.dispatchEvent(new CustomEvent('answer', { detail: answer }));
//       });

//       await this.sleep(this.interval);
//     }
//   }

//   async loopGetCandidate() {
//     // receive answer message from 30secs ago
//     let lastTimeRequest = Date.now() - 30000;

//     while (this.running) {
//       const res = await this.getCandidate(lastTimeRequest);
//       lastTimeRequest = Date.parse(res.headers.get('Date'));

//       const data = await res.json();
//       const candidates = data.candidates;
//       Logger.log('get candidates:', candidates);

//       if (candidates.length > 0) {
//         const connectionId = candidates[0].connectionId;
//         for (let candidate of candidates[0].candidates) {
//           const dispatch = { connectionId: connectionId, candidate: candidate.candidate, sdpMLineIndex: candidate.sdpMLineIndex, sdpMid: candidate.sdpMid };
//           this.dispatchEvent(new CustomEvent('candidate', { detail: dispatch }));
//         }
//       }

//       await this.sleep(this.interval);
//     }
//   }

//   async stop() {
//     this.running = false;
//     await fetch(this.url(''), { method: 'DELETE', headers: this.headers() });
//     this.sessionId = null;
//   }

//   async createConnection(connectionId) {
//     const data = { 'connectionId': connectionId };
//     const res = await fetch(this.url('connection'), { method: 'PUT', headers: this.headers(), body: JSON.stringify(data) });
//     const json = await res.json();
//     this.dispatchEvent(new CustomEvent('connect', { detail: json }));
//     return json;
//   }

//   async deleteConnection(connectionId) {
//     const data = { 'connectionId': connectionId };
//     const res = await fetch(this.url('connection'), { method: 'DELETE', headers: this.headers(), body: JSON.stringify(data) });
//     const json = await res.json();
//     this.dispatchEvent(new CustomEvent('disconnect', { detail: json }));
//     return json;
//   }

//   async sendOffer(connectionId, sdp) {
//     const data = { 'sdp': sdp, 'connectionId': connectionId };
//     Logger.log('sendOffer:', data);
//     await fetch(this.url('offer'), { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
//   }

//   async sendAnswer(connectionId, sdp) {
//     const data = { 'sdp': sdp, 'connectionId': connectionId };
//     Logger.log('sendAnswer:', data);
//     await fetch(this.url('answer'), { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
//   }

//   async sendCandidate(connectionId, candidate, sdpMid, sdpMLineIndex) {
//     const data = {
//       'candidate': candidate,
//       'sdpMLineIndex': sdpMLineIndex,
//       'sdpMid': sdpMid,
//       'connectionId': connectionId
//     };
//     Logger.log('sendCandidate:', data);
//     await fetch(this.url('candidate'), { method: 'POST', headers: this.headers(), body: JSON.stringify(data) });
//   }

//   async getConnection() {
//     return await fetch(this.url(`connection`), { method: 'GET', headers: this.headers() });
//   }

//   async getOffer(fromTime = 0) {
//     return await fetch(this.url(`offer?fromtime=${fromTime}`), { method: 'GET', headers: this.headers() });
//   }

//   async getAnswer(fromTime = 0) {
//     return await fetch(this.url(`answer?fromtime=${fromTime}`), { method: 'GET', headers: this.headers() });
//   }

//   async getCandidate(fromTime = 0) {
//     return await fetch(this.url(`candidate?fromtime=${fromTime}`), { method: 'GET', headers: this.headers() });
//   }
// }

export class WebSocketSignaling extends EventTarget {

  constructor() {
    super();
    this.sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

    let websocketUrl;
    if (window.location.protocol === "https:") {
      websocketUrl = "wss://" + '169.231.20.22';
    } else {
      websocketUrl = "ws://169.231.20.22";
    }

    this.websocket = new WebSocket(websocketUrl);
    this.connectionId = null;

    this.websocket.onopen = () => {
      this.isWsOpen = true;
    };

    this.websocket.onclose = () => {
      this.isWsOpen = false;
    };

    this.websocket.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (!msg || !this) {
        return;
      }

      Logger.log(msg);

      switch (msg.type) {
        case "connect":
          this.dispatchEvent(new CustomEvent('connect', { detail: msg }));
          break;
        case "disconnect":
          this.dispatchEvent(new CustomEvent('disconnect', { detail: msg }));
          break;
        case "offer":
          this.dispatchEvent(new CustomEvent('offer', { detail: { connectionId: msg.from, sdp: msg.data.sdp, polite: msg.data.polite } }));
          break;
        case "answer":
          this.dispatchEvent(new CustomEvent('answer', { detail: { connectionId: msg.from, sdp: msg.data.sdp } }));
          break;
        case "candidate":
          this.dispatchEvent(new CustomEvent('candidate', { detail: { connectionId: msg.from, candidate: msg.data.candidate, sdpMLineIndex: msg.data.sdpMLineIndex, sdpMid: msg.data.sdpMid } }));
          break;
        default:
          break;
      }
    };
  }

  get interval() {
    return 100;
  }

  async start() {
    while (!this.isWsOpen) {
      await this.sleep(100);
    }
  }

  async stop() {
    this.websocket.close();
    while (this.isWsOpen) {
      await this.sleep(100);
    }
  }

  createConnection(connectionId) {
    const sendJson = JSON.stringify({ type: "connect", connectionId: connectionId });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  deleteConnection(connectionId) {
    const sendJson = JSON.stringify({ type: "disconnect", connectionId: connectionId });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  sendOffer(connectionId, sdp) {
    const data = { 'sdp': sdp, 'connectionId': connectionId };
    const sendJson = JSON.stringify({ type: "offer", from: connectionId, data: data });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  sendAnswer(connectionId, sdp) {
    const data = { 'sdp': sdp, 'connectionId': connectionId };
    const sendJson = JSON.stringify({ type: "answer", from: connectionId, data: data });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }

  sendCandidate(connectionId, candidate, sdpMLineIndex, sdpMid) {
    const data = {
      'candidate': candidate,
      'sdpMLineIndex': sdpMLineIndex,
      'sdpMid': sdpMid,
      'connectionId': connectionId
    };
    const sendJson = JSON.stringify({ type: "candidate", from: connectionId, data: data });
    Logger.log(sendJson);
    this.websocket.send(sendJson);
  }
}

export default App;
