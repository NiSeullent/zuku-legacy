# 실제 IE6 VM 검증 기록

2026-09-08 UTC 기준, Microsoft 공식 평가판 설치 이미지로 새 VM을 만들고 Windows Setup 부팅과 빈 디스크의 포맷·설치 진행을 확인했다. **IE6 실행 및 ZUKU 화면 검증은 아직 대기 중이다.** 이 기록을 호환성 검증 통과로 해석하지 않는다.

검증 대상은 Windows Server 2003 계열에 포함된 실제 IE6이다. Windows XP, 다른 IE6 서비스 팩, 실제 구형 하드웨어는 이 VM의 결과만으로 검증되지 않는다. 전체 지원 범위와 별도 출시 조건은 [호환성 문서](compatibility.md)를 따른다.

## 설치 이미지와 브라우저 근거

설치 이미지는 [Microsoft 공식 CDN의 X13-04874.img](https://download.microsoft.com/download/5/1/C/51C53A00-7F8B-423C-A841-8B9C49B910BF/X13-04874.img)이며, Windows Server 2003 R2 Standard Edition with Service Pack 2 평가판의 x86 설치 CD1이다. 2026-09-08에 HTTPS 다운로드 응답과 실제 파일을 확인했다.

| 항목 | 확인값 |
| --- | --- |
| 파일 크기 | 623,075,328바이트 |
| ISO9660 볼륨 이름 | `CRMSEVL_EN` |
| SHA-256 | `5d3e3b4e4f46067032f4b61cccc9472e8eaed88490cb3f9800fc9a32f530e409` |
| 설치 매체의 `iexplore.exe` | PE FileVersion `6.0.3790.3959` |
| 설치 매체의 `mshtml.dll` | PE FileVersion `6.0.3790.3959` |
| 설치 매체의 `shdocvw.dll` | PE FileVersion `6.0.3790.3959` |

브라우저 버전은 ISO9660 디렉터리에서 `I386/IEXPLORE.EX_`, `I386/MSHTML.DL_`, `I386/SHDOCVW.DL_`를 읽고 압축 해제한 뒤 PE 버전 정보를 확인한 값이다. 다운로드 파일의 SHA-256은 로컬 계산값이며, Microsoft가 따로 게시한 서명이나 체크섬과 대조했다는 뜻은 아니다. 설치 후에는 브라우저의 버전 화면과 실행 중인 파일 버전도 별도로 확인해야 한다.

## 평가판 설치 조건

해당 설치 이미지 내부의 `I386/EULA.TXT`는 내부 평가 용도, 설치 후 180일의 평가 기간, 설치 과정에서 안내하는 정품 인증 절차를 명시한다. `SETUPSTANDARD.HTM`은 인증 전 유예 기간과 기간 종료 후 로그인 제한을 설명하며, 30일을 일반적인 유예 기간으로 든다. **이 설치의 실제 유예 기간과 인증 상태는 설치 후 화면에서 확인할 항목이다.** 정상 설치가 허용하는 기간 안에서 검증하며, 날짜 변경이나 인증 우회로 기간을 연장하지 않는다.

이 조건은 사전 설치된 [Windows Server 2003 R2 Enterprise VHD 평가판](https://www.microsoft.com/en-ie/download/details.aspx?id=19727)의 조건과 다르다. 그 VHD에는 별도의 사용 기간과 인증 금지 조항이 포함되어 있어, 이 검증에서는 공식 설치 CD로 빈 디스크에 새로 설치한다. 운영체제 파일, 가상 디스크, 제품 키, 비밀번호는 이 저장소에 포함하지 않는다.

## VM과 테스트 연결

| 항목 | 구성 |
| --- | --- |
| 가상화 | QEMU 10.1, KVM |
| 머신 | `pc-i440fx` |
| CPU / 메모리 | 1 vCPU / 1,024 MiB |
| 디스크 | 새 12 GiB `qcow2` 디스크 |
| 시계 | 호스트의 현재 UTC 시각, 과거 날짜로 변경하지 않음 |
| 가상 NIC | `rtl8139` |
| 네트워크 | QEMU user networking, `restrict=on` |
| 명시적 게스트 연결 | `10.0.2.100:80` → 호스트 `127.0.0.1:18787` |
| 테스트 서버 | [fixture-server.mjs](../scripts/vm/fixture-server.mjs) |
| 콘솔 제어 | [QMP 도구 안내](../scripts/vm/README.md) |

테스트 서버는 호스트의 루프백 주소에만 바인딩하고, 정해진 테스트 데이터로 응답한다. 실제 ZUKU API나 운영 계정에 연결하지 않는다. VM의 일반 외부 연결은 제한하고 위 게스트 전달 경로만 테스트에 사용한다.

빌드 후 저장소 루트에서 테스트 서버를 실행한다.

```sh
node scripts/vm/fixture-server.mjs
```

게스트 IE6에서는 `http://10.0.2.100/`를 연다. `/`, `/community` 등 같은 공개 경로에서 구형 브라우저 감지와 Classic 화면 선택을 확인하며, `/legacy` 직접 진입을 사용자 동선으로 사용하지 않는다. QMP 안내의 입력 예제를 사용할 때에도 이 VM의 주소를 입력한다.

이 HTTP 연결은 격리된 VM의 익명·읽기 전용 화면 검증용이다. 실제 사용자 로그인이나 통신 보안 검증을 대신하지 않는다. Server 2003의 Internet Explorer Enhanced Security Configuration이 적용될 수 있으므로, 테스트 시 적용된 보안 영역과 스크립트 설정을 결과에 함께 기록한다.

## 현재 진행과 남은 확인

| 확인 항목 | 상태 |
| --- | --- |
| 공식 설치 이미지 다운로드와 SHA-256 계산 | 완료 |
| 매체 안의 IE6 바이너리 버전 확인 | 완료 |
| 현재 시각에서 Windows Setup 부팅 | 완료 |
| 새 디스크에 Windows 설치 | 진행 중 |
| 설치된 운영체제·브라우저 버전 화면 확보 | 대기 |
| 공개 경로의 자동 Classic 선택과 탐색 | 대기 |
| CSS, 한글 표시, 폼, 키보드 접근성 | 대기 |
| NeonUX-LC 실행, VML 또는 DOM 대체 렌더링 | 대기 |
| JavaScript를 끈 상태의 탐색과 읽기 | 대기 |

검증 결과에는 실제 게스트 화면, 브라우저 버전, 테스트 URL, 스크립트·보안 영역 설정, 기대 동작과 관찰 결과를 남긴다. Chromium에서 IE6 User-Agent를 지정한 결과와 ES3 구문 검사는 별도 근거이며, 이 표의 실제 IE6 항목을 완료 처리하는 근거로 사용하지 않는다.
