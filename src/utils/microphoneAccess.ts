/** localhost·HTTPS만 보안 문맥입니다. http://192.168.x.x 같은 IP는 마이크가 차단됩니다. */
export function isSecureMediaContext(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext;
}

export function localhostAppUrl(): string {
  const port = window.location.port || '5173';
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:';
  return `${protocol}//localhost:${port}${window.location.pathname}${window.location.search}`;
}

export function getMicrophoneFailureMessage(failure?: string | null): string {
  if (!isSecureMediaContext()) {
    return (
      '지금 주소에서는 마이크를 쓸 수 없습니다.\n\n' +
      `현재 주소: ${window.location.host}\n` +
      `https://${window.location.host} 로 다시 열어 주세요.\n` +
      '처음에는 인증서 경고가 뜹니다. 고급 → 계속(안전하지 않음)을 누르면 마이크를 쓸 수 있습니다.'
    );
  }

  const type = String(failure ?? '');
  if (type.includes('PermissionDenied')) {
    return '마이크 권한이 거부되었습니다.\n주소창 왼쪽 자물쇠에서 마이크를 허용한 뒤 새로고침해 주세요.';
  }
  if (type.includes('NotFound')) {
    return '마이크를 찾지 못했습니다.\n장치가 없으면 음성 설정에서 없음을 선택하세요.\nWindows 설정 → 소리 → 입력에서 장치가 켜져 있는지도 확인해 주세요.';
  }
  if (type.includes('DeviceInUse')) {
    return '마이크를 사용할 수 없습니다. 다른 프로그램이 마이크를 쓰고 있지 않은지 확인해 주세요.';
  }
  return '마이크를 사용할 수 없습니다.\n브라우저 권한과 입력 장치를 확인해 주세요.';
}

export function getMicrophoneExceptionMessage(err: unknown): string {
  const name = err && typeof err === 'object' && 'name' in err
    ? String((err as { name: string }).name)
    : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return getMicrophoneFailureMessage('PermissionDenied');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return getMicrophoneFailureMessage('NotFound');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return getMicrophoneFailureMessage('DeviceInUse');
  }
  return getMicrophoneFailureMessage();
}
