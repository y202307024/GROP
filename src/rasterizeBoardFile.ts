import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import { CANVAS_FONT_FAMILY } from './canvasShapeUtils';
import { clipPreviewText, extractDocxPlainText, getFilePreviewKind } from './filePreviewUtils';

const PAGE_WIDTH = 800;
const MAX_STACK_PAGES = 3;

GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

export type RasterizedBoardFile = {
  dataUrl: string;
  width: number;
  height: number;
};

/** 파일을 화이트보드에 붙일 그림으로 바꿉니다. */
export async function rasterizeBoardFile(file: File): Promise<RasterizedBoardFile> {
  const kind = getFilePreviewKind(file.name, file.type);
  if (kind === 'image') return rasterizeImageFile(file);
  if (kind === 'pdf') return rasterizePdfFile(file);
  if (kind === 'docx') {
    const text = clipPreviewText(await extractDocxPlainText(await file.arrayBuffer()));
    return rasterizeTextPage(file.name, text);
  }
  if (kind === 'text') return rasterizeTextPage(file.name, clipPreviewText(await file.text()));
  return rasterizeTextPage(file.name, '이 파일은 보드에 미리보기로 올릴 수 없어요. 이미지·PDF·문서만 올려 주세요.');
}

async function rasterizeImageFile(file: File): Promise<RasterizedBoardFile> {
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  return { dataUrl, width: img.width, height: img.height };
}

async function rasterizePdfFile(file: File): Promise<RasterizedBoardFile> {
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await getDocument({ data }).promise;
  const pageCount = Math.min(doc.numPages, MAX_STACK_PAGES);
  const pages: HTMLCanvasElement[] = [];
  for (let i = 1; i <= pageCount; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    pages.push(canvas);
  }
  if (pages.length === 0) throw new Error('PDF 페이지를 그리지 못했습니다');
  return stackCanvases(pages);
}

function rasterizeTextPage(title: string, body: string): RasterizedBoardFile {
  const padding = 28;
  const titleSize = 18;
  const fontSize = 15;
  const lineHeight = 22;
  const maxWidth = PAGE_WIDTH - padding * 2;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('미리보기 캔버스를 만들지 못했습니다');
  ctx.font = `${fontSize}px ${CANVAS_FONT_FAMILY}`;
  const lines = wrapText(ctx, body, maxWidth);
  const height = Math.min(1600, padding * 2 + titleSize + 16 + lines.length * lineHeight);
  canvas.width = PAGE_WIDTH;
  canvas.height = height;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PAGE_WIDTH, height);
  ctx.fillStyle = '#0f172a';
  ctx.font = `700 ${titleSize}px ${CANVAS_FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.fillText(title, padding, padding, maxWidth);
  ctx.font = `${fontSize}px ${CANVAS_FONT_FAMILY}`;
  const maxLines = Math.floor((height - padding * 2 - titleSize - 16) / lineHeight);
  lines.slice(0, maxLines).forEach((line, i) => {
    ctx.fillText(line, padding, padding + titleSize + 16 + i * lineHeight);
  });
  return { dataUrl: canvas.toDataURL('image/png'), width: PAGE_WIDTH, height };
}

function stackCanvases(pages: HTMLCanvasElement[]): RasterizedBoardFile {
  const gap = 10;
  const width = Math.max(...pages.map((p) => p.width));
  const height = pages.reduce((sum, p) => sum + p.height, 0) + gap * (pages.length - 1);
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('PDF를 합치지 못했습니다');
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  for (const page of pages) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, y, width, page.height);
    ctx.drawImage(page, 0, y);
    y += page.height + gap;
  }
  return { dataUrl: out.toDataURL('image/jpeg', 0.86), width, height };
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const ch of raw) {
      const next = current + ch;
      if (ctx.measureText(next).width > maxWidth && current) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function readAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('파일을 읽지 못했습니다'));
    };
    reader.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열지 못했습니다'));
    img.src = dataUrl;
  });
}
