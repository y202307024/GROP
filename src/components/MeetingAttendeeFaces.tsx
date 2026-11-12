import { getAvatarSrc } from '../utils/avatarOptions';

/**
 * 회의 목록의 참석자 칸.
 * 그 회의에 들어온 사람의 프로필 아이콘을 최대 3개까지 겹쳐 보여 줍니다.
 * 4명부터는 넘친 인원을 +숫자로 표시합니다.
 */
export default function MeetingAttendeeFaces({
  ids,
  avatarByUserId,
}: {
  ids: string[];
  avatarByUserId: Record<string, string>;
}) {
  if (ids.length === 0) return <span className="attendees">—</span>;

  const shown = ids.slice(0, 3);
  const extra = ids.length - shown.length;
  return (
    <span className="attendees" aria-label={`참석자 ${ids.length}명`}>
      {shown.map((id) => (
        <img key={id} src={getAvatarSrc(avatarByUserId[id])} alt="" />
      ))}
      {extra > 0 ? <span className="attendees-more">+{extra}</span> : null}
    </span>
  );
}
