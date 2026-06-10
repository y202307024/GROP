import { supabase } from '../services/supabaseClient';

type AccessResult = { ok: true } | { ok: false; error: string };

export async function ensureGroupCanvasAccess(groupId: string, userId: string): Promise<AccessResult> {
  const { data: isMember, error: rpcError } = await supabase.rpc('is_group_member', {
    p_group_id: groupId,
  });

  if (!rpcError && isMember === true) {
    return { ok: true };
  }

  // RPC 미설치·구버전 DB 대비
  if (rpcError?.message?.includes('is_group_member')) {
    const { data: row, error: selError } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('group_id', groupId)
      .eq('user_id', userId)
      .maybeSingle();

    if (selError) return { ok: false, error: selError.message };
    if (row) return { ok: true };
  } else if (!rpcError && isMember === false) {
    // fall through
  } else if (rpcError) {
    return { ok: false, error: rpcError.message };
  }

  const { data: ensured, error: ensureError } = await supabase.rpc('ensure_group_creator_member', {
    p_group_id: groupId,
  });

  if (!ensureError && ensured === true) {
    return { ok: true };
  }

  if (ensureError?.message?.includes('ensure_group_creator_member')) {
    const { data: group, error: groupError } = await supabase
      .from('groups')
      .select('created_by')
      .eq('id', groupId)
      .maybeSingle();

    if (groupError) return { ok: false, error: groupError.message };
    if (group?.created_by === userId) {
      const { error: insError } = await supabase
        .from('group_members')
        .insert({ group_id: groupId, user_id: userId });
      if (!insError || insError.message.includes('duplicate') || insError.message.includes('unique')) {
        return { ok: true };
      }
      return { ok: false, error: insError.message };
    }
  } else if (!ensureError && ensured === false) {
    return {
      ok: false,
      error: 'not_member',
    };
  } else if (ensureError) {
    return { ok: false, error: ensureError.message };
  }

  return { ok: false, error: 'not_member' };
}
