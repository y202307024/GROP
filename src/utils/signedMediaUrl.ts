import { useEffect, useState } from 'react';
import { getApiBase } from './apiBase';
import { bearerHeaders } from './authHeader';

type MediaKind = 'file' | 'video';

type IssuedMediaUrl = {
  url: string;
  expiresAt: number;
};

const cache = new Map<string, IssuedMediaUrl>();

/**
 * 디스크의 /videos, /files 는 주소만으로 열리지 않습니다.
 * 로그인과 그룹 멤버 확인이 끝난 뒤에만 그 경로용 짧은 주소를 받습니다.
 * kind: file 은 첨부, video 는 예전 디스크 녹화입니다.
 */
export async function issueSignedMediaUrl(kind: MediaKind, relPath: string): Promise<IssuedMediaUrl> {
  const key = `${kind}:${relPath}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - Date.now() > 60_000) return hit;

  const params = new URLSearchParams({ kind, path: relPath });
  const res = await fetch(`${getApiBase()}/api/media-url?${params}`, {
    headers: await bearerHeaders(),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((body as { error?: string }).error || `파일 주소를 받지 못했습니다 (${res.status})`);
  }
  const pathUrl = (body as { url?: string }).url;
  const expiresIn = (body as { expiresIn?: number }).expiresIn;
  if (!pathUrl || typeof expiresIn !== 'number') {
    throw new Error('파일 주소를 받지 못했습니다');
  }
  const issued = {
    url: `${getApiBase()}${pathUrl}`,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  cache.set(key, issued);
  return issued;
}

/**
 * 화면에 붙일 짧은 주소. 경로가 바뀌면 다시 받고, 만료 전에는 조용히 갱신합니다.
 * 영상·이미지·PDF는 이 주소만으로 열리므로 헤더는 붙이지 않습니다.
 */
export function useSignedMediaUrl(kind: MediaKind, relPath: string | null | undefined) {
  const [issued, setIssued] = useState<{ path: string; url: string; error: string }>({
    path: '',
    url: '',
    error: '',
  });
  // 경로가 바뀌면 이전 파일 주소를 화면에 남기지 않습니다.
  const url = issued.path === (relPath || '') ? issued.url : '';
  const error = issued.path === (relPath || '') ? issued.error : '';

  useEffect(() => {
    if (!relPath) return;
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      try {
        const next = await issueSignedMediaUrl(kind, relPath);
        if (cancelled) return;
        setIssued({ path: relPath, url: next.url, error: '' });
        const wait = Math.max(30_000, next.expiresAt - Date.now() - 60_000);
        timer = window.setTimeout(() => { void load(); }, wait);
      } catch (err) {
        if (cancelled) return;
        setIssued({
          path: relPath,
          url: '',
          error: err instanceof Error ? err.message : '파일을 열 수 없습니다',
        });
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [kind, relPath]);

  return { url, error };
}
