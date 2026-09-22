import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { supabase } from '../services/supabaseClient';
import { fetchGroupMeta, isGroupOwner } from '../utils/groupPermissions';

type Announcement = {
  id: string;
  title: string;
  body: string;
  published_at: string | null;
  updated_at: string;
  created_at: string;
};

/**
 * 그룹 공지사항 — 멤버는 게시된 글만, 방장은 작성·수정·게시.
 */
export default function GroupAnnouncements() {
  const { id: groupId } = useParams();
  const navigate = useNavigate();
  const [userId, setUserId] = useState('');
  const [owner, setOwner] = useState(false);
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!groupId) return;
    const { data } = await supabase
      .from('group_announcements')
      .select('id, title, body, published_at, updated_at, created_at')
      .eq('group_id', groupId)
      .order('updated_at', { ascending: false });
    setItems((data as Announcement[]) || []);
    setLoading(false);
  };

  useEffect(() => {
    let mounted = true;
    const init = async () => {
      if (!groupId) return;
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        navigate('/');
        return;
      }
      if (!mounted) return;
      setUserId(userData.user.id);
      const meta = await fetchGroupMeta(groupId);
      if (!mounted) return;
      setOwner(isGroupOwner(meta, userData.user.id));
      await load();
    };
    void init();
    return () => {
      mounted = false;
    };
  }, [groupId, navigate]);

  const startCreate = () => {
    setEditingId('new');
    setTitle('');
    setBody('');
  };

  const startEdit = (item: Announcement) => {
    setEditingId(item.id);
    setTitle(item.title);
    setBody(item.body);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setTitle('');
    setBody('');
  };

  const saveDraft = async (publish: boolean) => {
    if (!owner || !groupId || !userId) return;
    if (!title.trim()) {
      alert('제목을 입력해 주세요.');
      return;
    }
    setSaving(true);
    const payload = {
      title: title.trim(),
      body: body.trim(),
      updated_at: new Date().toISOString(),
      published_at: publish ? new Date().toISOString() : null,
    };

    if (editingId === 'new') {
      const { error } = await supabase.from('group_announcements').insert({
        group_id: groupId,
        created_by: userId,
        ...payload,
      });
      setSaving(false);
      if (error) {
        alert(`저장 실패: ${error.message}`);
        return;
      }
    } else if (editingId) {
      const { error } = await supabase
        .from('group_announcements')
        .update(payload)
        .eq('id', editingId);
      setSaving(false);
      if (error) {
        alert(`저장 실패: ${error.message}`);
        return;
      }
    }
    cancelEdit();
    await load();
  };

  const togglePublish = async (item: Announcement) => {
    if (!owner) return;
    const next = item.published_at ? null : new Date().toISOString();
    const { error } = await supabase
      .from('group_announcements')
      .update({ published_at: next, updated_at: new Date().toISOString() })
      .eq('id', item.id);
    if (error) alert(error.message);
    else await load();
  };

  const remove = async (item: Announcement) => {
    if (!owner) return;
    if (!confirm('이 공지를 삭제할까요?')) return;
    const { error } = await supabase.from('group_announcements').delete().eq('id', item.id);
    if (error) alert(error.message);
    else await load();
  };

  return (
    <AppShell activePage="main">
      <div className="page">
        <div className="page-header">
          <h1>공지사항</h1>
          <div style={{ display: 'flex', gap: 8 }}>
            {owner ? (
              <button className="primary-button" type="button" onClick={startCreate}>
                새 공지
              </button>
            ) : null}
            <button className="secondary-button" type="button" onClick={() => navigate(`/group/${groupId}`)}>
              그룹으로
            </button>
          </div>
        </div>

        {editingId ? (
          <div className="settings-card" style={{ marginBottom: 20 }}>
            <div className="settings-section">
              <h3>{editingId === 'new' ? '새 공지 작성' : '공지 수정'}</h3>
              <div className="settings-row">
                <label>제목</label>
                <input className="settings-field" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="settings-row">
                <label>내용</label>
                <textarea
                  className="settings-field"
                  rows={6}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="secondary-button" type="button" disabled={saving} onClick={() => saveDraft(false)}>
                  임시저장
                </button>
                <button className="primary-button" type="button" disabled={saving} onClick={() => saveDraft(true)}>
                  게시하기
                </button>
                <button className="danger-button" type="button" onClick={cancelEdit}>
                  취소
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {loading ? (
          <div>불러오는 중...</div>
        ) : items.length === 0 ? (
          <div className="list-card">
            <div className="list-row">아직 공지가 없습니다.</div>
          </div>
        ) : (
          <div className="list-card">
            {items.map((item) => (
              <div key={item.id} className="list-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div>
                    <strong>{item.title || '(제목 없음)'}</strong>
                    <span style={{ marginLeft: 8, fontSize: 12, color: '#6b7280' }}>
                      {item.published_at ? '게시됨' : '임시저장'}
                    </span>
                  </div>
                  {owner ? (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="secondary-button" type="button" onClick={() => startEdit(item)}>
                        수정
                      </button>
                      <button className="secondary-button" type="button" onClick={() => togglePublish(item)}>
                        {item.published_at ? '게시 취소' : '게시'}
                      </button>
                      <button className="danger-button" type="button" onClick={() => remove(item)}>
                        삭제
                      </button>
                    </div>
                  ) : null}
                </div>
                <div style={{ whiteSpace: 'pre-wrap', color: '#374151' }}>{item.body || '(내용 없음)'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
