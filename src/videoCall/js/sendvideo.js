import { Signaling, WebSocketSignaling } from "./signaling.js";
import Peer from "./peer.js";
import * as Logger from "./logger.js";

export class SendVideo {
  constructor() {
    this.pc = null;
    this.localVideo = null;
    this.remoteVideo = null;
    this.ondisconnect = function () { };
  }

  async startVideo(localVideo, videoSource) {
    try {
      this.localVideo = localVideo;
      this.localStream = await navigator.mediaDevices.getUserMedia({
         video: { deviceId: videoSource ? { exact: videoSource } : undefined }
         ,audio : true
      });
      this.localVideo.srcObject = this.localStream;
      await localVideo.play();
    } catch (err) {
      Logger.error(`mediaDevice.getUserMedia() error:${err}`);
    }
  }

  async setupConnection(remoteVideo, connectionId, useWebSocket) {
    const _this = this;
    this.remoteVideo = remoteVideo;
    this.remoteVideo.srcObject = new MediaStream();

    if (useWebSocket) {
      this.signaling = new WebSocketSignaling();
    } else {
      this.signaling = new Signaling();
    }

    this.signaling.addEventListener('connect', async (e) => {
      const data = e.detail;
      _this.prepareNewPeerConnection(data.connectionId, data.polite);
      _this.addTracks(data.connectionId);
    });

    this.signaling.addEventListener('disconnect', async (e) => {
      const data = e.detail;
      if (_this.pc != null && _this.pc.connectionId == data.connectionId) {
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

      if (trackEvent.track.kind == "video") {
        console.log("recieve video");
        const direction = trackEvent.transceiver.direction;
        if (direction == "sendrecv" || direction == "recvonly") {
          _this.remoteVideo.srcObject.addTrack(trackEvent.track);
        }
      }

      if (trackEvent.track.kind  == "audio"){
        console.log("recieve audio");
        const direction = trackEvent.transceiver.direction;
        if (direction == "sendrecv" || direction == "recvonly") {
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
    const vtrack = _this.localVideo.srcObject.getTracks().find(x => x.kind == 'video');
    const atrack = _this.localVideo.srcObject.getTracks().find(x => x.kind == 'audio');
    _this.pc.addTrack(connectionId, vtrack);
    _this.pc.addTrack(connectionId, atrack);
  }

  async hangUp(connectionId) {
    if (this.signaling == null) {
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
