import { supabase } from '../services/supabaseClient';

/** 그룹 권한 플래그 — 방장이 설정에서 토글합니다. */
export type GroupPermissionFlags = {
  membersCanRecord: boolean;
  membersCanDraw: boolean;
  membersCanChangeBoard: boolean;
};

/** 멤버 한 명에 대한 개별 권한 (기본 true = 그룹 설정을 따름) */
export type MemberPermissionFlags = {
  canRecord: boolean;
  canDraw: boolean;
  canChangeBoard: boolean;
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
  membersCanChangeBoard: true,
};

const DEFAULT_MEMBER: MemberPermissionFlags = {
  canRecord: true,
  canDraw: true,
  canChangeBoard: true,
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
    .select('members_can_record, members_can_draw, members_can_change_board')
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
      membersCanChangeBoard:
        settings?.members_can_change_board ?? DEFAULT_SETTINGS.membersCanChangeBoard,
    },
  };
}

/** 특정 멤버의 개별 권한. 행이 없으면 기본(허용). */
export async function fetchMemberPermissions(
  groupId: string,
  userId: string,
): Promise<MemberPermissionFlags> {
  const { data } = await supabase
    .from('group_member_permissions')
    .select('can_record, can_draw, can_change_board')
    .eq('group_id', groupId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!data) return { ...DEFAULT_MEMBER };
  return {
    canRecord: data.can_record ?? true,
    canDraw: data.can_draw ?? true,
    canChangeBoard: data.can_change_board ?? true,
  };
}

/** 방장이 멤버별 권한을 저장합니다. */
export async function saveMemberPermissions(
  groupId: string,
  userId: string,
  flags: MemberPermissionFlags,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { error } = await supabase.from('group_member_permissions').upsert(
    {
      group_id: groupId,
      user_id: userId,
      can_record: flags.canRecord,
      can_draw: flags.canDraw,
      can_change_board: flags.canChangeBoard,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'group_id,user_id' },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** 현재 유저가 그룹 방장(created_by)인지 */
export function isGroupOwner(meta: GroupMeta | null | undefined, userId: string | null | undefined): boolean {
  if (!meta?.createdBy || !userId) return false;
  return meta.createdBy === userId;
}

/**
 * 녹화 가능: 방장 OR (그룹 허용 AND 멤버 허용)
 * memberFlags 없으면 멤버 허용으로 간주합니다.
 */
export function canRecord(
  meta: GroupMeta | null | undefined,
  userId: string | null | undefined,
  memberFlags?: MemberPermissionFlags | null,
): boolean {
  if (!meta || !userId) return false;
  if (isGroupOwner(meta, userId)) return true;
  if (!meta.settings.membersCanRecord) return false;
  return memberFlags?.canRecord ?? true;
}

/**
 * 판서 가능: 방장 OR (그룹 허용 AND 멤버 허용)
 */
export function canDraw(
  meta: GroupMeta | null | undefined,
  userId: string | null | undefined,
  memberFlags?: MemberPermissionFlags | null,
): boolean {
  if (!meta || !userId) return false;
  if (isGroupOwner(meta, userId)) return true;
  if (!meta.settings.membersCanDraw) return false;
  return memberFlags?.canDraw ?? true;
}

/**
 * 보드 변경(선택·생성·이름) 가능: 방장 OR (그룹 허용 AND 멤버 허용)
 */
export function canChangeBoard(
  meta: GroupMeta | null | undefined,
  userId: string | null | undefined,
  memberFlags?: MemberPermissionFlags | null,
): boolean {
  if (!meta || !userId) return false;
  if (isGroupOwner(meta, userId)) return true;
  if (!meta.settings.membersCanChangeBoard) return false;
  return memberFlags?.canChangeBoard ?? true;
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
