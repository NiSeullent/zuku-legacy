# 호환성과 검증 범위

목표는 IE6–11과 저사양 기기에서도 **기존과 같은 ZUKU URL**로 공개 콘텐츠와 보호된 계정 기능을 이용하는 것이다. Internet Explorer는 클래식 렌더러를 자동 선택하고 나머지 브라우저는 기존 모던 처리에 맡긴다. 전용 `ie.zuzunza.com`에서는 브라우저와 관계없이 Classic 화면을 제공한다. 별도 `/legacy` 진입을 요구하지 않는다.

**현재 릴리스는 초기 구현이다. Server 2003 SP2의 실제 IE6에서 아래 범위를 검증했으며, 모든 IE6 환경의 호환 인증을 뜻하지 않는다.** 브라우저 렌더링 호환성, 네트워크 보안, 미디어 재생은 각각 확인해야 한다.

## 목표와 확인한 증거

| 환경 | 목표 동작 | 현재 확인한 증거 | 남은 확인 |
| --- | --- | --- | --- |
| IE6 / Server 2003 SP2 | HTML 문서·링크·양식, 선택적 VML | 실제 IE 6.0.3790.3959에서 너비 320/480/800/1024px, Largest 320px, 한글 GET 검색, VML 표면·도형 관찰. [원본 결과](ie6-vm.md) | 보호된 로그인·쓰기·쿠키, 별도 서비스 팩, 실제 저사양 하드웨어 |
| IE6 / Windows XP | HTML 문서·링크·양식, 선택적 VML | 배포 JS의 ES3 파싱, 클래식 API stub 테스트 | 실제 VM에서 레이아웃·VML·입력·문자 인코딩·쿠키 확인. XP용 브리지 별도 필요 |
| IE7·IE8 | 같은 문서 구조, 가능한 경우 VML | UA 자동 분기, ES3와 VML fallback 계약 검사 | 해당 브라우저 엔진에서 실측 |
| IE9 | 같은 Classic 문서, canvas → VML → DOM | UA 자동 분기, ES3와 세 렌더러 계약 검사 | 실제 IE9 엔진에서 실측 |
| IE10·IE11 | 같은 Classic 문서 | MSIE와 Trident UA 자동 분기 검사 | 실제 IE10·IE11 엔진에서 실측 |
| canvas를 지원하는 현대 브라우저 | 같은 문서에 소형 canvas 장식 | canvas 선택·실패 fallback·자원 한도 자동 테스트 | OS·브라우저별 시각 및 입력 회귀 검사 |
| canvas·VML을 사용할 수 없는 브라우저 | DOM 문서만으로 읽기·입력 | 렌더러 없음과 초기화 실패에 대한 자동 테스트 | 개별 임베디드 엔진에서 확인 |
| JavaScript 비활성 / 텍스트 모드 | 서버 HTML과 기본 양식 사용 | 실제 IE6의 Active scripting을 Disable로 바꾸고 320px에서 0개 스크립트, 탐색·한글 GET 검색·모드 유지·가로 넘침 없음 확인 | 실제 보조공학 도구 확인 |
| 저해상도·저메모리 기기 | 세로 흐름, 페이지 이동, 자동 재생 없음 | 반복·그래픽 자원 한도와 CSS baseline 검사 | 실제 CPU·RAM·네트워크 조건의 지연·메모리 측정 |
| Node.js 22+ companion | 같은 기기 loopback → 검증된 HTTPS | 실제 임시 CA 기반 통합 테스트 | 각 배포 OS의 설치·업데이트·키 배포 |
| XP에서 companion 실행 | 이 저장소에서는 지원하지 않음 | Node 22 지원 OS 범위와 분리 | 별도 호환 네이티브 구현이 필요 |

ES3 파서는 문법만 검사한다. jsdom·VML stub은 Microsoft의 실제 layout/VML 엔진을 실행하지 않는다. 현대 Chromium에서 통과한 화면 검사 역시 IE6 실행 결과로 표시하지 않는다. 테스트 기록에는 브라우저 전체 버전, OS, 문서 모드, 보안 설정, 메모리, 화면 크기와 사용한 전송 방식을 남긴다.

UA 자동 선택 테스트와 실제 엔진 검증도 다르다. 최신 Chromium의 UA를 IE로 바꾸면 라우팅과 클래식 HTML 응답을 검사할 수 있지만 Microsoft의 렌더링·보안 동작을 실행하는 것은 아니다. UA가 없는 요청, 알 수 없는 브라우저, 최신 Chrome·Safari·Firefox·Edge가 자동으로 클래식 처리되지 않는지도 함께 검사한다. 전용 Classic 호스트의 강제 선택은 서버 설정이며 요청 헤더로 켤 수 없다. 실제 저사양 여부를 UA만으로 측정할 수는 없으며 텍스트 모드가 CPU·RAM 계측을 대신하지 않는다.

## NeonUX-LC의 표현 단계

기본 UI는 서버에서 만든 제목·문단·링크·폼·목록이다. runtime이 상태나 본문을 canvas로 대체하지 않는다. 브라우저에서 React, hydration, 클라이언트 라우터, fetch, JSON 파서, WebCrypto, localStorage, 웹폰트가 필요하지 않다.

1. DOM 문서는 JavaScript가 실행되기 전에 이용할 수 있다.
2. 지원되는 실제 2D context를 만들 수 있으면 작은 canvas 장식을 더한다.
3. canvas가 없으면 IE의 내장 VML 기능을 확인한다. 기능이 없거나 정책으로 막혔으면 DOM을 유지한다.
4. 텍스트·저전력 모드는 그래픽 생성 전부터 향상 기능을 끈다.

VML에는 namespace와 내장 behavior가 필요하며 설치 상태에 따라 사용할 수 없을 수 있다. VML은 IE9부터 deprecated된 역사적 기술이므로 선택적 fallback에만 사용한다. [Microsoft VML Appendix](https://learn.microsoft.com/en-us/windows/win32/vml/web-workshop---how-to-use-vml-on-web-pages----appendix).

NeonUX-LC는 외부 `.htc`, ActiveX 설치, Flash 또는 Silverlight를 내려받지 않는다. canvas·VML 장식은 읽을 내용이나 조작 버튼을 포함하지 않는다. 따라서 그래픽이 없어져도 상태를 설명하는 원래 텍스트가 남는다. IE8 이상에는 응답 헤더와 문서 앞부분의 `X-UA-Compatible: IE=edge`를 보내 가능한 가장 높은 표준 문서 모드를 사용하게 한다.

## 저사양 제한

| 항목 | 구현된 상한·방식 |
| --- | --- |
| 콘텐츠 API 페이지 | 12개 |
| 자동 재생·무한 스크롤·주기 polling | 사용하지 않음 |
| 그래픽 표면 | 페이지당 최대 4개 |
| 표면 크기 | 최대 320 × 160 px |
| 그래픽 명령 | clear 사이 최대 64개 |
| 초기화 DOM 탐색 | 처음 600개 div 이내 |
| Legacy form body | 최대 16 KiB |
| API 응답 | 최대 1 MiB, 기본 8초 timeout |
| 글꼴·필수 원격 이미지 | 시스템 글꼴 사용, 자동 원격 이미지 없음 |
| 기본 레이아웃 | CSS2 계열의 일반 세로 흐름 |

메뉴는 CSS2 float와 clear로 전체 항목 단위로 다음 줄에 배치한다. 알려진 짧은 메뉴 이름은 줄 내부에서 끊지 않으며, 사용자 본문은 긴 단어도 감쌀 수 있게 한다. 폼은 여백을 고려한 유동 폭을 쓰고 IE6의 hasLayout 문제를 해당 컨테이너에서 처리한다. 가로 넘침을 숨기는 방식으로 검사를 통과시키지 않는다. 글자 크기는 상대 단위로 설정해 IE6의 View → Text Size를 따른다.

새 브라우저는 넓은 화면에서 sidebar 배치를 추가로 받는다. 미디어 query를 지원하지 않는 IE6은 줄바꿈 메뉴와 기본 세로 레이아웃을 이용한다. 필수 구조에 flexbox, grid, CSS custom properties를 사용하지 않는다. 원본 NeonUX의 의미 토큰을 빌드 시점에 해석해 실제 색과 값으로 출력한다.

CSS와 JS URL에는 두 파일의 내용에서 계산한 SHA-256을 함께 붙여, 새 배포에서 IE6의 기존 캐시가 이전 스타일을 계속 적용하지 않게 한다.

`?mode=text`는 서버가 JavaScript를 아예 포함하지 않는 화면을 만들며, 내부 이동과 일반 양식에서 모드를 이어간다. runtime 라이브러리의 별도 `low-power` 옵션도 그래픽을 끈다. 두 모드가 코덱, TLS 또는 OS 지원을 추가하는 것은 아니다.

`data-lc-*` 속성은 클래식 DOM의 `getAttribute`로 읽지만 HTML4 DTD에 선언된 속성은 아니다. 현재 출력은 HTML4 문서 구조를 사용하되 엄격한 HTML4 문법 인증을 주장하지 않는다. 엄격한 DTD 검증이 필요한 임베더는 속성을 생략하고 element ID와 명시적 runtime 호출을 사용한다.

## 실제 IE6 릴리스 확인

실제 VM의 공개 HTTP 검증은 [설정·결과·스크린샷](ie6-vm.md)에 기록했다. 여섯 조건에서 공개 경로 자동 선택, 한글 표시와 검색 양식 제출, 메뉴 항목 줄바꿈과 가로 넘침을 확인했다. 스크립트 활성 조건에서는 실제 VML 표면과 도형 노드를 관찰했고, 별도 비활성 조건에서는 텍스트 모드를 검사했다. 모던 본문·캐시 유지와 UA별 자동 선택은 Next 프로덕션 통합 검사로 별도 검증했다.

다음은 아직 실제 IE6 VM에서 검증하지 않은 항목이다. IE6/XP에서 최신 Node companion이 실행된다고 가정하지 않는다.

- 보호된 계정 연결·쿠키·로그아웃, CSRF 만료와 재시도, 한글 textarea와 URL-encoded POST 왕복.
- CSS를 완전히 끈 상태, VML만 차단한 보안 정책과 다른 IE 서비스 팩.
- 키보드만 이용하는 전체 탐색과 실제 보조공학 도구.
- 느린 네트워크·응답 실패·만료 세션에서의 실기기 동작, CPU·RAM 사용량.
- Chromium의 긴 단어·표·글자 크기 회귀 조건 전체를 각각의 역사적 엔진에서 재검증.

영상·음악·게임과 DM의 제약은 [기능 표](features.md), 전송 보안과 XP 경계는 [보안 모델](security.md)을 따른다. IE for Mac, 모든 PDA·콘솔·임베디드 브라우저를 일괄 지원한다고 선언하지 않는다.
