create table public.group_notices (
  id uuid primary key,
  group_id uuid not null references public.study_groups on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  body text not null check (char_length(btrim(body)) between 1 and 5000),
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index group_notices_page_idx on public.group_notices(group_id,created_at desc,id desc);
alter table public.group_notices enable row level security;
revoke all on public.group_notices from public,anon,authenticated;
grant select on public.group_notices to authenticated;
create policy members_read_notices on public.group_notices for select to authenticated
  using (onmode_private.is_member(group_id));

create function onmode_private.notice_list(gid uuid, cursor_at timestamptz, cursor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  if not exists(select 1 from public.group_members where group_id = gid and user_id = uid) then
    raise exception '그룹 멤버만 공지를 볼 수 있습니다.' using errcode = '42501';
  end if;
  if (cursor_at is null) <> (cursor_id is null) then
    raise exception '이전 공지를 다시 불러와 주세요.' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',n.id,'title',n.title,'body',n.body,'version',n.version,
    'createdAt',n.created_at,'updatedAt',n.updated_at
  ) order by n.created_at desc,n.id desc) from (
    select * from public.group_notices
    where group_id = gid and (cursor_at is null or (created_at,id) < (cursor_at,cursor_id))
    order by created_at desc,id desc limit 21
  ) n),'[]'::jsonb);
end $$;

create function onmode_private.notice_change(gid uuid, action text, payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  nid uuid := (payload->>'id')::uuid;
  expected_version integer := (payload->>'version')::integer;
  new_title text := btrim(payload->>'title');
  new_body text := btrim(payload->>'body');
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform 1 from public.study_groups where id = gid for no key update;
  if not found or not exists(
    select 1 from public.group_members where group_id = gid and user_id = uid and role = 'owner'
  ) then
    raise exception '그룹장만 공지를 관리할 수 있습니다.' using errcode = '42501';
  end if;
  if action in ('create','edit') and (new_title is null or char_length(new_title) not between 1 and 80
    or new_body is null or char_length(new_body) not between 1 and 5000) then
    raise exception '제목은 1~80자, 내용은 1~5,000자로 입력해 주세요.' using errcode = '22023';
  end if;
  if action = 'create' then
    insert into public.group_notices(id,group_id,title,body)
      values (nid,gid,new_title,new_body) on conflict(id) do nothing;
    if not found then
      if exists(select 1 from public.group_notices where id = nid and group_id = gid
        and title = new_title and body = new_body) then return nid;
      else raise exception '공지를 새로 불러온 뒤 다시 시도해 주세요.' using errcode = '40001'; end if;
    end if;
  elsif action = 'edit' then
    update public.group_notices set title = new_title,body = new_body,version = version + 1,updated_at = clock_timestamp()
      where id = nid and group_id = gid and version = expected_version;
    if not found then
      if exists(select 1 from public.group_notices where id = nid and group_id = gid
        and version = expected_version + 1 and title = new_title and body = new_body) then return nid;
      else raise exception '다른 곳에서 공지가 변경됐어요. 최신 내용을 확인해 주세요.' using errcode = '40001'; end if;
    end if;
  elsif action = 'delete' then
    delete from public.group_notices where id = nid and group_id = gid and version = expected_version;
    if not found then
      if not exists(select 1 from public.group_notices where id = nid and group_id = gid) then return nid;
      else raise exception '다른 곳에서 공지가 변경됐어요. 최신 내용을 확인해 주세요.' using errcode = '40001'; end if;
    end if;
  else raise exception '지원하지 않는 요청입니다.' using errcode = '22023';
  end if;
  update public.group_updates set version = version + 1 where group_id = gid;
  return nid;
end $$;

create function public.onmode_notices(group_id uuid,cursor_at timestamptz default null,cursor_id uuid default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.notice_list(group_id,cursor_at,cursor_id) $$;
create function public.onmode_notice_change(group_id uuid,action text,payload jsonb) returns uuid
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.notice_change(group_id,action,payload) $$;
revoke execute on function onmode_private.notice_list(uuid,timestamptz,uuid),onmode_private.notice_change(uuid,text,jsonb),
  public.onmode_notices(uuid,timestamptz,uuid),public.onmode_notice_change(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function onmode_private.notice_list(uuid,timestamptz,uuid),onmode_private.notice_change(uuid,text,jsonb),
  public.onmode_notices(uuid,timestamptz,uuid),public.onmode_notice_change(uuid,text,jsonb) to authenticated;
