-- A season is a calendar window over the existing server-verified group records.
create function onmode_private.study_season(gid uuid,requested_month date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := onmode_private.require_user();
  zone constant text := 'Asia/Seoul';
  current_month date := date_trunc('month',statement_timestamp() at time zone zone)::date;
  first_month date := (current_month - interval '11 months')::date;
  season_month date := coalesce(requested_month,current_month);
  next_month date;
  starts_at timestamptz;
  ends_at timestamptz;
  result jsonb;
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 시즌을 볼 수 있습니다.' using errcode = '42501';
  end if;
  if season_month not between first_month and current_month or extract(day from season_month) <> 1 then
    raise exception '최근 12개월의 시즌을 선택해 주세요.' using errcode = '22023';
  end if;
  next_month := (season_month + interval '1 month')::date;
  starts_at := season_month::timestamp at time zone zone;
  ends_at := next_month::timestamp at time zone zone;

  with contributions as (
    select f.user_id,sum(c.seconds) as seconds,count(*) as sessions
    from public.group_contributions c
    join public.focus_sessions f on f.id = c.session_id and f.ended_at = c.ended_at and f.seconds = c.seconds
    where c.group_id = gid and c.ended_at >= starts_at and c.ended_at < ends_at
      and c.ended_at <= statement_timestamp() and c.seconds >= 60
    group by f.user_id
  ), ranking as (
    select c.user_id,coalesce(p.name,'집중러') as name,c.seconds,c.sessions,
      dense_rank() over(order by c.seconds desc) as position,m.joined_at
    from contributions c
    join public.group_members m on m.group_id = gid and m.user_id = c.user_id
    left join public.profiles p on p.user_id = c.user_id
  )
  select jsonb_build_object(
    'month',season_month,'endDate',next_month - 1,'currentMonth',current_month,
    'months',(select jsonb_agg(day::date order by day desc)
      from generate_series(first_month::timestamp,current_month::timestamp,interval '1 month') day),
    'totalSeconds',coalesce(sum(c.seconds),0),'sessions',coalesce(sum(c.sessions),0),'contributors',count(*),
    'ranking',coalesce((select jsonb_agg(jsonb_build_object('id',r.user_id,'name',r.name,'seconds',r.seconds,
      'sessions',r.sessions,'rank',r.position) order by r.position,r.joined_at,r.user_id)
      from (select * from ranking order by position,joined_at,user_id limit 20) r),'[]'::jsonb),
    'mine',(select jsonb_build_object('rank',r.position,'seconds',r.seconds,'sessions',r.sessions)
      from ranking r where r.user_id = uid)
  ) into result from contributions c;
  return result;
end $$;

create function public.onmode_study_season(group_id uuid,month_start date default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.study_season(group_id,month_start) $$;
revoke execute on function onmode_private.study_season(uuid,date),public.onmode_study_season(uuid,date) from public,anon,authenticated;
grant execute on function onmode_private.study_season(uuid,date),public.onmode_study_season(uuid,date) to authenticated;
