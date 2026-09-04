import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
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
      if (!mediaTrack) return;
      this.addTrack(this.room.localParticipant.identity, publication.trackSid, mediaTrack);
    };

    this.room.on(RoomEvent.TrackSubscribed, onSubscribed);
    this.room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    this.room.on(RoomEvent.LocalTrackPublished, onLocalPublished);

    this.cleanups.push(() => {
      this.room.off(RoomEvent.TrackSubscribed, onSubscribed);
      this.room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      this.room.off(RoomEvent.LocalTrackPublished, onLocalPublished);
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
