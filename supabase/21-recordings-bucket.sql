-- ═══════════════════════════════════════════════════════════════════════════
-- A PLACE TO PUT A RECORDING
--
-- Some calls happen where the notetaker cannot go: a client dials a phone, a
-- meeting is recorded on someone's laptop, a site visit is captured on a
-- handset. The audio exists; the transcript does not.
--
-- Fireflies will transcribe a file, but its API takes a URL — it fetches the
-- audio itself. So the file is uploaded here first and the server hands over a
-- SIGNED link that expires. The bucket is private: nothing in it is readable
-- by a URL alone, and a leaked path is not a leaked recording.
--
-- Ported from the ODM PMS (add-recordings-bucket.sql). One difference: the PMS
-- scopes ownership to whoever uploaded. That is kept here — a recording of a
-- client call is not something one person should be able to erase from under
-- another — but the SALES admin roster gets a way through it, because a
-- salesperson leaving should not strand their recordings.
--
-- Run AFTER 10-sales-port.sql (it needs sales.is_sales_admin). Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sales-recordings', 'sales-recordings', false,
  524288000,   -- 500 MB; an hour of speech is nowhere near this
  array['audio/mpeg','audio/mp3','audio/mp4','audio/m4a','audio/x-m4a',
        'audio/wav','audio/x-wav','audio/webm','audio/ogg','video/mp4','video/webm']
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types,
      public             = false;

-- Anyone signed in may add a recording and see what is there. Reading the
-- audio itself goes through a signed URL the server mints.
drop policy if exists "sales: upload recordings" on storage.objects;
create policy "sales: upload recordings"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'sales-recordings');

drop policy if exists "sales: list recordings" on storage.objects;
create policy "sales: list recordings"
  on storage.objects for select to authenticated
  using (bucket_id = 'sales-recordings');

-- Replace / delete: the uploader, or a sales admin.
drop policy if exists "sales: replace own recordings" on storage.objects;
create policy "sales: replace own recordings"
  on storage.objects for update to authenticated
  using (bucket_id = 'sales-recordings'
         and (owner = auth.uid() or sales.is_sales_admin()));

drop policy if exists "sales: delete own recordings" on storage.objects;
create policy "sales: delete own recordings"
  on storage.objects for delete to authenticated
  using (bucket_id = 'sales-recordings'
         and (owner = auth.uid() or sales.is_sales_admin()));

select 'sales-recordings' as bucket,
       (select count(*) from storage.buckets where id = 'sales-recordings') as exists,
       (select count(*) from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and policyname like 'sales: %') as policies;
-- Expect exists = 1, policies = 4.
