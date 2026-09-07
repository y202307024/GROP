import { useEffect, useRef, useState } from 'react';
import {
  getMicrophoneExceptionMessage,
  isSecureMediaContext,
  localhostAppUrl,
} from '../utils/microphoneAccess';
import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from '../utils/voiceSettings';
import s from './VoiceSettingsPanel.module.css';

const BAR_COUNT = 24;

function shortDeviceName(label: string) {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
}

function deviceOptionLabel(device: MediaDeviceInfo, fallback: string) {
  if (!device.label) return fallback;
  const name = shortDeviceName(device.label);
  if (device.deviceId === 'default' || device.deviceId === 'communications') {
    return `기본 설정 (${name})`;
  }
  return name;
}

type Props = {
  /** 바깥 설정 섹션에 제목이 있으면 패널 안 제목은 숨깁니다 */
  hideHeading?: boolean;
};

/**
 * 마이크/헤드셋 장치와 음량을 고르는 설정
 * localStorage에 저장되며 회의방에서 그대로 사용됩니다.
 */
export default function VoiceSettingsPanel({ hideHeading = false }: Props) {
  const [settings, setSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BAR_COUNT }, () => 0));
  const [error, setError] = useState('');
  const testCleanupRef = useRef<(() => void) | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const update = (partial: Partial<VoiceSettings>) => {
    setSettings(saveVoiceSettings(partial));
  };

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = settings.micVolume / 100;
    if (playbackRef.current) playbackRef.current.volume = settings.speakerVolume / 100;
  }, [settings.micVolume, settings.speakerVolume]);

  useEffect(() => {
    let cancelled = false;

    const refreshDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      if (isSecureMediaContext()) {
        try {
          const preview = await navigator.mediaDevices.getUserMedia({ audio: true });
          preview.getTracks().forEach((track) => track.stop());
        } catch (err) {
          if (!cancelled) setError(getMicrophoneExceptionMessage(err));
        }
      }
      const all = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setMics(all.filter((device) => device.kind === 'audioinput'));
      setSpeakers(all.filter((device) => device.kind === 'audiooutput'));
    };

    void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices);
    };
  }, []);

  useEffect(() => () => {
    testCleanupRef.current?.();
    testCleanupRef.current = null;
  }, []);

  const stopTest = () => {
    testCleanupRef.current?.();
    testCleanupRef.current = null;
    setTesting(false);
    setLevels(Array.from({ length: BAR_COUNT }, () => 0));
  };

  const startTest = async () => {
    if (testing) {
      stopTest();
      return;
    }
    if (!isSecureMediaContext()) {
      setError(getMicrophoneExceptionMessage(undefined));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : {}),
        },
      });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const gain = audioContext.createGain();
      gain.gain.value = settingsRef.current.micVolume / 100;
      gainNodeRef.current = gain;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(gain);
      gain.connect(analyser);

      const dest = audioContext.createMediaStreamDestination();
      gain.connect(dest);
      const playback = new Audio();
      playback.srcObject = dest.stream;
      playback.volume = settingsRef.current.speakerVolume / 100;
      if (settingsRef.current.speakerDeviceId && 'setSinkId' in playback) {
        await playback.setSinkId(settingsRef.current.speakerDeviceId).catch(() => {});
      }
      playbackRef.current = playback;
      await playback.play().catch(() => {});

      const data = new Uint8Array(analyser.frequencyBinCount);
      let frame = 0;
      const tick = () => {
        analyser.getByteFrequencyData(data);
        const next = Array.from({ length: BAR_COUNT }, (_, index) => {
          const sample = data[Math.floor((index / BAR_COUNT) * data.length)] ?? 0;
          return sample / 255;
        });
        setLevels(next);
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);

      testCleanupRef.current = () => {
        cancelAnimationFrame(frame);
        playback.pause();
        playback.srcObject = null;
        playbackRef.current = null;
        gainNodeRef.current = null;
        stream.getTracks().forEach((track) => track.stop());
        void audioContext.close();
      };
      setError('');
      setTesting(true);
    } catch (err) {
      setError(getMicrophoneExceptionMessage(err));
      stopTest();
    }
  };

  const showHelp = () => {
    alert(
      '음성 장치가 안 보이거나 소리가 없으면:\n\n' +
      '1) 주소창 왼쪽 자물쇠에서 마이크를 허용하세요.\n' +
      '2) Windows 설정 → 소리에서 입력/출력 장치가 켜져 있는지 확인하세요.\n' +
      '3) 다른 프로그램이 마이크를 독점하면 끄고 새로고침하세요.\n' +
      '4) 회의방에서는 여기서 저장한 장치·음량이 그대로 적용됩니다.',
    );
  };

  return (
    <div className={s.root}>
      {hideHeading ? null : <h3>음성</h3>}

      {!isSecureMediaContext() && (
        <p className={s.warn}>
          지금 주소에서는 브라우저가 마이크를 막을 수 있습니다.{' '}
          <a href={localhostAppUrl()}>localhost로 접속</a>
          하거나 https로 열어 주세요.
        </p>
      )}

      <div className="settings-row">
        <label htmlFor="voice-mic">마이크</label>
        <select
          id="voice-mic"
          className="settings-field"
          value={settings.micDeviceId}
          onChange={(e) => update({ micDeviceId: e.target.value })}
        >
          <option value="">Windows 기본 설정</option>
          {mics.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {deviceOptionLabel(device, '마이크')}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="voice-mic-vol">마이크 음량</label>
        <input
          id="voice-mic-vol"
          className={s.slider}
          type="range"
          min={0}
          max={100}
          value={settings.micVolume}
          onChange={(e) => update({ micVolume: Number(e.target.value) })}
        />
      </div>

      <div className="settings-row">
        <label htmlFor="voice-speaker">헤드셋 / 스피커</label>
        <select
          id="voice-speaker"
          className="settings-field"
          value={settings.speakerDeviceId}
          onChange={(e) => update({ speakerDeviceId: e.target.value })}
        >
          <option value="">Windows 기본 설정</option>
          {speakers.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {deviceOptionLabel(device, '헤드셋 / 스피커')}
            </option>
          ))}
        </select>
      </div>

      <div className="settings-row">
        <label htmlFor="voice-speaker-vol">스피커 음량</label>
        <input
          id="voice-speaker-vol"
          className={s.slider}
          type="range"
          min={0}
          max={100}
          value={settings.speakerVolume}
          onChange={(e) => update({ speakerVolume: Number(e.target.value) })}
        />
      </div>

      <div className={s.testRow}>
        <button
          type="button"
          className={testing ? 'danger-button' : 'secondary-button'}
          onClick={() => { void startTest(); }}
        >
          {testing ? '테스트 중지' : '마이크 테스트'}
        </button>
        <div className={s.meter} aria-hidden="true">
          {levels.map((level, index) => (
            <span
              key={index}
              className={`${s.bar}${level > 0.08 ? (level > 0.75 ? ` ${s.barHot}` : ` ${s.barOn}`) : ''}`}
              style={{ height: `${Math.max(12, Math.round(level * 100))}%` }}
            />
          ))}
        </div>
      </div>

      {error ? <p className={s.error}>{error}</p> : null}

      <p className={s.help}>
        도움이 필요하신가요?{' '}
        <button type="button" className={s.helpBtn} onClick={showHelp}>
          문제 해결 가이드
        </button>
        를 확인하세요.
      </p>
    </div>
  );
}
