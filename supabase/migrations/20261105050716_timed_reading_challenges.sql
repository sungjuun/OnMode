create table onmode_private.reading_challenges (
  id uuid primary key,
  group_id uuid not null,
  book_id uuid not null,
  target_page integer not null check (target_page between 1 and 100000),
  start_date date not null,
  end_date date not null check (end_date - start_date between 0 and 89),
  time_zone text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > starts_at),
  created_at timestamptz not null default clock_timestamp(),
  cancelled_at timestamptz,
  unique (group_id,id),
  foreign key (group_id,book_id) references public.group_library_books(group_id,id) on delete cascade
);
create index reading_challenges_group_page on onmode_private.reading_challenges(group_id,created_at desc,id desc);
create index reading_challenges_book on onmode_private.reading_challenges(group_id,book_id);

create table onmode_private.reading_challenge_progress (
  group_id uuid not null,
  challenge_id uuid not null,
  user_id uuid not null,
  page integer check (page between 0 and 100000),
  revision integer not null check (revision > 0),
  request_id uuid not null,
  primary key (challenge_id,user_id),
  foreign key (group_id,challenge_id) references onmode_private.reading_challenges(group_id,id) on delete cascade,
  foreign key (group_id,user_id) references public.group_members(group_id,user_id) on delete cascade
);
create index reading_challenge_progress_member on onmode_private.reading_challenge_progress(group_id,user_id);
alter table onmode_private.reading_challenges enable row level security;
alter table onmode_private.reading_challenge_progress enable row level security;
revoke all on onmode_private.reading_challenges,onmode_private.reading_challenge_progress from public,anon,authenticated;

create function onmode_private.reading_challenge_list(gid uuid,cursor_at timestamptz,cursor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user(); joined timestamptz;
begin
  select m.joined_at into joined from public.group_members m where m.group_id = gid and m.user_id = uid;
  if not found then raise exception '그룹 멤버만 독서 도전을 볼 수 있습니다.' using errcode = '42501'; end if;
  if (cursor_at is null) <> (cursor_id is null) then
    raise exception '도전 목록을 다시 불러와 주세요.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',c.id,'bookName',b.name,'bookPages',b.pages,'targetPage',c.target_page,
    'startDate',c.start_date,'endDate',c.end_date,'timeZone',c.time_zone,'createdAt',c.created_at,
    'status',case when c.cancelled_at is not null then 'cancelled'
      when statement_timestamp() < c.starts_at then 'scheduled'
      when statement_timestamp() >= c.ends_at then 'ended' else 'active' end,
    'participants',s.participants,'achieved',s.achieved,'myPage',mine.page,
    'myRevision',coalesce(mine.revision,0),'membershipSince',joined
  ) order by c.created_at desc,c.id desc)
  from (select * from onmode_private.reading_challenges
    where group_id = gid and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
    order by created_at desc,id desc limit 11) c
  join public.group_library_books b on b.id = c.book_id
  left join onmode_private.reading_challenge_progress mine on mine.challenge_id = c.id and mine.user_id = uid
  cross join lateral (
    select count(p.page) as participants,count(*) filter (where p.page >= c.target_page) as achieved
    from onmode_private.reading_challenge_progress p where p.challenge_id = c.id
  ) s),'[]'::jsonb);
end $$;

create function onmode_private.reading_challenge_change(gid uuid,action text,payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := onmode_private.require_user();
  cid uuid := (payload->>'id')::uuid;
  member public.group_members;
  challenge onmode_private.reading_challenges;
  prior onmode_private.reading_challenge_progress;
  bid uuid; book_pages integer; target integer;
  zone text; first_day date; last_day date; starts timestamptz; ends timestamptz;
  request uuid; expected integer; wanted integer; changed_at timestamptz;
begin
  if cid is null then raise exception '독서 도전 정보를 확인해 주세요.' using errcode = '22023'; end if;
  -- Serialize with group membership, shared book deletion and other challenge writes.
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform 1 from public.study_groups where id = gid for no key update;
  select * into member from public.group_members where group_id = gid and user_id = uid;
  if not found then raise exception '그룹 멤버만 독서 도전에 참여할 수 있습니다.' using errcode = '42501'; end if;
  if action in ('create','cancel') and member.role <> 'owner' then
    raise exception '그룹장만 독서 도전을 관리할 수 있습니다.' using errcode = '42501';
  end if;
  select * into challenge from onmode_private.reading_challenges where id = cid and group_id = gid;
  changed_at := clock_timestamp();
  if action = 'create' then
    bid := (payload->>'bookId')::uuid;
    select pages into book_pages from public.group_library_books where id = bid and group_id = gid;
    if not found then raise exception '이 그룹의 공동 도서를 선택해 주세요.' using errcode = '22023'; end if;
    target := onmode_private.reading_integer(payload->'targetPage',book_pages);
    zone := payload->>'timeZone';
    if target < 1 or (payload->>'startDate' ~ '^\d{4}-\d{2}-\d{2}$') is not true
      or (payload->>'endDate' ~ '^\d{4}-\d{2}-\d{2}$') is not true
      or not exists(select 1 from pg_catalog.pg_timezone_names where name = zone) then
      raise exception '도전 기간, 시간대와 목표 페이지를 확인해 주세요.' using errcode = '22023';
    end if;
    first_day := (payload->>'startDate')::date;
    last_day := (payload->>'endDate')::date;
    if challenge.id is not null then
      if (challenge.book_id,challenge.target_page,challenge.start_date,challenge.end_date,challenge.time_zone)
        = (bid,target,first_day,last_day,zone) then return cid; end if;
      raise exception '이미 저장된 도전과 내용이 달라요. 목록을 확인해 주세요.' using errcode = '40001';
    end if;
    if first_day < (changed_at at time zone zone)::date or last_day - first_day not between 0 and 89 then
      raise exception '오늘 이후 시작하는 1~90일 기간을 선택해 주세요.' using errcode = '22023';
    end if;
    starts := first_day::timestamp at time zone zone;
    ends := (last_day + 1)::timestamp at time zone zone;
    if starts >= ends then raise exception '이 시간대에 유효한 도전 기간을 선택해 주세요.' using errcode = '22023'; end if;
    if exists(select 1 from onmode_private.reading_challenges c
      where c.group_id = gid and c.book_id = bid and c.cancelled_at is null and c.starts_at < ends and starts < c.ends_at) then
      raise exception '이 책의 다른 도전과 기간이 겹쳐요.' using errcode = '22023';
    end if;
    insert into onmode_private.reading_challenges(id,group_id,book_id,target_page,start_date,end_date,time_zone,starts_at,ends_at)
      values (cid,gid,bid,target,first_day,last_day,zone,starts,ends)
      on conflict(id) do nothing;
    if not found then raise exception '독서 도전 정보를 확인해 주세요.' using errcode = '22023'; end if;
  else
    if challenge.id is null then raise exception '독서 도전이 변경됐어요. 목록을 확인해 주세요.' using errcode = '40001'; end if;
    if action = 'cancel' then
      if challenge.cancelled_at is not null then return cid; end if;
      if changed_at >= challenge.ends_at then raise exception '이미 끝난 도전이에요.' using errcode = '22023'; end if;
      update onmode_private.reading_challenges set cancelled_at = changed_at where id = cid;
    elsif action = 'progress' then
      if (to_jsonb(member.joined_at) #>> '{}') is distinct from payload->>'membershipSince' then
        raise exception '그룹 참여 정보가 변경됐어요. 목록을 확인해 주세요.' using errcode = '40001';
      end if;
      request := (payload->>'requestId')::uuid;
      if request is null then raise exception '진도 요청 정보를 확인해 주세요.' using errcode = '22023'; end if;
      expected := onmode_private.reading_integer(payload->'revision',2147483646);
      select pages into book_pages from public.group_library_books where id = challenge.book_id;
      if payload->'page' = 'null'::jsonb then wanted := null;
      else wanted := onmode_private.reading_integer(payload->'page',book_pages); end if;
      select * into prior from onmode_private.reading_challenge_progress where challenge_id = cid and user_id = uid;
      if prior.request_id = request then
        if prior.page is not distinct from wanted then return cid; end if;
        raise exception '같은 진도 요청의 내용을 확인해 주세요.' using errcode = '22023';
      end if;
      if expected <> coalesce(prior.revision,0) then
        raise exception '독서 진도가 변경됐어요. 최신 진도를 확인해 주세요.' using errcode = '40001';
      end if;
      if wanted is not null and (challenge.cancelled_at is not null or changed_at < challenge.starts_at or changed_at >= challenge.ends_at) then
        raise exception '도전이 진행 중일 때 진도를 기록할 수 있어요.' using errcode = '22023';
      end if;
      if prior.page is not distinct from wanted then return cid; end if;
      insert into onmode_private.reading_challenge_progress(group_id,challenge_id,user_id,page,revision,request_id)
        values (gid,cid,uid,wanted,expected + 1,request)
        on conflict(challenge_id,user_id) do update
          set page = excluded.page,revision = excluded.revision,request_id = excluded.request_id;
    else raise exception '지원하지 않는 요청입니다.' using errcode = '22023'; end if;
  end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return cid;
end $$;

create function public.onmode_reading_challenges(group_id uuid,cursor_at timestamptz default null,cursor_id uuid default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.reading_challenge_list(group_id,cursor_at,cursor_id) $$;
create function public.onmode_reading_challenge_change(group_id uuid,action text,payload jsonb) returns uuid
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.reading_challenge_change(group_id,action,payload) $$;
revoke execute on function onmode_private.reading_challenge_list(uuid,timestamptz,uuid),
  onmode_private.reading_challenge_change(uuid,text,jsonb),public.onmode_reading_challenges(uuid,timestamptz,uuid),
  public.onmode_reading_challenge_change(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function onmode_private.reading_challenge_list(uuid,timestamptz,uuid),
  onmode_private.reading_challenge_change(uuid,text,jsonb),public.onmode_reading_challenges(uuid,timestamptz,uuid),
  public.onmode_reading_challenge_change(uuid,text,jsonb) to authenticated;
