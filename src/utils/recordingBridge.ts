import type { Room } from 'livekit-client';
import { LiveKitRoomAudioMixer } from './roomAudioMixer';

export type RecordingBridge = {
  getMixedAudioStream: () => Promise<MediaStream>;
  /** 마이크 권한 대기로 녹화가 막히지 않게, 짧은 시간만 오디오를 모읍니다. */
  tryGetAudioTracks: (timeoutMs?: number) => Promise<MediaStreamTrack[]>;
  hasAudio: () => boolean;
  cleanupAudioMixer: () => void;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(null), ms);
    promise
      .then((value) => {
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        window.clearTimeout(timer);
        resolve(null);
      });
  });
}

export function createRecordingBridge(room: Room): RecordingBridge {
  let mixer: LiveKitRoomAudioMixer | null = null;

  const bridge: RecordingBridge = {
    async getMixedAudioStream() {
      mixer?.close();
      mixer = new LiveKitRoomAudioMixer(room);
      // 녹화 전에 회의 마이크를 켜야 믹서에 내 목소리가 붙습니다.
      // (권한 팝업에서 막혀도 화면 녹화는 따로 진행합니다.)
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.warn('녹화용 마이크 활성화 실패(화면만 녹화 가능):', err);
      }
      mixer.attach();
      await mixer.resume();
      if (!mixer.hasAudio()) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        mixer.resync();
      }
      return mixer.getMixedStream();
    },
    async tryGetAudioTracks(timeoutMs = 1200) {
      const mixed = await withTimeout(bridge.getMixedAudioStream(), timeoutMs);
      if (!mixed || !bridge.hasAudio()) return [];
      return mixed.getAudioTracks().filter((t) => t.readyState === 'live');
    },
    hasAudio() {
      return mixer?.hasAudio() ?? false;
    },
    cleanupAudioMixer() {
      mixer?.close();
      mixer = null;
    },
  };

  return bridge;
}
