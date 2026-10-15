-- ═══════════════════════════════════════════════════════════════════════════
-- THE SALES BRAIN: the whole Drive, with a tier on every folder.
-- Run after 29-memory-vectors.sql. Idempotent. Safe to re-run.
--
-- 29 built a brain that reads ONE folder called "DMP" and answers only the
-- Deal Copilot. This widens the corpus to everything the service account can
-- see and opens it to the whole team — which immediately creates a problem
-- 29 never had to solve.
--
-- A Drive that holds collateral also holds contracts, costings, salaries and
-- board papers. Index all of it and any salesperson who asks the right
-- question gets an answer out of a file they were never meant to open. The
-- crawler cannot tell the difference; nothing in Drive's own sharing reaches
-- a service account that has been given the lot.
--
-- So every chunk carries the TOP-LEVEL FOLDER it came from, and every
-- top-level folder carries a TIER. Retrieval filters on it.
--
-- THE BRIEF WAS: reach everything, disclose nothing from finance, commercial
-- or HR. That is a deny-list, so the crawler classifies each new folder by
-- NAME on first sight (see SENSITIVE in api/memory.js) — anything matching
-- finance / payroll / salary / HR / legal / contract / costing / margin /
-- invoice / board / investor lands on 'admin', everything else on 'all'.
-- The team gets the whole Drive on day one without a human sorting fifteen
-- folders first.
--
-- The column default here is the opposite — 'admin' — on purpose. It is the
-- backstop for a row that somehow arrives without having been classified,
-- and a backstop should fail closed. The crawler always classifies; if it
-- ever does not, the chunk is invisible rather than public.
--
-- Two honest limits on this control:
--   • it is FOLDER-level. A salary table filed inside Eb-07-Sales is open,
--     because nothing here reads the contents to decide.
--   • it is NAME-based. "Eb-04-Finance" is caught; a folder called
--     "Eb-21-Board Papers" is caught by 'board'; one called "Eb-22-Misc"
--     holding the cap table is not. The admin screen lists every folder and
--     what it was assigned, so the guesses can be corrected — and reviewing
--     that list once is the real control, not the regex.
--
--   sales.brain_folders   one row per top-level Drive folder → its tier
--   memory_chunks.tier    denormalised onto the chunk, so retrieval is a
--                         plain WHERE and no join can be forgotten
--   memory_chunks.kind    'text'  we read the contents
--                         'file'  we could not (a .pptx, a PDF, an image)
--                                 and this row exists so the thing is still
--                                 findable and linkable BY NAME
--   memory_chunks.file_id already existed; it is what makes a Drive link,
--                         and the 29 RPCs drop it. These return it.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── the corpus ─────────────────────────────────────────────────────────────
alter table sales.memory_chunks add column if not exists top_folder text not null default '';
alter table sales.memory_chunks add column if not exists tier        text not null default 'admin';
alter table sales.memory_chunks add column if not exists kind        text not null default 'text';
alter table sales.memory_chunks add column if not exists mime        text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'memory_chunks_tier_check') then
    alter table sales.memory_chunks add constraint memory_chunks_tier_check
      check (tier in ('all', 'leadership', 'admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'memory_chunks_kind_check') then
    alter table sales.memory_chunks add constraint memory_chunks_kind_check
      check (kind in ('text', 'file'));
  end if;
end $$;

create index if not exists memory_chunks_tier_idx on sales.memory_chunks(tier);
create index if not exists memory_chunks_folder_idx on sales.memory_chunks(top_folder);

comment on column sales.memory_chunks.tier is
  'Who may retrieve this chunk. Copied from brain_folders at crawl time so
   retrieval never has to join — a forgotten join here leaks a salary review
   into a sales answer.';
comment on column sales.memory_chunks.kind is
  '''text'' = contents indexed. ''file'' = a binary we cannot read (.pptx,
   .pdf, images); the row carries only name and path so the file is still
   findable and linkable. An answer must never imply it read one of these.';

-- Anything already crawled came from the DMP folder, which is collateral.
-- Classify it rather than leaving it stranded behind the admin default.
update sales.memory_chunks
   set top_folder = coalesce(nullif(split_part(folder_path, '/', 1), ''), 'DMP'),
       tier = 'all'
 where top_folder = '';

-- ── who may read which folder ──────────────────────────────────────────────
create table if not exists sales.brain_folders (
  folder     text primary key,            -- top-level Drive folder name
  tier       text not null default 'admin'
               check (tier in ('all', 'leadership', 'admin')),
  indexed    boolean not null default true,  -- false = do not crawl at all
  note       text,
  seen_at    timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table sales.brain_folders is
  'One row per top-level folder the crawler has met, with who may retrieve
   from it. The crawler proposes a tier from the folder NAME; a human
   corrects it here, and the correction sticks — a re-crawl never overwrites
   a tier somebody set. indexed=false skips the folder entirely, for the
   ones whose contents should not be in a database at all rather than merely
   filtered out of answers.';

-- Seeded from the Drive as it stands, so the first crawl starts from a
-- policy rather than from a guess. The crawler adds whatever else it finds.
-- Everything here is editable in the app; none of it is load-bearing.
insert into sales.brain_folders (folder, tier, note) values
  ('Digital Manufacturing Platform', 'all', 'Playbooks and process — the original brain corpus.'),
  ('DMP',                 'all',        'Alias of the above, where it is named short.'),
  ('Eb-01-Box build',     'all',        'Capability and build collateral.'),
  ('Eb-02-ODM',           'all',        'ODM capability — the deck a salesperson needs most.'),
  ('Eb-07-Sales',         'all',        'The sales team''s own material.'),
  ('Eb-08-Products',      'all',        'Product specs and sheets.'),
  ('Eb-09-Infrastructure','all',        'Plant and equipment — answers "can you actually make this".'),
  ('Eb-15-Clients',       'all',        'Client folders the sales team already works in.'),
  ('Eb-17-Projects',      'all',        'Delivered work, useful as proof.'),
  ('Eb-Central-ULM',      'all',        'Sanctioning and project IDs.'),
  ('Eb-04-Finance',       'admin',      'FINANCE — excluded by the brief.'),
  ('Eb-10-Partnership',   'leadership', 'Commercial terms between companies — excluded from the team.'),
  ('Eb-14-Vendors',       'leadership', 'Vendor pricing is our cost base; it is commercial.')
on conflict (folder) do nothing;

alter table sales.brain_folders enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='brain_folders' and policyname='brain_folders_read') then
    create policy brain_folders_read on sales.brain_folders for select to authenticated using (true);
  end if;
  -- Only a sales admin reclassifies a folder. This is the control that
  -- decides who can read what; it is not ordinary account work.
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='brain_folders' and policyname='brain_folders_write') then
    create policy brain_folders_write on sales.brain_folders for all to authenticated
      using (sales.is_sales_admin()) with check (sales.is_sales_admin());
  end if;
end $$;
grant select on sales.brain_folders to authenticated;
grant insert, update, delete on sales.brain_folders to authenticated;
grant all on sales.brain_folders to service_role;
revoke all on sales.brain_folders from anon;

-- ── retrieval, tier-filtered, and returning the file id ────────────────────
-- p_tiers is what the ASKER may see. The caller passes it; these functions
-- are SECURITY DEFINER and would otherwise hand back everything.
--
-- file_id comes back now. Without it there is no Drive link, and "give me
-- the deck" was the whole point.

create or replace function sales.match_memory(
  query_embedding vector(512), match_count int default 8, p_tiers text[] default array['all']
) returns table (file_id text, file_name text, folder_path text, content text, kind text, similarity float)
language sql stable security definer set search_path = sales, public as $$
  select m.file_id, m.file_name, m.folder_path, m.content, m.kind,
         1 - (m.embedding <=> query_embedding) as similarity
  from sales.memory_chunks m
  where m.embedding is not null
    and m.tier = any(coalesce(p_tiers, array['all']))
  order by m.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;

create or replace function sales.search_memory_text(
  q text, match_count int default 8, p_tiers text[] default array['all']
) returns table (file_id text, file_name text, folder_path text, content text, kind text, similarity float)
language sql stable security definer set search_path = sales, public as $$
  select m.file_id, m.file_name, m.folder_path, m.content, m.kind,
         ts_rank(to_tsvector('english', m.content), websearch_to_tsquery('english', q))::float as similarity
  from sales.memory_chunks m
  where to_tsvector('english', m.content) @@ websearch_to_tsquery('english', q)
    and m.tier = any(coalesce(p_tiers, array['all']))
  order by similarity desc
  limit greatest(1, least(match_count, 20));
$$;

/* MATCHING ON THE NAME, which the content search cannot do.

   Two different files need this and they need different things done with
   the result:

     • a .pptx or PDF we cannot open — its name is all we have, and it is
       still the answer to "send me the capability deck";
     • a Google Doc we read in full but whose text never repeats its own
       title. "Trade show plan" is a real document whose contents are about
       Electronica, hall 4; ask for it by name and a content search returns
       nothing at all.

   So this returns `content` and `kind` as well, and the caller routes on
   kind: a readable file found by name becomes a quotable passage, an
   unreadable one becomes a link and nothing more.

   ILIKE rather than a tsvector, because a filename is not prose —
   "ODM-Capability-Deck-v4.pptx" tokenises into nothing useful. */
-- Postgres refuses to change a function's return type in place, and this one
-- grew a `content` column during development. Drop first so re-running the
-- file is actually idempotent for anyone who took an earlier copy.
drop function if exists sales.search_memory_files(text, int, text[]);
create or replace function sales.search_memory_files(
  q text, match_count int default 6, p_tiers text[] default array['all']
) returns table (file_id text, file_name text, folder_path text, kind text, mime text, content text)
language sql stable security definer set search_path = sales, public as $$
  with words as (
    select unnest(string_to_array(lower(regexp_replace(coalesce(q,''), '[^a-zA-Z0-9 ]', ' ', 'g')), ' ')) as w
  ), terms as (
    select w from words where length(w) > 2
  )
  select distinct on (m.file_id)
         m.file_id, m.file_name, m.folder_path, m.kind, m.mime, m.content
    from sales.memory_chunks m
   where m.tier = any(coalesce(p_tiers, array['all']))
     and exists (select 1 from terms t
                  where m.file_name ilike '%' || t.w || '%'
                     or m.folder_path ilike '%' || t.w || '%')
   order by m.file_id, m.chunk_index
   limit greatest(1, least(match_count, 20));
$$;

-- The old two-argument signatures are gone; drop them so a stale caller
-- fails loudly at the call rather than silently reaching an unfiltered copy.
drop function if exists sales.match_memory(vector, int);
drop function if exists sales.search_memory_text(text, int);

grant execute on function sales.match_memory(vector, int, text[]) to authenticated, service_role;
grant execute on function sales.search_memory_text(text, int, text[]) to authenticated, service_role;
grant execute on function sales.search_memory_files(text, int, text[]) to authenticated, service_role;

select 'chunks'              as t, count(*)::text as n from sales.memory_chunks
union all select 'readable (kind=text)',   count(*)::text from sales.memory_chunks where kind = 'text'
union all select 'link-only (kind=file)',  count(*)::text from sales.memory_chunks where kind = 'file'
union all select 'folders known',          count(*)::text from sales.brain_folders
union all select 'folders open to all',    count(*)::text from sales.brain_folders where tier = 'all'
union all select 'folders still unclassified (admin-only)',
                 count(*)::text from sales.brain_folders where tier = 'admin';
