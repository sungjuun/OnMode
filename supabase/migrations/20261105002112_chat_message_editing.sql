-- Existing messages retain their creation time and pagination position.
alter table public.group_messages
  add column version integer not null default 1 check (version > 0),
  add column edited_at timestamptz,
  add column last_edit_id uuid,
  add constraint group_messages_edit_metadata check ((edited_at is null) = (last_edit_id is null));

create or replace function onmode_private.chat_list(gid uuid,cursor_at timestamptz,cursor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 대화를 볼 수 있습니다.' using errcode = '42501';
  end if;
  if (cursor_at is null) <> (cursor_id is null) then
    raise exception '이전 대화를 다시 불러와 주세요.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',m.id,'senderId',m.sender_id,'senderName',coalesce(p.name,'집중러'),
    'body',m.body,'createdAt',m.created_at,'deletedAt',m.deleted_at,'version',m.version,'editedAt',m.edited_at
  ) order by m.created_at desc,m.id desc)
  from (
    select * from public.group_messages where group_id = gid
      and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
    order by created_at desc,id desc limit 31
  ) m left join public.profiles p on p.user_id = m.sender_id),'[]'::jsonb);
end $$;

create or replace function onmode_private.chat_change(gid uuid,action text,payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  mid uuid := (payload->>'id')::uuid;
  content text := btrim(payload->>'body');
  member_role text; message_sender uuid; existing public.group_messages;
  expected integer; request_id uuid;
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform 1 from public.study_groups where id = gid for no key update;
  select role into member_role from public.group_members where group_id = gid and user_id = uid;
  if member_role is null then
    raise exception '그룹 멤버만 대화에 참여할 수 있습니다.' using errcode = '42501';
  end if;
  if action = 'send' then
    if content is null or char_length(content) not between 1 and 2000 then
      raise exception '메시지는 1~2,000자로 입력해 주세요.' using errcode = '22023';
    end if;
    if exists(select 1 from public.group_messages where id = mid) then
      if exists(select 1 from public.group_messages where id = mid and group_id = gid and sender_id = uid
        and (body = content or deleted_at is not null)) then return mid;
      else raise exception '전송 내용을 확인한 뒤 다시 시도해 주세요.' using errcode = '22023'; end if;
    end if;
    if (select count(*) from public.group_messages
      where sender_id = uid and created_at >= clock_timestamp() - interval '1 minute') >= 30 then
      raise exception '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.' using errcode = 'P0001';
    end if;
    insert into public.group_messages(id,group_id,sender_id,body) values (mid,gid,uid,content);
  elsif action = 'edit' then
    select * into existing from public.group_messages where id = mid and group_id = gid for update;
    if not found or existing.sender_id <> uid then
      raise exception '내 메시지만 수정할 수 있습니다.' using errcode = '42501';
    end if;
    if existing.deleted_at is not null then
      raise exception '삭제된 메시지는 수정할 수 없어요. 최신 대화를 확인해 주세요.' using errcode = '40001';
    end if;
    if jsonb_typeof(payload->'body') is distinct from 'string' or content is null
      or char_length(content) not between 1 and 2000 or content ~ '^[[:space:]]*$' then
      raise exception '메시지는 1~2,000자로 입력해 주세요.' using errcode = '22023';
    end if;
    if jsonb_typeof(payload->'version') is distinct from 'number' or (payload->>'version') !~ '^[0-9]+$'
      or jsonb_typeof(payload->'editId') is distinct from 'string'
      or (payload->>'editId') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception '수정 정보를 확인해 주세요.' using errcode = '22023';
    end if;
    if (payload->>'version')::numeric not between 1 and 2147483646 then
      raise exception '수정 정보를 확인해 주세요.' using errcode = '22023';
    end if;
    expected := (payload->>'version')::integer; request_id := (payload->>'editId')::uuid;
    if existing.last_edit_id = request_id then
      if existing.body = content then return mid; end if;
      raise exception '같은 수정 요청의 내용을 확인해 주세요.' using errcode = '22023';
    end if;
    if expected <> existing.version then
      raise exception '다른 곳에서 메시지가 수정됐어요. 최신 대화를 확인해 주세요.' using errcode = '40001';
    end if;
    if existing.body = content then return mid; end if;
    update public.group_messages set body = content,version = version + 1,edited_at = clock_timestamp(),last_edit_id = request_id
      where id = mid and group_id = gid;
  elsif action = 'delete' then
    select sender_id into message_sender from public.group_messages where id = mid and group_id = gid;
    if not found or (message_sender <> uid and member_role <> 'owner') then
      raise exception '내 메시지 또는 그룹장 권한으로만 삭제할 수 있습니다.' using errcode = '42501';
    end if;
    update public.group_messages set body = null,deleted_at = clock_timestamp(),version = version + 1,edited_at = null,last_edit_id = null
      where id = mid and group_id = gid and deleted_at is null;
    if not found then return mid; end if;
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  insert into public.group_chat_updates(group_id) values (gid)
    on conflict(group_id) do update set version = public.group_chat_updates.version + 1;
  return mid;
end $$;

-- CREATE OR REPLACE retains the existing private-function ACLs and invoker wrappers.
-- No table write grants or new client-callable functions are added.
