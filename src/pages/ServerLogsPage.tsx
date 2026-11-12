import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppShell from '../components/AppShell';
import { supabase } from '../services/supabaseClient';
import styles from './ServerLogsPage.module.css';

type ServerLogRow = {
  id: number;
  created_at: string;
  method: string;
  path: string;
  status: number;
  duration_ms: number;
  remote_addr: string | null;
  origin: string;
  user_id: string | null;
};

/**
 * Supabase server_logs 를 관리자에게만 보여 줍니다.
 * 행 권한은 DB 정책이 막고, 이 화면은 관리자가 아니면 표를 요청하지 않습니다.
 */
export default function ServerLogsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ServerLogRow[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    const { data: userData, error: authError } = await supabase.auth.getUser();
    if (authError || !userData.user) {
      navigate('/');
      return;
    }

    const admin = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', userData.user.id)
      .maybeSingle();
    if (admin.error) {
      setIsAdmin(false);
      setRows([]);
      setError('관리자 정보를 읽지 못했습니다. Supabase에서 supabase/20_서버로그.sql 을 실행해 주세요.');
      setLoading(false);
      return;
    }
    if (!admin.data?.is_admin) {
      setIsAdmin(false);
      setRows([]);
      setError('관리자만 서버 로그를 볼 수 있습니다.');
      setLoading(false);
      return;
    }

    setIsAdmin(true);
    const { data, error: logError } = await supabase
      .from('server_logs')
      .select('id, created_at, method, path, status, duration_ms, remote_addr, origin, user_id')
      .order('created_at', { ascending: false })
      .limit(200);
    if (logError) {
      setRows([]);
      setError('로그를 읽지 못했습니다. Supabase에서 supabase/20_서버로그.sql 을 실행해 주세요.');
      setLoading(false);
      return;
    }
    setRows((data ?? []) as ServerLogRow[]);
    setLoading(false);
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;
    // 응답이 도착한 뒤에만 상태를 바꿉니다. effect에서 load()를 바로 부르면 린트 에러가 납니다.
    const id = window.setTimeout(() => {
      if (!cancelled) void load();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [load]);

  return (
    <AppShell activePage="setting">
      <div className="page fitPage">
        <div className="page-header">
          <h1>서버 로그</h1>
          <button type="button" className="primary-button" onClick={() => { setLoading(true); setError(''); void load(); }} disabled={loading}>
            다시 읽기
          </button>
        </div>
        <p className={styles.hint}>
          서버가 처리한 요청이 Supabase에 쌓입니다. 관리자로 로그인한 기기에서만 이 표가 보입니다.
        </p>
        {error ? <p className={styles.error}>{error}</p> : null}
        {isAdmin ? (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>시각</th>
                  <th>요청</th>
                  <th>상태</th>
                  <th>시간</th>
                  <th>위치</th>
                  <th>사용자</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}>불러오는 중...</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6}>아직 기록된 요청이 없습니다.</td></tr>
                ) : rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString('ko-KR')}</td>
                    <td>{row.method} {row.path}</td>
                    <td>{row.status}</td>
                    <td>{row.duration_ms}ms</td>
                    <td>{row.origin === 'internal' ? '서버 컴퓨터' : '외부'} {row.remote_addr || ''}</td>
                    <td>{row.user_id || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </AppShell>
  );
}
