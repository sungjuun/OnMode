create table onmode_private.room_item_bounds (
  item_id text primary key references public.items,
  min_x integer not null, max_x integer not null,
  min_y integer not null, max_y integer not null
);
-- Bounds match the original SVG extents in src/domain/room.ts.
insert into onmode_private.room_item_bounds values
  ('desk',-173,173,-33,41),('chair',-269,270,-44,30),
  ('shelf',-39,477,-10,64),('frame',-432,120,-58,90),
  ('lamp',-350,206,-34,81),('laptop',-265,268,-33,82),('plant',-498,63,-20,54);
revoke all on onmode_private.room_item_bounds from public,anon,authenticated;

create table public.user_room_layouts (
  user_id uuid primary key references auth.users on delete cascade,
  revision integer not null default 0 check (revision >= 0)
);
create table public.room_item_positions (
  user_id uuid not null references public.user_room_layouts on delete cascade,
  item_id text not null references onmode_private.room_item_bounds,
  offset_x integer not null, offset_y integer not null,
  primary key (user_id,item_id),
  foreign key (user_id,item_id) references public.user_inventory(user_id,item_id) on delete cascade
);
create index room_item_positions_item_idx on public.room_item_positions(item_id);
alter table public.user_room_layouts enable row level security;
alter table public.room_item_positions enable row level security;
revoke all on public.user_room_layouts,public.room_item_positions from public,anon,authenticated;
grant select on public.user_room_layouts,public.room_item_positions to authenticated;
create policy own_room_layout on public.user_room_layouts for select to authenticated
  using (user_id = (select auth.uid()));
create policy own_room_positions on public.room_item_positions for select to authenticated
  using (user_id = (select auth.uid()));

create function onmode_private.append_room(base jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  return jsonb_set(base,'{snapshot,room}',jsonb_build_object(
    'revision',coalesce((select revision from public.user_room_layouts where user_id = uid),0),
    'positions',coalesce((select jsonb_object_agg(item_id,jsonb_build_object('x',offset_x,'y',offset_y))
      from public.room_item_positions where user_id = uid),'{}'::jsonb)
  ));
end $$;

create function onmode_private.snapshot_with_room() returns jsonb
language sql stable security definer set search_path = ''
as $$ select onmode_private.append_room(onmode_private.snapshot()) $$;

create function onmode_private.command_with_room(command jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  expected integer; current_revision integer; candidate jsonb; stored jsonb;
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
  select revision into current_revision from public.user_room_layouts where user_id = uid;
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
  if stored = candidate then return onmode_private.snapshot_with_room(); end if;
  if expected <> current_revision then
    raise exception '다른 곳에서 배치가 변경됐어요. 최신 배치를 불러와 주세요.' using errcode = '40001';
  end if;
  delete from public.room_item_positions where user_id = uid;
  insert into public.room_item_positions(user_id,item_id,offset_x,offset_y)
    select uid,key,(value->>'x')::integer,(value->>'y')::integer from jsonb_each(candidate);
  update public.user_room_layouts set revision = revision + 1 where user_id = uid;
  return onmode_private.snapshot_with_room();
end $$;

create or replace function public.onmode_snapshot() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.snapshot_with_room() $$;
create or replace function public.onmode_command(command jsonb) returns jsonb
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.command_with_room(command) $$;
revoke execute on function onmode_private.append_room(jsonb),onmode_private.snapshot_with_room(),
  onmode_private.command_with_room(jsonb),onmode_private.apply_command(jsonb),
  onmode_private.snapshot() from public,anon,authenticated;
grant execute on function onmode_private.snapshot_with_room(),onmode_private.command_with_room(jsonb) to authenticated;
