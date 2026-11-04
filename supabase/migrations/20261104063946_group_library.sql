create table public.group_library_books (
  id uuid primary key,
  group_id uuid not null references public.study_groups on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  author text not null check (char_length(btrim(author)) between 1 and 80),
  pages integer not null check (pages between 1 and 100000),
  isbn text check (isbn is null or onmode_private.valid_isbn13(isbn)),
  created_at timestamptz not null default clock_timestamp()
);
create index group_library_books_page on public.group_library_books(group_id,created_at desc,id desc);
create unique index group_library_books_isbn on public.group_library_books(group_id,isbn) where isbn is not null;

create table public.group_library_imports (
  user_id uuid not null references auth.users on delete cascade,
  book_id uuid not null references public.group_library_books on delete cascade,
  activity_id uuid not null,
  primary key (user_id,book_id),
  foreign key (user_id,activity_id) references public.activities(user_id,id) on delete cascade
);
create index group_library_imports_book on public.group_library_imports(book_id);
create index group_library_imports_activity on public.group_library_imports(user_id,activity_id);

create table public.group_library_layouts (
  group_id uuid primary key references public.study_groups on delete cascade,
  revision integer not null default 0 check (revision >= 0),
  positions jsonb not null default '{}'::jsonb check (jsonb_typeof(positions) = 'object')
);
alter table public.group_library_books enable row level security;
alter table public.group_library_imports enable row level security;
alter table public.group_library_layouts enable row level security;
revoke all on public.group_library_books,public.group_library_imports,public.group_library_layouts from public,anon,authenticated;
grant select on public.group_library_books,public.group_library_imports,public.group_library_layouts to authenticated;
create policy members_read_library_books on public.group_library_books for select to authenticated
  using (onmode_private.is_member(group_id));
create policy own_library_imports on public.group_library_imports for select to authenticated
  using (user_id = (select auth.uid()));
create policy members_read_library_layouts on public.group_library_layouts for select to authenticated
  using (onmode_private.is_member(group_id));

create function onmode_private.library_list(gid uuid,cursor_at timestamptz,cursor_id uuid) returns jsonb
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
    'room',coalesce((select jsonb_build_object('revision',revision,'positions',positions)
      from public.group_library_layouts where group_id = gid),' {"revision":0,"positions":{}}'::jsonb),
    'books',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'id',b.id,'name',b.name,'author',b.author,'pages',b.pages,'isbn',b.isbn,'createdAt',b.created_at,
      'myActivityId',(select activity_id from public.group_library_imports where user_id = uid and book_id = b.id)
    )) order by b.created_at desc,b.id desc) from (
      select * from public.group_library_books where group_id = gid
        and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
      order by created_at desc,id desc limit 21
    ) b),'[]'::jsonb)
  );
end $$;

create function onmode_private.library_change(gid uuid,action text,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  bid uuid := (payload->>'id')::uuid; aid uuid; existing_id uuid;
  a public.activities; b public.group_library_books;
  expected integer; current_revision integer; candidate jsonb; stored jsonb;
  iid text; point jsonb; bounds onmode_private.room_item_bounds;
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
  elsif action = 'layout' then
    expected := (payload->>'revision')::integer;
    candidate := payload->'positions';
    if expected is null or expected < 0 or candidate is null or jsonb_typeof(candidate) <> 'object' then
      raise exception '배치 정보를 확인해 주세요.' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_each(candidate)) > 5 then
      raise exception '공용 가구만 배치할 수 있습니다.' using errcode = '22023';
    end if;
    for iid,point in select key,value from jsonb_each(candidate) loop
      if iid not in ('desk','chair','shelf','lamp','plant') then
        raise exception '공용 가구만 배치할 수 있습니다.' using errcode = '22023';
      end if;
      select * into bounds from onmode_private.room_item_bounds where item_id = iid;
      if jsonb_typeof(point) <> 'object' then
        raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023';
      end if;
      if (select count(*) from jsonb_object_keys(point)) <> 2
        or jsonb_typeof(point->'x') is distinct from 'number' or jsonb_typeof(point->'y') is distinct from 'number'
        or (point->>'x') !~ '^-?[0-9]+$' or (point->>'y') !~ '^-?[0-9]+$' then
        raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023';
      end if;
      if (point->>'x')::numeric not between bounds.min_x and bounds.max_x
        or (point->>'y')::numeric not between bounds.min_y and bounds.max_y then
        raise exception '아이템을 방 안에 배치해 주세요.' using errcode = '22023';
      end if;
    end loop;
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into candidate from jsonb_each(candidate)
      where (value->>'x')::integer <> 0 or (value->>'y')::integer <> 0;
    insert into public.group_library_layouts(group_id) values (gid) on conflict do nothing;
    select revision,positions into current_revision,stored from public.group_library_layouts where group_id = gid;
    if candidate = stored then return jsonb_build_object('room',jsonb_build_object('revision',current_revision,'positions',stored)); end if;
    if expected <> current_revision then
      raise exception '다른 멤버가 배치를 변경했어요. 최신 배치를 확인해 주세요.' using errcode = '40001';
    end if;
    update public.group_library_layouts set revision = revision + 1,positions = candidate where group_id = gid;
    update public.group_updates set version = version + 1 where group_id = gid;
    return jsonb_build_object('room',jsonb_build_object('revision',current_revision + 1,'positions',candidate));
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return jsonb_build_object('id',bid);
exception when unique_violation then
  raise exception '이미 공동 도서관에 등록한 ISBN이거나 사용 중인 등록 번호입니다.' using errcode = '23505';
end $$;

create function public.onmode_library(group_id uuid,cursor_at timestamptz default null,cursor_id uuid default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.library_list(group_id,cursor_at,cursor_id) $$;
create function public.onmode_library_change(group_id uuid,action text,payload jsonb) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.library_change(group_id,action,payload) $$;
revoke execute on function onmode_private.library_list(uuid,timestamptz,uuid),onmode_private.library_change(uuid,text,jsonb),
  public.onmode_library(uuid,timestamptz,uuid),public.onmode_library_change(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function onmode_private.library_list(uuid,timestamptz,uuid),onmode_private.library_change(uuid,text,jsonb),
  public.onmode_library(uuid,timestamptz,uuid),public.onmode_library_change(uuid,text,jsonb) to authenticated;
