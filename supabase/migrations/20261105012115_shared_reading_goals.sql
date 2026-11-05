alter table public.group_library_books
  add column reading_target integer check (reading_target between 1 and pages),
  add column reading_revision integer not null default 0 check (reading_revision >= 0),
  add column reading_updated_at timestamptz,
  add column reading_request_id uuid,
  add constraint group_library_books_group_id_id unique (group_id,id);

-- A null page is a withdrawal tombstone: erase the published page but retain
-- the user's version/request ID so delayed retries cannot republish it.
create table public.group_reading_progress (
  book_id uuid not null,
  group_id uuid not null,
  user_id uuid not null,
  current_page integer check (current_page between 0 and 100000),
  revision integer not null default 1 check (revision > 0),
  updated_at timestamptz not null default clock_timestamp(),
  last_request_id uuid not null,
  primary key (book_id,user_id),
  foreign key (group_id,book_id) references public.group_library_books(group_id,id) on delete cascade,
  foreign key (group_id,user_id) references public.group_members(group_id,user_id) on delete cascade
);
create index group_reading_progress_book on public.group_reading_progress(group_id,book_id);
create index group_reading_progress_member on public.group_reading_progress(group_id,user_id);
alter table public.group_reading_progress enable row level security;
revoke all on public.group_reading_progress from public,anon,authenticated;
grant select on public.group_reading_progress to authenticated;
create policy members_read_shared_progress on public.group_reading_progress for select to authenticated
  using (onmode_private.is_member(group_id) and (current_page is not null or user_id = (select auth.uid())));

create function onmode_private.reading_integer(value jsonb,maximum integer) returns integer
language plpgsql immutable set search_path = '' as $$
begin
  if value is null or jsonb_typeof(value) <> 'number' or (value #>> '{}') !~ '^[0-9]+$' then
    raise exception '페이지와 버전 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  if (value #>> '{}')::numeric not between 0 and maximum then
    raise exception '페이지와 버전 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  return (value #>> '{}')::integer;
end $$;

create function onmode_private.reading_summary(bid uuid,uid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case when b.reading_revision = 0 then null else jsonb_build_object(
    'targetPage',b.reading_target,'revision',b.reading_revision,'updatedAt',b.reading_updated_at,
    'membershipSince',(select joined_at from public.group_members where group_id = b.group_id and user_id = uid),
    'mine',(select jsonb_build_object('page',current_page,'revision',revision,'updatedAt',updated_at)
      from public.group_reading_progress where book_id = bid and user_id = uid),
    'participants',(select count(*) from public.group_reading_progress where book_id = bid and current_page is not null),
    'achieved',(select count(*) from public.group_reading_progress where book_id = bid and current_page >= b.reading_target)
  ) end from public.group_library_books b where id = bid
$$;

-- Called only by library_change under its profile -> group lock and membership check.
create function onmode_private.change_reading(gid uuid,action text,payload jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare uid uuid := onmode_private.require_user(); bid uuid := (payload->>'id')::uuid;
  b public.group_library_books; prior public.group_reading_progress;
  request_id uuid; expected integer; wanted integer; goal_revision integer; current_revision integer;
  membership text;
begin
  select * into b from public.group_library_books where id = bid and group_id = gid for update;
  if not found then raise exception '공동 도서가 변경됐어요. 목록을 다시 불러와 주세요.' using errcode = '40001'; end if;
  if jsonb_typeof(payload->'requestId') is distinct from 'string'
    or (payload->>'requestId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    raise exception '공유 요청 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  request_id := (payload->>'requestId')::uuid;
  expected := onmode_private.reading_integer(payload->'revision',2147483646);
  if action = 'reading_goal' then
    if not exists(select 1 from public.group_members where group_id = gid and user_id = uid and role = 'owner') then
      raise exception '그룹장만 독서 목표를 관리할 수 있습니다.' using errcode = '42501';
    end if;
    if payload->'targetPage' = 'null'::jsonb then wanted := null;
    else
      wanted := onmode_private.reading_integer(payload->'targetPage',b.pages);
      if wanted = 0 then raise exception '독서 목표는 1쪽 이상으로 정해 주세요.' using errcode = '22023'; end if;
    end if;
    if b.reading_request_id = request_id then
      if b.reading_target is not distinct from wanted then return jsonb_build_object('id',bid); end if;
      raise exception '같은 공유 요청의 내용을 확인해 주세요.' using errcode = '22023';
    end if;
    if b.reading_revision <> expected then raise exception '독서 목표가 변경됐어요. 최신 목표를 확인해 주세요.' using errcode = '40001'; end if;
    if b.reading_target is not distinct from wanted then return jsonb_build_object('id',bid); end if;
    update public.group_library_books set reading_target = wanted,reading_revision = reading_revision + 1,
      reading_updated_at = clock_timestamp(),reading_request_id = request_id where id = bid;
    if wanted is null then delete from public.group_reading_progress where book_id = bid; end if;
  elsif action = 'reading_progress' then
    goal_revision := onmode_private.reading_integer(payload->'goalRevision',2147483646);
    if b.reading_target is null or b.reading_revision <> goal_revision then
      raise exception '독서 목표가 변경됐어요. 최신 목표를 확인해 주세요.' using errcode = '40001';
    end if;
    select to_jsonb(joined_at) #>> '{}' into membership from public.group_members where group_id = gid and user_id = uid;
    if membership is null or membership is distinct from payload->>'membershipSince' then
      raise exception '그룹 참여 정보가 변경됐어요. 목록을 다시 불러와 주세요.' using errcode = '40001';
    end if;
    if payload->'page' = 'null'::jsonb then wanted := null;
    else wanted := onmode_private.reading_integer(payload->'page',b.pages); end if;
    select * into prior from public.group_reading_progress where book_id = bid and user_id = uid for update;
    current_revision := coalesce(prior.revision,0);
    if prior.last_request_id = request_id then
      if prior.current_page is not distinct from wanted then return jsonb_build_object('id',bid); end if;
      raise exception '같은 공유 요청의 내용을 확인해 주세요.' using errcode = '22023';
    end if;
    if expected <> current_revision then raise exception '공유 진도가 변경됐어요. 최신 진도를 확인해 주세요.' using errcode = '40001'; end if;
    if prior.current_page is not distinct from wanted then return jsonb_build_object('id',bid); end if;
    insert into public.group_reading_progress(book_id,group_id,user_id,current_page,revision,last_request_id)
      values (bid,gid,uid,wanted,current_revision + 1,request_id)
      on conflict(book_id,user_id) do update set current_page = excluded.current_page,
        revision = excluded.revision,updated_at = clock_timestamp(),last_request_id = excluded.last_request_id;
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023'; end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return jsonb_build_object('id',bid);
end $$;

create function onmode_private.reading_members(gid uuid,bid uuid,cursor_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 공유 진도를 볼 수 있습니다.' using errcode = '42501';
  end if;
  if not exists(select 1 from public.group_library_books where id = bid and group_id = gid) then
    raise exception '공동 도서가 변경됐어요. 목록을 다시 불러와 주세요.' using errcode = '40001';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId',r.user_id,'name',coalesce(p.name,'집중러'),
    'page',r.current_page,'updatedAt',r.updated_at) order by r.user_id) from (
      select user_id,current_page,updated_at from public.group_reading_progress where group_id = gid and book_id = bid
        and current_page is not null and (cursor_user is null or user_id > cursor_user)
      order by user_id limit 21
    ) r left join public.profiles p on p.user_id = r.user_id),'[]'::jsonb);
end $$;

create function public.onmode_reading_members(group_id uuid,book_id uuid,cursor_user uuid default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.reading_members(group_id,book_id,cursor_user) $$;
revoke execute on function onmode_private.reading_integer(jsonb,integer),onmode_private.reading_summary(uuid,uuid),
  onmode_private.change_reading(uuid,text,jsonb),onmode_private.reading_members(uuid,uuid,uuid),
  public.onmode_reading_members(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function onmode_private.reading_members(uuid,uuid,uuid),public.onmode_reading_members(uuid,uuid,uuid) to authenticated;

create or replace function onmode_private.library_list(gid uuid,cursor_at timestamptz,cursor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 공동 도서관을 볼 수 있습니다.' using errcode = '42501';
  end if;
  if (cursor_at is null) <> (cursor_id is null) then
    raise exception '도서 목록을 다시 불러와 주세요.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'room',coalesce((select onmode_private.room_layout_json(revision,positions,layer_order,transforms)
      from public.group_library_layouts where group_id = gid),' {"revision":0,"positions":{}}'::jsonb),
    'books',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',b.id,'name',b.name,'author',b.author,'pages',b.pages,'isbn',b.isbn,'createdAt',b.created_at,
      'reading',onmode_private.reading_summary(b.id,uid),
      'myActivityId',(select activity_id from public.group_library_imports where user_id = uid and book_id = b.id)
    )) order by b.created_at desc,b.id desc) from (
      select * from public.group_library_books where group_id = gid
        and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
      order by created_at desc,id desc limit 21
    ) b),'[]'::jsonb)
  );
end $$;

create or replace function onmode_private.library_change(gid uuid,action text,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  bid uuid := (payload->>'id')::uuid; aid uuid; existing_id uuid;
  a public.activities; b public.group_library_books;
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform 1 from public.study_groups where id = gid for no key update;
  if not found or not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 공동 도서관을 이용할 수 있습니다.' using errcode = '42501';
  end if;
  if action in ('create','delete') and not exists(
    select 1 from public.group_members where group_id = gid and user_id = uid and role = 'owner'
  ) then
    raise exception '그룹장만 공동 도서를 관리할 수 있습니다.' using errcode = '42501';
  end if;
  if action = 'create' then
    select * into a from public.activities where id = (payload->>'activityId')::uuid and user_id = uid and kind = 'book';
    if not found then raise exception '내 서재의 도서를 선택해 주세요.' using errcode = '42501'; end if;
    insert into public.group_library_books(id,group_id,name,author,pages,isbn)
      values (bid,gid,a.name,a.author,a.pages,a.isbn) on conflict(id) do nothing;
    if not found then
      if exists(select 1 from public.group_library_books where id = bid and group_id = gid
        and name = a.name and author = a.author and pages = a.pages and isbn is not distinct from a.isbn) then
        return jsonb_build_object('id',bid);
      end if;
      raise exception '도서 목록을 새로 불러온 뒤 다시 시도해 주세요.' using errcode = '40001';
    end if;
    insert into public.group_library_imports(user_id,book_id,activity_id)
      values (uid,bid,a.id) on conflict(user_id,book_id) do nothing;
  elsif action = 'delete' then
    delete from public.group_library_books where id = bid and group_id = gid;
  elsif action = 'import' then
    select * into b from public.group_library_books where id = bid and group_id = gid;
    if not found then raise exception '공동 도서가 삭제됐어요. 목록을 다시 불러와 주세요.' using errcode = '40001'; end if;
    select activity_id into existing_id from public.group_library_imports where user_id = uid and book_id = bid;
    if existing_id is null and b.isbn is not null then
      select id into existing_id from public.activities where user_id = uid and isbn = b.isbn;
    end if;
    if existing_id is null then
      aid := (payload->>'activityId')::uuid;
      select * into a from public.activities where id = aid;
      if found then raise exception '서재를 새로 불러온 뒤 다시 시도해 주세요.' using errcode = '40001'; end if;
      insert into public.activities(id,user_id,kind,name,author,pages,current_page,goal_pages,isbn)
        values (aid,uid,'book',b.name,b.author,b.pages,0,10,b.isbn);
      existing_id := aid;
    end if;
    insert into public.group_library_imports(user_id,book_id,activity_id)
      values (uid,bid,existing_id) on conflict(user_id,book_id) do nothing;
    return jsonb_build_object('id',existing_id);
  elsif action in ('reading_goal','reading_progress') then
    return onmode_private.change_reading(gid,action,payload);
  elsif action = 'layout' then
    return onmode_private.save_library_room(gid,payload);
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return jsonb_build_object('id',bid);
exception when unique_violation then
  raise exception '이미 공동 도서관에 등록한 ISBN이거나 사용 중인 등록 번호입니다.' using errcode = '23505';
end $$;
