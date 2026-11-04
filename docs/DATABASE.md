# 데이터베이스

Supabase Auth의 `auth.users`가 사용자 ID의 기준입니다. 애플리케이션 테이블은 마이그레이션으로 생성합니다.

| 데이터 | 테이블과 관계 |
| --- | --- |
| 사용자 | `profiles`: 닉네임·일일 목표·알림 설정 |
| 자격증과 공부·독서 | `certifications` → `activities`(과목 또는 도서) → `activity_journal`. 활동 종류별 필드 제약과 소유자 포함 외래키 |
| 집중 | `focus_sessions`: 활동 연결, 시작·활성 구간·누적 시간·종료. 사용자당 미종료 세션 하나 |
| 성장 | `reward_transactions`: 세션 적립과 아이템 지출의 원장. `items` → `user_inventory`: 보유 및 고정 위치 배치. 레벨과 초기 업적은 읽을 때 계산 |
| 그룹 | `study_groups` → `group_members`, `group_updates`, `group_contributions`. 멤버십과 그룹장 제약, Realtime 버전 신호, 세션별 공동 목표 기여 |
| 챌린지 | `study_groups` → `study_challenges`. 공동 목표, 날짜·시간대, 서버가 계산한 기간 경계, 생성·취소 시각 |

모든 공개 테이블에서 RLS를 활성화한다. `authenticated`에 필요한 조회 권한만 명시적으로 부여한다. 개인 자료는 자신의 행만 읽을 수 있고, 그룹 변경 신호는 그룹 멤버만 구독할 수 있다. 그룹장만 비공개 코드 조회와 목표 수정을 할 수 있다. 그룹장이 탈퇴하면 가입 순으로 권한을 이관하고, 마지막 멤버이면 그룹을 삭제한다.

공개 RPC는 invoker 래퍼다. 보호된 쓰기와 집계는 Data API에 노출하지 않는 `onmode_private` 스키마의 함수에서 처리한다. 해당 함수는 `auth.uid()`와 소유권·멤버십을 확인하고 빈 `search_path`를 사용한다. 세션 시작·일시정지·완료는 서버 시각으로만 정산한다. 보상과 구매는 동일 사용자 잠금으로 직렬화하며 세션 ID와 아이템 ID 원장 제약으로 중복 처리를 차단한다.

그룹에 참여 중인 상태에서 완료한 세션을 그룹에 기여분으로 저장한다. 탈퇴해도 그룹 합계는 유지되며, 개인 랭킹은 현재 멤버의 현재 가입 기간만 집계한다. 그룹원에게는 이름·역할·목표·집중 상태와 합계만 공개한다. 개인 세션의 활동명이나 기록은 공개하지 않는다.

계정 삭제는 일반 그룹 탈퇴와 달리 해당 사용자의 세션과 그룹 기여분도 제거한다. RPC는 본인의 활성 세션과 최근 비밀번호 인증을 확인하고, 사용자별 작업과 그룹 변경을 잠금으로 직렬화한다. 공유 그룹의 그룹장을 이관하거나 빈 그룹을 삭제한 뒤 `auth.users`를 삭제하며, 소유한 개인 기록과 로그인 세션은 외래키로 함께 삭제된다. 운영 백업과 서비스 감사 로그의 보관 정책은 별도 출시 준비 항목이다.

챌린지의 생성·취소는 그룹장만 실행할 수 있다. 회원에게 직접 쓰기 권한을 주지 않으며, RLS로 같은 그룹의 멤버에게만 조회를 허용한다. RPC가 활성 계정과 멤버·그룹장 권한을 다시 확인한다. 생성 요청 ID로 재시도를 중복 처리하지 않고, 개인·그룹 잠금 순서를 기존 삭제 절차와 맞춘다. 챌린지 집계는 `group_contributions`와 검증된 집중 세션으로 계산하므로 클라이언트가 진도나 보상을 입력할 수 없다. 기간 경계는 저장한 시간대 기준으로 서버에서 계산하고 종료일 다음 날 0시를 제외 경계로 사용한다. 변경 시 기존 `group_updates` 신호로 멤버 화면을 다시 조회한다.

참고: [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [Data API 기본 노출 정책 변경](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), [클라이언트 API 키](https://supabase.com/docs/guides/getting-started/api-keys).
