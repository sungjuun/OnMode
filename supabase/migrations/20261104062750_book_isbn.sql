-- Optional canonical ISBN; existing manual registrations remain unchanged.
create function onmode_private.valid_isbn13(value text) returns boolean
language plpgsql immutable strict set search_path = ''
as $$
declare total integer := 0; i integer;
begin
  if value !~ '^97[89][0-9]{10}$' or left(value,4) = '9790' then return false; end if;
  for i in 1..13 loop
    total := total + substring(value from i for 1)::integer * case when i % 2 = 0 then 3 else 1 end;
  end loop;
  return total % 10 = 0;
end $$;
revoke execute on function onmode_private.valid_isbn13(text) from public,anon,authenticated;

alter table public.activities add column isbn text;
alter table public.activities add constraint activities_book_isbn
  check (isbn is null or (kind = 'book' and onmode_private.valid_isbn13(isbn)));
create unique index activities_user_isbn on public.activities(user_id,isbn) where isbn is not null;

-- Preserve private function ACLs and the public room-layout wrappers.
create or replace function onmode_private.snapshot() returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare uid uuid := onmode_private.require_user();
begin
  return jsonb_build_object('serverTime',onmode_private.ms(clock_timestamp()),'snapshot',jsonb_build_object(
    'profile',coalesce((select jsonb_build_object('name',name,'goalMinutes',goal_minutes,'notifications',notifications)
      from public.profiles where user_id = uid), '{"name":"집중러","goalMinutes":120,"notifications":false}'::jsonb),
    'certifications',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'examDate',exam_date,'result',result) order by exam_date)
      from public.certifications where user_id = uid),'[]'),
    'activities',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',id,'kind',kind,'name',name,'certificationId',certification_id,
      'goalMinutes',goal_minutes,'author',author,'pages',pages,'currentPage',current_page,'goalPages',goal_pages,'isbn',isbn)) order by name)
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

create or replace function onmode_private.apply_command(command jsonb) returns jsonb
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
