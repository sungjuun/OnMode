create table public.group_messages (
  id uuid primary key,
  group_id uuid not null references public.study_groups on delete cascade,
  sender_id uuid not null references auth.users on delete cascade,
  body text,
  created_at timestamptz not null default clock_timestamp(),
  deleted_at timestamptz,
  check ((deleted_at is null and body is not null and char_length(btrim(body)) between 1 and 2000)
    or (deleted_at is not null and body is null))
);
create index group_messages_page_idx on public.group_messages(group_id,created_at desc,id desc);
create index group_messages_sender_idx on public.group_messages(sender_id,created_at desc);
create table public.group_chat_updates (
  group_id uuid primary key references public.study_groups on delete cascade,
  version bigint not null default 1
);
alter table public.group_messages enable row level security;
alter table public.group_chat_updates enable row level security;
revoke all on public.group_messages,public.group_chat_updates from public,anon,authenticated;
grant select on public.group_messages,public.group_chat_updates to authenticated;
create policy members_read_messages on public.group_messages for select to authenticated
  using (onmode_private.is_member(group_id));
create policy members_read_chat_updates on public.group_chat_updates for select to authenticated
  using (onmode_private.is_member(group_id));
alter publication supabase_realtime add table public.group_chat_updates;

create function onmode_private.chat_list(gid uuid,cursor_at timestamptz,cursor_id uuid) returns jsonb
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
    'body',m.body,'createdAt',m.created_at,'deletedAt',m.deleted_at
  ) order by m.created_at desc,m.id desc)
  from (
    select * from public.group_messages where group_id = gid
      and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
    order by created_at desc,id desc limit 31
  ) m left join public.profiles p on p.user_id = m.sender_id),'[]'::jsonb);
end $$;

create function onmode_private.chat_change(gid uuid,action text,payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  mid uuid := (payload->>'id')::uuid;
  content text := btrim(payload->>'body');
  member_role text; message_sender uuid;
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
  elsif action = 'delete' then
    select sender_id into message_sender from public.group_messages where id = mid and group_id = gid;
    if not found or (message_sender <> uid and member_role <> 'owner') then
      raise exception '내 메시지 또는 그룹장 권한으로만 삭제할 수 있습니다.' using errcode = '42501';
    end if;
    update public.group_messages set body = null,deleted_at = clock_timestamp()
      where id = mid and group_id = gid and deleted_at is null;
    if not found then return mid; end if;
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  insert into public.group_chat_updates(group_id) values (gid)
    on conflict(group_id) do update set version = public.group_chat_updates.version + 1;
  return mid;
end $$;

create function public.onmode_chat_messages(group_id uuid,cursor_at timestamptz default null,cursor_id uuid default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.chat_list(group_id,cursor_at,cursor_id) $$;
create function public.onmode_chat_change(group_id uuid,action text,payload jsonb) returns uuid
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.chat_change(group_id,action,payload) $$;
revoke execute on function onmode_private.chat_list(uuid,timestamptz,uuid),onmode_private.chat_change(uuid,text,jsonb),
  public.onmode_chat_messages(uuid,timestamptz,uuid),public.onmode_chat_change(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function onmode_private.chat_list(uuid,timestamptz,uuid),onmode_private.chat_change(uuid,text,jsonb),
  public.onmode_chat_messages(uuid,timestamptz,uuid),public.onmode_chat_change(uuid,text,jsonb) to authenticated;
