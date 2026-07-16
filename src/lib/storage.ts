// Persistence layer — backed by Supabase.
//
// Each "collection" (crm-clients, crm-projects, crm-users, …) is stored as a
// single JSON blob in the `collections` table: one row per key, `data` holds the
// whole list. This keeps the exact loadList/saveList interface the rest of the
// app already uses, so App.tsx is untouched. Access is gated by Row Level
// Security (authenticated users only) — see supabase/schema.sql.
import { supabase } from "./supabase";

async function loadList(key) {
  try {
    const { data, error } = await supabase
      .from("collections")
      .select("data")
      .eq("key", key)
      .maybeSingle();
    if (error) {
      console.error(`loadList(${key}) failed:`, error.message);
      return [];
    }
    return data && Array.isArray(data.data) ? data.data : [];
  } catch (e) {
    console.error(`loadList(${key}) threw:`, e);
    return [];
  }
}

async function saveList(key, list) {
  try {
    const { error } = await supabase
      .from("collections")
      .upsert({ key, data: list, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) {
      console.error(`saveList(${key}) failed:`, error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`saveList(${key}) threw:`, e);
    return false;
  }
}

export { loadList, saveList };
