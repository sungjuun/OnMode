-- Optional shape data: omitted fields keep old clients and existing rooms intact.
alter table onmode_private.room_item_bounds
  add column origin_y integer,
  add column item_width integer,
  add column item_height integer;
update onmode_private.room_item_bounds b set
  origin_y = v.y,item_width = v.w,item_height = v.h
from (values ('desk',203,270,90),('chair',224,77,80),('shelf',123,100,147),
  ('frame',70,64,70),('lamp',126,60,78),('laptop',158,83,45),('plant',200,55,80)) v(id,y,w,h)
where b.item_id = v.id;
alter table onmode_private.room_item_bounds
  alter column origin_y set not null,alter column item_width set not null,alter column item_height set not null;

create function onmode_private.normalize_room_transforms(candidate jsonb,palette text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare iid text; shape jsonb; result jsonb := '{}'; angle numeric; size numeric;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then
    raise exception '가구 회전과 크기를 확인해 주세요.' using errcode = '22023';
  end if;
  for iid,shape in select key,value from jsonb_each(candidate) loop
    if not (iid = any(palette)) or jsonb_typeof(shape) <> 'object' then
      raise exception '가구 회전과 크기를 확인해 주세요.' using errcode = '22023';
    end if;
    if (select count(*) from jsonb_object_keys(shape)) <> 2
      or jsonb_typeof(shape->'rotation') is distinct from 'number'
      or jsonb_typeof(shape->'scale') is distinct from 'number'
      or (shape->>'rotation') !~ '^[0-9]+$' or (shape->>'scale') !~ '^[0-9]+$' then
      raise exception '가구 회전과 크기를 확인해 주세요.' using errcode = '22023';
    end if;
    angle := (shape->>'rotation')::numeric; size := (shape->>'scale')::numeric;
    if angle not in (0,90,180,270) or size not between 50 and 120 or mod(size,10) <> 0 then
      raise exception '가구 회전과 크기를 확인해 주세요.' using errcode = '22023';
    end if;
    if angle <> 0 or size <> 100 then result := result || jsonb_build_object(iid,jsonb_build_object('rotation',angle,'scale',size)); end if;
  end loop;
  return result;
end $$;

create function onmode_private.normalize_room_positions(candidate jsonb,shapes jsonb,palette text[]) returns jsonb
language plpgsql stable set search_path = '' as $$
declare iid text; point jsonb; shape jsonb; b onmode_private.room_item_bounds; result jsonb := '{}';
  px numeric; py numeric; angle numeric; size numeric; w numeric; h numeric; cx numeric; cy numeric;
  lo_x numeric; hi_x numeric; lo_y numeric; hi_y numeric;
begin
  if candidate is null or jsonb_typeof(candidate) <> 'object' then
    raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023';
  end if;
  for iid in select key from jsonb_each(candidate) union select key from jsonb_each(shapes) loop
    if not (iid = any(palette)) then raise exception '이동할 수 없는 아이템입니다.' using errcode = '22023'; end if;
    select * into b from onmode_private.room_item_bounds where item_id = iid;
    point := coalesce(candidate->iid,'{"x":0,"y":0}'::jsonb);
    if jsonb_typeof(point) <> 'object' then raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023'; end if;
    if (select count(*) from jsonb_object_keys(point)) <> 2
      or jsonb_typeof(point->'x') is distinct from 'number' or jsonb_typeof(point->'y') is distinct from 'number'
      or (point->>'x') !~ '^-?[0-9]+$' or (point->>'y') !~ '^-?[0-9]+$' then
      raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023';
    end if;
    px := (point->>'x')::numeric; py := (point->>'y')::numeric;
    shape := coalesce(shapes->iid,'{"rotation":0,"scale":100}'::jsonb);
    angle := (shape->>'rotation')::numeric; size := (shape->>'scale')::numeric;
    lo_x := b.min_x; hi_x := b.max_x; lo_y := b.min_y; hi_y := b.max_y;
    if angle <> 0 or size <> 100 then
      w := (case when mod(angle,180) = 0 then b.item_width else b.item_height end) * size / 100;
      h := (case when mod(angle,180) = 0 then b.item_height else b.item_width end) * size / 100;
      cx := 12 - b.min_x + b.item_width / 2.0; cy := b.origin_y + b.item_height / 2.0;
      lo_x := ceil(12 - cx + w / 2); hi_x := floor(628 - cx - w / 2);
      lo_y := ceil(12 - cy + h / 2); hi_y := floor(344 - cy - h / 2);
    end if;
    if px not between lo_x and hi_x or py not between lo_y and hi_y then
      raise exception '아이템을 방 안에 배치해 주세요.' using errcode = '22023';
    end if;
    if px <> 0 or py <> 0 then result := result || jsonb_build_object(iid,jsonb_build_object('x',px,'y',py)); end if;
  end loop;
  return result;
end $$;

create function onmode_private.room_layout_json(version integer,points jsonb,paint_order jsonb,shapes jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select onmode_private.room_layout_json(version,points,paint_order)
    || case when shapes = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('transforms',shapes) end
$$;
revoke execute on function onmode_private.normalize_room_transforms(jsonb,text[]),
  onmode_private.normalize_room_positions(jsonb,jsonb,text[]),onmode_private.room_layout_json(integer,jsonb,jsonb,jsonb) from public,anon,authenticated;

alter table public.user_room_layouts add column transforms jsonb not null default '{}';
alter table public.user_room_layouts add constraint user_room_transforms_valid check (
  transforms = onmode_private.normalize_room_transforms(transforms,array['shelf','frame','desk','lamp','laptop','chair','plant'])
);
alter table public.group_library_layouts add column transforms jsonb not null default '{}';
alter table public.group_library_layouts add constraint group_library_transforms_valid check (
  transforms = onmode_private.normalize_room_transforms(transforms,array['shelf','desk','lamp','chair','plant'])
);

create or replace function onmode_private.append_room(base jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  return jsonb_set(base,'{snapshot,room}',onmode_private.room_layout_json(
    coalesce((select revision from public.user_room_layouts where user_id = uid),0),
    coalesce((select jsonb_object_agg(item_id,jsonb_build_object('x',offset_x,'y',offset_y))
      from public.room_item_positions where user_id = uid),'{}'::jsonb),
    coalesce((select layer_order from public.user_room_layouts where user_id = uid),'[]'::jsonb),
    coalesce((select transforms from public.user_room_layouts where user_id = uid),'{}'::jsonb)
  ));
end $$;

create or replace function onmode_private.command_with_room(command jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  expected integer; current_revision integer; candidate jsonb; stored jsonb; new_order jsonb; stored_order jsonb;
  shapes jsonb; stored_shapes jsonb; raw_shapes jsonb; iid text;
  palette text[] := array['shelf','frame','desk','lamp','laptop','chair','plant'];
begin
  if command->>'type' is distinct from 'room_layout' then
    return onmode_private.append_room(onmode_private.apply_command(command));
  end if;
  expected := (command->>'revision')::integer;
  if expected is null or expected < 0 then raise exception '배치 정보를 확인해 주세요.' using errcode = '22023'; end if;
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  insert into public.user_inventory(user_id,item_id,placed) values (uid,'desk',true),(uid,'chair',true) on conflict do nothing;
  insert into public.user_room_layouts(user_id) values (uid) on conflict do nothing;
  select revision,layer_order,transforms into current_revision,stored_order,stored_shapes from public.user_room_layouts where user_id = uid;
  raw_shapes := case when command ? 'transforms' then command->'transforms' else stored_shapes end;
  shapes := onmode_private.normalize_room_transforms(raw_shapes,palette);
  candidate := onmode_private.normalize_room_positions(command->'positions',shapes,palette);
  -- Check raw entries too, so even default-valued unowned furniture is denied.
  for iid in select key from jsonb_each(command->'positions') union select key from jsonb_each(raw_shapes) loop
    if not exists(select 1 from public.user_inventory where user_id = uid and item_id = iid) then
      raise exception '보유하지 않은 아이템입니다.' using errcode = '42501';
    end if;
  end loop;
  new_order := case when command ? 'order' then onmode_private.normalize_room_order(command->'order',palette) else stored_order end;
  select coalesce(jsonb_object_agg(item_id,jsonb_build_object('x',offset_x,'y',offset_y)),'{}'::jsonb)
    into stored from public.room_item_positions where user_id = uid;
  if stored = candidate and stored_order = new_order and stored_shapes = shapes then return onmode_private.snapshot_with_room(); end if;
  if expected <> current_revision then raise exception '다른 곳에서 배치가 변경됐어요. 최신 배치를 불러와 주세요.' using errcode = '40001'; end if;
  delete from public.room_item_positions where user_id = uid;
  insert into public.room_item_positions(user_id,item_id,offset_x,offset_y)
    select uid,key,(value->>'x')::integer,(value->>'y')::integer from jsonb_each(candidate);
  update public.user_room_layouts set revision = revision + 1,layer_order = new_order,transforms = shapes where user_id = uid;
  return onmode_private.snapshot_with_room();
end $$;

-- Called from library_change under its profile -> group lock and membership check.
create function onmode_private.save_library_room(gid uuid,payload jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare expected integer := (payload->>'revision')::integer;
  current_revision integer; candidate jsonb; stored jsonb; new_order jsonb; stored_order jsonb;
  shapes jsonb; stored_shapes jsonb;
  palette text[] := array['shelf','desk','lamp','chair','plant'];
begin
  if expected is null or expected < 0 then raise exception '배치 정보를확인해 주세요.' using errcode = '22023'; end if;
  insert into public.group_library_layouts(group_id) values (gid) on conflict do nothing;
  select revision,positions,layer_order,transforms into current_revision,stored,stored_order,stored_shapes from public.group_library_layouts where group_id = gid;
  shapes := onmode_private.normalize_room_transforms(case when payload ? 'transforms' then payload->'transforms' else stored_shapes end,palette);
  candidate := onmode_private.normalize_room_positions(payload->'positions',shapes,palette);
  new_order := case when payload ? 'order' then onmode_private.normalize_room_order(payload->'order',palette) else stored_order end;
  if candidate = stored and new_order = stored_order and shapes = stored_shapes then
    return jsonb_build_object('room',onmode_private.room_layout_json(current_revision,stored,stored_order,stored_shapes));
  end if;
  if expected <> current_revision then raise exception '다른 멤버가 배치를 변경했어요. 최신 배치를 확인해 주세요.' using errcode = '40001'; end if;
  update public.group_library_layouts set revision = revision + 1,positions = candidate,layer_order = new_order,transforms = shapes where group_id = gid;
  update public.group_updates set version = version + 1 where group_id = gid;
  return jsonb_build_object('room',onmode_private.room_layout_json(current_revision + 1,candidate,new_order,shapes));
end $$;
revoke execute on function onmode_private.save_library_room(uuid,jsonb) from public,anon,authenticated;

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
  elsif action = 'layout' then
    return onmode_private.save_library_room(gid,payload);
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return jsonb_build_object('id',bid);
exception when unique_violation then
  raise exception '이미 공동 도서관에 등록한 ISBN이거나 사용 중인 등록 번호입니다.' using errcode = '23505';
end $$;
