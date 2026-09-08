'use client';

import { useRef, useState } from 'react';
import { normalizeDeviceCode, type ApproveDevice } from '../lib/device-approval';

export interface DeviceApprovalProps {
  code: string;
  /** Supply a callback backed by the host's existing login. Omit to show setup state. */
  approve?: ApproveDevice;
}

export default function DeviceApproval({ code: input, approve }: DeviceApprovalProps) {
  const code = normalizeDeviceCode(input);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [complete, setComplete] = useState(false);
  const inFlight = useRef(false);

  async function confirm() {
    if (!approve || !code || inFlight.current || complete) return;
    inFlight.current = true;
    setBusy(true);
    setMessage('');
    try {
      const result = await approve(code);
      setMessage(`${result.displayName ? result.displayName + ' 님의 ' : ''}연결을 승인했습니다. Legacy 기기로 돌아가 연결 확인을 눌러 주세요.`);
      setComplete(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '연결을 승인하지 못했습니다. 다시 시도해 주세요.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return <section className="approval-card" aria-labelledby="approval-title">
    <p className="eyebrow">ZUKU / DEVICE CONNECTION</p>
    <h1 id="approval-title">내 Legacy 기기 연결</h1>
    <p>로그인한 ZUKU 계정을 이 코드의 기기에 연결합니다. 직접 시작한 연결이며 두 화면의 코드가 같은지 확인해 주세요.</p>
    <p className="device-code" aria-label="연결 코드">{code ? code.match(/.{4}/g)!.join(' – ') : '유효한 연결 코드가 없습니다'}</p>
    <p>승인하면 해당 기기에서 내 계정으로 좋아요, 댓글, 게시 및 보관함을 이용할 수 있습니다.</p>
    {!approve && <p className="notice" role="status">이 예제에는 호스트 로그인 연결이 아직 설치되지 않았습니다. 운영자가 기존 ZUKU 인증을 연결한 뒤 사용할 수 있습니다.</p>}
    {!code && <p className="notice">Legacy 기기의 계정 연결 화면에서 발급한 승인 주소를 다시 열어 주세요.</p>}
    <button type="button" disabled={!approve || !code || busy || complete} onClick={confirm}>
      {complete ? '연결 승인 완료' : busy ? '연결 승인 중…' : '코드가 일치합니다 · 이 기기 연결'}
    </button>
    <p role="status" aria-live="polite">{message}</p>
    <p><a href="/legacy">Legacy 둘러보기</a></p>
  </section>;
}
