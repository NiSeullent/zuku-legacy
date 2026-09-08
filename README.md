# ZUKU Web Client (Legacy)

**같은 ZUKU 주소에 접속하면 구형 브라우저를 감지해 클래식 렌더러를 자동 선택합니다.** 사용자가 `/legacy` 주소를 찾아 들어갈 필요가 없습니다. 모던 브라우저는 기존 모던 클라이언트로 계속 처리합니다.

현대 ZUKU의 API를 클래식 브라우저와 저사양 기기에 연결하는 초기 구현입니다. 전체 기능 동등성이나 IE6 실기기 호환성 인증을 뜻하지 않습니다. 이 저장소는 기존 프로젝트에 연결할 패키지와 예제를 제공하며, 운영 중인 모던 ZUKU 프로젝트를 변경하거나 자동 배포하지 않습니다.

서버는 현대 TypeScript·Node/Bun·Next.js를 사용합니다. 브라우저에는 HTML4 기반 화면, CSS2 기본 스타일과 선택적인 ES3 스크립트만 전달합니다. React hydration, 번들 polyfill, 외부 글꼴, 자동 재생, 무한 스크롤은 필요하지 않습니다.

## 한 플랫폼, 다른 렌더러

- 기존 `/api/v1`에서 피드, 검색, 작품, 프로필, Thread와 댓글을 읽습니다.
- 보호된 연결에서 기존 계정을 승인하면 글·답글·댓글·좋아요·보관함을 이용합니다.
- **NeonUX-LC**는 의미 있는 DOM을 유지하면서 canvas → VML → DOM 순서로 지원 여부를 확인합니다. 텍스트 모드에서는 그래픽과 스크립트 요청을 생략합니다.
- 공개 NeonUX 토큰을 고정된 원본 커밋에서 CSS 리터럴로 생성합니다. 회원·권한·추천·모더레이션 DB를 별도로 만들지 않습니다.
- 같은 `createLegacyApp().handle()`이 독립 서버와 Next Route Handler에서 실행됩니다.

공개 URL도 공유합니다. `/`는 홈, `/community`는 Thread, `/login`은 계정 연결, `/profile`은 내 계정입니다. 상품 채널·검색·콘텐츠·창작자 프로필도 기존 경로를 유지합니다. 감지 결과가 명확한 구형 브라우저 요청만 내부 렌더러로 rewrite하며 주소창과 내부 링크에는 공개 경로를 유지합니다. `/legacy`는 정적 자산·action·승인 API와 명시적 디버깅용 내부 경로입니다.

현재 화면은 영상·음악·게임의 소개와 대화를 제공하며 실제 재생/실행은 미디어·코덱·엔진에 따라 다릅니다. 메시징은 기존 E2EE를 유지하기 위해 모던 화면으로 연결합니다. 패스키, 결제, 업로드, Studio, 관리 기능도 모던 화면을 사용합니다. 상세 범위는 [기능표](docs/features.md)를 확인하세요.

## 실행

서버/빌드 도구: Node.js 22.13+와 npm. 이는 **브라우저 요구사항과 다릅니다**.

```sh
npm ci
npm run check
ZUKU_API_ORIGIN=http://127.0.0.1:30012 npm start
```

독립 렌더러의 홈은 `http://127.0.0.1:8787/`입니다. 구형 UA는 클래식 HTML을 받고, 모던·알 수 없는 UA의 공개 GET/HEAD 요청은 같은 경로의 `ZUKU_MODERN_ORIGIN`으로 302 이동합니다. 독립 서버에는 모던 앱이 포함되지 않습니다. 아래처럼 구형 UA로 자동 선택을 확인할 수 있습니다.

```sh
curl -A 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1)' http://127.0.0.1:8787/
```

기존 ZUKU API가 필요하며, API 연결 실패 시 가짜 콘텐츠 대신 오류를 표시합니다. 같은 호스트에서 모던 앱을 계속 제공하면서 자동 분기하는 통합 방법은 아래 Next.js 예제를 따릅니다. `.env.example`은 설정 참고용이며 자동으로 읽지 않습니다. Node의 `--env-file` 또는 배포 환경변수로 전달하세요.

```sh
node --env-file=.env apps/server/server.mjs
```

독립 서버의 기본 bind 주소는 `127.0.0.1`입니다. `HOST`, `PORT`, `ZUKU_PUBLIC_ORIGIN`을 명시해 배포합니다. 원격 API에는 HTTPS가 필수이며 정확한 loopback HTTP만 예외로 허용합니다. URL 경로나 비밀정보를 API origin에 넣지 마세요.

## TLS를 지원하지 않는 브라우저

HTTP로 받은 자바스크립트만으로 TLS와 동등한 보안을 만들 수 없습니다. 네트워크 공격자가 암호화 코드 자체를 바꿀 수 있기 때문입니다. 따라서 공개 HTTP는 **익명 읽기 전용**입니다.

내장 브리지는 같은 기기의 `127.0.0.1`에만 HTTP를 열고, 외부 통신은 인증서를 검증하는 TLS 1.2+로 처리합니다. 백엔드 인증 토큰과 원격 세션 쿠키는 브라우저에 전달하지 않습니다. 서버는 별도로 설치한 브리지의 HMAC 요청 인증·타임스탬프·일회용 nonce도 검증합니다. HMAC는 전송 암호화를 대체하지 않습니다.

```sh
# 서버와 해당 신뢰된 브리지에, 안전한 별도 경로로 같은 키를 설정합니다.
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# 출력한 값을 ZUKU_BRIDGE_KEY 환경변수에 설정 — 소스에 저장하지 마세요.
ZUKU_LEGACY_UPSTREAM=https://your-legacy-host.example npm run bridge
```

TLS를 직접 사용할 수 없는 브라우저는 같은 기기의 `http://127.0.0.1:8788/`로 접속합니다. 브리지는 허용된 공개 경로와 내부 Legacy 요청만 전달합니다. 이것은 전송을 위한 로컬 주소이며 별도의 Legacy 사이트 진입 경로를 요구하는 구조가 아닙니다.

최신 Node.js는 Windows XP에서 실행되지 않습니다. **XP용 네이티브 브리지는 이 릴리스에 포함되지 않으며**, XP의 인증 작업에는 검증된 호환 브리지 또는 운영체제 수준의 보호된 터널이 추가로 필요합니다. 일반 LAN HTTP는 보호된 마지막 연결 구간이 아닙니다. [보안 모델](docs/security.md), [브리지 설명](packages/bridge/README.md)을 읽어 주세요.

## 기존 Next.js ZUKU에 연결

[Next 예제](examples/next/README.md)는 기존 공개 URL에서 구형 User-Agent만 감지해 내부 `/legacy/[[...path]]/route.ts`로 rewrite하고 완성된 HTML을 반환합니다. 모던·알 수 없는 User-Agent는 기존 라우팅에 그대로 넘깁니다. `Vary: User-Agent`로 캐시가 두 표현을 섞지 않도록 하며, UA 판단은 인증이나 보안 연결의 근거로 사용하지 않습니다.

1. 세 패키지를 현재 workspace 의존성으로 연결하고 빌드합니다.
2. 자동 선택 proxy, 내부 Route Handler와 공유 application instance를 설치합니다. 구형 브라우저 분기만 기존 호스트 라우터 앞에 통합하고 나머지 요청 처리는 유지합니다.
3. 기존 호스트 라우터의 공통 경로 목록(`SHARED_PATH_PREFIXES`)에 내부 `/legacy` 경로를 추가해 자산·action·승인 화면을 보존합니다. 사용자에게 이 경로로 이동하도록 요구하지 않습니다.
4. 모던 승인 화면을 기존 `hydrateAuthStore` / `getAccessToken` 또는 `authFetch`에 연결합니다. 공개 예제는 새로운 로그인 체계를 만들지 않습니다.
5. 독립 서버와 같은 `ZUKU_PUBLIC_ORIGIN`, `ZUKU_HTTPS_PROXY_SECRET`을 사용합니다. HTTPS ingress에서 외부의 `X-Zuku-Ingress-Key`를 제거하고 서버 전용 키를 덮어씁니다. URL이나 `X-Forwarded-Proto`만으로 계정 작업을 허용하지 않습니다.
6. Next 정적 응답은 proxy의 `Vary`를 덮어쓸 수 있으므로 [최종 응답 훅](examples/next/integration/response-hook.mjs)을 기존 서버의 응답 마지막 단계에 연결합니다. 공유 HTML 캐시도 `User-Agent`별 표현을 구분하도록 설정하고, 기존 캐시는 전환 전에 무효화하거나 우회합니다. [실행 예제와 검증](examples/next/README.md)에 모던 본문과 캐시 정책을 유지하는 연결 방법이 있습니다.

구형 브라우저의 `/login`에서 생성한 5분짜리 코드를 이미 로그인한 모던 ZUKU에서 **명시적으로 승인**하고, 구형 화면에서 확인 버튼을 누르면 세션을 교체합니다. Legacy 전용 `zuku_lc_session` 쿠키는 공개 경로에서 사용하도록 `Path=/`로 발급하며 기존 모던 인증 쿠키를 변경하지 않습니다. 캡차·패스키·MFA 절차를 우회하지 않습니다. 연결된 access token은 서버에만 보관하며 15분 후 Legacy 세션 사용이 끝납니다. refresh token은 받지 않습니다.

기본 상태 저장소와 nonce 저장소는 한 프로세스용입니다. 여러 워커에 바로 배포하지 마세요. 세션·승인·CSRF를 원자적으로 처리하는 공유 저장소와 공유 replay 저장소가 필요합니다. 현재 예제는 한 워커에 배포하도록 구성되어 있습니다.

## 검증

```sh
npm run check                      # TypeScript, API/보안/ES3 테스트, 크기 예산
npx playwright install chromium
npm run test:browser               # Chromium 320/390/1024/1440px, JS on/off
npm run test:layout                # 미디어 query 없이 너비·글자 크기·긴 내용 9개 조합
npm run test:live                  # 기존 API 읽기 전용 계약 검사
```

브라우저 검사는 고정된 테스트 자료를 사용하며 `artifacts/`에 결과와 이미지를 저장합니다. 실제 API 검사는 공개 읽기만 수행합니다. npm의 브라우저 자동화는 Chromium을 사용하며, DOM/VML 테스트 대역을 IE6 실기기 결과로 간주하지 않습니다. [호환성 검증표](docs/compatibility.md)에 테스트 범위와 출시 조건을 기록합니다.

별도로 VM을 새로 설치해 **실제 IE 6.0.3790.3959**에서 320·480·800·1024px, 가장 큰 글자, 스크립트 비활성 상태의 탐색·한글 검색·레이아웃을 검증했습니다. [IE6 VM 실행 기록](docs/ie6-vm.md)과 [QMP 콘솔 도구](scripts/vm/README.md)를 제공합니다. Windows 설치 이미지와 VM 디스크는 저장소에 배포하지 않습니다.
로컬 검사 결과와 GitHub 실행 상태는 [검증 기록](docs/validation.md)을 확인하세요.

## 구조와 라이선스

```text
packages/legacy-core   현대 TypeScript 서버 렌더러 · 공통 ZUKU API 어댑터
packages/neonux-lc     ES3 runtime · CSS2 · NeonUX 토큰 컴파일러
packages/bridge       공통 URL/UA 선택 규칙 · loopback/TLS 브리지 · 요청 인증
apps/server           독립 Node/Bun HTTP 어댑터
examples/next         구형 브라우저 자동 rewrite · Route Handler · 모던 계정 승인
```

[설계](docs/architecture.md) · [NeonUX-LC](packages/neonux-lc/README.md) · [보안](docs/security.md)

Apache-2.0. 공개 NeonUX 원본의 저작권·라이선스·수정 표시는 각 패키지에 유지됩니다. 이 저장소에는 비공개 ZUKU 백엔드나 운영 비밀정보를 포함하지 않습니다.
