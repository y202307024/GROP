export type Point = { x: number; y: number };

type DrawStyle = {
  strokeStyle: string;
  lineWidth: number;
  fillStyle?: string;
};

export function drawRectangle(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const x = Math.min(from.x, to.x);
  const y = Math.min(from.y, to.y);
  const w = Math.abs(to.x - from.x);
  const h = Math.abs(to.y - from.y);
  ctx.save();
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(preview ? [6, 4] : []);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

export function drawEllipse(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const rx = Math.abs(to.x - from.x) / 2;
  const ry = Math.abs(to.y - from.y) / 2;
  ctx.save();
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(preview ? [6, 4] : []);
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawDiamond(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  const cx = (from.x + to.x) / 2;
  const cy = (from.y + to.y) / 2;
  const hw = Math.abs(to.x - from.x) / 2;
  const hh = Math.abs(to.y - from.y) / 2;
  ctx.save();
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(preview ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(cx, cy - hh);
  ctx.lineTo(cx + hw, cy);
  ctx.lineTo(cx, cy + hh);
  ctx.lineTo(cx - hw, cy);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

export function drawLine(ctx: CanvasRenderingContext2D, from: Point, to: Point, style: DrawStyle, preview = false) {
  ctx.save();
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'round';
  ctx.setLineDash(preview ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
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
  ctx.strokeStyle = style.strokeStyle;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'butt';
  ctx.setLineDash(preview ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(shaftEnd.x, shaftEnd.y);
  ctx.stroke();

  if (length > head * 0.35) {
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle - Math.PI / 6), to.y - head * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(to.x, to.y);
    ctx.lineTo(to.x - head * Math.cos(angle + Math.PI / 6), to.y - head * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
  }
  ctx.restore();
}

export function drawText(ctx: CanvasRenderingContext2D, point: Point, text: string, style: DrawStyle) {
  ctx.save();
  ctx.fillStyle = style.strokeStyle;
  ctx.font = `${Math.max(14, style.lineWidth * 3)}px sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(text, point.x, point.y);
  ctx.restore();
}

export function drawStamp(ctx: CanvasRenderingContext2D, center: Point, kind: 'rect' | 'circle' | 'triangle', style: DrawStyle) {
  const s = 40;
  const from = { x: center.x - s / 2, y: center.y - s / 2 };
  const to = { x: center.x + s / 2, y: center.y + s / 2 };
  if (kind === 'rect') drawRectangle(ctx, from, to, style);
  else if (kind === 'circle') drawEllipse(ctx, from, to, style);
  else {
    ctx.save();
    ctx.strokeStyle = style.strokeStyle;
    ctx.lineWidth = style.lineWidth;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y - s / 2);
    ctx.lineTo(center.x + s / 2, center.y + s / 2);
    ctx.lineTo(center.x - s / 2, center.y + s / 2);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}

export type ShapeTool = 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line';

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
  else if (tool === 'ellipse') drawEllipse(ctx, from, to, style, preview);
  else if (tool === 'arrow') drawArrow(ctx, from, to, style, preview);
  else drawLine(ctx, from, to, style, preview);
}
