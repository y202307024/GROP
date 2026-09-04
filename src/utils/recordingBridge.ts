import type { Room } from 'livekit-client';
import { LiveKitRoomAudioMixer } from './roomAudioMixer';

export type RecordingBridge = {
  getMixedAudioStream: () => Promise<MediaStream>;
  hasAudio: () => boolean;
  cleanupAudioMixer: () => void;
};

export function createRecordingBridge(room: Room): RecordingBridge {
  let mixer: LiveKitRoomAudioMixer | null = null;

  return {
    async getMixedAudioStream() {
      mixer?.close();
      mixer = new LiveKitRoomAudioMixer(room);
      // 녹화 전에 회의 마이크를 켜야 믹서에 내 목소리가 붙습니다.
      try {
        await room.localParticipant.setMicrophoneEnabled(true);
      } catch (err) {
        console.error('녹화용 마이크 활성화 실패:', err);
      }
      mixer.attach();
      await mixer.resume();
      if (!mixer.hasAudio()) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        mixer.resync();
      }
      return mixer.getMixedStream();
    },
    hasAudio() {
      return mixer?.hasAudio() ?? false;
    },
    cleanupAudioMixer() {
      mixer?.close();
      mixer = null;
    },
  };
}
