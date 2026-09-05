import { useEffect, useState } from 'react';
import { clipPreviewText, extractDocxPlainText, getFilePreviewKind } from '../filePreviewUtils';
import cb from '../CanvasBoard.module.css';

type Props = {
  url: string;
  name: string;
  mime: string;
  /** 손 도구일 때만 PDF 스크롤을 받고, 그릴 때는 포커스를 빼 단축키가 보드로 가게 합니다. */
  interactive?: boolean;
};

/** 펼친 파일 카드 안에 넣는 미리보기입니다. */
export default function BoardFilePreview({ url, name, mime, interactive = false }: Props) {
  const kind = getFilePreviewKind(name, mime);

  if (kind === 'pdf') {
    return (
      <iframe
        className={cb.filePreviewFrame}
        title={name}
        src={`${url}#toolbar=1&navpanes=0`}
        tabIndex={-1}
        style={{ pointerEvents: interactive ? 'auto' : 'none' }}
      />
    );
  }
  if (kind === 'image') {
    return <img className={cb.filePreviewImage} src={url} alt={name} />;
  }
  if (kind === 'video') {
    return <video className={cb.filePreviewMedia} src={url} controls />;
  }
  if (kind === 'audio') {
    return <audio className={cb.filePreviewAudio} src={url} controls />;
  }
  if (kind === 'text') {
    return <RemoteTextPreview url={url} />;
  }
  if (kind === 'docx') {
    return <DocxTextPreview url={url} />;
  }
  return (
    <div className={cb.filePreviewEmpty}>
      이 파일은 보드에서 미리보기를 지원하지 않아요.
      <a href={url} target="_blank" rel="noreferrer">
        새 탭에서 열기
      </a>
    </div>
  );
}

function RemoteTextPreview({ url }: { url: string }) {
  const text = useRemoteText(url, async (res) => clipPreviewText(await res.text()));
  return <pre className={cb.filePreviewText}>{text}</pre>;
}

function DocxTextPreview({ url }: { url: string }) {
  const text = useRemoteText(url, async (res) => {
    const buffer = await res.arrayBuffer();
    return clipPreviewText(await extractDocxPlainText(buffer));
  });
  return <pre className={cb.filePreviewText}>{text}</pre>;
}

/** 미리보기 텍스트를 한 번만 받아 오고, 실패하면 안내 문구를 보여줍니다. */
function useRemoteText(url: string, parse: (res: Response) => Promise<string>) {
  const [text, setText] = useState('불러오는 중…');
  useEffect(() => {
    let cancelled = false;
    setText('불러오는 중…');
    void fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`미리보기 실패 (${res.status})`);
        return parse(res);
      })
      .then((next) => {
        if (!cancelled) setText(next || '(내용이 없습니다)');
      })
      .catch(() => {
        if (!cancelled) setText('파일 내용을 읽지 못했습니다.');
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return text;
}
