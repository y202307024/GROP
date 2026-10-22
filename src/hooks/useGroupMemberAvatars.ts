import { useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

/** 그룹원 한 명의 프로필 이미지 정보 (get_group_members_with_profiles RPC의 일부) */
export type MemberAvatar = { user_id: string; avatar: string; nickname: string };

/**
 * 메인/AI 요약 페이지의 "참석자" 자리(그룹 카드·회의 행)에 쓸 실제 그룹원 프로필 이미지를 가져옵니다.
 * - groupIds: 보여줄 그룹 id들(중복 가능). 그룹마다 한 번씩만 RPC를 부릅니다.
 * - 돌려주는 값: { [groupId]: 가입 순서대로의 그룹원 배열 }. 아직 못 불러온 그룹은 키가 없으니
 *   화면에서는 기존 임시 아이콘으로 대신 그리면 됩니다.
 * 같은 RPC를 멤버 페이지(MemberList)/그룹 상세(GroupPage)도 쓰므로 프로필 이미지가 그곳과 항상 같습니다.
 */
export function useGroupMemberAvatars(groupIds: string[]): Record<string, MemberAvatar[]> {
  const [byGroup, setByGroup] = useState<Record<string, MemberAvatar[]>>({});

  // 배열 참조가 매 렌더 바뀌어도 다시 불러오지 않도록, 내용(정렬된 id 목록)을 문자열 키로 비교합니다
  const key = [...new Set(groupIds.filter(Boolean))].sort().join(',');

  useEffect(() => {
    if (!key) return;
    let cancelled = false;

    const load = async () => {
      const ids = key.split(',');
      const results = await Promise.all(
        ids.map(async (id) => {
          const { data, error } = await supabase.rpc('get_group_members_with_profiles', { p_group_id: id });
          if (error || !data) return [id, null] as const;
          const members = (data as { user_id: string; avatar: string; nickname: string }[]).map((m) => ({
            user_id: m.user_id,
            avatar: m.avatar,
            nickname: m.nickname,
          }));
          return [id, members] as const;
        }),
      );
      if (cancelled) return;
      const next: Record<string, MemberAvatar[]> = {};
      for (const [id, members] of results) if (members) next[id] = members;
      setByGroup(next);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return byGroup;
}
