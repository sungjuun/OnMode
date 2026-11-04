# 아키텍처

| 계층 | 역할 |
| --- | --- |
| `src/pages`, `src/ui` | React Router 화면, 공통 카드·폼·다이얼로그, 반응형 내비게이션과 2D 공부방 |
| `src/domain` | 타이머, 기간 통계, 경험치, 달성 조건, 알림 인터페이스 |
| `src/state` | Auth 세션 전환, 상태 로딩, 타이머 자동 완료, 탭 간 새로고침, 알림 |
| `src/data` | IndexedDB 저장소 및 Supabase RPC / Realtime 연결 |
| `supabase/migrations` | 관계형 데이터, RLS, 그룹 API, 서버 시각 기반 보상 트랜잭션 |

React + Vite는 웹 SPA를 만들며 Capacitor는 같은 자산을 네이티브 WebView에서 실행한다. 브라우저는 History 경로, 네이티브는 Hash 경로를 사용한다. Tailwind 유틸리티와 CSS 토큰으로 공통 스타일을 유지하고 Lucide와 앱에서 만든 SVG를 사용한다. 한글과 라틴 글꼴은 빌드에 포함해 외부 폰트 서비스가 필요 없다.

## 타이머와 보상

화면의 tick은 그리기 주기일 뿐이다. 경과 시간은 누적 밀리초와 현재 활성 구간의 시작 시각 차이로 계산한다. 리로드와 화면 복귀 시 저장소에서 타이머를 불러온다. 계정 모드는 RPC 서버 시각에 왕복 지연의 절반을 보정하고 브라우저의 단조 시계로 표시 시간을 보간한다. 서버가 시간을 다시 계산하므로 표시 오차는 보상을 변경하지 않는다.

로컬은 하나의 IndexedDB 쓰기 트랜잭션에서 세션과 보상을 함께 저장한다. 계정은 사용자별 프로필 행 잠금, 활성 세션 부분 유니크 인덱스, 원장 제약을 사용한다. 초 단위로 시간을 저장하며 분을 채울 때마다 5 XP와 1코인을 지급한다. 완료 제한을 넘긴 시간과 일시정지 시간은 제외한다. 플로우타임은 방치로 인한 누적을 제한하기 위해 12시간에서 마감된다. 사람이 실제로 공부했는지는 앱에서 판별할 수 없다.

정해진 시간이 다 차면 휴식을 시작한다. 뽀모도로는 같은 날짜에 완주한 네 번째마다 15분을 쉰다. 휴식 상태는 브라우저에 저장되고, 앱이 완전히 닫혀 있으면 다음 실행 때 만료된 집중을 정산한다. 브라우저 알림은 앱이 열린 동안에만 지원한다.

## 저장과 확장

체험과 계정은 별도 기록이다. IndexedDB 쓰기는 탭 간 직렬화되고 BroadcastChannel로 상태를 다시 읽는다. 계정의 개인 기록은 로그인 시 서버에서 읽는다. 인증된 다른 탭 또는 기기의 변경은 화면 복귀 및 주기 조회로 반영한다. 현재는 작은 개인 기록을 스냅숏으로 읽으며 사용량이 늘면 기간별 페이지 조회로 나눈다.

스터디는 변경 신호만 Realtime으로 보낸다. 랭킹은 멤버 권한을 다시 확인하는 RPC로 읽는다. 연결이 끊기면 20초마다 재조회한다. 원격 메시지, 클라이언트 시간, 클라이언트 보상 값을 인증 판단에 쓰지 않는다.

웹 비밀번호 재설정은 앱 로그인과 분리한 [Supabase Auth PKCE 흐름](https://supabase.com/docs/reference/javascript/auth-resetpasswordforemail)을 사용한다. 재설정 요청 브라우저에는 교환에 필요한 검증값만 저장한다. 콜백의 일회용 코드는 즉시 주소에서 지우고, 교환한 세션은 비밀번호 변경 화면의 메모리에만 둔다. 변경 성공 또는 화면을 벗어날 때 그 세션을 종료한다. 네이티브 앱용 복구 딥 링크는 모바일 베타에서 다룬다.

계정 삭제는 독립된 메모리 클라이언트에서 현재 비밀번호로 로그인한 뒤 호출한다. 서버는 JWT의 사용자가 소유한 활성 [Auth 세션](https://supabase.com/docs/guides/auth/sessions), 최근 비밀번호 인증, 확인 문구를 검사한다. 계정 삭제와 그룹 이관은 하나의 트랜잭션에서 처리되며, 삭제한 세션의 기존 JWT로는 앱 RPC를 다시 호출할 수 없다.

화면 테마는 계정 데이터와 분리한 기기 설정이다. 브라우저가 화면을 그리기 전에 저장한 선택 또는 시스템 테마를 적용한다. 공통 CSS 색상 토큰으로 화면, 입력창, 차트, 공부방 색을 바꾸며 시스템 설정 변경도 즉시 반영한다.

공식 참고: [Vite](https://vite.dev/guide/), [Tailwind Vite 연동](https://tailwindcss.com/docs/installation/using-vite), [React Router](https://reactrouter.com/start/declarative/installation), [Supabase API 권한](https://supabase.com/docs/guides/api/securing-your-api), [Realtime Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes).
