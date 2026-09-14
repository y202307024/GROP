import axolotl from '../assets/avatars/axolotl.png';
import bee from '../assets/avatars/bee.png';
import cat from '../assets/avatars/cat.png';
import chick from '../assets/avatars/chick.png';
import hamster from '../assets/avatars/hamster.png';
import jellyfish from '../assets/avatars/jellyfish.png';
import octopus from '../assets/avatars/octopus.png';
import panda from '../assets/avatars/panda.png';
import penguin from '../assets/avatars/penguin.png';
import pig from '../assets/avatars/pig.png';
import sheep from '../assets/avatars/sheep.png';
import turtle from '../assets/avatars/turtle.png';

/**
 * 프로필 아바타 프리셋 (이모지 대신 쓰는 캐릭터 이미지).
 * profiles.avatar / group_profiles.avatar 컬럼에는 이 key 문자열만 저장하고,
 * 화면에 그릴 때 getAvatarSrc로 실제 이미지 경로를 구합니다.
 * (key로 저장해야 빌드마다 바뀌는 이미지 경로를 DB에 직접 담지 않아도 됩니다.)
 */
export const AVATAR_OPTIONS: { key: string; src: string }[] = [
  { key: 'axolotl', src: axolotl },
  { key: 'bee', src: bee },
  { key: 'cat', src: cat },
  { key: 'chick', src: chick },
  { key: 'hamster', src: hamster },
  { key: 'jellyfish', src: jellyfish },
  { key: 'octopus', src: octopus },
  { key: 'panda', src: panda },
  { key: 'penguin', src: penguin },
  { key: 'pig', src: pig },
  { key: 'sheep', src: sheep },
  { key: 'turtle', src: turtle },
];

const AVATAR_MAP: Record<string, string> = Object.fromEntries(
  AVATAR_OPTIONS.map((a) => [a.key, a.src]),
);

export const DEFAULT_AVATAR_KEY = 'cat';

/**
 * DB에 저장된 avatar 값을 실제 이미지 경로로 바꿉니다.
 * - 업로드한 사진(avatar_url)처럼 http(s) URL이면 그대로 사용
 * - 새 프리셋 key(cat, panda ...)면 매핑된 이미지
 * - 옛날에 저장된 이모지 등 인식 못 하는 값이면 기본 아바타로 대체
 */
export function getAvatarSrc(avatar: string | null | undefined): string {
  if (!avatar) return AVATAR_MAP[DEFAULT_AVATAR_KEY];
  if (avatar.startsWith('http') || avatar.startsWith('data:') || avatar.startsWith('blob:')) {
    return avatar;
  }
  return AVATAR_MAP[avatar] ?? AVATAR_MAP[DEFAULT_AVATAR_KEY];
}
