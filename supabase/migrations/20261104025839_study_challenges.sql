create table public.study_challenges (
  id uuid primary key,
  group_id uuid not null references public.study_groups on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 60),
  target_minutes integer not null check (target_minutes between 1 and 1000000),
  start_date date not null,
  end_date date not null check (end_date >= start_date and end_date - start_date <= 89),
  time_zone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz
);
create index study_challenges_group_time_idx on public.study_challenges(group_id,created_at desc);
alter table public.study_challenges enable row level security;
revoke all on public.study_challenges from public,anon,authenticated;
grant select on public.study_challenges to authenticated;
create policy members_read_challenges on public.study_challenges for select to authenticated
  using (onmode_private.is_member(group_id));

create function onmode_private.challenge_list(gid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 챌린지를 볼 수 있습니다.' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(result.value order by result.created_at desc, result.id) from (
    select c.created_at,c.id,jsonb_build_object(
      'id',c.id,'title',c.title,'targetMinutes',c.target_minutes,'startDate',c.start_date,'endDate',c.end_date,
      'timeZone',c.time_zone,'totalSeconds',t.seconds,
      'status',case when c.cancelled_at is not null then 'cancelled'
        when statement_timestamp() < c.starts_at then 'scheduled'
        when t.seconds >= c.target_minutes::bigint * 60 then 'achieved'
        when statement_timestamp() >= c.ends_at then 'ended' else 'active' end,
      'canCancel',c.cancelled_at is null and statement_timestamp() < c.ends_at,
      'members',coalesce((
        select jsonb_agg(jsonb_build_object('id',m.user_id,'name',coalesce(p.name,'집중러'),'seconds',v.seconds)
          order by v.seconds desc,m.joined_at,m.user_id)
        from public.group_members m left join public.profiles p on p.user_id = m.user_id
        left join lateral (
          select coalesce(sum(f.seconds),0) as seconds
          from public.group_contributions gc join public.focus_sessions f on f.id = gc.session_id
          where gc.group_id = gid and f.user_id = m.user_id
            and gc.ended_at >= greatest(c.starts_at,c.created_at,m.joined_at)
            and gc.ended_at < least(c.ends_at,coalesce(c.cancelled_at,c.ends_at))
            and f.started_at >= greatest(c.starts_at,c.created_at,m.joined_at)
        ) v on true
        where m.group_id = gid
      ),'[]'::jsonb)
    ) as value
    from public.study_challenges c left join lateral (
      select coalesce(sum(f.seconds),0) as seconds
      from public.group_contributions gc join public.focus_sessions f on f.id = gc.session_id
      where gc.group_id = gid and f.started_at >= greatest(c.starts_at,c.created_at)
        and gc.ended_at >= greatest(c.starts_at,c.created_at)
        and gc.ended_at < least(c.ends_at,coalesce(c.cancelled_at,c.ends_at))
    ) t on true where c.group_id = gid
  ) result),'[]'::jsonb);
end $$;

create function onmode_private.challenge_change(gid uuid, action text, payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  cid uuid := (payload->>'id')::uuid;
  first_day date; last_day date; zone text := payload->>'timeZone';
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform 1 from public.study_groups where id = gid for no key update;
  if not found or not exists(
    select 1 from public.group_members where group_id = gid and user_id = uid and role = 'owner'
  ) then
    raise exception '그룹장만 챌린지를 관리할 수 있습니다.' using errcode = '42501';
  end if;
  if action = 'create' then
    if not exists(select 1 from pg_catalog.pg_timezone_names where name = zone) then
      raise exception '시간대를 확인해 주세요.' using errcode = '22023';
    end if;
    first_day := (payload->>'startDate')::date;
    last_day := (payload->>'endDate')::date;
    if first_day is null or last_day is null or first_day < (clock_timestamp() at time zone zone)::date
      or last_day < first_day or last_day - first_day > 89 then
      raise exception '오늘 이후 시작하는 1~90일 기간을 선택해 주세요.' using errcode = '22023';
    end if;
    insert into public.study_challenges(id,group_id,title,target_minutes,start_date,end_date,time_zone,starts_at,ends_at)
      values (cid,gid,btrim(payload->>'title'),(payload->>'targetMinutes')::integer,first_day,last_day,zone,
        first_day::timestamp at time zone zone,(last_day + 1)::timestamp at time zone zone)
      on conflict(id) do nothing;
    if not found then
      if exists(select 1 from public.study_challenges where id = cid and group_id = gid) then return cid;
      else raise exception '챌린지를 만들지 못했어요.' using errcode = '42501'; end if;
    end if;
  elsif action = 'cancel' then
    update public.study_challenges set cancelled_at = clock_timestamp()
      where id = cid and group_id = gid and cancelled_at is null and ends_at > clock_timestamp();
    if not found then
      if exists(select 1 from public.study_challenges where id = cid and group_id = gid and cancelled_at is not null) then return cid;
      else raise exception '취소할 수 없는 챌린지입니다.' using errcode = '22023'; end if;
    end if;
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return cid;
end $$;

create function public.onmode_challenges(group_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.challenge_list(group_id) $$;
create function public.onmode_challenge_change(group_id uuid,action text,payload jsonb) returns uuid
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.challenge_change(group_id,action,payload) $$;
revoke execute on function onmode_private.challenge_list(uuid),onmode_private.challenge_change(uuid,text,jsonb),
  public.onmode_challenges(uuid),public.onmode_challenge_change(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function onmode_private.challenge_list(uuid),onmode_private.challenge_change(uuid,text,jsonb),
  public.onmode_challenges(uuid),public.onmode_challenge_change(uuid,text,jsonb) to authenticated;
