const STORAGE_KEY = 'grouop-voice-settings'
const CHANGE_EVENT = 'grouop-voice-settings'

export type VoiceSettings = {
  micDeviceId: string
  speakerDeviceId: string
  micVolume: number
  speakerVolume: number
}

const DEFAULT_SETTINGS: VoiceSettings = {
  micDeviceId: '',
  speakerDeviceId: '',
  micVolume: 90,
  speakerVolume: 60,
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
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    ...(settings.micDeviceId ? { deviceId: settings.micDeviceId } : {}),
  }
}
