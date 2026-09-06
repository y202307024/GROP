import { useEffect, useRef, useState } from 'react'
import {
  getMicrophoneExceptionMessage,
  isSecureMediaContext,
  localhostAppUrl,
} from '../utils/microphoneAccess'
import { loadVoiceSettings, saveVoiceSettings, type VoiceSettings } from '../utils/voiceSettings'

const BAR_COUNT = 24

function shortDeviceName(label: string) {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim()
}

function deviceOptionLabel(device: MediaDeviceInfo, fallback: string) {
  if (!device.label) return fallback
  const name = shortDeviceName(device.label)
  if (device.deviceId === 'default' || device.deviceId === 'communications') {
    return `기본 설정 (${name})`
  }
  return name
}

export default function VoiceSettingsPanel() {
  const [settings, setSettings] = useState<VoiceSettings>(() => loadVoiceSettings())
  const [mics, setMics] = useState<MediaDeviceInfo[]>([])
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([])
  const [testing, setTesting] = useState(false)
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: BAR_COUNT }, () => 0))
  const [error, setError] = useState('')
  const testCleanupRef = useRef<(() => void) | null>(null)
  const gainNodeRef = useRef<GainNode | null>(null)
  const playbackRef = useRef<HTMLAudioElement | null>(null)
  const settingsRef = useRef(settings)
  settingsRef.current = settings

  const update = (partial: Partial<VoiceSettings>) => {
    setSettings(saveVoiceSettings(partial))
  }

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = settings.micVolume / 100
    if (playbackRef.current) playbackRef.current.volume = settings.speakerVolume / 100
  }, [settings.micVolume, settings.speakerVolume])

  useEffect(() => {
    let cancelled = false

    const refreshDevices = async () => {
      if (!navigator.mediaDevices?.enumerateDevices) return
      if (isSecureMediaContext()) {
        try {
          const preview = await navigator.mediaDevices.getUserMedia({ audio: true })
          preview.getTracks().forEach((track) => track.stop())
        } catch (err) {
          if (!cancelled) setError(getMicrophoneExceptionMessage(err))
        }
      }
      const all = await navigator.mediaDevices.enumerateDevices()
      if (cancelled) return
      setMics(all.filter((device) => device.kind === 'audioinput'))
      setSpeakers(all.filter((device) => device.kind === 'audiooutput'))
    }

    void refreshDevices()
    navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices)
    return () => {
      cancelled = true
      navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices)
    }
  }, [])

  useEffect(() => () => {
    testCleanupRef.current?.()
    testCleanupRef.current = null
  }, [])

  const stopTest = () => {
    testCleanupRef.current?.()
    testCleanupRef.current = null
    setTesting(false)
    setLevels(Array.from({ length: BAR_COUNT }, () => 0))
  }

  const startTest = async () => {
    if (testing) {
      stopTest()
      return
    }
    if (!isSecureMediaContext()) {
      setError(getMicrophoneExceptionMessage())
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          ...(settings.micDeviceId ? { deviceId: { exact: settings.micDeviceId } } : {}),
        },
      })
      const audioContext = new AudioContext()
      const source = audioContext.createMediaStreamSource(stream)
      const gain = audioContext.createGain()
      gain.gain.value = settingsRef.current.micVolume / 100
      gainNodeRef.current = gain
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 64
      analyser.smoothingTimeConstant = 0.7
      source.connect(gain)
      gain.connect(analyser)

      const dest = audioContext.createMediaStreamDestination()
      gain.connect(dest)
      const playback = new Audio()
      playback.srcObject = dest.stream
      playback.volume = settingsRef.current.speakerVolume / 100
      if (settingsRef.current.speakerDeviceId && 'setSinkId' in playback) {
        await playback.setSinkId(settingsRef.current.speakerDeviceId).catch(() => {})
      }
      playbackRef.current = playback
      await playback.play().catch(() => {})

      const data = new Uint8Array(analyser.frequencyBinCount)
      let frame = 0
      const tick = () => {
        analyser.getByteFrequencyData(data)
        const next = Array.from({ length: BAR_COUNT }, (_, index) => {
          const sample = data[Math.floor((index / BAR_COUNT) * data.length)] ?? 0
          return sample / 255
        })
        setLevels(next)
        frame = requestAnimationFrame(tick)
      }
      frame = requestAnimationFrame(tick)

      testCleanupRef.current = () => {
        cancelAnimationFrame(frame)
        playback.pause()
        playback.srcObject = null
        playbackRef.current = null
        gainNodeRef.current = null
        stream.getTracks().forEach((track) => track.stop())
        void audioContext.close()
      }
      setError('')
      setTesting(true)
    } catch (err) {
      setError(getMicrophoneExceptionMessage(err))
      stopTest()
    }
  }

  const showHelp = () => {
    alert(
      '음성 장치가 안 보이거나 소리가 없으면:\n\n' +
      '1) 주소창 왼쪽 자물쇠에서 마이크를 허용하세요.\n' +
      '2) Windows 설정 → 소리에서 입력/출력 장치가 켜져 있는지 확인하세요.\n' +
      '3) 다른 프로그램이 마이크를 독점하면 끄고 새로고침하세요.\n' +
      '4) 회의방에서는 여기서 저장한 장치·음량이 그대로 적용됩니다.',
    )
  }

  return (
    <div style={{
      marginBottom: 24,
      padding: 16,
      background: '#2b2d31',
      borderRadius: 12,
      color: '#fff',
      width: '100%',
      boxSizing: 'border-box',
      overflow: 'visible',
      minWidth: 0,
    }}>
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>음성</div>

      {!isSecureMediaContext() && (
        <div style={{ fontSize: 12, color: '#f0c36d', marginBottom: 12, lineHeight: 1.45 }}>
          지금 주소에서는 브라우저가 마이크를 막을 수 있습니다.{' '}
          <a href={localhostAppUrl()} style={{ color: '#fff', fontWeight: 700 }}>localhost로 접속</a>
          하거나 https로 열어 주세요.
        </div>
      )}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))',
        gap: 16,
        marginBottom: 16,
        width: '100%',
        minWidth: 0,
      }}>
        <DeviceColumn
          title="마이크"
          icon="🎤"
          devices={mics}
          value={settings.micDeviceId}
          fallback="마이크"
          volumeLabel="마이크 음량"
          volume={settings.micVolume}
          onDeviceChange={(micDeviceId) => update({ micDeviceId })}
          onVolumeChange={(micVolume) => update({ micVolume })}
        />
        <DeviceColumn
          title="스피커"
          icon="🎧"
          devices={speakers}
          value={settings.speakerDeviceId}
          fallback="헤드셋 / 스피커"
          volumeLabel="스피커 음량"
          volume={settings.speakerVolume}
          onDeviceChange={(speakerDeviceId) => update({ speakerDeviceId })}
          onVolumeChange={(speakerVolume) => update({ speakerVolume })}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button
          type="button"
          onClick={() => { void startTest() }}
          style={{
            flexShrink: 0,
            padding: '8px 14px',
            border: 'none',
            borderRadius: 8,
            background: testing ? '#ed4245' : '#5865f2',
            color: '#fff',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {testing ? '테스트 중지' : '마이크 테스트'}
        </button>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 28, flex: 1, minWidth: 0 }}>
          {levels.map((level, index) => (
            <span
              key={index}
              style={{
                flex: 1,
                height: `${Math.max(12, Math.round(level * 100))}%`,
                borderRadius: 1,
                background: level > 0.08 ? (level > 0.75 ? '#ed4245' : '#57f287') : '#4e5058',
              }}
            />
          ))}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: '#f0c36d', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
          {error}
        </div>
      )}

      <div style={{ fontSize: 12, color: '#b5bac1' }}>
        도움이 필요하신가요?{' '}
        <button
          type="button"
          onClick={showHelp}
          style={{
            border: 'none',
            background: 'none',
            color: '#00a8fc',
            cursor: 'pointer',
            padding: 0,
            fontSize: 12,
          }}
        >
          문제 해결 가이드
        </button>
        를 확인하세요.
      </div>
    </div>
  )
}

function DeviceColumn({
  title,
  icon,
  devices,
  value,
  fallback,
  volumeLabel,
  volume,
  onDeviceChange,
  onVolumeChange,
}: {
  title: string
  icon: string
  devices: MediaDeviceInfo[]
  value: string
  fallback: string
  volumeLabel: string
  volume: number
  onDeviceChange: (deviceId: string) => void
  onVolumeChange: (volume: number) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const options = [
    { id: '', label: 'Windows 기본 설정' },
    ...devices.map((device) => ({
      id: device.deviceId,
      label: deviceOptionLabel(device, fallback),
    })),
  ]
  const current = options.find((option) => option.id === value)?.label || 'Windows 기본 설정'

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div ref={rootRef} style={{ minWidth: 0, width: '100%', position: 'relative' }}>
      <div style={{ fontSize: 13, color: '#dbdee1', marginBottom: 8 }}>{title}</div>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: '#1e1f22',
          borderRadius: 10,
          padding: '8px 10px',
          marginBottom: 12,
          minWidth: 0,
          width: '100%',
          boxSizing: 'border-box',
          border: '1px solid #3f4147',
          color: '#fff',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
        <span style={{
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
        }}>
          {current}
        </span>
        <span style={{ flexShrink: 0, color: '#b5bac1', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 64,
          left: 0,
          right: 0,
          zIndex: 20,
          maxHeight: 180,
          overflowY: 'auto',
          background: '#1e1f22',
          border: '1px solid #3f4147',
          borderRadius: 10,
          boxShadow: '0 8px 20px rgba(0,0,0,0.35)',
        }}>
          {options.map((option) => (
            <button
              key={option.id || 'default'}
              type="button"
              onClick={() => {
                onDeviceChange(option.id)
                setOpen(false)
              }}
              style={{
                display: 'block',
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                border: 'none',
                background: option.id === value ? '#313338' : 'transparent',
                color: '#fff',
                fontSize: 12,
                textAlign: 'left',
                cursor: 'pointer',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: '#b5bac1', marginBottom: 6 }}>{volumeLabel}</div>
      <input
        type="range"
        min={0}
        max={100}
        value={volume}
        onChange={(event) => onVolumeChange(Number(event.target.value))}
        style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', accentColor: '#5865f2' }}
      />
    </div>
  )
}
