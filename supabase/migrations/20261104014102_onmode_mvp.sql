-- Protected writes use invoker API wrappers around private transaction functions.
create schema onmode_private;
revoke all on schema onmode_private from public, anon, authenticated;
grant usage on schema onmode_private to authenticated;

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  name text not null default '집중러' check (char_length(btrim(name)) between 1 and 30),
  goal_minutes integer not null default 120 check (goal_minutes between 1 and 1440),
  notifications boolean not null default false
);
create table public.certifications (
  id uuid primary key, user_id uuid not null references auth.users on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  exam_date date not null, result text not null check (result in ('pending','passed','failed')),
  unique (user_id,id)
);
create table public.activities (
  id uuid primary key, user_id uuid not null references auth.users on delete cascade,
  kind text not null check (kind in ('subject','book')),
  name text not null check (char_length(btrim(name)) between 1 and 80), certification_id uuid,
  goal_minutes integer, author text, pages integer, current_page integer, goal_pages integer,
  unique (user_id,id),
  foreign key (user_id,certification_id) references public.certifications(user_id,id) on delete cascade,
  check (case when kind = 'subject' then certification_id is not null and goal_minutes is not null and goal_minutes between 1 and 100000
      and author is null and pages is null and current_page is null and goal_pages is null
    else certification_id is null and goal_minutes is null and author is not null and char_length(btrim(author)) between 1 and 80
      and pages is not null and pages between 1 and 100000 and current_page is not null and current_page between 0 and pages
      and goal_pages is not null and goal_pages between 1 and 100000 end)
);
create index activities_cert_idx on public.activities(user_id,certification_id) where certification_id is not null;
create table public.activity_journal (
  id uuid primary key, user_id uuid not null,
  activity_id uuid not null, logged_on date not null, created_at timestamptz not null default now(),
  note text not null check (char_length(note) <= 2000), amount integer not null check (amount between 0 and 100000),
  foreign key (user_id,activity_id) references public.activities(user_id,id) on delete cascade
);
create index activity_journal_owner_idx on public.activity_journal(user_id,activity_id);
create table public.focus_sessions (
  id uuid primary key, user_id uuid not null references auth.users on delete cascade,
  activity_id uuid, method text not null, target_seconds integer, rest_seconds integer not null,
  started_at timestamptz not null, active_since timestamptz, elapsed_ms integer not null default 0 check (elapsed_ms >= 0),
  ended_at timestamptz, seconds integer check (seconds between 0 and 43200),
  unique(user_id,id),
  foreign key (user_id,activity_id) references public.activities(user_id,id) on delete set null (activity_id),
  check ((ended_at is null and seconds is null) or (ended_at is not null and seconds is not null and active_since is null)),
  check (case method when 'flow' then target_seconds is null and rest_seconds = 0
    when 'pomodoro' then target_seconds is not null and target_seconds = 1500 and rest_seconds = 300
    when 'deep' then target_seconds is not null and target_seconds = 3000 and rest_seconds = 600
    when 'custom' then target_seconds is not null and target_seconds between 60 and 10800 and target_seconds % 60 = 0
      and rest_seconds between 0 and 3600 and rest_seconds % 60 = 0 else false end)
);
create unique index focus_active_one_per_user on public.focus_sessions(user_id) where ended_at is null;
create index focus_completed_owner_time_idx on public.focus_sessions(user_id,ended_at desc) where ended_at is not null;
create index focus_activity_idx on public.focus_sessions(user_id,activity_id) where activity_id is not null;

create table public.items (id text primary key, price integer not null check (price >= 0));
insert into public.items values ('desk',0),('chair',0),('lamp',1),('frame',3),('plant',5),('shelf',10),('laptop',12),('wall',15);
create table public.user_inventory (
  user_id uuid not null references auth.users on delete cascade,
  item_id text not null references public.items, placed boolean not null default false,
  primary key (user_id,item_id)
);
create index inventory_item_idx on public.user_inventory(item_id);
create table public.reward_transactions (
  user_id uuid not null references auth.users on delete cascade, session_id uuid, item_id text,
  coins integer not null, xp integer not null,
  foreign key (user_id,session_id) references public.focus_sessions(user_id,id) on delete cascade,
  foreign key (user_id,item_id) references public.user_inventory(user_id,item_id) on delete cascade,
  unique (user_id,session_id), unique (user_id,item_id),
  check ((session_id is not null and item_id is null and coins > 0 and xp > 0) or
    (session_id is null and item_id is not null and coins <= 0 and xp = 0))
);

create table public.study_groups (
  id uuid primary key default gen_random_uuid(), name text not null check (char_length(btrim(name)) between 1 and 60),
  description text not null check (char_length(description) <= 300), is_public boolean not null,
  invite_code text not null unique default substr(replace(gen_random_uuid()::text,'-',''),1,16),
  goal_minutes integer not null check (goal_minutes between 1 and 1000000)
);
create table public.group_members (
  group_id uuid references public.study_groups on delete cascade, user_id uuid references auth.users on delete cascade,
  role text not null check (role in ('owner','member')), joined_at timestamptz not null default clock_timestamp(),
  primary key (group_id,user_id)
);
create index group_members_user_idx on public.group_members(user_id,group_id);
create unique index group_members_one_owner on public.group_members(group_id) where role = 'owner';
create table public.group_updates (
  group_id uuid primary key references public.study_groups on delete cascade, version bigint not null default 0
);
create table public.group_contributions (
  group_id uuid references public.study_groups on delete cascade,
  session_id uuid references public.focus_sessions on delete cascade,
  ended_at timestamptz not null, seconds integer not null check (seconds between 1 and 43200),
  primary key (group_id,session_id)
);
create index group_contributions_session_idx on public.group_contributions(session_id);
create index group_contributions_time_idx on public.group_contributions(group_id,ended_at);

alter table public.profiles enable row level security;
alter table public.certifications enable row level security;
alter table public.activities enable row level security;
alter table public.activity_journal enable row level security;
alter table public.focus_sessions enable row level security;
alter table public.items enable row level security;
alter table public.user_inventory enable row level security;
alter table public.reward_transactions enable row level security;
alter table public.study_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_updates enable row level security;
alter table public.group_contributions enable row level security;
revoke all on public.profiles,public.certifications,public.activities,public.activity_journal,public.focus_sessions,
  public.items,public.user_inventory,public.reward_transactions,public.study_groups,public.group_members,public.group_updates,public.group_contributions
  from public,anon,authenticated;
grant select on public.profiles,public.certifications,public.activities,public.activity_journal,public.focus_sessions,
  public.user_inventory,public.reward_transactions,public.group_updates to authenticated;
create policy own_profile on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy own_certifications on public.certifications for select to authenticated using (user_id = (select auth.uid()));
create policy own_activities on public.activities for select to authenticated using (user_id = (select auth.uid()));
create policy own_journal on public.activity_journal for select to authenticated using (user_id = (select auth.uid()));
create policy own_focus on public.focus_sessions for select to authenticated using (user_id = (select auth.uid()));
create policy own_inventory on public.user_inventory for select to authenticated using (user_id = (select auth.uid()));
create policy own_rewards on public.reward_transactions for select to authenticated using (user_id = (select auth.uid()));

create function onmode_private.is_member(gid uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select auth.uid() is not null and exists (
  select 1 from public.group_members where group_id = gid and user_id = (select auth.uid())
) $$;
create policy member_group_updates on public.group_updates for select to authenticated using (onmode_private.is_member(group_id));
alter publication supabase_realtime add table public.group_updates;

create function onmode_private.require_user() returns uuid language plpgsql stable set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception '로그인이 필요합니다.' using errcode = '42501'; end if;
  return uid;
end $$;

create function onmode_private.ms(t timestamptz) returns bigint language sql immutable set search_path = ''
as $$ select floor(extract(epoch from t) * 1000)::bigint $$;
create function onmode_private.elapsed(s public.focus_sessions, at_time timestamptz) returns integer language sql immutable set search_path = ''
as $$
select least(coalesce(s.target_seconds,43200) * 1000,
  s.elapsed_ms + case when s.active_since is null then 0
  else greatest(0, onmode_private.ms(at_time) - onmode_private.ms(s.active_since)) end)::integer
$$;

create function onmode_private.snapshot() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := onmode_private.require_user();
begin
  return jsonb_build_object('serverTime',onmode_private.ms(clock_timestamp()),'snapshot',jsonb_build_object(
    'profile',coalesce((select jsonb_build_object('name',name,'goalMinutes',goal_minutes,'notifications',notifications)
      from public.profiles where user_id = uid), '{"name":"집중러","goalMinutes":120,"notifications":false}'::jsonb),
    'certifications',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'examDate',exam_date,'result',result) order by exam_date)
      from public.certifications where user_id = uid),'[]'),
    'activities',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'kind',kind,'name',name,'certificationId',certification_id,
      'goalMinutes',goal_minutes,'author',author,'pages',pages,'currentPage',current_page,'goalPages',goal_pages)) order by name)
      from public.activities where user_id = uid),'[]'),
    'journal',coalesce((select jsonb_agg(jsonb_build_object('id',id,'activityId',activity_id,'date',logged_on,'text',note,'amount',amount) order by created_at)
      from public.activity_journal where user_id = uid),'[]'),
    'timer',(select jsonb_build_object('id',id,'method',method,'activityId',activity_id,'targetSeconds',target_seconds,
      'restSeconds',rest_seconds,'startedAt',onmode_private.ms(started_at),'elapsedMs',elapsed_ms,'activeSince',onmode_private.ms(active_since))
      from public.focus_sessions where user_id = uid and ended_at is null),
    'records',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'method',s.method,'activityId',s.activity_id,
      'seconds',s.seconds,'endedAt',onmode_private.ms(s.ended_at),'xp',coalesce(r.xp,0),'coins',coalesce(r.coins,0)) order by s.ended_at desc)
      from public.focus_sessions s left join public.reward_transactions r on r.user_id = s.user_id and r.session_id = s.id
      where s.user_id = uid and s.ended_at is not null and s.seconds > 0),'[]'),
    'inventory',coalesce((select jsonb_agg(item_id) from public.user_inventory where user_id = uid),'["desk","chair"]'),
    'placed',coalesce((select jsonb_agg(item_id) filter (where placed) from public.user_inventory where user_id = uid),
      case when exists(select 1 from public.user_inventory where user_id = uid) then '[]'::jsonb else '["desk","chair"]'::jsonb end)
  ));
end $$;

create function onmode_private.bump(uid uuid) returns void language plpgsql set search_path = ''
as $$
declare gid uuid;
begin
  for gid in select group_id from public.group_members where user_id = uid order by group_id loop
    update public.group_updates set version = version + 1 where group_id = gid;
  end loop;
end $$;

create function onmode_private.apply_command(command jsonb) returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare uid uuid := onmode_private.require_user();
  op text := command->>'type'; v jsonb := command->'value';
  sid uuid; current_timer public.focus_sessions; a public.activities;
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
      insert into public.activities(id,user_id,kind,name,certification_id,goal_minutes,author,pages,current_page,goal_pages)
      values ((v->>'id')::uuid,uid,v->>'kind',btrim(v->>'name'),(v->>'certificationId')::uuid,(v->>'goalMinutes')::integer,
        btrim(v->>'author'),(v->>'pages')::integer,(v->>'currentPage')::integer,(v->>'goalPages')::integer);
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
        update public.focus_sessions set active_since = null, elapsed_ms = actual_ms, ended_at = at_time, seconds = seconds_done
          where user_id = uid and id = sid;
        if seconds_done > 0 then
          insert into public.group_contributions(group_id,session_id,ended_at,seconds)
            select group_id,sid,at_time,seconds_done from public.group_members where user_id = uid and joined_at <= at_time
            on conflict do nothing;
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

create function onmode_private.group_list() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := onmode_private.require_user();
begin
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',g.id,'name',g.name,'description',g.description,
    'isPublic',g.is_public,'role',m.role,'members',(select count(*) from public.group_members where group_id = g.id),
    'goalMinutes',g.goal_minutes,'inviteCode',case when m.role = 'owner' then g.invite_code end)) || jsonb_build_object('role',m.role) order by g.name)
    from public.study_groups g left join public.group_members m on m.group_id = g.id and m.user_id = uid
    where g.is_public or m.user_id is not null),'[]');
end $$;

create function onmode_private.group_change(action text, payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare uid uuid := onmode_private.require_user();
  g public.study_groups; member_role text; successor uuid;
begin
  if action = 'create' then
    insert into public.study_groups(name,description,is_public,goal_minutes)
      values (btrim(payload->>'name'),coalesce(btrim(payload->>'description'),''),(payload->>'isPublic')::boolean,(payload->>'goalMinutes')::integer)
      returning * into g;
    insert into public.group_members(group_id,user_id,role) values (g.id,uid,'owner');
    insert into public.group_updates(group_id) values (g.id);
    return g.id;
  end if;
  if action = 'invite' then
    select * into g from public.study_groups where invite_code = lower(btrim(payload->>'code')) for update;
  else
    select * into g from public.study_groups where id = (payload->>'id')::uuid for update;
  end if;
  if not found then raise exception '그룹 또는 초대 코드를 확인해 주세요.' using errcode = '42501'; end if;
  select role into member_role from public.group_members where group_id = g.id and user_id = uid;
  if action in ('join','invite') and (g.is_public or action = 'invite') then
    insert into public.group_members(group_id,user_id,role) values (g.id,uid,'member') on conflict do nothing;
  elsif action = 'goal' and member_role = 'owner' then
    update public.study_groups set goal_minutes = (payload->>'goalMinutes')::integer where id = g.id;
  elsif action = 'leave' and member_role is not null then
    delete from public.group_members where group_id = g.id and user_id = uid;
    if member_role = 'owner' then
      select user_id into successor from public.group_members where group_id = g.id order by joined_at,user_id limit 1;
      if successor is null then delete from public.study_groups where id = g.id;
      else update public.group_members set role = 'owner' where group_id = g.id and user_id = successor;
      end if;
    end if;
  else raise exception '이 작업을 할 권한이 없습니다.' using errcode = '42501';
  end if;
  update public.group_updates set version = version + 1 where group_id = g.id;
  return g.id;
end $$;

create function onmode_private.ranking(gid uuid, zone text) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := onmode_private.require_user();
  local_now timestamp := statement_timestamp() at time zone zone;
  day_since timestamptz := date_trunc('day',local_now) at time zone zone;
  day_until timestamptz := (date_trunc('day',local_now) + interval '1 day') at time zone zone;
  week_since timestamptz := date_trunc('week',local_now) at time zone zone;
  week_until timestamptz := (date_trunc('week',local_now) + interval '1 week') at time zone zone;
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 랭킹을 볼 수 있습니다.' using errcode = '42501';
  end if;
  return (select jsonb_build_object('members',coalesce((select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(p.name,'집중러'),'role',m.role,
    'today',coalesce(s.today,0),'week',coalesce(s.week,0),'total',coalesce(s.total,0),'goalMinutes',coalesce(p.goal_minutes,120),
    'focusingUntil',onmode_private.ms(f.active_since + (coalesce(f.target_seconds,43200)*1000 - f.elapsed_ms) * interval '1 millisecond')))
  from public.group_members m
  left join public.profiles p on p.user_id = m.user_id
  left join public.focus_sessions f on f.user_id = m.user_id and f.ended_at is null
  left join lateral (select sum(fs.seconds) filter (where fs.ended_at >= day_since and fs.ended_at < day_until) as today,
    sum(fs.seconds) filter (where fs.ended_at >= week_since and fs.ended_at < week_until) as week,
    sum(fs.seconds) as total from public.focus_sessions fs
    join public.group_contributions c on c.group_id = gid and c.session_id = fs.id
    where fs.user_id = m.user_id and fs.ended_at >= m.joined_at) s on true
  where m.group_id = gid),'[]'), 'total', a.total, 'week', a.week)
  from (select coalesce(sum(seconds),0) as total,
    coalesce(sum(seconds) filter (where ended_at >= week_since and ended_at < week_until),0) as week
    from public.group_contributions where group_id = gid) a);
end $$;

create function public.onmode_snapshot() returns jsonb language sql stable security invoker set search_path = ''
as $$ select onmode_private.snapshot() $$;
create function public.onmode_command(command jsonb) returns jsonb language sql volatile security invoker set search_path = ''
as $$ select onmode_private.apply_command(command) $$;
create function public.onmode_groups() returns jsonb language sql stable security invoker set search_path = ''
as $$ select onmode_private.group_list() $$;
create function public.onmode_group_change(action text,payload jsonb) returns uuid language sql volatile security invoker set search_path = ''
as $$ select onmode_private.group_change(action,payload) $$;
create function public.onmode_ranking(group_id uuid,zone text) returns jsonb language sql stable security invoker set search_path = ''
as $$ select onmode_private.ranking(group_id,zone) $$;
revoke execute on all functions in schema onmode_private from public,anon,authenticated;
grant execute on function onmode_private.is_member(uuid),onmode_private.snapshot(),onmode_private.apply_command(jsonb),
  onmode_private.group_list(),onmode_private.group_change(text,jsonb),onmode_private.ranking(uuid,text) to authenticated;
revoke execute on function public.onmode_snapshot(),public.onmode_command(jsonb),public.onmode_groups(),
  public.onmode_group_change(text,jsonb),public.onmode_ranking(uuid,text) from public,anon,authenticated;
grant execute on function public.onmode_snapshot(),public.onmode_command(jsonb),public.onmode_groups(),
  public.onmode_group_change(text,jsonb),public.onmode_ranking(uuid,text) to authenticated;
