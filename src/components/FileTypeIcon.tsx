import fileCsv from '../assets/file-icons/file-csv.svg';
import fileDocx from '../assets/file-icons/file-docx.svg';
import fileJpg from '../assets/file-icons/file-jpg.svg';
import fileJs from '../assets/file-icons/file-js.svg';
import fileJson from '../assets/file-icons/file-json.svg';
import fileJsx from '../assets/file-icons/file-jsx.svg';
import filePdf from '../assets/file-icons/file-PDF.svg';
import filePng from '../assets/file-icons/file-png.svg';
import fileSrt from '../assets/file-icons/file-srt.svg';
import fileTs from '../assets/file-icons/file-ts.svg';
import fileTsx from '../assets/file-icons/file-tsx.svg';
import fileTxt from '../assets/file-icons/file-txt.svg';

/** 확장자(소문자, 점 없음) → 아이콘. 피그마 "문서 아이콘" 세트 기준. */
const ICON_BY_EXT: Record<string, string> = {
  csv: fileCsv,
  docx: fileDocx,
  doc: fileDocx,
  jpg: fileJpg,
  jpeg: fileJpg,
  js: fileJs,
  json: fileJson,
  jsx: fileJsx,
  pdf: filePdf,
  png: filePng,
  srt: fileSrt,
  ts: fileTs,
  tsx: fileTsx,
  txt: fileTxt,
};

/** 확장자에 매핑된 아이콘이 없을 때 쓰는 기본 아이콘 (일반 문서 취급) */
const DEFAULT_ICON = fileTxt;

/** 파일명에서 확장자만 뽑아냅니다 (예: "회의록.pdf" → "pdf"). */
function getFileExtension(fileName: string | null | undefined): string {
  if (!fileName) return '';
  const dot = fileName.lastIndexOf('.');
  if (dot === -1 || dot === fileName.length - 1) return '';
  return fileName.slice(dot + 1).toLowerCase();
}

type FileTypeIconProps = {
  /** 아이콘을 고를 기준이 되는 파일명 (확장자 포함) */
  fileName?: string | null;
  className?: string;
};

/** 파일 확장자에 맞는 문서 아이콘을 보여줍니다. 매칭되는 게 없으면 기본 문서 아이콘을 씁니다. */
export default function FileTypeIcon({ fileName, className }: FileTypeIconProps) {
  const ext = getFileExtension(fileName);
  const src = (ext && ICON_BY_EXT[ext]) || DEFAULT_ICON;
  return <img className={className} src={src} alt="" aria-hidden />;
}
