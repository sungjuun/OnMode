-- Match the JWT to a live Auth session for privileged workspace RPCs.
create or replace function onmode_private.require_user() returns uuid
language plpgsql stable set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null or not exists (
    select 1 from auth.sessions s
    where s.id = nullif(auth.jwt()->>'session_id','')::uuid and s.user_id = uid
      and (s.not_after is null or s.not_after > statement_timestamp())
  ) then
    raise exception '다시 로그인해 주세요.' using errcode = '42501';
  end if;
  return uid;
end $$;

-- Group membership changes and focus commands serialize with deletion on the
-- same per-user profile row. The original group operation still checks roles.
create function onmode_private.locked_group_change(action text, payload jsonb) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  return onmode_private.group_change(action, payload);
end $$;

create or replace function public.onmode_group_change(action text, payload jsonb) returns uuid
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.locked_group_change(action, payload) $$;

create function onmode_private.delete_account(confirmation text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
  cutoff timestamptz := clock_timestamp() - interval '5 minutes';
  gid uuid; member_role text; successor uuid;
begin
  if confirmation is distinct from '계정 삭제' then
    raise exception '삭제 확인 문구가 일치하지 않습니다.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from auth.sessions s
    where s.id = (auth.jwt()->>'session_id')::uuid and s.user_id = uid and s.created_at >= cutoff
  ) or not exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) as a(method)
    where a.method->>'method' = 'password'
      and (a.method->>'timestamp')::numeric >= floor(extract(epoch from cutoff))
  ) then
    raise exception '비밀번호로 다시 로그인해 주세요.' using errcode = '42501';
  end if;

  insert into public.profiles(user_id) values (uid) on conflict do nothing;
  perform 1 from public.profiles where user_id = uid for update;
  perform onmode_private.require_user();

  -- Lock all affected groups in a consistent order before changing memberships.
  perform 1 from public.study_groups g join public.group_members m on m.group_id = g.id
    where m.user_id = uid order by g.id for no key update of g;
  for gid, member_role in
    select group_id, role from public.group_members where user_id = uid order by group_id
  loop
    delete from public.group_members where group_id = gid and user_id = uid;
    if member_role = 'owner' then
      select user_id into successor from public.group_members where group_id = gid order by joined_at,user_id limit 1;
      if successor is null then
        delete from public.study_groups where id = gid;
      else
        update public.group_members set role = 'owner' where group_id = gid and user_id = successor;
      end if;
    end if;
    update public.group_updates set version = version + 1 where group_id = gid;
  end loop;

  -- Cascades remove sessions, personal records, rewards and their group contributions.
  delete from auth.users where id = uid;
  return found;
end $$;

create function public.onmode_delete_account(confirmation text) returns boolean
language sql volatile security invoker set search_path = ''
as $$ select onmode_private.delete_account(confirmation) $$;

revoke execute on function onmode_private.group_change(text,jsonb),
  onmode_private.locked_group_change(text,jsonb),onmode_private.delete_account(text),
  public.onmode_delete_account(text) from public,anon,authenticated;
grant execute on function onmode_private.locked_group_change(text,jsonb),
  onmode_private.delete_account(text),public.onmode_delete_account(text) to authenticated;
