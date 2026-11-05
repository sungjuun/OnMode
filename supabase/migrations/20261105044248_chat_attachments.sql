insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('onmode-chat-files','onmode-chat-files',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain']);

create table public.group_chat_files (
  id uuid primary key,
  group_id uuid not null references public.study_groups on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  membership_since timestamptz not null,
  requested_message_id uuid not null unique,
  message_id uuid unique references public.group_messages on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp','application/pdf','text/plain')),
  bytes integer not null check (bytes between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  object_name text not null unique,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '15 minutes'
);
create index group_chat_files_group on public.group_chat_files(group_id);
create index group_chat_files_owner on public.group_chat_files(owner_id);
alter table public.group_chat_files enable row level security;
revoke all on public.group_chat_files from public,anon,authenticated;
grant select (id,group_id,message_id,name,mime,bytes,object_name) on public.group_chat_files to authenticated;
create policy members_read_chat_files on public.group_chat_files for select to authenticated using (
  onmode_private.is_member(group_id) and (message_id is not null or owner_id = (select auth.uid()))
);

-- Tombstones prevent cancelled upload IDs from being reused. Only object IDs
-- remain after deletion, without a filename, owner ID, hash or file contents.
create table onmode_private.chat_file_gc (
  id uuid primary key, object_name text not null unique,
  next_attempt timestamptz not null default clock_timestamp(),
  lease_until timestamptz, completed_at timestamptz
);
revoke all on onmode_private.chat_file_gc from public,anon,authenticated;

create function onmode_private.queue_chat_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into onmode_private.chat_file_gc(id,object_name) values (old.id,old.object_name)
    on conflict(id) do update set completed_at = null,next_attempt = clock_timestamp();
  return old;
end $$;
create trigger queue_deleted_chat_file after delete on public.group_chat_files for each row execute function onmode_private.queue_chat_file();
create function onmode_private.remove_message_file() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.group_chat_files where message_id = new.id;
  return new;
end $$;
create trigger remove_deleted_message_file after update of deleted_at on public.group_messages for each row
  when (old.deleted_at is null and new.deleted_at is not null) execute function onmode_private.remove_message_file();

create function onmode_private.chat_file_json(fid uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id',id,'name',name,'mime',mime,'bytes',bytes,'objectName',object_name) from public.group_chat_files where id = fid
$$;

create function onmode_private.chat_file_change(gid uuid,action text,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user(); fid uuid := (payload->>'id')::uuid;
  mid uuid; joined timestamptz; prior public.group_chat_files;
  fname text := payload->>'name'; mime_type text := payload->>'mime'; file_bytes integer; digest text := payload->>'sha256'; extension text;
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform 1 from public.study_groups where id = gid for no key update;
  select joined_at into joined from public.group_members where group_id = gid and user_id = uid;
  if joined is null then raise exception '그룹 멤버만 파일을 첨부할 수 있습니다.' using errcode = '42501'; end if;
  select * into prior from public.group_chat_files where id = fid for update;
  if action = 'cancel' then
    if prior.id is not null and (prior.owner_id <> uid or prior.group_id <> gid) then
      raise exception '내가 작성 중인 첨부만 취소할 수 있습니다.' using errcode = '42501';
    end if;
    if prior.message_id is not null then return jsonb_build_object('posted',true); end if;
    delete from public.group_chat_files where id = fid and group_id = gid and owner_id = uid;
    return jsonb_build_object('posted',false);
  end if;
  if action is distinct from 'reserve' then raise exception '지원하지 않는 요청입니다.' using errcode = '22023'; end if;
  mid := (payload->>'messageId')::uuid;
  if fid is null or mid is null or fname is null or char_length(fname) not between 1 and 120
    or fname ~ '[[:cntrl:]/:*?"<>|]' or strpos(fname,chr(92)) > 0 or fname ~ '^[. ]|[. ]$'
    or digest is null or digest !~ '^[0-9a-f]{64}$' then
    raise exception '첨부 파일 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  file_bytes := onmode_private.reading_integer(payload->'bytes',10485760);
  if file_bytes < 1 then raise exception '빈 파일은 첨부할 수 없어요.' using errcode = '22023'; end if;
  extension := case mime_type when 'image/jpeg' then 'jpg' when 'image/png' then 'png' when 'image/webp' then 'webp' when 'application/pdf' then 'pdf' when 'text/plain' then 'txt' end;
  if extension is null then raise exception 'JPG·PNG·WebP·PDF·TXT 파일만 첨부할 수 있어요.' using errcode = '22023'; end if;
  if lower(fname) !~ (case when mime_type = 'image/jpeg' then '\.(jpg|jpeg)$' else '\.' || extension || '$' end) then
    raise exception '파일 이름과 형식이 맞지 않아요.' using errcode = '22023';
  end if;
  if prior.id is not null then
    if prior.group_id = gid and prior.owner_id = uid and prior.membership_since = joined and prior.requested_message_id = mid
      and prior.name = fname and prior.mime = mime_type and prior.bytes = file_bytes and prior.sha256 = digest
      and (prior.message_id is not null or prior.expires_at > clock_timestamp()) then return onmode_private.chat_file_json(fid); end if;
    raise exception '첨부 정보가 변경됐어요. 파일을 다시 선택해 주세요.' using errcode = '40001';
  end if;
  if exists(select 1 from onmode_private.chat_file_gc where id = fid) or exists(select 1 from public.group_messages where id = mid) then
    raise exception '이미 처리한 첨부입니다. 파일을 다시 선택해 주세요.' using errcode = '40001';
  end if;
  if (select count(*) from public.group_chat_files where owner_id = uid and message_id is null and expires_at > clock_timestamp()) >= 5 then
    raise exception '작성 중인 첨부가 많아요. 기존 첨부를 취소하거나 잠시 후 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  insert into public.group_chat_files(id,group_id,owner_id,membership_since,requested_message_id,name,mime,bytes,sha256,object_name)
    values (fid,gid,uid,joined,mid,fname,mime_type,file_bytes,digest,fid::text || '.' || extension);
  return onmode_private.chat_file_json(fid);
exception when unique_violation then
  raise exception '첨부가 변경됐어요. 파일을 다시 선택해 주세요.' using errcode = '40001';
end $$;

create function onmode_private.chat_storage_access(object_key text,writing boolean) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  return exists(select 1 from public.group_chat_files f join public.group_members m on m.group_id = f.group_id and m.user_id = uid
    left join public.group_messages msg on msg.id = f.message_id
    where f.object_name = object_key and (
      (not writing and f.message_id is not null and msg.deleted_at is null)
      or (f.message_id is null and f.owner_id = uid and m.joined_at = f.membership_since and f.expires_at > statement_timestamp())
    ));
end $$;
create policy chat_files_download on storage.objects for select to authenticated
  using (bucket_id = 'onmode-chat-files' and onmode_private.chat_storage_access(name,false));
create policy chat_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'onmode-chat-files' and onmode_private.chat_storage_access(name,true));

-- This service-only worker removes actual objects through Storage API. SQL only
-- queues metadata; it never deletes storage.objects. Periodic orphan scanning
-- also catches uploads that complete after cancellation or a lost client.
create function onmode_private.chat_file_gc_work(action text,payload jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare fid uuid; result jsonb;
begin
  if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception '관리 작업입니다.' using errcode = '42501'; end if;
  if action = 'claim' then
    delete from public.group_chat_files f where f.message_id is null and (f.expires_at <= clock_timestamp()
      or not exists(select 1 from public.group_members m where m.group_id = f.group_id and m.user_id = f.owner_id and m.joined_at = f.membership_since));
    if coalesce((payload->>'scan')::boolean,false) then
    insert into onmode_private.chat_file_gc(id,object_name)
      select split_part(o.name,'.',1)::uuid,o.name from storage.objects o
      where o.bucket_id = 'onmode-chat-files' and o.name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf|txt)$'
        and o.created_at < clock_timestamp() - interval '10 minutes'
        and not exists(select 1 from public.group_chat_files f where f.object_name = o.name)
      on conflict(id) do update set completed_at = null;
    end if;
    with claimed as (
      select id from onmode_private.chat_file_gc where completed_at is null and next_attempt <= clock_timestamp()
        and (lease_until is null or lease_until < clock_timestamp()) order by next_attempt,id limit 50 for update skip locked
    ), leased as (
      update onmode_private.chat_file_gc q set lease_until = clock_timestamp() + interval '60 seconds'
      from claimed c where q.id = c.id returning q.id,q.object_name
    ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'objectName',object_name)),'[]'::jsonb) into result from leased;
    return result;
  end if;
  fid := (payload->>'id')::uuid;
  if action = 'done' then update onmode_private.chat_file_gc set completed_at = clock_timestamp(),lease_until = null where id = fid;
  elsif action = 'retry' then update onmode_private.chat_file_gc set next_attempt = clock_timestamp() + interval '60 seconds',lease_until = null where id = fid;
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023'; end if;
  return '{}'::jsonb;
end $$;

create function public.onmode_chat_file(group_id uuid,action text,payload jsonb) returns jsonb
language sql volatile security invoker set search_path = '' as $$ select onmode_private.chat_file_change(group_id,action,payload) $$;
create function public.onmode_chat_file_gc(action text,payload jsonb default '{}') returns jsonb
language sql volatile security invoker set search_path = '' as $$ select onmode_private.chat_file_gc_work(action,payload) $$;
revoke execute on function onmode_private.queue_chat_file(),onmode_private.remove_message_file(),onmode_private.chat_file_json(uuid),
  onmode_private.chat_file_change(uuid,text,jsonb),onmode_private.chat_storage_access(text,boolean),onmode_private.chat_file_gc_work(text,jsonb),
  public.onmode_chat_file(uuid,text,jsonb),public.onmode_chat_file_gc(text,jsonb) from public,anon,authenticated;
grant execute on function onmode_private.chat_file_change(uuid,text,jsonb),onmode_private.chat_storage_access(text,boolean),public.onmode_chat_file(uuid,text,jsonb) to authenticated;
grant usage on schema onmode_private to service_role;
grant execute on function onmode_private.chat_file_gc_work(text,jsonb),public.onmode_chat_file_gc(text,jsonb) to service_role;

create or replace function onmode_private.chat_change(gid uuid,action text,payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  mid uuid := (payload->>'id')::uuid;
  content text := btrim(payload->>'body');
  member_role text; message_sender uuid; existing public.group_messages;
  expected integer; request_id uuid; fid uuid := (payload->>'attachmentId')::uuid; attached public.group_chat_files;
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
        and (body = content or deleted_at is not null)
        and (deleted_at is not null or (select id from public.group_chat_files where message_id = mid) is not distinct from fid)) then return mid;
      else raise exception '전송 내용을 확인한 뒤 다시 시도해 주세요.' using errcode = '22023'; end if;
    end if;
    if fid is not null then
      select * into attached from public.group_chat_files where id = fid and group_id = gid and owner_id = uid and requested_message_id = mid for update;
      if not found or attached.membership_since <> (select joined_at from public.group_members where group_id = gid and user_id = uid) then
        raise exception '내가 올린 첨부만 전송할 수 있습니다.' using errcode = '42501';
      end if;
      if attached.message_id is null and attached.expires_at <= clock_timestamp() then
        raise exception '첨부 시간이 지났어요. 파일을 다시 선택해 주세요.' using errcode = '40001';
      end if;
      if not exists(select 1 from storage.objects where bucket_id = 'onmode-chat-files' and name = attached.object_name and owner_id = uid::text
        and (metadata->>'size')::bigint = attached.bytes and metadata->>'mimetype' = attached.mime) then
        raise exception '파일 업로드가 완료되지 않았어요. 다시 전송해 주세요.' using errcode = '40001';
      end if;
    end if;
    if (select count(*) from public.group_messages
      where sender_id = uid and created_at >= clock_timestamp() - interval '1 minute') >= 30 then
      raise exception '메시지를 너무 빠르게 보내고 있어요. 잠시 후 다시 시도해 주세요.' using errcode = 'P0001';
    end if;
    insert into public.group_messages(id,group_id,sender_id,body) values (mid,gid,uid,content);
    if fid is not null then update public.group_chat_files set message_id = mid where id = fid; end if;
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
    'attachment',(select onmode_private.chat_file_json(id) from public.group_chat_files where message_id = m.id),
    'membershipSince',membership,'readCount',case when m.sender_id = uid then onmode_private.chat_read_count(m.id,uid) else 0 end
  ) order by m.created_at desc,m.id desc)
  from (
    select * from public.group_messages where group_id = gid
      and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
    order by created_at desc,id desc limit 31
  ) m left join public.profiles p on p.user_id = m.sender_id),'[]'::jsonb);
end $$;
