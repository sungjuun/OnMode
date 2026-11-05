alter table public.group_library_layouts
  add column extras jsonb not null default '[]'::jsonb
    check (extras in ('[]'::jsonb,'["frame"]'::jsonb,'["laptop"]'::jsonb,'["frame","laptop"]'::jsonb)),
  drop constraint group_library_transforms_valid,
  drop constraint group_library_layer_order_valid;

-- Five-item orders written by earlier clients remain valid.
alter table public.group_library_layouts
  add constraint group_library_transforms_valid check (
    transforms = onmode_private.normalize_room_transforms(transforms,array['shelf','frame','desk','lamp','laptop','chair','plant'])
  ),
  add constraint group_library_layer_order_valid check (
    layer_order = onmode_private.normalize_room_order(layer_order,
      case when jsonb_array_length(layer_order) = 5 then array['shelf','desk','lamp','chair','plant']
        else array['shelf','frame','desk','lamp','laptop','chair','plant'] end)
  );

create function onmode_private.shared_room_json(room public.group_library_layouts) returns jsonb
language sql immutable set search_path = '' as $$
  select onmode_private.room_layout_json(room.revision,room.positions,room.layer_order,room.transforms)
    || case when room.extras = '[]'::jsonb then '{}'::jsonb else jsonb_build_object('extras',room.extras) end
$$;
revoke execute on function onmode_private.shared_room_json(public.group_library_layouts) from public,anon,authenticated;

-- library_change has already locked the group and checked current membership.
create or replace function onmode_private.save_library_room(gid uuid,payload jsonb) returns jsonb
language plpgsql volatile set search_path = '' as $$
declare
  expected integer := (payload->>'revision')::integer;
  stored public.group_library_layouts;
  points jsonb := payload->'positions';
  shapes jsonb;
  new_order jsonb;
  visible_extras jsonb;
  base_palette constant text[] := array['shelf','desk','lamp','chair','plant'];
  full_palette constant text[] := array['shelf','frame','desk','lamp','laptop','chair','plant'];
  old_client boolean := not (payload ? 'extras');
begin
  if expected is null or expected < 0 then raise exception '배치 정보를 확인해 주세요.' using errcode = '22023'; end if;
  if jsonb_typeof(points) is distinct from 'object' then
    raise exception '아이템 위치를 확인해 주세요.' using errcode = '22023';
  end if;
  insert into public.group_library_layouts(group_id) values (gid) on conflict do nothing;
  select * into stored from public.group_library_layouts where group_id = gid;
  visible_extras := coalesce(payload->'extras',stored.extras);
  if visible_extras = '["laptop","frame"]'::jsonb then visible_extras := '["frame","laptop"]'::jsonb; end if;
  if visible_extras not in ('[]'::jsonb,'["frame"]'::jsonb,'["laptop"]'::jsonb,'["frame","laptop"]'::jsonb) then
    raise exception '공동 공간에 표시할 소품을 확인해 주세요.' using errcode = '22023';
  end if;

  shapes := coalesce(payload->'transforms',stored.transforms);
  if old_client then
    -- Older payloads edit the original furniture. Keep the decor configuration.
    if points ?| array['frame','laptop'] or (payload->'transforms') ?| array['frame','laptop'] then
      raise exception '이동할 수 없는 아이템입니다.' using errcode = '22023';
    end if;
    points := (stored.positions - base_palette) || points;
    if payload ? 'transforms' then shapes := (stored.transforms - base_palette) || shapes; end if;
  end if;
  shapes := onmode_private.normalize_room_transforms(shapes,full_palette);
  points := onmode_private.normalize_room_positions(points,shapes,full_palette);

  new_order := stored.layer_order;
  if payload ? 'order' then
    if old_client then
      new_order := onmode_private.normalize_room_order(payload->'order',base_palette);
      if jsonb_array_length(stored.layer_order) = cardinality(full_palette)
        or (stored.layer_order = '[]'::jsonb and stored.extras <> '[]'::jsonb) then
        -- Replace the original furniture in its existing slots, leaving decor slots intact.
        with slots as (
          select item,ord,sum((item = any(base_palette))::integer) over (order by ord) as base_index
          from jsonb_array_elements_text(coalesce(nullif(stored.layer_order,'[]'::jsonb),to_jsonb(full_palette))) with ordinality as e(item,ord)
        ), arranged as (
          select item,ord from jsonb_array_elements_text(
            case when new_order = '[]'::jsonb then to_jsonb(base_palette) else new_order end
          ) with ordinality as e(item,ord)
        )
        select jsonb_agg(coalesce(arranged.item,slots.item) order by slots.ord) into new_order
          from slots left join arranged on slots.item = any(base_palette) and arranged.ord = slots.base_index;
        new_order := onmode_private.normalize_room_order(new_order,full_palette);
      end if;
    else
      new_order := onmode_private.normalize_room_order(payload->'order',full_palette);
    end if;
  end if;

  if (points,new_order,shapes,visible_extras) = (stored.positions,stored.layer_order,stored.transforms,stored.extras) then
    return jsonb_build_object('room',onmode_private.shared_room_json(stored));
  end if;
  if expected <> stored.revision then
    raise exception '다른 멤버가 배치를 변경했어요. 최신 배치를 확인해 주세요.' using errcode = '40001';
  end if;
  update public.group_library_layouts
    set revision = revision + 1,positions = points,layer_order = new_order,transforms = shapes,extras = visible_extras
    where group_id = gid returning * into stored;
  update public.group_updates set version = version + 1 where group_id = gid;
  return jsonb_build_object('room',onmode_private.shared_room_json(stored));
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
    'room',coalesce((select onmode_private.shared_room_json(l)
      from public.group_library_layouts l where l.group_id = gid),'{"revision":0,"positions":{}}'::jsonb),
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
