create table onmode_private.group_achievement_rules (
  id text primary key,
  title text not null,
  description text not null,
  metric text not null check (metric in ('seconds','sessions','contributors')),
  target integer not null check (target > 0),
  position integer not null unique
);
insert into onmode_private.group_achievement_rules values
  ('first_focus','함께하는 첫 집중','그룹에 1분 이상 완료한 집중 기록 남기기','sessions',1,1),
  ('focus_hour','한 시간의 힘','완료한 집중 시간을 함께 1시간 쌓기','seconds',3600,2),
  ('focus_ten_hours','열 시간의 몰입','완료한 집중 시간을 함께 10시간 쌓기','seconds',36000,3),
  ('ten_sessions','열 번의 약속','1분 이상 집중을 함께 10회 완료하기','sessions',10,4),
  ('hundred_sessions','백 번의 꾸준함','1분 이상 집중을 함께 100회 완료하기','sessions',100,5),
  ('three_contributors','함께하는 세 사람','서로 다른 3명이 1분 이상 집중 완료하기','contributors',3,6);
revoke all on onmode_private.group_achievement_rules from public,anon,authenticated;

-- Historical group trophies contain no personal IDs, notes or source session IDs.
create table public.group_achievements (
  group_id uuid not null references public.study_groups on delete cascade,
  achievement_id text not null references onmode_private.group_achievement_rules,
  earned_at timestamptz not null default clock_timestamp(),
  primary key (group_id,achievement_id)
);
create index group_achievements_rule_idx on public.group_achievements(achievement_id);
alter table public.group_achievements enable row level security;
revoke all on public.group_achievements from public,anon,authenticated;
grant select on public.group_achievements to authenticated;
create policy members_read_group_achievements on public.group_achievements for select to authenticated
  using (onmode_private.is_member(group_id));

create function onmode_private.group_achievement_totals(gid uuid)
returns table(seconds bigint,sessions bigint,contributors bigint)
language sql stable set search_path = '' as $$
  select coalesce(sum(c.seconds),0)::bigint,count(*),count(distinct f.user_id)
  from public.group_contributions c join public.focus_sessions f on f.id = c.session_id
  where c.group_id = gid and c.seconds >= 60 and f.ended_at is not null
    and f.seconds = c.seconds and f.ended_at = c.ended_at
$$;

-- The focus transaction holds all affected groups in UUID order before calling.
create function onmode_private.award_group_achievements(gid uuid) returns void
language sql volatile set search_path = '' as $$
  insert into public.group_achievements(group_id,achievement_id)
  select gid,r.id from onmode_private.group_achievement_rules r
  cross join onmode_private.group_achievement_totals(gid) t
  where (case r.metric when 'seconds' then t.seconds when 'sessions' then t.sessions else t.contributors end) >= r.target
  on conflict(group_id,achievement_id) do nothing
$$;

create function onmode_private.group_achievement_list(gid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 그룹 업적을 볼 수 있습니다.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'title',r.title,'description',r.description,
    'metric',r.metric,'target',r.target,'value',case r.metric when 'seconds' then t.seconds when 'sessions' then t.sessions else t.contributors end,
    'earnedAt',a.earned_at) order by r.position)
    from onmode_private.group_achievement_rules r cross join onmode_private.group_achievement_totals(gid) t
    left join public.group_achievements a on a.group_id = gid and a.achievement_id = r.id),'[]'::jsonb);
end $$;
create function public.onmode_group_achievements(group_id uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$ select onmode_private.group_achievement_list(group_id) $$;
revoke execute on function onmode_private.group_achievement_totals(uuid),onmode_private.award_group_achievements(uuid),
  onmode_private.group_achievement_list(uuid),public.onmode_group_achievements(uuid) from public,anon,authenticated;
grant execute on function onmode_private.group_achievement_list(uuid),public.onmode_group_achievements(uuid) to authenticated;

-- Existing cloud group records are checked at installation. The confirmation
-- timestamp is now, not an invented historical achievement date.
do $$ declare gid uuid;
begin
  for gid in select id from public.study_groups order by id for no key update loop
    perform onmode_private.award_group_achievements(gid);
  end loop;
end $$;

-- Preserve existing ISBN, personal-study, timer and reward command behavior.
create or replace function onmode_private.apply_command(command jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare uid uuid := onmode_private.require_user();
  op text := command->>'type'; v jsonb := command->'value';
  sid uuid; gid uuid; current_timer public.focus_sessions; a public.activities;
  at_time timestamptz; actual_ms integer; seconds_done integer; earned integer; price_to_pay integer;
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  at_time := clock_timestamp();
  case op
    when 'profile' then
      update public.profiles set name = btrim(v->>'name'), goal_minutes = (v->>'goalMinutes')::integer,
        notifications = (v->>'notifications')::boolean where user_id = uid;
      perform onmode_private.bump(uid);
    when 'certification' then
      insert into public.certifications as c(id,user_id,name,exam_date,result)
      values ((v->>'id')::uuid,uid,btrim(v->>'name'),(v->>'examDate')::date,v->>'result')
      on conflict(id) do update set name = excluded.name, exam_date = excluded.exam_date, result = excluded.result
      where c.user_id = uid;
      if not found then raise exception '접근할 수 없는 자격증입니다.' using errcode = '42501'; end if;
    when 'activity' then
      if v->>'isbn' is not null then
        if v->>'kind' is distinct from 'book' or not onmode_private.valid_isbn13(v->>'isbn') then
          raise exception '올바른 ISBN 13자리를 입력해 주세요.' using errcode = '22023';
        end if;
        if exists(select 1 from public.activities where user_id = uid and isbn = v->>'isbn') then
          raise exception '이미 서재에 등록한 ISBN입니다.' using errcode = '23505';
        end if;
      end if;
      insert into public.activities(id,user_id,kind,name,certification_id,goal_minutes,author,pages,current_page,goal_pages,isbn)
      values ((v->>'id')::uuid,uid,v->>'kind',btrim(v->>'name'),(v->>'certificationId')::uuid,(v->>'goalMinutes')::integer,
        btrim(v->>'author'),(v->>'pages')::integer,(v->>'currentPage')::integer,(v->>'goalPages')::integer,v->>'isbn');
    when 'journal' then
      select * into a from public.activities where user_id = uid and id = (v->>'activityId')::uuid;
      if not found then raise exception '활동을 찾을 수 없습니다.' using errcode = '42501'; end if;
      insert into public.activity_journal(id,user_id,activity_id,logged_on,note,amount)
        values ((v->>'id')::uuid,uid,a.id,(v->>'date')::date,v->>'text',(v->>'amount')::integer)
        on conflict(id) do nothing;
      if found and a.kind = 'book' then
        update public.activities set current_page = (v->>'amount')::integer where user_id = uid and id = a.id;
      end if;
    when 'start' then
      sid := (v->>'id')::uuid;
      if exists (select 1 from public.focus_sessions where user_id = uid and id = sid) then
        return onmode_private.snapshot();
      end if;
      if exists (select 1 from public.focus_sessions where user_id = uid and ended_at is null) then
        raise exception '이미 진행 중인 집중이 있습니다.' using errcode = '23505';
      end if;
      insert into public.focus_sessions(id,user_id,activity_id,method,target_seconds,rest_seconds,started_at,active_since)
      values (sid,uid,(v->>'activityId')::uuid,v->>'method',(v->>'targetSeconds')::integer,(v->>'restSeconds')::integer,at_time,at_time);
      perform onmode_private.bump(uid);
    when 'pause', 'resume', 'finish' then
      sid := (command->>'id')::uuid;
      select * into current_timer from public.focus_sessions where user_id = uid and id = sid and ended_at is null;
      if not found then return onmode_private.snapshot(); end if;
      actual_ms := onmode_private.elapsed(current_timer,at_time);
      if op = 'finish' then
        seconds_done := actual_ms / 1000;
        earned := seconds_done / 60;
        if current_timer.active_since is not null and actual_ms = coalesce(current_timer.target_seconds,43200)*1000 then
          at_time := current_timer.active_since + (actual_ms - current_timer.elapsed_ms) * interval '1 millisecond';
        end if;
        -- Stable ordering also matches account deletion; concurrent completions
        -- across overlapping groups cannot acquire these locks in reverse order.
        perform 1 from public.study_groups g join public.group_members m on m.group_id = g.id
          where m.user_id = uid and m.joined_at <= at_time order by g.id for no key update of g;
        update public.focus_sessions set active_since = null, elapsed_ms = actual_ms, ended_at = at_time, seconds = seconds_done
          where user_id = uid and id = sid;
        if seconds_done > 0 then
          insert into public.group_contributions(group_id,session_id,ended_at,seconds)
            select group_id,sid,at_time,seconds_done from public.group_members where user_id = uid and joined_at <= at_time order by group_id
            on conflict do nothing;
        end if;
        if seconds_done >= 60 then
          for gid in select group_id from public.group_members where user_id = uid and joined_at <= at_time order by group_id loop
            perform onmode_private.award_group_achievements(gid);
          end loop;
        end if;
        if earned > 0 then
          insert into public.reward_transactions(user_id,session_id,coins,xp) values (uid,sid,earned,earned*5)
          on conflict(user_id,session_id) do nothing;
        end if;
      elsif actual_ms < coalesce(current_timer.target_seconds,43200)*1000 then
        if op = 'pause' and current_timer.active_since is not null then
          update public.focus_sessions set active_since = null, elapsed_ms = actual_ms where user_id = uid and id = sid;
        elsif op = 'resume' and current_timer.active_since is null then
          update public.focus_sessions set active_since = at_time where user_id = uid and id = sid;
        else return onmode_private.snapshot();
        end if;
      else return onmode_private.snapshot();
      end if;
      perform onmode_private.bump(uid);
    when 'buy', 'place' then
      insert into public.user_inventory(user_id,item_id,placed) values (uid,'desk',true),(uid,'chair',true)
        on conflict do nothing;
      if op = 'buy' then
        select price into price_to_pay from public.items where id = command->>'id';
        if not found then raise exception '아이템을 찾을 수 없습니다.'; end if;
        if exists (select 1 from public.user_inventory where user_id = uid and item_id = command->>'id') then
          return onmode_private.snapshot();
        end if;
        if (select coalesce(sum(coins),0) from public.reward_transactions where user_id = uid) < price_to_pay then
          raise exception '코인이 부족합니다.';
        end if;
        insert into public.user_inventory(user_id,item_id) values (uid,command->>'id');
        insert into public.reward_transactions(user_id,item_id,coins,xp) values (uid,command->>'id',-price_to_pay,0);
      else
        update public.user_inventory set placed = (command->>'placed')::boolean where user_id = uid and item_id = command->>'id';
        if not found then raise exception '보유하지 않은 아이템입니다.'; end if;
      end if;
    else raise exception '지원하지 않는 요청입니다.';
  end case;
  return onmode_private.snapshot();
end $$;
