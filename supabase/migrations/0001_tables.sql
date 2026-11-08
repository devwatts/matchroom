-- 0001_tables.sql
-- The 13 tables of the talent–job matching system.
-- Only server code (Next.js route handlers, n8n) connects, with the service key.
-- Row-level security is on with no policies, so the anon key can read nothing.

begin;

-- ---------- talents and settings ----------

create table talents (
  id                 uuid primary key default gen_random_uuid(),
  linkedin_url       text not null unique,
  name               text,
  status             text not null default 'adding'
                     check (status in ('adding', 'active', 'paused', 'window_ended', 'failed')),
  match_days         int  not null default 14 check (match_days between 1 and 90),
  match_until        timestamptz,
  profile_raw        jsonb,
  profile_hash       text,
  profile_scraped_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table talent_facts (
  id             bigint generated always as identity primary key,
  talent_id      uuid not null references talents(id) on delete cascade,
  profile_hash   text not null,
  prompt_version text not null,
  model          text not null,
  years_computed numeric(5,2) not null,
  level          text not null check (level in ('internship', 'entry', 'associate', 'mid-senior', 'director', 'executive')),
  level_evidence text,
  role_family    text not null,
  plain_title    text,
  search_titles  text[] not null default '{}',
  skills         jsonb  not null default '[]',   -- [{name, evidence: work_history | listed_only}]
  industries     text[] not null default '{}',   -- industries of the talent's employers
  raw_response   jsonb,
  created_at     timestamptz not null default now(),
  unique (talent_id, profile_hash, prompt_version, model)
);

create table talent_settings (
  talent_id            uuid primary key references talents(id) on delete cascade,
  search_titles        text[] not null default '{}',
  skills               jsonb  not null default '[]',   -- [{name, source: work | listed | recruiter}]
  excluded_companies   text[] not null default '{}',
  excluded_industries  text[] not null default '{}',   -- LinkedIn industry labels
  excluded_title_words text[] not null default '{}',
  needs_sponsorship    boolean not null default false,
  level_override       text check (level_override in ('internship', 'entry', 'associate', 'mid-senior', 'director', 'executive')),
  startup_preference   text not null default 'none' check (startup_preference in ('none', 'seed_b', 'a_d', 'any')),
  min_score            int  not null default 65 check (min_score between 0 and 100),
  first_search_window  text not null default 'week' check (first_search_window in ('24h', 'week', 'month', 'any')),
  weights              jsonb not null default '{"skills": 35, "role": 30, "seniority": 15, "location": 0, "company_type": 20}',
  version              int  not null default 1,
  updated_at           timestamptz not null default now()
);

create table role_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  settings   jsonb not null,               -- same shape as talent_settings, minus talent_id
  created_at timestamptz not null default now()
);

-- ---------- companies and jobs ----------

create table companies (
  company_linkedin_id text primary key,
  name                text not null,
  industries          text[] not null default '{}',   -- LinkedIn industry labels
  employee_count      int,
  founded_year        int,
  stage               text not null default 'unknown'
                      check (stage in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d', 'startup', 'later', 'public', 'not_startup', 'unknown')),  -- 'startup' = inferred, round unknown
  stage_source        text not null default 'unknown' check (stage_source in ('verified', 'inferred', 'unknown')),
  stage_evidence      text,
  raw                 jsonb,
  fetched_at          timestamptz             -- set when the company actor enriched it
);

create table jobs (
  linkedin_job_id     text primary key,
  title               text not null,
  company_linkedin_id text references companies(company_linkedin_id),
  company_name        text,
  location            text,
  workplace_type      text,
  employment_type     text,
  experience_level    text,
  posted_at           timestamptz,
  url                 text,
  description         text,
  raw                 jsonb,
  content_hash        text not null,
  first_seen_at       timestamptz not null default now()
);

create table pipeline_runs (
  id                 uuid primary key default gen_random_uuid(),
  talent_id          uuid not null references talents(id) on delete cascade,
  trigger            text not null check (trigger in ('onboarding', 'daily', 'rescore')),
  status             text not null default 'running' check (status in ('running', 'finished', 'failed')),
  posted_window_used text check (posted_window_used in ('24h', 'week', 'month', 'any')),
  recovery_mode      boolean not null default false,
  n8n_execution_id   text,
  error              text,
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);

create table pipeline_run_steps (
  id              bigint generated always as identity primary key,
  pipeline_run_id uuid not null references pipeline_runs(id) on delete cascade,
  step            text not null check (step in ('enrich', 'discover', 'filter', 'match')),
  status          text not null default 'waiting' check (status in ('waiting', 'running', 'finished', 'failed', 'skipped')),
  summary         text,                       -- one line for the recruiter
  details         jsonb not null default '[]', -- bullet lines
  log             jsonb not null default '[]', -- [{at, msg}]
  counts          jsonb not null default '{}',
  error           text,
  started_at      timestamptz,
  finished_at     timestamptz,
  unique (pipeline_run_id, step)
);

create table talent_jobs (
  talent_id             uuid not null references talents(id) on delete cascade,
  job_id                text not null references jobs(linkedin_job_id),
  first_discovered_at   timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  first_search_title    text,
  first_pipeline_run_id uuid references pipeline_runs(id) on delete set null,
  primary key (talent_id, job_id)
);

create table job_facts (
  id                      bigint generated always as identity primary key,
  job_id                  text not null references jobs(linkedin_job_id),
  content_hash            text not null,
  prompt_version          text not null,
  model                   text not null,
  agency                  text not null check (agency in ('employer', 'agency', 'unsure')),
  agency_quote            text,
  named_employer          text,
  role_family             text not null,
  level                   text not null check (level in ('internship', 'entry', 'associate', 'mid-senior', 'director', 'executive')),
  level_quote             text,
  experience_paths        jsonb not null default '[]',  -- [{min_years, condition, quote}]
  sponsorship             text not null check (sponsorship in ('no_sponsorship', 'offers', 'not_stated')),
  sponsorship_quote       text,
  must_have_skills        text[] not null default '{}',
  nice_to_have_skills     text[] not null default '{}',
  required_industries     text[] not null default '{}',
  required_industry_quote text,
  funding_quote           text,
  quotes_ok               jsonb not null default '{}',  -- {experience_paths: [bool], required_industry: bool, agency: bool, ...}
  raw_response            jsonb,
  created_at              timestamptz not null default now(),
  unique (job_id, content_hash, prompt_version, model)
);

-- ---------- scoring ----------

create table scoring_config (
  version    int primary key,
  config     jsonb not null,
  active     boolean not null default false,
  notes      text,
  created_at timestamptz not null default now()
);
create unique index scoring_config_one_active on scoring_config (active) where active;

create table company_verdicts (
  id                  bigint generated always as identity primary key,
  company_linkedin_id text not null references companies(company_linkedin_id),
  verdict             text not null check (verdict in ('agency', 'direct_employer')),
  source              text not null check (source in ('recruiter', 'confirmed_suggestion', 'seed')),
  previous_verdict    text check (previous_verdict in ('agency', 'direct_employer')),
  reason              text,
  decided_by          text,
  decided_at          timestamptz not null default now()
);
create index company_verdicts_company on company_verdicts (company_linkedin_id, decided_at desc);

create table matches (
  id                bigint generated always as identity primary key,
  talent_id         uuid not null references talents(id) on delete cascade,
  job_id            text not null references jobs(linkedin_job_id),
  pipeline_run_id   uuid references pipeline_runs(id) on delete set null,
  score             int not null,
  passed            boolean not null,     -- no filter failed
  shown             boolean not null,     -- passed, agency_status = employer, score >= min_score
  filters_failed    text[] not null default '{}',
  breakdown         jsonb not null,       -- per criterion: value, weight, points, label
  reason            text not null,
  agency_status     text not null check (agency_status in ('agency', 'employer', 'needs_check')),
  agency_decided_by text not null check (agency_decided_by in ('recruiter', 'seed', 'linkedin_industry', 'model', 'none')),
  check_reason      text check (check_reason in ('unsure', 'conflicting_verdicts', 'agency_internal_role')),
  agency_evidence   text,
  settings_version  int not null,
  settings_snapshot jsonb not null,
  config_version    int not null references scoring_config(version),
  talent_fact_id    bigint references talent_facts(id) on delete set null,
  job_fact_id       bigint references job_facts(id),
  scored_at         timestamptz not null default now()
);
create index matches_latest on matches (talent_id, job_id, scored_at desc);
create index talent_jobs_job on talent_jobs (job_id);
create index jobs_company on jobs (company_linkedin_id);
create index job_facts_job on job_facts (job_id, created_at desc);
create index pipeline_runs_talent on pipeline_runs (talent_id, started_at desc);

-- ---------- row-level security: on, no policies ----------
do $$
declare t text;
begin
  foreach t in array array['talents', 'talent_facts', 'talent_settings', 'role_templates', 'companies', 'jobs',
                           'pipeline_runs', 'pipeline_run_steps', 'talent_jobs', 'job_facts', 'scoring_config',
                           'company_verdicts', 'matches']
  loop
    execute format('alter table %I enable row level security', t);
  end loop;
end $$;

commit;
