import html2canvas from 'html2canvas';

export type MeetingRecordingCapture = {
  stream: MediaStream;
  cleanup: () => void;
};

type Rect = { x: number; y: number; w: number; h: number };

/** 합성 결과의 긴 변 상한. 이보다 키우면 파일이 1GB 제한에 빨리 닿습니다. */
const RECORDING_MAX_LONG_EDGE = 1920;
/** 화면보다 최대 두 배까지만 키웁니다. 작은 창을 억지로 4K로 늘리면 선만 번집니다. */
const RECORDING_MAX_SCALE = 2;
const RECORDING_FPS = 30;

/**
 * 보이는 화면보다 선명하게 녹화할 배율.
 * 긴 변이 1920을 넘지 않게 막고, 이미 그 크기면 더 키우지 않습니다.
 */
function recordingScale(width: number, height: number) {
  const longEdge = Math.max(width, height, 1);
  return Math.min(RECORDING_MAX_SCALE, RECORDING_MAX_LONG_EDGE / longEdge);
}

function relativeRect(container: DOMRect, target: DOMRect): Rect {
  return {
    x: target.left - container.left,
    y: target.top - container.top,
    w: target.width,
    h: target.height,
  };
}

/**
 * Chrome 화면 공유 없이 회의 UI(헤더·캔버스·컨트롤) 녹화
 * - UI는 html2canvas로 1회 캡처(배경)
 * - 필기는 canvas.captureStream으로 실시간 합성
 */
export async function createMeetingRecordingStream(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
): Promise<MeetingRecordingCapture> {
  const containerRect = container.getBoundingClientRect();
  const scale = recordingScale(containerRect.width, containerRect.height);
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.floor(containerRect.width * scale));
  off.height = Math.max(1, Math.floor(containerRect.height * scale));

  const canvasRect = relativeRect(containerRect, canvas.getBoundingClientRect());

  let backdrop: HTMLCanvasElement | null = null;
  try {
    // html2canvas 가 오래 걸리면 녹화 시작이 멈춘 것처럼 보여, 짧게만 시도합니다.
    // scale 은 합성 캔버스와 맞춰 헤더·버튼 글자가 흐려지지 않게 합니다.
    backdrop = await Promise.race([
      html2canvas(container, {
        backgroundColor: '#1e1f22',
        scale,
        logging: false,
        useCORS: true,
        ignoreElements: (el) => el === canvas,
      }),
      new Promise<null>((resolve) => {
        window.setTimeout(() => resolve(null), 2500);
      }),
    ]);
  } catch {
    backdrop = null;
  }

  const canvasStream = canvas.captureStream(RECORDING_FPS);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = canvasStream;
  try {
    await Promise.race([
      video.play(),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 800);
      }),
    ]);
  } catch {
    // autoplay 실패해도 합성 루프는 계속 돌립니다.
  }

  const ctx = off.getContext('2d');
  if (!ctx) {
    canvasStream.getTracks().forEach((t) => t.stop());
    throw new Error('녹화용 캔버스를 만들 수 없습니다.');
  }

  let running = true;
  let rafId = 0;

  const draw = () => {
    if (!running) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, off.width, off.height);
    if (backdrop) {
      ctx.drawImage(backdrop, 0, 0, off.width, off.height);
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      ctx.drawImage(
        video,
        canvasRect.x * scale,
        canvasRect.y * scale,
        canvasRect.w * scale,
        canvasRect.h * scale,
      );
    }
    rafId = requestAnimationFrame(draw);
  };

  // 첫 프레임을 그린 뒤 스트림을 열어, MediaRecorder 가 빈 청크만 받는 경우를 줄입니다.
  draw();
  const outputStream = off.captureStream(RECORDING_FPS);

  const cleanup = () => {
    running = false;
    cancelAnimationFrame(rafId);
    video.pause();
    video.srcObject = null;
    canvasStream.getTracks().forEach((t) => t.stop());
    outputStream.getTracks().forEach((t) => t.stop());
  };

  return { stream: outputStream, cleanup };
}
