import type { Room } from 'livekit-client';
import { LiveKitRoomAudioMixer } from './roomAudioMixer';

export type RecordingBridge = {
  getMixedAudioStream: () => Promise<MediaStream>;
  cleanupAudioMixer: () => void;
};

export function createRecordingBridge(room: Room): RecordingBridge {
  let mixer: LiveKitRoomAudioMixer | null = null;

  return {
    async getMixedAudioStream() {
      mixer?.close();
      mixer = new LiveKitRoomAudioMixer(room);
      mixer.attach();
      await mixer.resume();
      return mixer.getMixedStream();
    },
    cleanupAudioMixer() {
      mixer?.close();
      mixer = null;
    },
  };
}
