import type { Room } from 'livekit-client';
import { LiveKitRoomAudioMixer } from './roomAudioMixer';
import { isSecureMediaContext } from './microphoneAccess';
import {
  isNoneDevice,
  loadVoiceSettings,
  voiceCaptureOptions,
  type VoiceSettings,
} from './voiceSettings';

export type RecordingBridge = {
  /** 빈 오디오 트랙이 있는 믹스 스트림을 바로 만듭니다. 마이크 연결과 무관합니다. */
  prepareAudioStream: () => MediaStream;
  /** LiveKit/로컬 마이크를 믹서에 붙입니다. 녹화 시작 전후에 호출해도 됩니다. */
  connectSources: () => Promise<void>;
  getMixedAudioStream: () => Promise<MediaStream>;
  tryGetAudioTracks: (timeoutMs?: number) => Promise<MediaStreamTrack[]>;
  hasAudio: () => boolean;
  cleanupAudioMixer: () => void;
};

async function captureLocalMic(settings: VoiceSettings): Promise<MediaStream | null> {
  if (!isSecureMediaContext() || isNoneDevice(settings.micDeviceId)) return null;
  const audio = voiceCaptureOptions(settings);
  if (!audio) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch {
    try {
      // 고른 장치가 빠졌으면 Windows 기본 입력으로 한 번 더 시도합니다.
      return await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (err) {
      console.warn('녹화용 마이크 직접 캡처 실패:', err);
      return null;
    }
  }
}

async function enableLiveKitMic(room: Room, settings: VoiceSettings) {
  const capture = voiceCaptureOptions(settings);
  if (!capture) return;
  try {
    if (settings.micDeviceId) {
      await room.switchActiveDevice('audioinput', settings.micDeviceId);
    }
    await room.localParticipant.setMicrophoneEnabled(true, capture);
  } catch (err) {
    console.warn('LiveKit 마이크 장치 전환 실패, 기본 장치로 재시도:', err);
    await room.localParticipant.setMicrophoneEnabled(true, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  }
}

export function createRecordingBridge(room: Room): RecordingBridge {
  let mixer: LiveKitRoomAudioMixer | null = null;
  let fallbackStream: MediaStream | null = null;

  const ensureMixer = () => {
    if (!mixer) {
      mixer = new LiveKitRoomAudioMixer(room);
      mixer.attach();
    }
    return mixer;
  };

  const bridge: RecordingBridge = {
    prepareAudioStream() {
      const mix = ensureMixer();
      void mix.resume();
      return mix.getMixedStream();
    },
    async connectSources() {
      const settings = loadVoiceSettings();
      if (!isSecureMediaContext() || isNoneDevice(settings.micDeviceId)) return;

      const mix = ensureMixer();
      await mix.resume();

      try {
        await enableLiveKitMic(room, settings);
      } catch (err) {
        console.warn('녹화용 마이크 활성화 실패:', err);
      }

      mix.resync();
      if (!mix.hasAudio()) {
        await new Promise((resolve) => setTimeout(resolve, 400));
        mix.resync();
      }

      // LiveKit이 장치를 못 잡으면 브라우저에서 직접 받아 녹화에만 붙입니다.
      if (!mix.hasAudio()) {
        fallbackStream?.getTracks().forEach((t) => t.stop());
        fallbackStream = await captureLocalMic(settings);
        fallbackStream?.getAudioTracks().forEach((track) => {
          mix.addExternalTrack('local-fallback', track);
        });
      }
    },
    async getMixedAudioStream() {
      const stream = bridge.prepareAudioStream();
      await bridge.connectSources();
      return stream;
    },
    async tryGetAudioTracks() {
      const mixed = bridge.prepareAudioStream();
      void bridge.connectSources();
      return mixed.getAudioTracks().filter((t) => t.readyState !== 'ended');
    },
    hasAudio() {
      return mixer?.hasAudio() ?? false;
    },
    cleanupAudioMixer() {
      mixer?.close();
      mixer = null;
      fallbackStream?.getTracks().forEach((t) => t.stop());
      fallbackStream = null;
    },
  };

  return bridge;
}
