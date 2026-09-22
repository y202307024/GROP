import { supabase } from '../services/supabaseClient';

/** 그룹 권한 플래그 — 방장이 설정에서 토글합니다. */
export type GroupPermissionFlags = {
  membersCanRecord: boolean;
  membersCanDraw: boolean;
};

export type GroupMeta = {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string | null;
  avatarUrl: string | null;
  settings: GroupPermissionFlags;
};

const DEFAULT_SETTINGS: GroupPermissionFlags = {
  membersCanRecord: true,
  membersCanDraw: true,
};

/**
 * 그룹 메타 + 권한 설정을 한 번에 로드합니다.
 * settings 행이 없으면 기본값(멤버 허용)을 씁니다.
 */
export async function fetchGroupMeta(groupId: string): Promise<GroupMeta | null> {
  const { data: group, error } = await supabase
    .from('groups')
    .select('id, name, invite_code, created_by, avatar_url')
    .eq('id', groupId)
    .maybeSingle();

  if (error || !group) return null;

  const { data: settings } = await supabase
    .from('group_settings')
    .select('members_can_record, members_can_draw')
    .eq('group_id', groupId)
    .maybeSingle();

  return {
    id: group.id,
    name: group.name,
    inviteCode: group.invite_code,
    createdBy: group.created_by ?? null,
    avatarUrl: group.avatar_url ?? null,
    settings: {
      membersCanRecord: settings?.members_can_record ?? DEFAULT_SETTINGS.membersCanRecord,
      membersCanDraw: settings?.members_can_draw ?? DEFAULT_SETTINGS.membersCanDraw,
    },
  };
}

/** 현재 유저가 그룹 방장(created_by)인지 */
export function isGroupOwner(meta: GroupMeta | null | undefined, userId: string | null | undefined): boolean {
  if (!meta?.createdBy || !userId) return false;
  return meta.createdBy === userId;
}

/** 녹화 가능: 방장이거나 멤버 녹화 허용 */
export function canRecord(meta: GroupMeta | null | undefined, userId: string | null | undefined): boolean {
  if (!meta || !userId) return false;
  if (isGroupOwner(meta, userId)) return true;
  return meta.settings.membersCanRecord;
}

/** 판서 가능: 방장이거나 멤버 판서 허용 */
export function canDraw(meta: GroupMeta | null | undefined, userId: string | null | undefined): boolean {
  if (!meta || !userId) return false;
  if (isGroupOwner(meta, userId)) return true;
  return meta.settings.membersCanDraw;
}

/** 초대코드 재발급용 랜덤 코드 (GRP-XXXXX) */
export function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = 'GRP-';
  for (let i = 0; i < 5; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
