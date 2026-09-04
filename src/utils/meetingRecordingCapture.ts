import html2canvas from 'html2canvas';

export type MeetingRecordingCapture = {
  stream: MediaStream;
  cleanup: () => void;
};

type Rect = { x: number; y: number; w: number; h: number };

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
  const off = document.createElement('canvas');
  off.width = Math.max(1, Math.floor(containerRect.width));
  off.height = Math.max(1, Math.floor(containerRect.height));

  const canvasRect = relativeRect(containerRect, canvas.getBoundingClientRect());

  let backdrop: HTMLCanvasElement | null = null;
  try {
    backdrop = await html2canvas(container, {
      backgroundColor: '#1e1f22',
      scale: 1,
      logging: false,
      useCORS: true,
      ignoreElements: (el) => el === canvas,
    });
  } catch {
    backdrop = null;
  }

  const canvasStream = canvas.captureStream(24);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = canvasStream;
  await video.play();

  const ctx = off.getContext('2d');
  if (!ctx) {
    canvasStream.getTracks().forEach((t) => t.stop());
    throw new Error('녹화용 캔버스를 만들 수 없습니다.');
  }

  let running = true;
  let rafId = 0;

  const draw = () => {
    if (!running) return;
    ctx.fillStyle = '#1e1f22';
    ctx.fillRect(0, 0, off.width, off.height);
    if (backdrop) {
      ctx.drawImage(backdrop, 0, 0, off.width, off.height);
    }
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      ctx.drawImage(video, canvasRect.x, canvasRect.y, canvasRect.w, canvasRect.h);
    }
    rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);

  const outputStream = off.captureStream(24);

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
