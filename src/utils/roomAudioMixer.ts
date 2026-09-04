import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type TrackPublication,
} from 'livekit-client';

/** 회의방 참여자(본인+다른 사람) 마이크를 하나의 오디오 스트림으로 합침 */
export class LiveKitRoomAudioMixer {
  private audioContext: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private room: Room;
  private cleanups: (() => void)[] = [];

  constructor(room: Room) {
    this.room = room;
    this.audioContext = new AudioContext();
    this.destination = this.audioContext.createMediaStreamDestination();
  }

  private key(identity: string, trackSid: string) {
    return `${identity}:${trackSid}`;
  }

  private addTrack(identity: string, trackSid: string, mediaTrack: MediaStreamTrack) {
    const id = this.key(identity, trackSid);
    if (this.sources.has(id) || mediaTrack.readyState === 'ended') return;

    const stream = new MediaStream([mediaTrack]);
    const source = this.audioContext.createMediaStreamSource(stream);
    source.connect(this.destination);
    this.sources.set(id, source);

    const onEnded = () => this.removeTrack(identity, trackSid);
    mediaTrack.addEventListener('ended', onEnded, { once: true });
    this.cleanups.push(() => mediaTrack.removeEventListener('ended', onEnded));
  }

  private removeTrack(identity: string, trackSid: string) {
    const id = this.key(identity, trackSid);
    const source = this.sources.get(id);
    if (!source) return;
    source.disconnect();
    this.sources.delete(id);
  }

  private syncParticipant(participant: Participant, isLocal = false) {
    participant.audioTrackPublications.forEach((pub) => {
      const mediaTrack = pub.track?.mediaStreamTrack;
      if (!mediaTrack || pub.isMuted) return;
      if (!isLocal && pub.isSubscribed === false) return;
      this.addTrack(participant.identity, pub.trackSid, mediaTrack);
    });
  }

  /** 음소거를 나중에 켠 경우에도 다시 붙입니다. */
  resync() {
    this.syncParticipant(this.room.localParticipant, true);
    this.room.remoteParticipants.forEach((p) => this.syncParticipant(p, false));
  }

  /** destination.stream 은 소스가 없어도 빈 트랙이 있어서, 실제 연결 수로 판단합니다. */
  hasAudio() {
    return this.sources.size > 0;
  }

  attach() {
    this.syncParticipant(this.room.localParticipant, true);
    this.room.remoteParticipants.forEach((p) => this.syncParticipant(p, false));

    const onSubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      if (track.kind !== Track.Kind.Audio || !track.mediaStreamTrack) return;
      this.addTrack(participant.identity, publication.trackSid, track.mediaStreamTrack);
    };

    const onUnsubscribed = (
      _track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      this.removeTrack(participant.identity, publication.trackSid);
    };

    const onLocalPublished = (publication: LocalTrackPublication) => {
      if (publication.kind !== Track.Kind.Audio) return;
      const mediaTrack = publication.track?.mediaStreamTrack;
      if (!mediaTrack || publication.isMuted) return;
      this.addTrack(this.room.localParticipant.identity, publication.trackSid, mediaTrack);
    };

    const onLocalUnpublished = (publication: LocalTrackPublication) => {
      if (publication.kind !== Track.Kind.Audio) return;
      this.removeTrack(this.room.localParticipant.identity, publication.trackSid);
    };

    // 음소거/해제 시 믹서에 바로 반영 (안 그러면 녹음에 내 목소리가 빠집니다)
    const onMuted = (publication: TrackPublication, participant: Participant) => {
      if (publication.kind !== Track.Kind.Audio) return;
      this.removeTrack(participant.identity, publication.trackSid);
    };
    const onUnmuted = (publication: TrackPublication, participant: Participant) => {
      if (publication.kind !== Track.Kind.Audio) return;
      const mediaTrack = publication.track?.mediaStreamTrack;
      if (!mediaTrack) return;
      this.addTrack(participant.identity, publication.trackSid, mediaTrack);
    };

    this.room.on(RoomEvent.TrackSubscribed, onSubscribed);
    this.room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    this.room.on(RoomEvent.LocalTrackPublished, onLocalPublished);
    this.room.on(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
    this.room.on(RoomEvent.TrackMuted, onMuted);
    this.room.on(RoomEvent.TrackUnmuted, onUnmuted);

    this.cleanups.push(() => {
      this.room.off(RoomEvent.TrackSubscribed, onSubscribed);
      this.room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      this.room.off(RoomEvent.LocalTrackPublished, onLocalPublished);
      this.room.off(RoomEvent.LocalTrackUnpublished, onLocalUnpublished);
      this.room.off(RoomEvent.TrackMuted, onMuted);
      this.room.off(RoomEvent.TrackUnmuted, onUnmuted);
    });
  }

  async resume() {
    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  getMixedStream() {
    return this.destination.stream;
  }

  close() {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.sources.forEach((source) => source.disconnect());
    this.sources.clear();
    void this.audioContext.close();
  }
}
