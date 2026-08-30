-- ═══════════════════════════════════════════════════════════════════════════
-- THE DMP BRAIN — what the AI learns from the Google Drive DMP folder
-- (Digital Manufacturing Platform), stored as pgvector embeddings.
--
--   • /api/memory crawls the DMP folder, reads every readable file, chunks
--     the text, embeds it (Voyage; VOYAGE_API_KEY in Vercel) and upserts here.
--   • sales.match_memory() serves nearest-neighbour retrieval to the deal
--     copilot and System Memory search. Until embeddings are configured, the
--     full-text index answers instead — the feature degrades, never dies.
--
-- Run any time after 10-sales-port.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists vector;

create table if not exists sales.memory_chunks (
  id          bigint generated always as identity primary key,
  file_id     text not null,             -- Drive file id
  file_name   text not null,
  folder_path text not null default '',  -- e.g. DMP/Processes/PCBA
  chunk_index int  not null default 0,
  content     text not null,
  embedding   vector(512),               -- voyage-3-lite; null until embedded
  modified    text,                      -- Drive modifiedTime, for change detection
  fetched_at  timestamptz not null default now(),
  unique (file_id, chunk_index)
);
create index if not exists memory_chunks_file_idx on sales.memory_chunks(file_id);
create index if not exists memory_chunks_fts_idx on sales.memory_chunks
  using gin (to_tsvector('english', content));
-- The ANN index arrives once rows exist; ivfflat on an empty table is useless.
do $$ begin
  if (select count(*) from sales.memory_chunks) > 100 then
    if not exists (select 1 from pg_indexes where schemaname='sales' and indexname='memory_chunks_vec_idx') then
      create index memory_chunks_vec_idx on sales.memory_chunks
        using ivfflat (embedding vector_cosine_ops) with (lists = 20);
    end if;
  end if;
end $$;

alter table sales.memory_chunks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='memory_chunks' and policyname='memory_chunks_read') then
    create policy memory_chunks_read on sales.memory_chunks for select to authenticated using (true);
  end if;
end $$;
grant select on sales.memory_chunks to authenticated;
grant all on sales.memory_chunks to service_role;
grant usage on all sequences in schema sales to service_role;
revoke all on sales.memory_chunks from anon;

-- Nearest chunks by cosine distance. SECURITY DEFINER so the app can call it
-- through PostgREST rpc while the table itself stays read-only.
create or replace function sales.match_memory(query_embedding vector(512), match_count int default 8)
returns table (file_name text, folder_path text, content text, similarity float)
language sql stable security definer set search_path = sales, public as $$
  select m.file_name, m.folder_path, m.content,
         1 - (m.embedding <=> query_embedding) as similarity
  from sales.memory_chunks m
  where m.embedding is not null
  order by m.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;
grant execute on function sales.match_memory(vector, int) to authenticated, service_role;

-- The degraded path: plain full-text search when no embeddings exist yet.
create or replace function sales.search_memory_text(q text, match_count int default 8)
returns table (file_name text, folder_path text, content text, similarity float)
language sql stable security definer set search_path = sales, public as $$
  select m.file_name, m.folder_path, m.content,
         ts_rank(to_tsvector('english', m.content), websearch_to_tsquery('english', q))::float as similarity
  from sales.memory_chunks m
  where to_tsvector('english', m.content) @@ websearch_to_tsquery('english', q)
  order by similarity desc
  limit greatest(1, least(match_count, 20));
$$;
grant execute on function sales.search_memory_text(text, int) to authenticated, service_role;

select 'sales.memory_chunks' as t, count(*) from sales.memory_chunks;
