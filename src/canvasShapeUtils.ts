export type Point = { x: number; y: number };

export type DrawStyle = {
  strokeStyle: string;
  lineWidth: number;
  /** 없으면 채우지 않음(투명) */
  fillStyle?: string;
  /** 실선이면 [] 또는 undefined, 점선이면 [dash, gap] */
  dash?: number[];
  /** 텍스트 전용. 있으면 lineWidth에서 환산하지 않고 이 픽셀 크기를 씁니다. */
  fontSize?: number;
  /** 텍스트 박스 너비 — 정렬 계산에 사용 */
  textWidth?: number;
  /** 텍스트 가로 정렬 */
  textAlign?: 'left' | 'center' | 'right';
  /** 굵게 */
  bold?: boolean;
  /** 취소선 */
  strike?: boolean;
  /** 밑줄 */
  underline?: boolean;
};

/** #RRGGBB(+alpha 0~1) → rgba() */
export function colorWithOpacity(hexOrCss: string, opacity: number) {
  const a = Math.min(1, Math.max(0, opacity));
  const m = /^#([0-9a-f]{6})$/i.exec(hexOrCss.trim());
  if (!m) return hexOrCss;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r},${g},${b},${a})`;
}

/**
 * 도형 점선 — 대시:간격 = 1:1 로 통일합니다.
 * (굵기에 비례해 길이를 키워 두꺼운 화살표도 같은 비율로 보이게 합니다.)
 */
export function shapeDashArray(lineWidth: number): [number, number] {
  const unit = Math.max(8, Math.round(Math.max(1, lineWidth) * 2));
  return [unit, unit];
}

function beginShapeStyle(ctx: CanvasRenderingContext2D, style: DrawStyle, preview: boolean) {
  const isDashed = Boolean(style.dash?.length);
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  ctx.lineJoin = 'round';
  // 점선은 butt 로 그려 대시 길이가 간격과 같아 보이게 합니다. (round 캡은 간격이 달라 보임)
  ctx.lineCap = isDashed ? 'butt' : 'round';
  if (isDashed) {
    ctx.setLineDash(style.dash!);
  } else if (preview) {
    // 실선 도형 드래그 미리보기만 얇은 1:1 점선
    ctx.setLineDash(shapeDashArray(Math.max(2, style.lineWidth * 0.75)));
  } else {
    ctx.setLineDash([]);
  }
}

function finishShape(ctx: CanvasRenderingContext2D, style: DrawStyle) {
  if (style.fillStyle) {
    ctx.fillStyle = style.fillStyle;
    ctx.fill();
  }
  ctx.stroke();
}

export function drawRectangle(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  finishShape(ctx, style);
  ctx.restore();
}

export function drawEllipse(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const rx = Math.abs(to.x - from.x) / 2;
  const ry = Math.abs(to.y - from.y) / 2;
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
  finishShape(ctx, style);
  ctx.restore();
}

export function drawDiamond(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const hw = Math.abs(to.x - from.x) / 2;
  const hh = Math.abs(to.y - from.y) / 2;
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  finishShape(ctx, style);
  ctx.restore();
}

/** 드래그 박스 안에 꼭짓점이 위를 향하는 삼각형을 그립니다. */
export function drawTriangle(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const x0 = Math.min(from.x, to.x);
  const y0 = Math.min(from.y, to.y);
  const x1 = Math.max(from.x, to.x);
  const y1 = Math.max(from.y, to.y);
  const cx = (x0 + x1) / 2;
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.beginPath();
  ctx.moveTo(cx, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x0, y1);
  ctx.closePath();
  finishShape(ctx, style);
  ctx.restore();
}

/** n각형 — 드래그 박스에 외접하는 정다각형 */
function drawRegularPolygon(
  ctx: CanvasRenderingContext2D,
  from: Point,
  to: Point,
  sides: number,
  style: DrawStyle,
  preview = false,
) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const rx = Math.max(1, Math.abs(to.x - from.x) / 2);
  const ry = Math.max(1, Math.abs(to.y - from.y) / 2);
  const start = -Math.PI / 2;
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const a = start + (i * 2 * Math.PI) / sides;
    const x = cx + rx * Math.cos(a);
    const y = cy + ry * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  finishShape(ctx, style);
  ctx.restore();
}

export function drawPentagon(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  drawRegularPolygon(ctx, from, to, 5, style, preview);
}

export function drawHexagon(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  drawRegularPolygon(ctx, from, to, 6, style, preview);
}

/** 5각 별 */
export function drawStar(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const rx = Math.max(1, Math.abs(to.x - from.x) / 2);
  const ry = Math.max(1, Math.abs(to.y - from.y) / 2);
  const spikes = 5;
  const start = -Math.PI / 2;
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i += 1) {
    const rFactor = i % 2 === 0 ? 1 : 0.45;
    const a = start + (i * Math.PI) / spikes;
    const x = cx + rx * rFactor * Math.cos(a);
    const y = cy + ry * rFactor * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  finishShape(ctx, style);
  ctx.restore();
}

export function drawLine(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.restore();
}

/** 끝점에 화살촉만 그립니다. angle 은 진행 방향(라디안). */
function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tip: Point,
  angle: number,
  style: DrawStyle,
  preview: boolean,
) {
  const head = Math.max(10, style.lineWidth * 3);
  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.setLineDash([]);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - head * Math.cos(angle - Math.PI / 6), tip.y - head * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - head * Math.cos(angle + Math.PI / 6), tip.y - head * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
  ctx.restore();
}

export function drawArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const head = Math.max(10, style.lineWidth * 3);
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const shaftInset = Math.min(head * 0.8, length * 0.45);
  const shaftEnd =
    length > 1
      ? { x: to.x - shaftInset * Math.cos(angle), y: to.y - shaftInset * Math.sin(angle) }
      : to;

  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.stroke();
  ctx.restore();

  if (length > head * 0.35) {
    drawArrowHead(ctx, to, angle, style, preview);
  }
}

/**
 * 꺾은선(직교) 화살표 — 가로→세로→가로로 이어 끝 mid 점에서 to 로 붙입니다.
 * 도형 탭 첫 번째 연결선 아이콘에 해당합니다.
 */
export function drawElbowArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const midX = (from.x + to.x) / 2;
  const p1 = { x: midX, y: from.y };
  const p2 = { x: midX, y: to.y };
  const angle = Math.atan2(to.y - p2.y, to.x - p2.x) || (to.x >= from.x ? 0 : Math.PI);
  // 끝 구간이 너무 짧으면 midX 대신 세로만 쓰는 경로로 보정합니다.
  const endDx = Math.abs(to.x - midX);
  const head = Math.max(10, style.lineWidth * 3);
  const lengthHint = Math.hypot(to.x - from.x, to.y - from.y);

  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  if (endDx < 2) {
    ctx.lineTo(from.x, to.y);
    ctx.lineTo(to.x, to.y);
  } else {
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();
  ctx.restore();

  if (lengthHint > head * 0.35) {
    const tipAngle = endDx < 2
      ? Math.atan2(to.y - from.y, to.x - from.x)
      : Math.atan2(to.y - p2.y, to.x - p2.x);
    drawArrowHead(ctx, to, tipAngle || angle, style, preview);
  }
}

/**
 * 곡선(베지어) 화살표 — S자 연결선.
 * 도형 탭 두 번째 연결선 아이콘에 해당합니다.
 */
export function drawCurveArrow(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const dx = to.x - from.x;
  const c1 = { x: from.x + dx * 0.5, y: from.y };
  const c2 = { x: from.x + dx * 0.5, y: to.y };
  const tipAngle = Math.atan2(to.y - c2.y, to.x - c2.x);
  const lengthHint = Math.hypot(dx, to.y - from.y);
  const head = Math.max(10, style.lineWidth * 3);

  ctx.save();
  beginShapeStyle(ctx, style, preview);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
  ctx.stroke();
  ctx.restore();

  if (lengthHint > head * 0.35) {
    drawArrowHead(ctx, to, tipAngle || (dx >= 0 ? 0 : Math.PI), style, preview);
  }
}

/** 굵기(lineWidth)에 맞춘 텍스트 글자 크기. 입력칸과 실제 그리기가 같은 크기를 쓰도록 한곳에서 계산합니다. */
export function textFontSize(lineWidth: number) {
  return Math.max(14, lineWidth * 3);
}

/** 캔버스는 sans-serif만 주면 한글 글리프가 빠지는 경우가 있어 명시합니다. */
export const CANVAS_FONT_FAMILY = "'Malgun Gothic', 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif";

export function drawText(ctx: CanvasRenderingContext2D, point: Point, text: string, style: DrawStyle) {
  ctx.save();
  ctx.fillStyle = style.strokeStyle;
  const fontSize = style.fontSize ?? textFontSize(style.lineWidth);
  const weight = style.bold ? 'bold ' : '';
  ctx.font = `${weight}${fontSize}px ${CANVAS_FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  // 입력칸에서 Shift+Enter로 줄바꿈을 넣을 수 있어서 줄 단위로 그립니다.
  const lineHeight = fontSize * 1.25;
  const align = style.textAlign ?? 'left';
  const boxWidth = style.textWidth;
  const lines = text.split('\n');
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = Math.max(1, fontSize / 16);
  ctx.lineCap = 'round';
  lines.forEach((line, i) => {
    const metrics = ctx.measureText(line);
    const w = metrics.width;
    let x = point.x;
    if (boxWidth != null && align !== 'left') {
      if (align === 'center') x = point.x + (boxWidth - w) / 2;
      else if (align === 'right') x = point.x + boxWidth - w;
    }
    const y = point.y + i * lineHeight;
    ctx.fillText(line, x, y);
    // 취소선: 글자 높이 중간
    if (style.strike && line.length > 0) {
      const midY = y + fontSize * 0.55;
      ctx.beginPath();
      ctx.moveTo(x, midY);
      ctx.lineTo(x + w, midY);
      ctx.stroke();
    }
    // 밑줄: 베이스라인 아래
    if (style.underline && line.length > 0) {
      const underY = y + fontSize * 1.05;
      ctx.beginPath();
      ctx.moveTo(x, underY);
      ctx.lineTo(x + w, underY);
      ctx.stroke();
    }
  });
  ctx.restore();
}

export function drawStamp(ctx: CanvasRenderingContext2D, center: Point, kind: 'rect' | 'circle' | 'triangle', style: DrawStyle) {
  const s = 40;
  const from = { x: center.x - s / 2, y: center.y - s / 2 };
  const to = { x: center.x + s / 2, y: center.y + s / 2 };
  if (kind === 'rect') drawRectangle(ctx, from, to, style);
  else if (kind === 'circle') drawEllipse(ctx, from, to, style);
  else drawTriangle(ctx, from, to, style);
}

export type ShapeTool =
  | 'rectangle'
  | 'diamond'
  | 'triangle'
  | 'pentagon'
  | 'hexagon'
  | 'star'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'elbowArrow'
  | 'curveArrow';

export function drawShapeTool(
  ctx: CanvasRenderingContext2D,
  tool: ShapeTool,
  from: Point,
  to: Point,
  style: DrawStyle,
  preview = false,
) {
  if (tool === 'rectangle') drawRectangle(ctx, from, to, style, preview);
  else if (tool === 'diamond') drawDiamond(ctx, from, to, style, preview);
  else if (tool === 'triangle') drawTriangle(ctx, from, to, style, preview);
  else if (tool === 'pentagon') drawPentagon(ctx, from, to, style, preview);
  else if (tool === 'hexagon') drawHexagon(ctx, from, to, style, preview);
  else if (tool === 'star') drawStar(ctx, from, to, style, preview);
  else if (tool === 'ellipse') drawEllipse(ctx, from, to, style, preview);
  else if (tool === 'arrow') drawArrow(ctx, from, to, style, preview);
  else if (tool === 'elbowArrow') drawElbowArrow(ctx, from, to, style, preview);
  else if (tool === 'curveArrow') drawCurveArrow(ctx, from, to, style, preview);
  else drawLine(ctx, from, to, style, preview);
}
