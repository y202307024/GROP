export const MEETING_RECORDING_TOPIC = 'meeting-recording';

export type MeetingRecordingSyncMessage =
  | { type: 'recording:start'; from: string }
  | { type: 'recording:stop'; from: string };

export function encodeRecordingSyncMessage(msg: MeetingRecordingSyncMessage): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(msg));
}

export function decodeRecordingSyncMessage(payload: Uint8Array): MeetingRecordingSyncMessage | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(payload)) as MeetingRecordingSyncMessage;
    if (parsed.type !== 'recording:start' && parsed.type !== 'recording:stop') return null;
    if (typeof parsed.from !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}
