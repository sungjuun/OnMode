create index study_groups_public_name_idx on public.study_groups ((lower(name) collate "C"),id) where is_public;

create function onmode_private.my_groups() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := onmode_private.require_user();
begin
  return coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',g.id,'name',g.name,'description',g.description,'isPublic',g.is_public,'role',m.role,
    'members',(select count(*) from public.group_members gm where gm.group_id = g.id),
    'goalMinutes',g.goal_minutes,'inviteCode',case when m.role = 'owner' then g.invite_code end
  )) order by g.name,g.id)
  from public.group_members m join public.study_groups g on g.id = m.group_id
  where m.user_id = uid),'[]'::jsonb);
end $$;

create function onmode_private.search_public_groups(search_query text,cursor_name text,cursor_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  uid uuid := onmode_private.require_user();
  tokens text[];
begin
  if char_length(coalesce(search_query,'')) > 120 or (cursor_name is null) <> (cursor_id is null) then
    raise exception '검색어와 페이지 정보를 확인해 주세요.' using errcode = '22023';
  end if;
  tokens := string_to_array(btrim(regexp_replace(lower(coalesce(search_query,'')),'[[:space:]]+',' ','g')),' ');
  -- Take only one page before counting members. The UUID breaks ties across pages.
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',g.id,'name',g.name,'description',g.description,'isPublic',true,
    'members',(select count(*) from public.group_members gm where gm.group_id = g.id)
  ) order by g.sort_name collate "C",g.id)
  from (
    select s.id,s.name,s.description,lower(s.name) collate "C" as sort_name
    from public.study_groups s
    where s.is_public
      and (cursor_name is null or (lower(s.name) collate "C",s.id) > (lower(cursor_name) collate "C",cursor_id))
      and not exists(select 1 from public.group_members m where m.group_id = s.id and m.user_id = uid)
      and not exists(select 1 from unnest(tokens) as t(term)
        where strpos(lower(s.name || ' ' || s.description),t.term) = 0)
    order by sort_name,s.id limit 21
  ) g),'[]'::jsonb);
end $$;

create function public.onmode_my_groups() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.my_groups() $$;
create function public.onmode_search_public_groups(search_query text default '',cursor_name text default null,cursor_id uuid default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select onmode_private.search_public_groups(search_query,cursor_name,cursor_id) $$;
revoke execute on function onmode_private.my_groups(),onmode_private.search_public_groups(text,text,uuid),
  public.onmode_my_groups(),public.onmode_search_public_groups(text,text,uuid) from public,anon,authenticated;
grant execute on function onmode_private.my_groups(),onmode_private.search_public_groups(text,text,uuid),
  public.onmode_my_groups(),public.onmode_search_public_groups(text,text,uuid) to authenticated;
