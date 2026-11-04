# ONMODE · 온모드

**집중을 켜다, 성장을 쌓다.** 자격증 공부와 독서 시간을 기록하고, 집중해서 얻은 코인으로 나만의 2D 공부방을 꾸미는 웹 앱입니다.

![온모드 홈 화면](docs/assets/dashboard.png)

## 로컬에서 바로 실행

Node.js **22.22 이상**이 필요합니다. PowerShell에서 스크립트 실행 정책으로 `npm`이 차단되면 `npm.cmd`를 사용하세요.

```bash
npm ci
npm run dev
```

터미널의 로컬 주소(기본 `http://127.0.0.1:5173`)를 여세요. Supabase 설정 없이도 체험 기록이 IndexedDB에 저장됩니다. `localhost`와 `127.0.0.1`은 브라우저 저장 공간이 다르므로 같은 주소를 사용하세요.

1. **학습·독서**에서 자격증과 과목 또는 도서를 등록하고 **집중하기**를 누릅니다.
2. 빠르게 확인하려면 **사용자 지정**에서 1분 집중, 0분 휴식을 설정하고 시작합니다.
3. 1분을 완료하면 5 XP와 1코인이 쌓입니다. **성장**에서 새벽 조명을 구매하고 배치합니다.
4. **홈**과 **MY**에서 오늘의 집중 시간과 기록을 확인한 뒤 새로고침합니다.

## 계정과 스터디 연결

로컬 Docker 환경에서 [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)를 실행합니다. ONMODE는 다른 프로젝트의 기본 포트와 겹치지 않도록 API **56321**, DB **56322**, Mailpit **56324**를 사용합니다.

```bash
npx supabase@3.0.0 start
npx supabase@3.0.0 status
```

`.env.example`을 `.env.local`로 복사하고 API URL과 **Publishable key**를 입력한 다음 Vite를 다시 실행하세요. `sb_secret_…`이나 service_role 키는 입력하지 마세요. 로컬 설정은 테스트를 위해 이메일 확인을 생략합니다. 호스팅 환경에서는 이메일 확인과 리디렉션 URL을 설정하세요. 로컬 체험 기록과 계정 기록은 별도로 보관됩니다.

운영 환경을 연결할 때는 승인된 Supabase 프로젝트에 [마이그레이션](supabase/migrations)과 환경변수를 적용하고, Vercel의 Vite 설정으로 `dist`를 배포할 수 있습니다. SPA 경로는 [vercel.json](vercel.json)에서 처리합니다. 이 저장소에는 원격 프로젝트 주소나 키를 포함하지 않습니다.

## 검증

```bash
npm run lint
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:db
npm run test:connected
```

`test:e2e`는 별도 포트에서 Supabase 없이 데스크톱과 모바일 Chromium을 실행합니다. `test:db`와 `test:connected`는 Docker의 ONMODE 전용 로컬 스택과 56321 API에만 연결하며, 테스트 계정과 그룹을 생성해 확인한 뒤 삭제합니다. 연결 테스트를 재현하려면 로컬 스택과 마이그레이션이 준비되어 있어야 합니다.

## 모바일 확장

[Capacitor](https://capacitorjs.com/docs/getting-started)는 같은 웹 빌드(`dist`)를 사용합니다. 모바일 개발 환경을 준비한 후 동일한 Capacitor 버전의 Android/iOS 패키지를 설치하고 `npx cap add android` 또는 macOS에서 `npx cap add ios`를 실행합니다. 다음부터는 `npm run build`와 `npx cap sync`로 동기화합니다. 네이티브 프로젝트, 알림, 이메일 인증 딥 링크는 후속 작업입니다.

- [아키텍처](docs/ARCHITECTURE.md) · [기능 명세](docs/FEATURES.md) · [데이터베이스](docs/DATABASE.md)
- [로드맵](docs/ROADMAP.md) · [진행 현황과 테스트 결과](docs/PROGRESS.md) · [개발 규칙](AGENTS.md)
