alter table public.group_messages add constraint group_messages_group_id_id unique (group_id,id);
create table public.group_message_reads (
  group_id uuid not null,
  message_id uuid not null,
  user_id uuid not null,
  version integer not null check (version > 0),
  read_at timestamptz not null default clock_timestamp(),
  primary key (message_id,user_id),
  foreign key (group_id,message_id) references public.group_messages(group_id,id) on delete cascade,
  foreign key (group_id,user_id) references public.group_members(group_id,user_id) on delete cascade
);
create index group_message_reads_message on public.group_message_reads(group_id,message_id);
create index group_message_reads_member on public.group_message_reads(group_id,user_id);
create table public.group_chat_read_updates (
  group_id uuid primary key references public.study_groups on delete cascade,
  version bigint not null default 1
);
alter table public.group_message_reads enable row level security;
alter table public.group_chat_read_updates enable row level security;
revoke all on public.group_message_reads,public.group_chat_read_updates from public,anon,authenticated;
grant select on public.group_message_reads,public.group_chat_read_updates to authenticated;
create policy own_or_authored_reads on public.group_message_reads for select to authenticated
  using (onmode_private.is_member(group_id) and (user_id = (select auth.uid()) or exists(
    select 1 from public.group_messages m where m.id = message_id and m.sender_id = (select auth.uid())
  )));
create policy members_read_receipt_updates on public.group_chat_read_updates for select to authenticated
  using (onmode_private.is_member(group_id));
alter publication supabase_realtime add table public.group_chat_read_updates;

create function onmode_private.chat_read_count(mid uuid,uid uuid) returns bigint
language sql stable set search_path = '' as $$
  select count(*) from public.group_message_reads r join public.group_messages m on m.id = r.message_id
  where m.id = mid and m.sender_id = uid and m.deleted_at is null and r.version = m.version and r.user_id <> uid
$$;

create function onmode_private.chat_read(gid uuid,payload jsonb) returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user(); membership text; entry jsonb; mid uuid;
  seen uuid[] := '{}'; affected integer;
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform 1 from public.study_groups where id = gid for no key update;
  select to_jsonb(joined_at) #>> '{}' into membership from public.group_members where group_id = gid and user_id = uid;
  if membership is null then raise exception '그룹 멤버만 읽음 상태를 저장할 수 있습니다.' using errcode = '42501'; end if;
  if membership is distinct from payload->>'membershipSince' then
    raise exception '그룹 참여 정보가 변경됐어요. 최신 대화를 확인해 주세요.' using errcode = '40001';
  end if;
  if jsonb_typeof(payload->'messages') is distinct from 'array' then
    raise exception '읽음 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  if jsonb_array_length(payload->'messages') not between 1 and 30 then
    raise exception '읽음 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  for entry in select value from jsonb_array_elements(payload->'messages') loop
    if jsonb_typeof(entry) <> 'object' then raise exception '읽음 정보를 확인해 주세요.' using errcode = '22023'; end if;
    if (select count(*) from jsonb_object_keys(entry)) <> 2
      or jsonb_typeof(entry->'id') is distinct from 'string'
      or (entry->>'id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      or jsonb_typeof(entry->'version') is distinct from 'number' or (entry->>'version') !~ '^[0-9]+$' then
      raise exception '읽음 정보를 확인해 주세요.' using errcode = '22023';
    end if;
    if (entry->>'version')::numeric not between 1 and 2147483647 then raise exception '읽음 정보를 확인해 주세요.' using errcode = '22023'; end if;
    mid := (entry->>'id')::uuid;
    if mid = any(seen) then raise exception '읽음 정보를 확인해 주세요.' using errcode = '22023'; end if;
    seen := array_append(seen,mid);
    if not exists(select 1 from public.group_messages where id = mid and group_id = gid) then
      raise exception '이 그룹의 메시지만 확인할 수 있습니다.' using errcode = '42501';
    end if;
  end loop;
  insert into public.group_message_reads as r(group_id,message_id,user_id,version,read_at)
    select gid,m.id,uid,m.version,clock_timestamp()
    from jsonb_to_recordset(payload->'messages') as ref(id uuid,version integer)
    join public.group_messages m on m.id = ref.id and m.group_id = gid
    where m.version = ref.version and m.deleted_at is null and m.sender_id <> uid
    on conflict(message_id,user_id) do update set version = excluded.version,read_at = excluded.read_at
      where r.version < excluded.version;
  get diagnostics affected = row_count;
  if affected > 0 then
    insert into public.group_chat_read_updates(group_id) values (gid)
      on conflict(group_id) do update set version = public.group_chat_read_updates.version + 1;
  end if;
  return affected;
end $$;

create function onmode_private.chat_read_counts(gid uuid,ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 읽음 상태를 볼 수 있습니다.' using errcode = '42501';
  end if;
  if coalesce(cardinality(ids),0) not between 1 and 100 or array_position(ids,null) is not null then
    raise exception '읽음 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'version',m.version,
    'readCount',onmode_private.chat_read_count(m.id,uid))) from public.group_messages m
    where m.group_id = gid and m.sender_id = uid and m.id = any(ids)),'[]'::jsonb);
end $$;

create function public.onmode_chat_read(group_id uuid,payload jsonb) returns integer
language sql volatile security invoker set search_path = '' as $$ select onmode_private.chat_read(group_id,payload) $$;
create function public.onmode_chat_read_counts(group_id uuid,message_ids uuid[]) returns jsonb
language sql stable security invoker set search_path = '' as $$ select onmode_private.chat_read_counts(group_id,message_ids) $$;
revoke execute on function onmode_private.chat_read_count(uuid,uuid),onmode_private.chat_read(uuid,jsonb),
  onmode_private.chat_read_counts(uuid,uuid[]),public.onmode_chat_read(uuid,jsonb),public.onmode_chat_read_counts(uuid,uuid[]) from public,anon,authenticated;
grant execute on function onmode_private.chat_read(uuid,jsonb),onmode_private.chat_read_counts(uuid,uuid[]),
  public.onmode_chat_read(uuid,jsonb),public.onmode_chat_read_counts(uuid,uuid[]) to authenticated;

create or replace function onmode_private.chat_list(gid uuid,cursor_at timestamptz,cursor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user(); membership timestamptz;
begin
  select joined_at into membership from public.group_members where group_id = gid and user_id = uid;
  if membership is null then raise exception '그룹 멤버만 대화를 볼 수 있습니다.' using errcode = '42501'; end if;
  if (cursor_at is null) <> (cursor_id is null) then raise exception '이전 대화를 다시 불러와 주세요.' using errcode = '22023'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'senderId',m.sender_id,'senderName',coalesce(p.name,'집중러'),
    'body',m.body,'createdAt',m.created_at,'deletedAt',m.deleted_at,'version',m.version,'editedAt',m.edited_at,
    'membershipSince',membership,'readCount',case when m.sender_id = uid then onmode_private.chat_read_count(m.id,uid) else 0 end
  ) order by m.created_at desc,m.id desc)
  from (
    select * from public.group_messages where group_id = gid
      and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
    order by created_at desc,id desc limit 31
  ) m left join public.profiles p on p.user_id = m.sender_id),'[]'::jsonb);
end $$;
