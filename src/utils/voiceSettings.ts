const STORAGE_KEY = 'grouop-voice-settings'
const CHANGE_EVENT = 'grouop-voice-settings'

/** 마이크/헤드셋이 없는 사용자가 고르는 값. 빈 문자열(Windows 기본)과 구분합니다. */
export const NONE_DEVICE_ID = 'none'

export type VoiceSettings = {
  micDeviceId: string
  speakerDeviceId: string
  micVolume: number
  speakerVolume: number
  /** true면 사용자가 직접 고른 값이라, 자동 감지가 덮어쓰지 않습니다. */
  micManual: boolean
}

export type MicPresence = 'present' | 'missing' | 'unknown'

export function isNoneDevice(deviceId: string) {
  return deviceId === NONE_DEVICE_ID
}

const DEFAULT_SETTINGS: VoiceSettings = {
  micDeviceId: '',
  speakerDeviceId: '',
  micVolume: 90,
  speakerVolume: 60,
  micManual: false,
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 0
  return Math.min(100, Math.max(0, Math.round(value)))
}

export function loadVoiceSettings(): VoiceSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed = JSON.parse(raw) as Partial<VoiceSettings>
    return {
      micDeviceId: typeof parsed.micDeviceId === 'string' ? parsed.micDeviceId : '',
      speakerDeviceId: typeof parsed.speakerDeviceId === 'string' ? parsed.speakerDeviceId : '',
      micVolume: clampVolume(parsed.micVolume ?? DEFAULT_SETTINGS.micVolume),
      speakerVolume: clampVolume(parsed.speakerVolume ?? DEFAULT_SETTINGS.speakerVolume),
      micManual: parsed.micManual === true,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveVoiceSettings(partial: Partial<VoiceSettings>): VoiceSettings {
  const next = { ...loadVoiceSettings(), ...partial }
  next.micVolume = clampVolume(next.micVolume)
  next.speakerVolume = clampVolume(next.speakerVolume)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(CHANGE_EVENT))
  return next
}

export function subscribeVoiceSettings(listener: () => void) {
  const onCustom = () => listener()
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  window.addEventListener(CHANGE_EVENT, onCustom)
  window.addEventListener('storage', onStorage)
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom)
    window.removeEventListener('storage', onStorage)
  }
}

export function voiceCaptureOptions(settings: VoiceSettings) {
  if (isNoneDevice(settings.micDeviceId)) return false
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(settings.micDeviceId ? { deviceId: settings.micDeviceId } : {}),
  }
}

/**
 * 브라우저에 실제 입력 장치가 있는지 확인합니다.
 * getUserMedia가 NotFound면 마이크가 없는 것입니다.
 */
export async function detectMicrophonePresence(): Promise<MicPresence> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'unknown'
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    stream.getTracks().forEach((track) => track.stop())
    return 'present'
  } catch (err) {
    const name = err && typeof err === 'object' && 'name' in err
      ? String((err as { name: string }).name)
      : ''
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'missing'
    return 'unknown'
  }
}

/**
 * 마이크가 있으면 Windows 기본 장치를, 없으면 없음으로 맞춥니다.
 * 사용자가 목록에서 직접 고른 값은 유지합니다.
 */
export async function syncMicrophoneSetting(): Promise<VoiceSettings> {
  const current = loadVoiceSettings()
  const presence = await detectMicrophonePresence()

  if (presence === 'missing') {
    if (isNoneDevice(current.micDeviceId)) return current
    return saveVoiceSettings({ micDeviceId: NONE_DEVICE_ID })
  }

  if (presence === 'present' && !current.micManual && isNoneDevice(current.micDeviceId)) {
    return saveVoiceSettings({ micDeviceId: '' })
  }

  return current
}
