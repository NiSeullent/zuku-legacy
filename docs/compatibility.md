# 호환성과 검증 범위

목표는 IE6급 브라우저와 저사양 기기에서도 **기존과 같은 ZUKU URL**로 공개 콘텐츠와 보호된 계정 기능을 이용하는 것이다. 확인된 구형 User-Agent에는 클래식 렌더러를 자동 선택하고 나머지 브라우저는 기존 모던 처리에 맡긴다. 별도 `/legacy` 진입을 요구하지 않는다.

**현재 릴리스는 IE6을 목표로 한 초기 구현이며, 실제 IE6 호환 인증을 마친 제품은 아니다.** 브라우저 렌더링 호환성, 네트워크 보안, 미디어 재생은 각각 확인해야 한다.

## 목표와 확인한 증거

| 환경 | 목표 동작 | 현재 확인한 증거 | 남은 확인 |
| --- | --- | --- | --- |
| IE6 / Windows XP | HTML 문서·링크·양식, 선택적 VML | 배포 JS의 ES3 파싱, 클래식 API stub 테스트 | 실제 VM에서 레이아웃·VML·입력·문자 인코딩·쿠키 확인. XP용 브리지 별도 필요 |
| IE7·IE8 | 같은 문서 구조, 가능한 경우 VML | 동일한 ES3 및 fallback 테스트 | 해당 브라우저 엔진에서 실측 |
| canvas를 지원하는 현대 브라우저 | 같은 문서에 소형 canvas 장식 | canvas 선택·실패 fallback·자원 한도 자동 테스트 | OS·브라우저별 시각 및 입력 회귀 검사 |
| canvas·VML을 사용할 수 없는 브라우저 | DOM 문서만으로 읽기·입력 | 렌더러 없음과 초기화 실패에 대한 자동 테스트 | 개별 임베디드 엔진에서 확인 |
| JavaScript 비활성 / 텍스트 모드 | 서버 HTML과 기본 양식 사용 | 텍스트 유지, 효과 비활성화, 서버 텍스트 모드 구현 | 실제 기기 및 보조공학 도구 확인 |
| 저해상도·저메모리 기기 | 세로 흐름, 페이지 이동, 자동 재생 없음 | 반복·그래픽 자원 한도와 CSS baseline 검사 | 실제 CPU·RAM·네트워크 조건의 지연·메모리 측정 |
| Node.js 22+ companion | 같은 기기 loopback → 검증된 HTTPS | 실제 임시 CA 기반 통합 테스트 | 각 배포 OS의 설치·업데이트·키 배포 |
| XP에서 companion 실행 | 이 저장소에서는 지원하지 않음 | Node 22 지원 OS 범위와 분리 | 별도 호환 네이티브 구현이 필요 |

ES3 파서는 문법만 검사한다. jsdom·VML stub은 Microsoft의 실제 layout/VML 엔진을 실행하지 않는다. 현대 Chromium에서 통과한 화면 검사 역시 IE6 실행 결과로 표시하지 않는다. 테스트 기록에는 브라우저 전체 버전, OS, 문서 모드, 보안 설정, 메모리, 화면 크기와 사용한 전송 방식을 남긴다.

UA 자동 선택 테스트와 실제 엔진 검증도 다르다. 최신 Chromium의 UA를 IE6으로 바꾸면 라우팅과 클래식 HTML 응답을 검사할 수 있지만 IE6의 렌더링·보안 동작을 실행하는 것은 아니다. UA가 없는 요청, 알 수 없는 브라우저, 최신 Chrome·Safari·Firefox·Edge가 자동으로 클래식 처리되지 않는지도 함께 검사한다. 실제 저사양 여부를 UA만으로 측정할 수는 없으며 텍스트 모드가 CPU·RAM 계측을 대신하지 않는다.

## NeonUX-LC의 표현 단계

기본 UI는 서버에서 만든 제목·문단·링크·폼·목록이다. runtime이 상태나 본문을 canvas로 대체하지 않는다. 브라우저에서 React, hydration, 클라이언트 라우터, fetch, JSON 파서, WebCrypto, localStorage, 웹폰트가 필요하지 않다.

1. DOM 문서는 JavaScript가 실행되기 전에 이용할 수 있다.
2. 지원되는 실제 2D context를 만들 수 있으면 작은 canvas 장식을 더한다.
3. canvas가 없으면 IE의 내장 VML 기능을 확인한다. 기능이 없거나 정책으로 막혔으면 DOM을 유지한다.
4. 텍스트·저전력 모드는 그래픽 생성 전부터 향상 기능을 끈다.

VML에는 namespace와 내장 behavior가 필요하며 설치 상태에 따라 사용할 수 없을 수 있다. VML은 IE9부터 deprecated된 역사적 기술이므로 선택적 fallback에만 사용한다. [Microsoft VML Appendix](https://learn.microsoft.com/en-us/windows/win32/vml/web-workshop---how-to-use-vml-on-web-pages----appendix).

NeonUX-LC는 외부 `.htc`, ActiveX 설치, Flash 또는 Silverlight를 내려받지 않는다. canvas·VML 장식은 읽을 내용이나 조작 버튼을 포함하지 않는다. 따라서 그래픽이 없어져도 상태를 설명하는 원래 텍스트가 남는다.

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

새 브라우저는 넓은 화면에서 sidebar 배치를 추가로 받는다. 미디어 query를 지원하지 않는 IE6은 기본 세로 레이아웃을 이용한다. 필수 구조에 flexbox, grid, CSS custom properties를 사용하지 않는다. 원본 NeonUX의 의미 토큰을 빌드 시점에 해석해 실제 색과 값으로 출력한다.

`?mode=text`는 서버가 JavaScript를 아예 포함하지 않는 화면을 만들며, 내부 이동과 일반 양식에서 모드를 이어간다. runtime 라이브러리의 별도 `low-power` 옵션도 그래픽을 끈다. 두 모드가 코덱, TLS 또는 OS 지원을 추가하는 것은 아니다.

`data-lc-*` 속성은 클래식 DOM의 `getAttribute`로 읽지만 HTML4 DTD에 선언된 속성은 아니다. 현재 출력은 HTML4 문서 구조를 사용하되 엄격한 HTML4 문법 인증을 주장하지 않는다. 엄격한 DTD 검증이 필요한 임베더는 속성을 생략하고 element ID와 명시적 runtime 호출을 사용한다.

## 실제 IE6 릴리스 확인

실제 VM에서 공개 HTTP 열람과 보호된 연결을 분리해 점검한다. IE6/XP에서 최신 Node companion이 실행된다고 가정하지 않는다. 다음 항목은 실제 VM 검증 완료 전까지 미검증으로 남는다.

- 한국어 제목·본문·검색·textarea 입력과 URL-encoded POST 왕복.
- 기존 공개 `/`, `/community`, `/login`에서 자동 선택되며 주소창에 `/legacy` 이동을 요구하지 않는지 확인.
- 같은 URL에 모던 UA로 접속했을 때 기존 앱과 라우팅이 유지되고 캐시가 두 화면을 섞지 않는지 확인.
- 페이지 이동, CSRF 만료 후 재시도, 연결 코드 확인, 로그아웃과 쿠키 정책.
- 320px 및 800px 화면, 긴 URL·긴 제목, 시스템 글꼴과 확대 설정.
- JavaScript 꺼짐, CSS 꺼짐, VML 꺼짐, 텍스트 모드와 정상 fallback.
- 키보드만 이용하는 탐색, 포커스, label, 본문 바로가기, 실제 보조공학 도구.
- 느린 네트워크·응답 실패·만료 세션에서의 오류 안내와 재접속.

영상·음악·게임과 DM의 제약은 [기능 표](features.md), 전송 보안과 XP 경계는 [보안 모델](security.md)을 따른다. IE for Mac, 모든 PDA·콘솔·임베디드 브라우저를 일괄 지원한다고 선언하지 않는다.
