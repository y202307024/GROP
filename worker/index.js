/**
 * 회의 영상 용량만 이 사이트에서 돌려줍니다.
 * R2 비밀키는 두지 않고, 배포에 연결된 버킷 목록의 크기만 읽습니다.
 * 그 외 주소는 기존 화면 파일로 넘깁니다.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/meetings/storage' && request.method === 'GET') {
      return listMeetingVideoSizes(env);
    }
    return env.ASSETS.fetch(request);
  },
};

/** meeting-videos/ 아래 파일 크기를 모아 체크 왼쪽과 하단 막대에 씁니다. */
async function listMeetingVideoSizes(env) {
  if (!env.MEETING_VIDEOS) {
    return Response.json({ error: '용량 버킷이 없습니다' }, { status: 503 });
  }
  try {
    let cursor;
    let totalBytes = 0;
    const files = [];
    do {
      const listed = await env.MEETING_VIDEOS.list({
        prefix: 'meeting-videos/',
        cursor,
      });
      for (const obj of listed.objects) {
        const size = obj.size || 0;
        totalBytes += size;
        files.push({ key: obj.key, size });
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
    return Response.json({ totalBytes, files });
  } catch {
    return Response.json({ error: '용량을 읽지 못했습니다' }, { status: 500 });
  }
}
