-- Subjects can stand alone; linked subjects retain the composite ownership FK.
-- Keep all existing book, goal, ISBN, RLS and write-permission constraints.
alter table public.activities
  drop constraint activities_check,
  add constraint activities_check check (
    case when kind = 'subject' then
      goal_minutes is not null and goal_minutes between 1 and 100000
      and author is null and pages is null and current_page is null and goal_pages is null
    else
      certification_id is null and goal_minutes is null
      and author is not null and char_length(btrim(author)) between 1 and 80
      and pages is not null and pages between 1 and 100000
      and current_page is not null and current_page between 0 and pages
      and goal_pages is not null and goal_pages between 1 and 100000
    end
  );
