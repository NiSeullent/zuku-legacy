# 보안 모델

Legacy의 계정 작업은 **검증된 HTTPS 또는 같은 기기의 신뢰된 브리지**에서만 동작한다. 일반 HTTP에서는 공개 콘텐츠만 읽는다. 같은 공개 URL에서 이루어지는 구형 브라우저 자동 선택은 화면 표현만 결정한다. User-Agent나 내부 rewrite 표시는 인증·보안 전송의 근거가 아니다.

브라우저가 오래되었다는 이유로 기존 ZUKU의 인증, 콘텐츠 권한, CAPTCHA, 종단간 암호화 정책을 낮추지 않는다. `Vary: User-Agent`와 인증 응답의 `no-store`가 중간 캐시에서도 유지되어야 한다.

## HTTP 안의 JavaScript는 TLS를 대체하지 못한다

HTTP로 내려받은 암호화 코드와 공개키는 통신 중인 공격자가 함께 바꿀 수 있다. 따라서 처음 신뢰할 코드를 전달할 별도 수단 없이, 웹페이지 내부 암호화만으로 TLS와 동등한 인증·기밀성·무결성을 제공한다고 주장할 수 없다. 이는 인증되고 기밀성이 보장된 경로로 애플리케이션 코드를 전달해야 한다는 [W3C Secure Contexts의 위협 모델](https://www.w3.org/TR/secure-contexts/#threat-models)에서 도출되는 설계 제약이다.

NeonUX-LC는 렌더링만 담당한다. 암호 알고리즘, 키 교환, 로그인 우회 코드를 브라우저 런타임에 넣지 않는다.

| 접속 방식 | 공개 열람 | 계정 연결·쓰기 | 신뢰 근거 |
| --- | --- | --- | --- |
| 원격 서버의 일반 HTTP | 가능 | 차단 | 민감한 세션을 생성하거나 사용하지 않음 |
| 브라우저가 인증서를 검증한 HTTPS | 가능 | 가능 | 어댑터가 확인한 TLS 또는 인증된 ingress |
| 같은 기기의 `127.0.0.1` 브리지 | 가능 | 조건부 가능 | 신뢰해 설치한 네이티브 프로세스, 검증된 upstream TLS, 서버의 HMAC 검증 |
| LAN에 설치한 브리지까지 일반 HTTP | 지원하지 않음 | 차단 대상 | 브라우저와 브리지 사이의 원격 구간이 보호되지 않음 |
| `X-Forwarded-Proto: https`만 붙인 HTTP | 가능 | 차단 | 클라이언트가 지정한 헤더는 증거가 아님 |

`RequestContext.secureTransport`는 실제 연결을 수락한 어댑터가 설정한다. `Request.url`의 `https:` 문자열이나 외부에서 받은 forwarded 헤더만 보고 `true`를 넣으면 이 보안 경계가 무너진다. 역방향 프록시를 쓰면 프록시를 인증하고, 외부 헤더를 제거·재설정하고, 애플리케이션 직접 접근을 막는 구성을 먼저 해야 한다.

독립 서버와 Next 예제는 공개 origin에 `ZUKU_PUBLIC_ORIGIN`, HTTPS ingress 인증에 `ZUKU_HTTPS_PROXY_SECRET`을 공통으로 사용한다. ingress는 외부의 `X-Zuku-Ingress-Key`를 제거하고 설정된 값을 덮어써야 한다. 브리지 요청 증명의 `ZUKU_BRIDGE_KEY`와는 역할이 다르며 어느 키도 클라이언트 코드나 `NEXT_PUBLIC_*` 변수에 넣지 않는다.

`http://ie.zuzunza.com`은 TLS를 협상하지 못하는 IE용 공개 열람 origin으로 둘 수 있다. `ZUKU_FORCE_CLASSIC=1`은 화면 선택과 경로만 고정하며 연결을 안전한 것으로 승격하지 않는다. 이 호스트의 로그인·쓰기·세션 발급은 계속 차단된다.

## 로컬 브리지

[`@zuku/legacy-bridge`](../packages/bridge/README.md)는 Node.js 22+ 프로세스다. 브라우저는 정확한 `http://127.0.0.1:<port>/` 주소와 기존 공개 경로로 접속하고, 브리지는 설정한 단일 HTTPS origin으로만 전달한다. 전송을 위한 로컬 origin이며 사용자가 별도 Legacy 경로를 선택하는 방식은 아니다.

- 외부 인터페이스에 바인딩하지 않는다. 요청의 양쪽 socket 주소와 정확한 Host도 검사한다.
- Origin·Referer·Fetch Metadata가 다른 출처를 나타내면 거부한다. IE6처럼 해당 헤더가 없는 경우에는 애플리케이션의 CSRF 검증이 필수다.
- GET·HEAD·URL-encoded POST와 공통 경로 매핑에 등록된 공개 URL·내부 Legacy 경로만 허용한다. CONNECT, WebSocket, 임의 프록시 URL, 경로 이동과 다른 origin의 redirect는 허용하지 않는다.
- 인증서와 호스트 이름을 검증하며 TLS 1.2 이상을 사용한다. 인증서 검증을 끄는 설정은 제공하지 않는다. 사설 CA는 별도의 신뢰된 배포 경로로 설치할 수 있다. [Node HTTPS](https://nodejs.org/api/https.html), [Node TLS](https://nodejs.org/api/tls.html).
- upstream 쿠키는 브라우저별 메모리 cookie jar에 보관한다. 브라우저에는 무작위 `zuku_lc_bridge` 핸들만 `HttpOnly; SameSite=Strict` 쿠키로 전달한다.
- 기본 제한은 요청 64 KiB, 응답 2 MiB, 15초 timeout, 동시 처리 16개, 연결 64개, 브라우저 세션 128개다. 실제 Legacy 양식 한도는 더 작은 16 KiB다.

브리지와 서버에는 최소 32바이트의 같은 무작위 비밀키를 hex로 사전 배포한다. 키를 HTTP 페이지, 주소, 로그 또는 공개 저장소에 넣지 않는다. HMAC-SHA256 증명은 메서드, 정확한 경로와 query, 본문의 SHA-256 해시, timestamp, nonce를 묶는다. timestamp 허용 오차는 ±60초이며 nonce는 한 번만 사용할 수 있다. replay cache가 가득 차면 이전 유효 항목을 지우지 않고 요청을 거부한다. **이 증명은 암호화가 아니다.** 원격 통신의 기밀성은 TLS가 제공한다.

브리지는 신뢰된 소프트웨어 배포 경로에서 설치해야 한다. 변조 가능한 HTTP 페이지가 안내한 실행 파일이나 비밀키를 그대로 신뢰하면 bootstrap 문제가 해결되지 않는다. 같은 기기의 악성코드, 관리자 권한 프로세스, 공유 브라우저 프로필, 오래된 브라우저 자체의 취약점까지 보호하지는 않는다.

Node.js 22는 Windows XP에서 실행되지 않는다. [Node 22의 지원 플랫폼](https://github.com/nodejs/node/blob/v22.x/BUILDING.md#platform-list)에 맞는 호스트가 필요하다. 이 저장소는 XP 네이티브 브리지나 OS 터널을 제공하지 않는다. XP 지원에는 독립적으로 유지보수·검증된 같은 기기용 companion 또는 이미 보호된 마지막 구간이 추가로 필요하다. 브리지를 다른 LAN 기기로 옮기는 것은 해결책이 아니다.

## 기존 계정의 연결

1. 구형 브라우저의 보호된 공개 `/login` 화면에서 만료 5분의 무작위 12자리 hex 코드를 생성한다. 내부 handler는 `/legacy/connect`를 사용한다.
2. 사용자는 이미 로그인한 모던 ZUKU에서 같은 코드를 확인하고 명시적으로 승인한다. 제공된 모던 승인 화면을 기존 AuthVault 흐름에 연결해야 한다.
3. 모던 화면이 같은 origin의 `/legacy/authorize`에 기존 access token과 코드를 보낸다. 서버는 `/api/v1/auth/me`로 사용자를 확인한다. 브리지를 통한 승인 요청은 받지 않는다.
4. Legacy의 ‘승인 완료 확인’ 양식이 세션과 CSRF 토큰을 검증하고 승인 건을 한 번만 소비한다. 성공하면 세션 ID를 새로 발급한다.

비밀번호·패스키·CAPTCHA는 기존 모던 로그인에서 처리한다. Legacy가 CAPTCHA를 우회하거나 별도 비밀번호 로그인을 만드는 기능은 없다. 모던 승인 화면이 설치되지 않은 독립 서버에서는 안내를 보여주며 연결을 완료했다고 가장하지 않는다.

access token은 Legacy 서버의 상태 저장소에만 보관한다. HTML, 브라우저 JavaScript, 브라우저 저장소, Legacy cookie에는 넣지 않는다. 공개 URL을 공유하는 전용 `zuku_lc_session` cookie는 `Path=/`를 사용하지만 기존 모던 인증 cookie를 수정하거나 덮어쓰지 않는다. refresh token은 받거나 저장하지 않으며 자동 갱신하지 않는다. 연결 세션은 최대 15분 후 사용할 수 없고 upstream token이 먼저 만료되면 더 일찍 끝난다. 기본 메모리 저장소는 만료 데이터를 접근·저장 시 정리하므로 정확히 15분 시점의 메모리 소거를 보장하지 않는다. 로그아웃은 Legacy 연결을 지우며 모던 계정 전체의 세션을 취소하는 기능은 아니다.

## 양식·콘텐츠·메시지

모든 Legacy 상태 변경 양식은 세션에 묶인 CSRF 토큰을 원자적으로 소비하고 교체한다. 중복 전송이나 다른 탭의 오래된 양식은 새로 열어야 한다. 브리지 증명이 유효해도 CSRF는 생략하지 않는다. 모던 승인 API는 HTML 양식과 별개로 정확한 Origin, JSON 및 Authorization을 요구한다.

사용자 문자열은 HTML 이스케이프 후 출력한다. 원격 HTML을 그대로 삽입하지 않는다. 기본 응답은 `no-store`, `nosniff`, framing 제한 및 CSP를 제공하지만 IE6가 최신 헤더를 모두 이해한다고 가정하지 않는다. 원격 이미지와 미디어를 자동으로 불러오지 않고 HTTPS 링크로 제공한다. 미디어 링크를 열면 브리지 밖으로 이동하므로 해당 브라우저의 TLS·코덱 지원이 필요하다.

DM은 기존 종단간 암호화 클라이언트로 연결한다. Legacy 서버에서 DM을 복호화하거나 평문 대화 전송 API로 바꾸지 않는다. 패스키, 결제, 업로드, Studio, 관리 작업도 모던 환경에서 계속 처리한다. 실제 제공 범위는 [기능 표](features.md)에 명시한다.

## 배포 경계와 검증

현재 애플리케이션은 **단일 프로세스·단일 worker 운영이 전제**다. 기본 세션·pairing·rate limiter와 애플리케이션 내부 replay cache가 메모리에 있다. `LegacyState` 교체만으로 여러 worker를 안전하게 운영할 수는 없다. 분산 운영에는 승인·CSRF·pair 소비를 원자적으로 수행하는 공유 저장소, 공유 rate limit, 공유 nonce 소비가 모두 필요하다. 현재 `createLegacyApp`은 replay store 주입 API를 제공하지 않는다.

공개 ingress에는 IP·기기별 요청 제한, 연결·본문·timeout 제한을 운영 환경에 맞게 설정해야 한다. 내장 제한은 단일 프로세스의 보조 수단이다. 실제 이용자 주소를 얻기 위해 임의의 `X-Forwarded-For`를 신뢰하지 않는다. 브리지 키의 기기별 발급·회전·폐기와 로그의 token·코드 제거도 운영 구현에 포함해야 한다.

자동 테스트는 HMAC 변조·재사용·만료, Host·Origin 거부, cookie jar 분리, 크기 제한, 실제 임시 CA를 이용한 HTTPS 연결과 신뢰되지 않은 인증서 거부 등을 검증한다. 이는 독립 보안 감사, 실제 IE6 보안 검증, 운영 배포 인증을 대신하지 않는다.

### TLS 연결 이전의 분기

TLS handshake 자체에 실패하면 Next.js는 브라우저 요청을 받지 못하므로 사용자 에이전트 판별도 실행할 수 없다. 공개 읽기를 HTTP로 제공하려는 배포는 ingress의 일괄 HTTPS redirect보다 먼저 구형 브라우저의 허용된 공개 경로를 분기해야 한다. 이 경로에도 인증·API·업로드 예외를 열지 않는다. 현재 독립 서버는 HTTP에서 구형 브라우저의 공개 열람과 계정 작업 차단을 구현하며, 운영 도메인의 nginx/CDN 정책은 이 저장소를 빌드한다고 자동 변경되지 않는다. 브리지를 사용할 때는 브리지가 외부 TLS를 담당한다.
