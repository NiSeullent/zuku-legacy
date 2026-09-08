export interface ApprovalResult { displayName?: string; }
export type ApproveDevice = (code: string) => Promise<ApprovalResult>;

export function normalizeDeviceCode(value: string): string {
  const code = value.replace(/-/g, '').toUpperCase();
  return /^[A-F0-9]{12}$/.test(code) ? code : '';
}

const errors: Record<number, string> = {
  400: '연결 코드가 만료되었거나 이미 사용되었습니다. Legacy 기기에서 새 코드를 발급해 주세요.',
  401: '모던 ZUKU에서 다시 로그인한 뒤 연결을 승인해 주세요.',
  403: '보호된 연결을 확인할 수 없습니다. 서비스 운영자에게 연결 설정 확인을 요청해 주세요.',
  429: '연결 요청이 많습니다. 잠시 후 다시 시도해 주세요.',
};

/** Call only after explicit confirmation, using the host's existing login session. */
export function tokenApproval(getAccessToken: () => string | null | undefined | Promise<string | null | undefined>): ApproveDevice {
  return async (input) => {
    const code = normalizeDeviceCode(input);
    if (!code) throw new Error('Legacy 기기에 표시된 12자리 연결 코드를 확인해 주세요.');
    if (typeof window === 'undefined' || window.location.protocol !== 'https:') {
      throw new Error('모던 ZUKU의 HTTPS 승인 화면에서 연결해 주세요.');
    }
    const token = await getAccessToken();
    if (!token || !/^[A-Za-z0-9._~-]{20,8192}$/.test(token)) {
      throw new Error('모던 ZUKU에서 먼저 로그인해 주세요.');
    }
    let response: Response;
    try {
      response = await fetch('/legacy/authorize', {
        method: 'POST',
        mode: 'same-origin',
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code }),
      });
    } catch {
      throw new Error('연결 승인을 전송하지 못했습니다. 네트워크 상태를 확인해 주세요.');
    }
    // Core errors may be HTML. Never render or display an arbitrary response body.
    if (!response.ok) throw new Error(errors[response.status] || '연결 승인을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    if (!(response.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      throw new Error('승인 응답을 확인할 수 없습니다. 서비스 운영자에게 문의해 주세요.');
    }
    let payload: unknown;
    try { payload = await response.json(); } catch { throw new Error('승인 응답을 확인할 수 없습니다.'); }
    if (!payload || typeof payload !== 'object' || !('success' in payload) || payload.success !== true) {
      throw new Error('승인이 확인되지 않았습니다. Legacy 기기에서 연결 상태를 확인해 주세요.');
    }
    const name = 'display_name' in payload && typeof payload.display_name === 'string' ? payload.display_name.slice(0, 120) : undefined;
    return { displayName: name };
  };
}
