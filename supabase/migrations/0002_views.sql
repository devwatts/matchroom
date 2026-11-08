-- 0002_views.sql
-- Read models for the frontend and the funnel. Days are New York calendar days.

begin;

-- Latest verdict per company (verdicts are history, never overwritten).
create view company_verdicts_current with (security_invoker = true) as
select distinct on (company_linkedin_id)
       company_linkedin_id, verdict, source, reason, decided_by, decided_at
from company_verdicts
order by company_linkedin_id, decided_at desc, id desc;

-- Latest model read per job (the read for the job's current text).
create view job_facts_current with (security_invoker = true) as
select distinct on (f.job_id) f.*
from job_facts f
join jobs j on j.linkedin_job_id = f.job_id and j.content_hash = f.content_hash
order by f.job_id, f.created_at desc, f.id desc;

-- Per company with no verdict yet: how the model read its jobs. Feeds suggestions
-- and the "conflicting verdicts" check.
create view company_agency_tally with (security_invoker = true) as
select j.company_linkedin_id,
       c.name                                         as company_name,
       count(*) filter (where f.agency = 'agency')    as agency_reads,
       count(*) filter (where f.agency = 'employer')  as employer_reads,
       count(*) filter (where f.agency = 'unsure')    as unsure_reads,
       case
         when count(*) filter (where f.agency = 'agency') >= 2
          and count(*) filter (where f.agency <> 'agency') = 0 then 'suggest_agency'
         when count(*) filter (where f.agency = 'agency') > 0
          and count(*) filter (where f.agency = 'employer') > 0 then 'conflicting'
         else null
       end                                            as suggestion
from job_facts_current f
join jobs j      on j.linkedin_job_id = f.job_id
join companies c on c.company_linkedin_id = j.company_linkedin_id
where not exists (select 1 from company_verdicts v where v.company_linkedin_id = j.company_linkedin_id)
group by j.company_linkedin_id, c.name;

-- Latest evaluation per talent and job, with job details, for the match list.
create view talent_matches with (security_invoker = true) as
select distinct on (m.talent_id, m.job_id)
       m.*, j.title, j.company_name, j.company_linkedin_id, j.location, j.workplace_type,
       j.posted_at, j.url, tj.first_discovered_at, tj.first_search_title,
       c.stage as company_stage, c.stage_source as company_stage_source
from matches m
join jobs j          on j.linkedin_job_id = m.job_id
join talent_jobs tj  on tj.talent_id = m.talent_id and tj.job_id = m.job_id
left join companies c on c.company_linkedin_id = j.company_linkedin_id
order by m.talent_id, m.job_id, m.scored_at desc, m.id desc;

-- The funnel. One row per talent per New York day of first discovery.
-- Filter and match counts use each job's FIRST evaluation, so past days never change.
create view funnel_daily with (security_invoker = true) as
with first_eval as (
  select distinct on (talent_id, job_id) talent_id, job_id, agency_status, passed, shown
  from matches
  order by talent_id, job_id, scored_at asc, id asc
)
select tj.talent_id,
       (tj.first_discovered_at at time zone 'America/New_York')::date                       as day,
       count(*)                                                                              as jobs_found,
       count(*) filter (where fe.agency_status = 'agency')                                   as agency_removed,
       count(*) filter (where coalesce(fe.agency_status, '') <> 'agency')                    as jobs_qualified,
       count(*) filter (where fe.agency_status = 'needs_check')                              as held_for_check,
       count(*) filter (where fe.agency_status = 'employer' and not fe.passed)               as filtered_out,
       count(*) filter (where fe.shown)                                                      as jobs_matched,
       count(*) filter (where c.stage in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d', 'startup')) as startup_jobs,
       count(*) filter (where c.stage in ('pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'series_d', 'startup')
                          and c.stage_source = 'verified')                                   as startup_jobs_verified,
       min(pr.posted_window_used) filter (where pr.trigger = 'onboarding')                   as first_run_window
from talent_jobs tj
join jobs j               on j.linkedin_job_id = tj.job_id
left join companies c     on c.company_linkedin_id = j.company_linkedin_id
left join first_eval fe   on fe.talent_id = tj.talent_id and fe.job_id = tj.job_id
left join pipeline_runs pr on pr.id = tj.first_pipeline_run_id
group by tj.talent_id, day;

-- How often recruiters agreed with the system's own agency call.
create view agency_feedback_stats with (security_invoker = true) as
with decided as (
  select v.company_linkedin_id, v.verdict, t.agency_reads, t.employer_reads
  from company_verdicts_current v
  left join lateral (
    select count(*) filter (where f.agency = 'agency')   as agency_reads,
           count(*) filter (where f.agency = 'employer') as employer_reads
    from job_facts_current f join jobs j on j.linkedin_job_id = f.job_id
    where j.company_linkedin_id = v.company_linkedin_id
  ) t on true
  where v.source in ('recruiter', 'confirmed_suggestion')
)
select count(*)                                                                  as companies_decided,
       count(*) filter (where (verdict = 'agency') = (agency_reads > employer_reads)) as agreed_with_system,
       count(*) filter (where verdict = 'direct_employer' and agency_reads > 0)  as companies_rescued
from decided;

-- Views run with the caller's rights, so row-level security applies; and the
-- public roles get nothing.
revoke all on company_verdicts_current, job_facts_current, company_agency_tally, talent_matches, funnel_daily, agency_feedback_stats from anon, authenticated;
revoke all on all tables in schema public from anon, authenticated;

commit;
