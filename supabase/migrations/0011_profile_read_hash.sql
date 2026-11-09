-- 0011_profile_read_hash.sql
-- A profile is read by the model once and the read is reused while the profile is unchanged. "Unchanged" was
-- judged on the raw scrape, which includes company-logo URLs with signed tokens that LinkedIn rotates on every
-- scrape, so every re-scrape looked like a new profile and was read again (with slightly different results).
-- The hash is now taken over the exact text the model reads, so only a real change triggers a new read.

begin;

drop function if exists save_profile(uuid, jsonb);

create or replace function save_profile(p_talent uuid, p_profile jsonb, p_read_text text default null)
returns jsonb language plpgsql set search_path = public as $$
declare
  cfg jsonb := (select config from scoring_config where active);
  h   text;
  nm  text;
begin
  h := encode(sha256(convert_to(coalesce(p_read_text, jsonb_build_object(
         'experience', p_profile->'experience', 'skills', p_profile->'skills', 'headline', p_profile->'headline',
         'about', p_profile->'about', 'education', p_profile->'education')::text), 'utf8')), 'hex');
  nm := nullif(trim(concat_ws(' ', p_profile->>'firstName', p_profile->>'lastName')), '');
  update talents set profile_raw = p_profile, profile_hash = h, profile_scraped_at = now(),
                     name = coalesce(name, nm), updated_at = now()
  where id = p_talent;
  return jsonb_build_object('hash', h, 'name', nm,
    'fact_exists', exists (select 1 from talent_facts where talent_id = p_talent and profile_hash = h
                           and prompt_version = coalesce(cfg->>'talent_prompt_version', cfg->>'prompt_version') and model = cfg->>'model'));
end $$;

revoke all on function save_profile(uuid, jsonb, text) from public, anon, authenticated;
grant execute on function save_profile(uuid, jsonb, text) to service_role;

-- existing reads: re-key them to the new hash of the stored profile isn't possible in SQL (the text is built in
-- n8n), so the next run reads each profile once more and then reuses that read.

commit;
