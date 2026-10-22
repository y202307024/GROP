/**
 * 하단 툴바·옵션에서 쓰는 SVG 아이콘 모음.
 * - w/h는 SVG 파일의 원래 크기(px)입니다. 시안(2048px)의 아이콘 크기 그대로이고,
 *   화면에 그릴 때 MeetingDrawingTools의 --s(회의방 0.703 / 기본 1)를 곱해 줄입니다.
 * - 아이콘마다 크기가 달라서(글자 서식 18px, 이미지 20px 등) 원래 크기를 같이 들고 다닙니다.
 */

import chevronDownSrc from '../assets/toolbar/chevron-down.svg';
import fileDocSrc from '../assets/toolbar/file-doc.svg';
import fileSrc from '../assets/toolbar/file.svg';
import handSrc from '../assets/toolbar/hand.svg';
import imageSrc from '../assets/toolbar/image.svg';
import penBrushSrc from '../assets/toolbar/pen-brush.svg';
import penEraserSrc from '../assets/toolbar/pen-eraser.svg';
import penMarkerSrc from '../assets/toolbar/pen-marker.svg';
import penPencilSrc from '../assets/toolbar/pen-pencil.svg';
import penSrc from '../assets/toolbar/pen.svg';
import pointerSrc from '../assets/toolbar/pointer.svg';
import shapeArrowSrc from '../assets/toolbar/shape-arrow.svg';
import shapeCircleSrc from '../assets/toolbar/shape-circle.svg';
import shapeCurveArrowSrc from '../assets/toolbar/shape-curve-arrow.svg';
import shapeLineSrc from '../assets/toolbar/shape-line.svg';
import shapeOctagonSrc from '../assets/toolbar/shape-octagon.svg';
import shapePentagonSrc from '../assets/toolbar/shape-pentagon.svg';
import shapeSquareSrc from '../assets/toolbar/shape-square.svg';
import shapeTriangleSrc from '../assets/toolbar/shape-triangle.svg';
import shapeZigzagArrowSrc from '../assets/toolbar/shape-zigzag-arrow.svg';
import shapeSrc from '../assets/toolbar/shape.svg';
import stickerSrc from '../assets/toolbar/sticker.svg';
import textAlignLeftSrc from '../assets/toolbar/text-align-left.svg';
import textBoldSrc from '../assets/toolbar/text-bold.svg';
import textListSrc from '../assets/toolbar/text-list.svg';
import textSizeSrc from '../assets/toolbar/text-size.svg';
import textStrikeSrc from '../assets/toolbar/text-strike.svg';
import textUnderlineSrc from '../assets/toolbar/text-underline.svg';
import textSrc from '../assets/toolbar/text.svg';

export type ToolIcon = { src: string; w: number; h: number };

export const chevronDown: ToolIcon = { src: chevronDownSrc, w: 16, h: 16 };
export const fileDoc: ToolIcon = { src: fileDocSrc, w: 13, h: 16 };
export const file: ToolIcon = { src: fileSrc, w: 24, h: 24 };
export const hand: ToolIcon = { src: handSrc, w: 24, h: 22 };
export const image: ToolIcon = { src: imageSrc, w: 20, h: 20 };
export const penBrush: ToolIcon = { src: penBrushSrc, w: 24, h: 24 };
export const penEraser: ToolIcon = { src: penEraserSrc, w: 21, h: 20 };
export const penMarker: ToolIcon = { src: penMarkerSrc, w: 24, h: 24 };
export const penPencil: ToolIcon = { src: penPencilSrc, w: 24, h: 24 };
export const pen: ToolIcon = { src: penSrc, w: 24, h: 24 };
export const pointer: ToolIcon = { src: pointerSrc, w: 24, h: 24 };
export const shapeArrow: ToolIcon = { src: shapeArrowSrc, w: 21, h: 21 };
export const shapeCircle: ToolIcon = { src: shapeCircleSrc, w: 24, h: 24 };
export const shapeCurveArrow: ToolIcon = { src: shapeCurveArrowSrc, w: 22, h: 20 };
export const shapeLine: ToolIcon = { src: shapeLineSrc, w: 21, h: 21 };
export const shapeOctagon: ToolIcon = { src: shapeOctagonSrc, w: 24, h: 24 };
export const shapePentagon: ToolIcon = { src: shapePentagonSrc, w: 24, h: 24 };
export const shapeSquare: ToolIcon = { src: shapeSquareSrc, w: 24, h: 24 };
export const shapeTriangle: ToolIcon = { src: shapeTriangleSrc, w: 25, h: 24 };
export const shapeZigzagArrow: ToolIcon = { src: shapeZigzagArrowSrc, w: 23, h: 20 };
export const shape: ToolIcon = { src: shapeSrc, w: 24, h: 24 };
export const sticker: ToolIcon = { src: stickerSrc, w: 24, h: 24 };
export const textAlignLeft: ToolIcon = { src: textAlignLeftSrc, w: 15, h: 13 };
export const textBold: ToolIcon = { src: textBoldSrc, w: 10, h: 13 };
export const textList: ToolIcon = { src: textListSrc, w: 15, h: 13 };
export const textSize: ToolIcon = { src: textSizeSrc, w: 20, h: 20 };
export const textStrike: ToolIcon = { src: textStrikeSrc, w: 16, h: 13 };
export const textUnderline: ToolIcon = { src: textUnderlineSrc, w: 12, h: 13 };
export const text: ToolIcon = { src: textSrc, w: 20, h: 20 };
