import { useEffect, useRef, useState } from 'react';
import Icon from './Icon';
import {
  getMicrophoneExceptionMessage,
  isSecureMediaContext,
  localhostAppUrl,
} from '../utils/microphoneAccess';
import { isNoneDevice, loadVoiceSettings, NONE_DEVICE_ID, saveVoiceSettings, syncMicrophoneSetting, type VoiceSettings } from '../utils/voiceSettings';
import s from './VoiceSettingsPanel.module.css';
import micIcon from '../assets/voice/voice-mic.svg';
import volumeIcon from '../assets/voice/voice-volume.svg';
import soundIcon from '../assets/voice/voice-sound.svg';

/**
 * 시안 SVG(검정 고정)를 CSS 마스크로 그려 글자색(currentColor)을 따라가게 하는 아이콘.
 * 크기는 호출하는 쪽 클래스(width/height)가 정합니다.
 */
function MaskIcon({ src, className }: { src: string; className?: string }) {
  return (
    <span
      className={`${s.maskIcon}${className ? ` ${className}` : ''}`}
      style={{ '--icon-url': `url(${JSON.stringify(src)})` } as React.CSSProperties}
      aria-hidden="true"
    />
  );
}

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
 * (피그마 "설정 > 음성" export 반영 — 장치 선택창 바로 아래에 실시간 입력 레벨 미터를 추가했습니다.)
 */
export default function VoiceSettingsPanel({ hideHeading = false }: Props) {
  const [settings, setSettings] = useState<VoiceSettings>(() => loadVoiceSettings());
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const testCleanupRef = useRef<(() => void) | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const playbackRef = useRef<HTMLAudioElement | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  /** 마이크 드롭다운 바로 아래의 실시간 입력 레벨 (0~1) — "마이크 테스트"를 누르지 않아도 항상 표시됩니다 */
  const [liveMicLevel, setLiveMicLevel] = useState(0);
  const liveMicCleanupRef = useRef<(() => void) | null>(null);

  const update = (partial: Partial<VoiceSettings>) => {
    setSettings(saveVoiceSettings(partial));
  };

  const micNone = isNoneDevice(settings.micDeviceId);
  const speakerNone = isNoneDevice(settings.speakerDeviceId);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = settings.micVolume / 100;
    if (playbackRef.current) playbackRef.current.volume = settings.speakerVolume / 100;
  }, [settings.micVolume, settings.speakerVolume]);

  useEffect(() => {
    let cancelled = false;

    const refreshDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      // 시스템 마이크 유무를 보고, 없으면 없음 / 있으면 기본 장치로 맞춥니다.
      const next = await syncMicrophoneSetting();
      if (cancelled) return;
      setSettings(next);
      settingsRef.current = next;

      if (!cancelled && isNoneDevice(next.micDeviceId)) setError('');
      const all = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setMics(all.filter((device) => device.kind === 'audioinput' && device.deviceId));
      setSpeakers(all.filter((device) => device.kind === 'audiooutput' && device.deviceId));
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

  /**
   * 마이크를 고르면(없음이 아니면) "마이크 테스트"를 누르지 않아도 조용히(재생 없이) 스트림을 열어
   * 입력 레벨만 계산합니다. 장치를 바꾸거나 "없음"으로 바꾸면 이전 스트림은 정리합니다.
   * 권한이 없거나 실패해도 이 미터는 부가 기능이라 조용히 무시합니다 — 에러 안내는 "마이크 테스트"가 맡습니다.
   */
  useEffect(() => {
    liveMicCleanupRef.current?.();
    liveMicCleanupRef.current = null;
    setLiveMicLevel(0);

    if (micNone || !isSecureMediaContext() || !navigator.mediaDevices?.getUserMedia) return;

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : {}),
          },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);

        const data = new Uint8Array(analyser.frequencyBinCount);
        let frame = 0;
        const tick = () => {
          analyser.getByteFrequencyData(data);
          const avg = data.reduce((sum, value) => sum + value, 0) / data.length / 255;
          setLiveMicLevel(avg);
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);

        liveMicCleanupRef.current = () => {
          cancelAnimationFrame(frame);
          stream.getTracks().forEach((track) => track.stop());
          void audioContext.close();
        };
      } catch {
        // 조용히 무시 — "마이크 테스트" 버튼을 누르면 그때 실패 이유를 안내합니다.
      }
    })();

    return () => {
      cancelled = true;
      liveMicCleanupRef.current?.();
      liveMicCleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.micDeviceId, micNone]);

  const stopTest = () => {
    testCleanupRef.current?.();
    testCleanupRef.current = null;
    setTesting(false);
  };

  const startTest = async () => {
    if (testing) {
      stopTest();
      return;
    }
    if (isNoneDevice(settingsRef.current.micDeviceId)) {
      setError('마이크가 없음으로 설정되어 있습니다. 테스트하려면 장치를 고르세요.');
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
          ...(settings.micDeviceId ? { deviceId: { ideal: settings.micDeviceId } } : {}),
        },
      });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const gain = audioContext.createGain();
      gain.gain.value = settingsRef.current.micVolume / 100;
      gainNodeRef.current = gain;
      source.connect(gain);

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

      testCleanupRef.current = () => {
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

      {/* 마이크 */}
      <div className={s.deviceGroup}>
        <label htmlFor="voice-mic" className={s.deviceLabel}>마이크</label>
        <div className={s.selectRow}>
          <MaskIcon src={micIcon} className={s.selectIcon} />
          <select
            id="voice-mic"
            className={s.select}
            value={settings.micDeviceId}
            onChange={(e) => {
              setError('');
              if (isNoneDevice(e.target.value)) stopTest();
              update({ micDeviceId: e.target.value, micManual: true });
            }}
          >
            <option value={NONE_DEVICE_ID}>없음</option>
            <option value="">Windows 기본 설정</option>
            {mics.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceOptionLabel(device, '마이크')}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" className={s.selectChevron} />
        </div>
        {/* 장치를 고르면(없음이 아니면) 항상 살아있는 실시간 입력 레벨 미터 */}
        {!micNone && (
          <div className={s.levelTrack} role="status" aria-label="실시간 마이크 입력 레벨">
            <div className={s.levelFill} style={{ width: `${Math.round(liveMicLevel * 100)}%` }} />
          </div>
        )}
      </div>

      {micNone ? (
        <div className={s.noneWindow} role="status">
          <strong>없음</strong>
          <span>마이크 없이 회의에 참여합니다. 내 목소리는 나가지 않습니다.</span>
        </div>
      ) : (
        <div className={s.deviceGroup}>
          <label htmlFor="voice-mic-vol" className={s.deviceLabel}>마이크 음량</label>
          <div className={s.sliderRow}>
            <MaskIcon src={micIcon} className={s.sliderIcon} />
            <input
              id="voice-mic-vol"
              className={s.slider}
              type="range"
              min={0}
              max={100}
              value={settings.micVolume}
              onChange={(e) => update({ micVolume: Number(e.target.value) })}
              style={{ '--fill': `${settings.micVolume}%` } as React.CSSProperties}
            />
          </div>
        </div>
      )}

      {/* 헤드셋 / 스피커 */}
      <div className={s.deviceGroup}>
        <label htmlFor="voice-speaker" className={s.deviceLabel}>헤드셋 / 스피커</label>
        <div className={s.selectRow}>
          <MaskIcon src={volumeIcon} className={s.selectIcon} />
          <select
            id="voice-speaker"
            className={s.select}
            value={settings.speakerDeviceId}
            onChange={(e) => update({ speakerDeviceId: e.target.value })}
          >
            <option value={NONE_DEVICE_ID}>없음</option>
            <option value="">Windows 기본 설정</option>
            {speakers.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceOptionLabel(device, '헤드셋 / 스피커')}
              </option>
            ))}
          </select>
          <Icon name="chevron-down" className={s.selectChevron} />
        </div>
        {/* 출력 장치는 실시간으로 잴 신호가 없어서, 아래 스피커 음량 값을 그대로 보여주는 장식용 막대입니다 */}
        {!speakerNone && (
          <div className={s.levelTrack} aria-hidden="true">
            <div className={s.levelFill} style={{ width: `${settings.speakerVolume}%` }} />
          </div>
        )}
      </div>

      {speakerNone ? (
        <div className={s.noneWindow} role="status">
          <strong>없음</strong>
          <span>헤드셋·스피커 없이 참여합니다. 상대 소리는 들리지 않습니다.</span>
        </div>
      ) : (
        <div className={s.deviceGroup}>
          <label htmlFor="voice-speaker-vol" className={s.deviceLabel}>헤드셋 / 스피커 음량</label>
          <div className={s.sliderRow}>
            <MaskIcon src={volumeIcon} className={s.sliderIcon} />
            <input
              id="voice-speaker-vol"
              className={s.slider}
              type="range"
              min={0}
              max={100}
              value={settings.speakerVolume}
              onChange={(e) => update({ speakerVolume: Number(e.target.value) })}
              style={{ '--fill': `${settings.speakerVolume}%` } as React.CSSProperties}
            />
          </div>
        </div>
      )}

      {/* 마이크 테스트 버튼 + 도움말 — 피그마엔 버튼 옆 24칸 레벨 미터가 없어서 뺐습니다
          (입력 소리는 마이크 선택칸 아래의 실시간 막대로 확인할 수 있습니다). */}
      <div className={s.footer}>
        <div className={s.testRow}>
          <button
            type="button"
            className={testing ? `${s.testButton} ${s.testButtonActive}` : s.testButton}
            disabled={micNone}
            onClick={() => { void startTest(); }}
          >
            <MaskIcon src={soundIcon} className={s.testIcon} />
            {testing ? '테스트 중지' : '마이크 테스트'}
          </button>
        </div>

        {error ? <p className={s.error}>{error}</p> : null}

      </div>
    </div>
  );
}
