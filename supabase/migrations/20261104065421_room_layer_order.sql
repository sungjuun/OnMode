-- Back-to-front preferences do not grant or place inventory items.
create function onmode_private.normalize_room_order(candidate jsonb,palette text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare entry jsonb; seen text[] := '{}'; iid text;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'array' then
    raise exception '가구 겹침 순서를 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(candidate) = 0 then return '[]'::jsonb; end if;
  if jsonb_array_length(candidate) <> cardinality(palette) then
    raise exception '가구 겹침 순서를 확인해 주세요.' using errcode = '22023';
  end if;
  for entry in select value from jsonb_array_elements(candidate) loop
    iid := entry #>> '{}';
    if jsonb_typeof(entry) <> 'string' or iid is null or not (iid = any(palette)) or iid = any(seen) then
      raise exception '가구 겹침 순서를 확인해 주세요.' using errcode = '22023';
    end if;
    seen := array_append(seen,iid);
  end loop;
  return case when candidate = to_jsonb(palette) then '[]'::jsonb else candidate end;
end $$;

create function onmode_private.room_layout_json(version integer,points jsonb,paint_order jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('revision',version,'positions',points)
    || case when paint_order = '[]'::jsonb then '{}'::jsonb else jsonb_build_object('order',paint_order) end
$$;
revoke execute on function onmode_private.normalize_room_order(jsonb,text[]),onmode_private.room_layout_json(integer,jsonb,jsonb) from public,anon,authenticated;

alter table public.user_room_layouts add column layer_order jsonb not null default '[]'::jsonb;
alter table public.user_room_layouts add constraint user_room_layer_order_valid check (
  layer_order = onmode_private.normalize_room_order(layer_order,array['shelf','frame','desk','lamp','laptop','chair','plant'])
);
alter table public.group_library_layouts add column layer_order jsonb not null default '[]'::jsonb;
alter table public.group_library_layouts add constraint group_library_layer_order_valid check (
  layer_order = onmode_private.normalize_room_order(layer_order,array['shelf','desk','lamp','chair','plant'])
);

-- Existing rows and callers without an order retain their previous appearance.
create or replace function onmode_private.append_room(base jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  return jsonb_set(base,'{snapshot,room}',onmode_private.room_layout_json(
    coalesce((select revision from public.user_room_layouts where user_id = uid),0),
    coalesce((select jsonb_object_agg(item_id,jsonb_build_object('x',offset_x,'y',offset_y))
      from public.room_item_positions where user_id = uid),'{}'::jsonb),
    coalesce((select layer_order from public.user_room_layouts where user_id = uid),'[]'::jsonb)
  ));
end $$;

create or replace function onmode_private.command_with_room(command jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  expected integer; current_revision integer; candidate jsonb; stored jsonb; new_order jsonb; stored_order jsonb;
  iid text; point jsonb; b onmode_private.room_item_bounds;
begin
  if command->>'type' is distinct from 'room_layout' then
    return onmode_private.append_room(onmode_private.apply_command(command));
  end if;
  expected := (command->>'revision')::integer;
  candidate := command->'positions';
  if expected is null or expected < 0 or candidate is null or jsonb_typeof(candidate) <> 'object' then
    raise exception '배치 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  if (select count(*) from jsonb_each(candidate)) > 7 then
    raise exception '배치할 수 없는 아이템입니다.' using errcode = '22023';
  end if;
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  insert into public.user_inventory(user_id,item_id,placed) values (uid,'desk',true),(uid,'chair',true)
    on conflict do nothing;
  insert into public.user_room_layouts(user_id) values (uid) on conflict do nothing;
  select revision,layer_order into current_revision,stored_order from public.user_room_layouts where user_id = uid;
  new_order := case when command ? 'order' then onmode_private.normalize_room_order(command->'order',array['shelf','frame','desk','lamp','laptop','chair','plant']) else stored_order end;
  for iid,point in select key,value from jsonb_each(candidate) loop
    select * into b from onmode_private.room_item_bounds where item_id = iid;
    if not found then raise exception '이동할 수 없는 아이템입니다.' using errcode = '22023'; end if;
    if not exists(select 1 from public.user_inventory where user_id = uid and item_id = iid) then
      raise exception '보유하지 않은 아이템입니다.' using errcode = '42501';
    end if;
    if jsonb_typeof(point) <> 'object' then
      raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_object_keys(point)) <> 2
      or jsonb_typeof(point->'x') is distinct from 'number' or jsonb_typeof(point->'y') is distinct from 'number'
      or (point->>'x') !~ '^-?[0-9]+$' or (point->>'y') !~ '^-?[0-9]+$' then
      raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023';
    end if;
    if (point->>'x')::numeric not between b.min_x and b.max_x
      or (point->>'y')::numeric not between b.min_y and b.max_y then
      raise exception '아이템을 방 안에 배치해 주세요.' using errcode = '22023';
    end if;
  end loop;
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into candidate from jsonb_each(candidate)
    where (value->>'x')::integer <> 0 or (value->>'y')::integer <> 0;
  select coalesce(jsonb_object_agg(item_id,jsonb_build_object('x',offset_x,'y',offset_y)),'{}'::jsonb)
    into stored from public.room_item_positions where user_id = uid;
  if stored = candidate and stored_order = new_order then return onmode_private.snapshot_with_room(); end if;
  if expected <> current_revision then
    raise exception '다른 곳에서 배치가 변경됐어요. 최신 배치를 불러와 주세요.' using errcode = '40001';
  end if;
  delete from public.room_item_positions where user_id = uid;
  insert into public.room_item_positions(user_id,item_id,offset_x,offset_y)
    select uid,key,(value->>'x')::integer,(value->>'y')::integer from jsonb_each(candidate);
  update public.user_room_layouts set revision = revision + 1,layer_order = new_order where user_id = uid;
  return onmode_private.snapshot_with_room();
end $$;

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
    'room',coalesce((select onmode_private.room_layout_json(revision,positions,layer_order)
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

create or replace function onmode_private.library_change(gid uuid,action text,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  bid uuid := (payload->>'id')::uuid; aid uuid; existing_id uuid;
  a public.activities; b public.group_library_books;
  expected integer; current_revision integer; candidate jsonb; stored jsonb; new_order jsonb; stored_order jsonb;
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
    select revision,positions,layer_order into current_revision,stored,stored_order from public.group_library_layouts where group_id = gid;
    new_order := case when payload ? 'order' then onmode_private.normalize_room_order(payload->'order',array['shelf','desk','lamp','chair','plant']) else stored_order end;
    if candidate = stored and new_order = stored_order then return jsonb_build_object('room',onmode_private.room_layout_json(current_revision,stored,stored_order)); end if;
    if expected <> current_revision then
      raise exception '다른 멤버가 배치를 변경했어요. 최신 배치를 확인해 주세요.' using errcode = '40001';
    end if;
    update public.group_library_layouts set revision = revision + 1,positions = candidate,layer_order = new_order where group_id = gid;
    update public.group_updates set version = version + 1 where group_id = gid;
    return jsonb_build_object('room',onmode_private.room_layout_json(current_revision + 1,candidate,new_order));
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return jsonb_build_object('id',bid);
exception when unique_violation then
  raise exception '이미 공동 도서관에 등록한 ISBN이거나 사용 중인 등록 번호입니다.' using errcode = '23505';
end $$;
