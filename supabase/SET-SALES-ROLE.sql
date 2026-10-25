-- ═══════════════════════════════════════════════════════════════════════════
-- SET SOMEBODY'S SALES ROLE, by email.
--
-- Not a migration — nothing here changes the schema, and it is not part of
-- the numbered run order. It is the two clicks in Admin → Users, written out
-- so it can be pasted once instead of navigated to. Safe to re-run; running
-- it twice sets the same role twice.
--
-- AS SHIPPED IT PROMOTES garvit.joshi@elecbits.in TO ADMIN. Change the two
-- values in the `wanted` block below to use it for anybody else.
--
-- WHAT ADMIN MEANS HERE. It is the ceiling of this tool — there is no higher
-- sales role. The `superadmin` value that exists on core.people belongs to
-- the shared PMS roster and is not read by Sales OS, which resolves
-- permission from sales.people_detail.role alone. So this grants, in full:
--   • every deal and every task on the platform
--   • the Admin, System Memory and Assistant screens
--   • the Sales Brain at every tier, Eb-04-Finance and the commercial
--     folders included — the finance/HR exclusion is keyed on this column,
--     so it does not apply to an admin
--   • creating, resetting and revoking other people's logins
--   • deleting any company or deal, and reclassifying Drive folders
--
-- WHY NOT sales.upsert_person(). That RPC is SECURITY DEFINER and checks
-- is_sales_admin(), which reads auth.uid(). In the SQL editor there is no
-- authenticated user, so auth.uid() is null, the check fails and the call
-- raises 'only a sales admin can manage the sales roster'. The editor runs
-- as the table owner and bypasses RLS, so a direct write is both correct
-- and the only thing that works from here.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
declare
  wanted_email text := 'garvit.joshi@elecbits.in';   -- ← who
  wanted_role  text := 'admin';                      -- ← admin | dept_head | agent | finance
  v_id   uuid;
  v_from text;
begin
  if wanted_role not in ('admin', 'dept_head', 'agent', 'finance') then
    raise exception 'unknown sales role: %', wanted_role;
  end if;

  select id into v_id from core.people where lower(email) = lower(wanted_email) limit 1;
  if v_id is null then
    -- Loud, not silent. A typo in the address would otherwise update nothing
    -- and report success, and nobody checks a role they believe they set.
    raise exception 'Nobody in core.people has the email %. Check the spelling, or add them to the roster first.', wanted_email;
  end if;

  select role into v_from from sales.people_detail where person_id = v_id;

  insert into sales.people_detail (person_id, role, dept, active)
  values (v_id, wanted_role, 'Sales', true)
  on conflict (person_id) do update
    set role = excluded.role, active = true;

  raise notice '% : % -> %', wanted_email, coalesce(v_from, '(not on the sales roster)'), wanted_role;
end $$;

-- The roster as it now stands. Read it before closing the tab: this is the
-- list of who can see everything, and it is the only place it is written down.
select p.name,
       p.email,
       d.role,
       d.active,
       case when p.auth_id is null then 'never signed in' else 'can sign in' end as login
  from sales.people_detail d
  join core.people p on p.id = d.person_id
 order by case d.role when 'admin' then 0 when 'dept_head' then 1
                      when 'finance' then 2 else 3 end,
          p.name;
