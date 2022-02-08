import { useRef, useState } from "react";
import React from 'react';
import './App.css';
import * as Logger from "./logger.js";
export class WebSocketSignaling extends EventTarget {

  constructor() {
    super();
    this.sleep = msec => new Promise(resolve => setTimeout(resolve, msec));

    let websocketUrl;
    if (window.location.protocol === "https:") {
      websocketUrl = "wss://" + "169.231.21.56";
    } else {
      websocketUrl = "ws://169.231.21.56";
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
    if (this.pc !== null) {
      this.pc.close();
      this.pc = null;
    }
  }

  getTransceivers(connectionId) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return this.pc.getTransceivers();
  }

  addTrack(connectionId, track) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    const sender = this.pc.addTrack(track);
    const transceiver = this.pc.getTransceivers().find((t) => t.sender === sender);
    transceiver.direction = "sendonly";
    return sender;
  }

  addTransceiver(connectionId, trackOrKind, init) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return this.pc.addTransceiver(trackOrKind, init);
  }

  createDataChannel(connectionId, label) {
    if (this.connectionId !== connectionId) {
      return null;
    }

    return this.pc.createDataChannel(label);
  }

  async onGotDescription(connectionId, description) {
    if (this.connectionId !== connectionId) {
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
    if (this.connectionId !== connectionId) {
      return;
    }

    try {
      await this.pc.addIceCandidate(candidate);
    } catch (e) {
      if (!this.ignoreOffer) this.log(e);
    }
  }
}
//sendvideo
class SendVideo {
  constructor() {
    this.pc = null;
    this.localVideo = null;
    this.remoteVideo = null;
    this.ondisconnect = function () { };
    console.log('called');
  }

  async startVideo(localVideo) {
    try {
      this.localVideo = localVideo;
      this.localStream = await navigator.mediaDevices.getUserMedia({
         video: true 
         ,audio : true,
      });
      this.localVideo.current.srcObject = this.localStream;
      console.log("setup")
    } catch (err) {
      Logger.error(`mediaDevice.getUserMedia() error:${err}`);
    }
  }

  async setupConnection(localVideo, remoteVideo, connectionId, useWebSocket) {
    await this.startVideo(localVideo);
    if (this.localVideo === null){
      console.log("NULL");
    }
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
      if (_this.pc !== null && _this.pc.connectionId === data.connectionId) {
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
      if (_this.pc !== null) {
        await _this.pc.onGotDescription(answer.connectionId, desc);
      }
    });

    this.signaling.addEventListener('candidate', async (e) => {
      const candidate = e.detail;
      const iceCandidate = new RTCIceCandidate({ candidate: candidate.candidate, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
      if (_this.pc !== null) {
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
          _this.remoteVideo.current.srcObject.addTrack(trackEvent.track);
        }
      }

      if (trackEvent.track.kind  === "audio"){
        console.log("recieve audio");
        const direction = trackEvent.transceiver.direction;
        if (direction === "sendrecv" || direction === "recvonly") {
          _this.remoteVideo.current.srcObject.addTrack(trackEvent.track);
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
    const vtrack = _this.localVideo.current.srcObject.getTracks().find(x => x.kind === 'video');
    const atrack = _this.localVideo.current.srcObject.getTracks().find(x => x.kind === 'audio');
    _this.pc.addTrack(connectionId, vtrack);
    _this.pc.addTrack(connectionId, atrack);
    console.log("here")
  }

  async hangUp(connectionId) {
    if (this.signaling === null) {
      return;
    }

    this.pc.close();
    this.pc = null;
    Logger.log(`delete connection ${connectionId}`);
    await this.signaling.deleteConnection(connectionId);

    this.remoteVideo.current.srcObject = null;
    await this.stop();
  }

  async stop() {
    if (this.signaling) {
      await this.signaling.stop();
      this.signaling = null;
    }
  }
}

const sendVideo = new SendVideo();
sendVideo.ondisconnect = () => sendVideo.hangUp();



window.addEventListener('beforeunload', async () => {
  await sendVideo.stop();
}, true);

function App() {
  const localVideo = useRef();
  const remoteVideo = useRef();
  var [setUpButtonDisable, setSetUpButtonDisable] = useState(false);
  var [hangUpButtonDisable, setHangUpButtonDisable] = useState(false);
  var [joinCode, setJoinCode] = useState(getRandom());

  let useWebSocket;
  let connectionId;


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

  async function setUp() {
    setSetUpButtonDisable(true);
    setHangUpButtonDisable(false);
    connectionId = joinCode;
    await sendVideo.setupConnection(localVideo, remoteVideo, connectionId, useWebSocket);
  }

  function hangUp() {
    setSetUpButtonDisable(false);
    setHangUpButtonDisable(true);
    sendVideo.hangUp(connectionId);
    joinCode = getRandom();
    connectionId = joinCode;
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
        <div id="warning" hidden={true} />
        <div id="select">
          <label htmlFor="videoSource">Video source: </label><select id="videoSource" />
        </div>
        <div id="buttons">
          <button disabled={setUpButtonDisable} type="button" onClick={setUp}>Set Up</button>
          <button disabled={hangUpButtonDisable} type="button" onClick={hangUp}>Hang Up</button>
        </div>
        <div id="preview">
          <div id="local">
            <h2>Local</h2>
            <video ref = {localVideo} id="local_video" playsInline autoPlay muted={true} />
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


export default App;
