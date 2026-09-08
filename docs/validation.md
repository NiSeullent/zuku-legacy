# 검증 기록

2026-09-08 UTC, 초기 공개 구현의 검증 범위다. 기능 동등성이나 모든 IE6 환경의 호환 인증을 의미하지 않는다.

| 검사 | 결과 |
| --- | --- |
| `npm run check` | 68개 통과: TypeScript, API 계약, 요청·세션·CSRF·브리지 보안, IE6–11 자동 선택, 전용 Classic 호스트 경로, ES3와 자원 예산 |
| `npm run test:browser` | Chromium 320/390/1024/1440px × JavaScript on/off, 8개 조합 통과 |
| `npm run test:layout` | 미디어 query를 제거한 Chromium에서 320/480/1024px × 16/24/32px 기본 글자 크기, 긴 본문·표·입력과 메뉴 검사 9개 통과 |
| Next 예제 | Next 16.3.4 기본 Turbopack 빌드·타입 검사·테스트 11개 통과 |
| Next 프로덕션 smoke | 실제 서버와 최종 ingress에서 구형 UA 자동 선택, 공개 URL 서명 GET/POST, 모던 본문 동일성과 캐시 정책 유지 확인 |
| QMP 콘솔 도구 | Python 단위 테스트 14개 통과 |
| CI 대상 런타임 | 임시 Node v22.23.2에서 루트 66개 검사·브라우저 8개·레이아웃 9개·Next 빌드와 프로덕션 smoke 통과 |
| 기존 ZUKU API | 공개 피드·검색·작품·댓글·Thread 읽기 계약 확인 |
| Bun 독립 서버 | 구형 UA의 공개 URL과 정적 자산 응답, 모던 UA의 기존 사이트 연결 확인 |
| 실제 IE6 VM | Server 2003 SP2 / IE 6.0.3790.3959: 기본 글자 4개 너비, Largest 320px, Active scripting 비활성 + 텍스트 모드 320px, 총 6개 조건 통과. [실행 기록과 원본 결과](ie6-vm.md) |

브라우저 자동화는 고정 fixture를 사용했다. Chromium에 IE6 User-Agent를 지정한 검사는 라우팅 증거이며, 실제 IE6 엔진 실행 증거와 구분한다. 로그인·사용자 작성 동작의 자동 검사는 테스트 자격 증명과 테스트 서버로 수행하며 운영 사용자 데이터를 변경하지 않는다.

NeonUX-LC 배포 JavaScript는 9,406바이트(gzip 2,386바이트), CSS는 7,308바이트(gzip 2,198바이트)다. 실제 구형 기기의 메모리 사용이나 지연을 측정한 값은 아니다.

## GitHub Actions

첫 공개 커밋의 [Actions 실행](https://github.com/NiSeullent/zuku-legacy/actions/runs/34190150709)은 GitHub 계정 수준의 실행 제한으로 작업이 시작되지 않았다. 두 작업 모두 실행 단계가 없으며, 로컬 검사 통과를 GitHub CI 통과로 표시하지 않는다. 계정의 실행 제한이 해제되면 저장소의 workflow로 다시 검증할 수 있다.
