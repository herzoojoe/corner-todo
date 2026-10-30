# 📋 Corner Todo

PC 모니터 오른쪽 위에 띄워 두고, 갤럭시 폰에서도 함께 쓰는 개인용 할 일 관리 웹 앱 (v2.0).

- 앱 주소: https://herzoojoe.github.io/corner-todo/
- 폰: 크롬 ⋮ → 홈 화면에 추가 → 설치
- PC: 바탕화면 바로 가기 → `open-todo.ps1` (오른쪽 위 400×780 창)
- 설계도: [PRD.md](PRD.md) (v2) · [PRD-v1.md](PRD-v1.md)

## 구성
| 부분 | 사용 기술 |
|---|---|
| 화면 | HTML + CSS + 순수 JavaScript (빌드 도구 없음) |
| 저장·연동 | Firebase Firestore (실시간 구독, 기기 임시 보관함) |
| 로그인 | Firebase Authentication (Google) |
| 주소 | GitHub Pages |
| 앱 설치 | manifest.json + 서비스 워커(sw.js) |

`firebase-config.js`의 값은 프로젝트 이름표라 공개해도 괜찮습니다. 데이터는 Firestore 보안 규칙으로 본인 계정만 읽고 쓸 수 있습니다.
