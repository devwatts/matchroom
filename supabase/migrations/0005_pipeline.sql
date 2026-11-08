-- 0005_pipeline.sql
-- Small database functions the n8n workflows call, so each step writes in one
-- batch and the rules (hashing, de-duplication, stage inference) live in SQL.

begin;

-- Save a scraped profile. The hash covers the parts that matter, so a re-scrape with
-- the same content does not trigger a new model read.
create or replace function save_profile(p_talent uuid, p_profile jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  cfg jsonb := (select config from scoring_config where active);
  h   text;
  nm  text;
begin
  h := encode(sha256(convert_to(jsonb_build_object(
         'experience', p_profile->'experience', 'skills', p_profile->'skills', 'headline', p_profile->'headline',
         'about', p_profile->'about', 'education', p_profile->'education')::text, 'utf8')), 'hex');
  nm := nullif(trim(concat_ws(' ', p_profile->>'firstName', p_profile->>'lastName')), '');
  update talents set profile_raw = p_profile, profile_hash = h, profile_scraped_at = now(),
                     name = coalesce(name, nm), updated_at = now()
  where id = p_talent;
  return jsonb_build_object('hash', h, 'name', nm,
    'fact_exists', exists (select 1 from talent_facts where talent_id = p_talent and profile_hash = h
                           and prompt_version = cfg->>'prompt_version' and model = cfg->>'model'));
end $$;

-- Save one batch of job-search results for a talent: companies, jobs and finds.
-- A job seen again only moves last_seen_at; it never counts twice in the funnel.
create or replace function ingest_jobs(p_talent uuid, p_run uuid, p_items jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  n_returned int := jsonb_array_length(p_items);
  n_unique int; n_new int;
begin
  create temp table if not exists tm_items (job_id text primary key, item jsonb, cid text) on commit drop;
  delete from tm_items where true;   -- the API refuses DELETE without WHERE
  insert into tm_items
  select distinct on (i->>'id') i->>'id', i,
         coalesce(i->'company'->>'id', i->'company'->>'universalName', i->'company'->>'name', 'unknown')
  from jsonb_array_elements(p_items) i
  where coalesce(i->>'id', '') <> '';
  get diagnostics n_unique = row_count;

  insert into companies (company_linkedin_id, name, industries, employee_count)
  select distinct on (cid) cid, coalesce(item->'company'->>'name', 'unknown'),
         array(select x->>'name' from jsonb_array_elements(coalesce(item->'company'->'industries', '[]')) x where x->>'name' is not null),
         nullif(item->'company'->>'employeeCount', '')::int
  from tm_items
  on conflict (company_linkedin_id) do update
    set name = excluded.name,
        industries = case when cardinality(excluded.industries) > 0 then excluded.industries else companies.industries end,
        employee_count = coalesce(excluded.employee_count, companies.employee_count);

  insert into jobs (linkedin_job_id, title, company_linkedin_id, company_name, location, workplace_type, employment_type,
                    experience_level, posted_at, url, description, raw, content_hash)
  select job_id, coalesce(item->>'title', ''), cid, item->'company'->>'name', item->'location'->>'linkedinText',
         item->>'workplaceType', item->>'employmentType', item->>'experienceLevel', (item->>'postedDate')::timestamptz,
         item->>'linkedinUrl', item->>'descriptionText', item,
         encode(sha256(convert_to(coalesce(item->>'title', '') || E'\n' || coalesce(item->>'descriptionText', ''), 'utf8')), 'hex')
  from tm_items
  on conflict (linkedin_job_id) do update
    set title = excluded.title, description = excluded.description, raw = excluded.raw,
        content_hash = excluded.content_hash, posted_at = excluded.posted_at, workplace_type = excluded.workplace_type;

  with ins as (
    insert into talent_jobs (talent_id, job_id, first_discovered_at, last_seen_at, first_search_title, first_pipeline_run_id)
    select p_talent, job_id, now(), now(),
           coalesce(item->'query'->>'search', item->'query'->>'jobTitle', item->'query'->>'title', case when jsonb_typeof(item->'query') = 'string' then item->>'query' end), p_run
    from tm_items
    on conflict (talent_id, job_id) do update set last_seen_at = now()
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted) into n_new from ins;

  return jsonb_build_object('returned', n_returned, 'unique', n_unique, 'new', n_new, 'seen_before', n_unique - n_new);
end $$;

-- Jobs for this talent with no model read for their current text, prompt and model.
create or replace function jobs_to_read(p_talent uuid)
returns table (job_id text, content_hash text, title text, company_name text, employee_count int,
               company_description text, experience_level text, description text)
language sql stable set search_path = public as $$
  with cfg as (select config c from scoring_config where active)
  select j.linkedin_job_id, j.content_hash, j.title, j.company_name, co.employee_count,
         left(coalesce(j.raw->'company'->>'description', ''), 1200), j.experience_level, coalesce(j.description, '')
  from talent_jobs tj
  join jobs j on j.linkedin_job_id = tj.job_id
  left join companies co on co.company_linkedin_id = j.company_linkedin_id, cfg
  where tj.talent_id = p_talent
    and not exists (select 1 from job_facts f where f.job_id = j.linkedin_job_id and f.content_hash = j.content_hash
                    and f.prompt_version = cfg.c->>'prompt_version' and f.model = cfg.c->>'model')
$$;

-- Companies of this talent's jobs that the company actor has not enriched yet.
create or replace function companies_to_enrich(p_talent uuid)
returns table (company_linkedin_id text, name text, linkedin_url text)
language sql stable set search_path = public as $$
  select distinct c.company_linkedin_id, c.name, j.raw->'company'->>'linkedinUrl'
  from talent_jobs tj
  join jobs j on j.linkedin_job_id = tj.job_id
  join companies c on c.company_linkedin_id = j.company_linkedin_id
  where tj.talent_id = p_talent and c.fetched_at is null and coalesce(j.raw->'company'->>'linkedinUrl', '') <> ''
$$;

-- Save company-actor results and infer stage from LinkedIn data (never overrides a verified stage).
create or replace function save_company_details(p_items jsonb)
returns int language plpgsql set search_path = public as $$
declare
  cfg jsonb := (select config from scoring_config where active)->'startup_inferred';
  n int;
begin
  with src as (
    select coalesce(i->>'id', i->>'universalName') as cid, i,
           nullif(i->'foundedOn'->>'year', '')::int as founded, nullif(i->>'employeeCount', '')::int as emp, i->>'companyType' as ctype
    from jsonb_array_elements(p_items) i
  )
  update companies c set
    raw = s.i, fetched_at = now(), founded_year = s.founded, employee_count = coalesce(s.emp, c.employee_count),
    industries = coalesce(nullif(array(select x->>'name' from jsonb_array_elements(coalesce(s.i->'industries', '[]')) x where x->>'name' is not null), '{}'), c.industries),
    stage = case when c.stage_source = 'verified' then c.stage
                 when s.ctype ilike 'public%' then 'public'
                 when s.ctype = cfg->>'company_type' and s.founded >= (cfg->>'min_founded_year')::int
                      and coalesce(s.emp, c.employee_count) <= (cfg->>'max_employees')::int then 'startup'
                 when s.founded is not null or s.emp is not null then 'not_startup'
                 else 'unknown' end,
    stage_source = case when c.stage_source = 'verified' then 'verified'
                        when s.ctype is null and s.founded is null and s.emp is null then 'unknown' else 'inferred' end,
    stage_evidence = case when c.stage_source = 'verified' then c.stage_evidence
                          else format('%s, founded %s, %s employees', coalesce(s.ctype, 'type unknown'),
                                      coalesce(s.founded::text, '?'), coalesce(coalesce(s.emp, c.employee_count)::text, '?')) end
  from src s
  where c.company_linkedin_id = s.cid;
  get diagnostics n = row_count;
  return n;
end $$;

-- A funding round quoted in a job read, and found in the text, marks the company's stage as verified.
create or replace function apply_funding_quotes(p_talent uuid)
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  with q as (
    select distinct on (j.company_linkedin_id) j.company_linkedin_id, f.funding_quote,
           lower(substring(f.funding_quote from '(?i)(pre-?seed|seed|series\s+[a-h])')) as round
    from talent_jobs tj
    join jobs j on j.linkedin_job_id = tj.job_id
    join job_facts_current f on f.job_id = j.linkedin_job_id
    where tj.talent_id = p_talent and coalesce(f.funding_quote, '') <> ''
      and position(left(tm_flat(f.funding_quote), 40) in tm_flat(j.description)) > 0
    order by j.company_linkedin_id, f.created_at desc
  )
  update companies c set
    stage = case when q.round ~ '^pre' then 'pre_seed' when q.round = 'seed' then 'seed'
                 when q.round ~ 'series\s+[a-d]$' then 'series_' || right(q.round, 1) else 'later' end,
    stage_source = 'verified', stage_evidence = q.funding_quote
  from q where c.company_linkedin_id = q.company_linkedin_id and q.round is not null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Runs still "running" after 30 minutes (n8n crashed or was restarted) are marked failed.
create or replace function mark_stale_runs()
returns int language plpgsql set search_path = public as $$
declare n int;
begin
  update pipeline_run_steps s set status = 'failed', error = 'Run stopped without finishing (marked failed after 30 minutes).', finished_at = now()
  from pipeline_runs r where s.pipeline_run_id = r.id and r.status = 'running' and r.started_at < now() - interval '30 minutes'
    and s.status in ('running', 'waiting');
  update pipeline_runs set status = 'failed', error = 'Run stopped without finishing (marked failed after 30 minutes).', finished_at = now()
  where status = 'running' and started_at < now() - interval '30 minutes';
  get diagnostics n = row_count;
  return n;
end $$;

-- What a scoring run produced, for the step summary.
create or replace function run_summary(p_run uuid)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'scored', count(*),
    'shown', count(*) filter (where m.shown),
    'agency', count(*) filter (where m.agency_status = 'agency'),
    'held', count(*) filter (where m.agency_status = 'needs_check'),
    'filtered', count(*) filter (where m.agency_status = 'employer' and not m.passed),
    'below_min', count(*) filter (where m.agency_status = 'employer' and m.passed and not m.shown),
    'agency_examples', (select coalesce(jsonb_agg(distinct j2.company_name), '[]') from (select * from matches x where x.pipeline_run_id = p_run and x.agency_status = 'agency' limit 50) a join jobs j2 on j2.linkedin_job_id = a.job_id),
    'filter_counts', (select coalesce(jsonb_object_agg(g, c), '{}') from (select unnest(filters_failed) g, count(*) c from matches where pipeline_run_id = p_run and agency_status = 'employer' group by 1) z),
    'top', (select coalesce(jsonb_agg(t order by t->>'score' desc), '[]') from (
              select jsonb_build_object('title', j3.title, 'company', j3.company_name, 'score', m3.score) t
              from matches m3 join jobs j3 on j3.linkedin_job_id = m3.job_id
              where m3.pipeline_run_id = p_run and m3.shown order by m3.score desc limit 3) tt))
  from matches m where m.pipeline_run_id = p_run
$$;

-- Only the service role (n8n, Next.js server) may call these.
do $$
declare f text;
begin
  foreach f in array array['save_profile(uuid,jsonb)', 'ingest_jobs(uuid,uuid,jsonb)', 'jobs_to_read(uuid)', 'companies_to_enrich(uuid)',
                           'save_company_details(jsonb)', 'apply_funding_quotes(uuid)', 'mark_stale_runs()', 'run_summary(uuid)', 'score_talent(uuid,uuid)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

commit;
