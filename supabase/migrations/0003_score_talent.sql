-- 0003_score_talent.sql
-- The scoring function. Reads stored facts, the talent's settings and the active
-- scoring_config; writes one new `matches` row per job found for the talent.
-- No network calls and no model calls: same rows in, same scores out.
-- This is a direct port of the frozen Python scorer (v4) that set the defaults.

begin;

-- lower-case, trim, collapse whitespace
create or replace function tm_norm(s text) returns text
language sql immutable as $$
  select regexp_replace(lower(trim(coalesce(s, ''))), '\s+', ' ', 'g')
$$;

-- canonical skill name via the equivalents list
create or replace function tm_canon(s text, cfg jsonb) returns text
language sql immutable as $$
  select coalesce(cfg->'aliases'->>tm_norm(s), tm_norm(s))
$$;

-- words of a skill for the containment rule ("account management" is inside
-- "enterprise account management"): alias, strip punctuation, drop stopwords, singular
create or replace function tm_words(s text, cfg jsonb) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct case when length(w) > 3 and w like '%s' and w not like '%ss'
                                          then left(w, length(w) - 1) else w end), '{}')
  from regexp_split_to_table(
         regexp_replace(coalesce(cfg->'contain_aliases'->>s, s), '[()/,]', ' ', 'g'), '\s+') as w
  where w <> '' and not (cfg->'contain_stopwords') ? w
$$;

-- same family 1.0; both hands-on engineering, or a listed near pair, 0.6; else 0
create or replace function tm_family_credit(a text, b text, cfg jsonb) returns numeric
language sql immutable as $$
  select case
    when a = b then 1.0
    when (cfg->'engineering_families') ? a and (cfg->'engineering_families') ? b then 0.6
    when exists (select 1 from jsonb_array_elements(cfg->'near_family_groups') g where g ? a and g ? b) then 0.6
    else 0.0 end
$$;

-- whitespace-collapsed lower-case text, for quote checks
create or replace function tm_flat(s text) returns text
language sql immutable as $$
  select lower(regexp_replace(coalesce(s, ''), '\s+', ' ', 'g'))
$$;

-- display name: the config's name if listed, else word by word (ai -> AI, apis -> APIs), first letter capital
create or replace function tm_display(s text, cfg jsonb) returns text
language sql immutable as $$
  select coalesce(cfg->'display_names'->>s,
    (select upper(left(x, 1)) || substr(x, 2)
     from (select string_agg(coalesce(cfg->'display_words'->>w, w), ' ' order by o) as x
           from regexp_split_to_table(s, ' ') with ordinality as t(w, o)) z))
$$;

create or replace function tm_list(items text[]) returns text
language sql immutable as $$
  select case coalesce(array_length(items, 1), 0)
    when 0 then '' when 1 then items[1]
    else array_to_string(items[1:array_length(items, 1) - 1], ', ') || ' and ' || items[array_length(items, 1)] end
$$;

create or replace function score_talent(p_talent uuid, p_run uuid default null)
returns int
language plpgsql
set search_path = public
as $$
declare
  cfg_row   scoring_config;
  cfg       jsonb;
  st        talent_settings;
  tf        talent_facts;
  tname     text;
  levels    text[];
  t_years   numeric;
  t_level   text;
  t_lidx    int;
  t_family  text;
  t_inds    text[];
  base      jsonb := '{}';    -- talent skill -> credit, before covers / likely
  sk        jsonb := '{}';    -- after covers / likely
  w_skills  numeric; w_role numeric; w_sen numeric; w_loc numeric; w_comp numeric;
  r         record;
  e         jsonb;
  k         text;
  v         numeric;
  n_written int := 0;
  -- per job
  js        text[];
  credit    numeric;
  best      numeric;
  jw        text[];
  has       text[];
  miss      text[];
  sk_score  numeric;
  overlap   int;
  fam       numeric;
  req       numeric;
  level_d   int;
  sv        numeric;
  gap       numeric;
  gates     text[];
  loc       numeric;
  comp      numeric;
  num       numeric;
  den       numeric;
  score     int;
  raw_score numeric;
  ag_status text; ag_by text; ag_check text; ag_evidence text;
  cname     text;
  named     text;
  verdict   text;
  tally     record;
  inds_low  text[];
  q         text;
  jtext     text;
  passed    boolean;
  shown     boolean;
  reason    text;
  sen_txt   text;
  fam_txt   text;
  hdisp     text[];
  mdisp     text[];
begin
  -- one scoring run per talent at a time (a settings re-score and a daily run can't interleave)
  perform pg_advisory_xact_lock(hashtext('score_talent:' || p_talent::text));
  select * into cfg_row from scoring_config where active;
  if not found then raise exception 'no active scoring_config'; end if;
  cfg := cfg_row.config;
  select * into st from talent_settings where talent_id = p_talent;
  if not found then raise exception 'talent % has no settings', p_talent; end if;
  select * into tf from talent_facts where talent_id = p_talent order by created_at desc, id desc limit 1;
  if not found then raise exception 'talent % has no profile read', p_talent; end if;
  select coalesce(nullif(split_part(trim(name), ' ', 1), ''), 'the candidate') into tname from talents where id = p_talent;

  select array_agg(x order by o) into levels from jsonb_array_elements_text(cfg->'levels') with ordinality as t(x, o);
  t_years  := tf.years_computed;
  -- level: the read's level, capped at one above what the years alone suggest
  select lv into t_level from (
    select c->>1 as lv, (c->>0)::numeric as cut from jsonb_array_elements(cfg->'years_level_cuts') c
  ) z where t_years < cut order by cut limit 1;
  t_lidx   := least(array_position(levels, tf.level), array_position(levels, t_level) + 1);
  t_level  := coalesce(st.level_override, levels[t_lidx]);
  t_lidx   := array_position(levels, t_level);
  t_family := tf.role_family;
  t_inds   := tf.industries;

  -- talent skills with credit by source
  for e in select * from jsonb_array_elements(st.skills) loop
    k := tm_canon(e->>'name', cfg);
    v := coalesce((cfg->'skill_credit'->>(e->>'source'))::numeric, 0.6);
    if k <> '' and (base->>k is null or (base->>k)::numeric < v) then base := base || jsonb_build_object(k, v); end if;
  end loop;
  sk := base;
  for k in select jsonb_object_keys(cfg->'covers') loop
    if base ? k then
      for e in select * from jsonb_array_elements(cfg->'covers'->k) loop
        if sk->>(e#>>'{}') is null or (sk->>(e#>>'{}'))::numeric < (base->>k)::numeric then
          sk := sk || jsonb_build_object(e#>>'{}', (base->>k)::numeric);
        end if;
      end loop;
    end if;
  end loop;
  for k in select jsonb_object_keys(cfg->'likely') loop
    if base ? k then
      for e in select * from jsonb_array_elements(cfg->'likely'->k) loop
        if not sk ? (e#>>'{}') then sk := sk || jsonb_build_object(e#>>'{}', (cfg->>'likely_credit')::numeric); end if;
      end loop;
    end if;
  end loop;
  create temp table if not exists tm_talent_words (skill text, words text[], credit numeric) on commit drop;
  delete from tm_talent_words where true;   -- the API refuses DELETE without WHERE
  insert into tm_talent_words select key, tm_words(key, cfg), value::numeric from jsonb_each_text(sk);

  w_skills := coalesce((st.weights->>'skills')::numeric, 0);
  w_role   := coalesce((st.weights->>'role')::numeric, 0);
  w_sen    := coalesce((st.weights->>'seniority')::numeric, 0);
  w_loc    := coalesce((st.weights->>'location')::numeric, 0);
  w_comp   := coalesce((st.weights->>'company_type')::numeric, 0);

  for r in
    select j.*, f.id as fact_id, f.agency, f.agency_quote, f.named_employer, f.role_family as j_family, f.level as j_level,
           f.experience_paths, f.sponsorship, f.must_have_skills, f.nice_to_have_skills, f.required_industries,
           f.required_industry_quote, c.name as c_name, c.industries as c_inds, c.stage as c_stage
    from talent_jobs tj
    join jobs j on j.linkedin_job_id = tj.job_id
    join job_facts_current f on f.job_id = j.linkedin_job_id
    left join companies c on c.company_linkedin_id = j.company_linkedin_id
    where tj.talent_id = p_talent
  loop
    jtext := tm_flat(r.description);
    gates := '{}';

    -- skills: up to 8 must-haves, else up to 6 nice-to-haves (duplicates kept, as tested)
    js := array(select tm_canon(x, cfg) from unnest(r.must_have_skills[1:8]) x);
    if coalesce(array_length(js, 1), 0) = 0 then js := array(select tm_canon(x, cfg) from unnest(r.nice_to_have_skills[1:6]) x); end if;
    has := '{}'; miss := '{}'; sk_score := null; overlap := 0;
    if coalesce(array_length(js, 1), 0) > 0 then
      num := 0;
      foreach k in array js loop
        -- exact, or either side of "a / b"
        select coalesce(max((sk->>p)::numeric), 0) into credit
        from (select k as p union all select trim(x) from unnest(string_to_array(k, '/')) x) parts;
        if credit = 0 then
          jw := tm_words(k, cfg);
          if coalesce(array_length(jw, 1), 0) > 0 then
            select coalesce(max(tw2.credit), 0) into best from tm_talent_words tw2 where jw <@ tw2.words;
            credit := best;
          end if;
        end if;
        num := num + credit;
        if credit > 0 then overlap := overlap + 1; if not has @> array[k] then has := has || k; end if;
        elsif not miss @> array[k] then miss := miss || k; end if;
      end loop;
      sk_score := num / array_length(js, 1);
    end if;

    fam := tm_family_credit(r.j_family, t_family, cfg);

    -- required years: quoted paths only, degree-only paths ignored when others exist
    select min((p->>'min_years')::numeric) into req from (
      select p, (p->>'condition') ~* array_to_string(array(select jsonb_array_elements_text(cfg->'degree_path_words')), '|') as degree
      from jsonb_array_elements(r.experience_paths) p
      where position(left(tm_flat(p->>'quote'), 40) in jtext) > 0
    ) z where not degree or not exists (
      select 1 from jsonb_array_elements(r.experience_paths) p2
      where position(left(tm_flat(p2->>'quote'), 40) in jtext) > 0
        and not ((p2->>'condition') ~* array_to_string(array(select jsonb_array_elements_text(cfg->'degree_path_words')), '|')));

    level_d := array_position(levels, r.j_level) - t_lidx
               + case when r.j_level = 'mid-senior'
                       and r.title ~* ('\m(' || array_to_string(array(select jsonb_array_elements_text(cfg->'senior_title_words')), '|') || ')\M')
                      then 1 else 0 end;

    if req is not null then
      gap := req - t_years;
      sv := case when gap <= 0 then 1.0 when gap <= 1 then 0.6 when gap <= 2 then 0.3 else 0.1 end;
      if gap >= (cfg->>'too_junior_years_gap')::numeric then gates := gates || 'too junior'::text; end if;
      if gap <= 0 and level_d <= -2 then sv := (cfg->>'seniority_far_below')::numeric; end if;
    else
      sv := coalesce((cfg->'seniority_by_level_gap'->>level_d::text)::numeric,
                     case when level_d < -1 then (cfg->>'seniority_far_below')::numeric else 0 end);
      if level_d >= 2 then gates := gates || 'too junior'::text; end if;
    end if;
    if level_d <= -2 then gates := gates || 'well below talent level'::text; end if;
    if fam = 0 and overlap = 0 then gates := gates || 'not reasonable'::text; end if;
    if coalesce(array_length(js, 1), 0) > 0 and overlap = 0 then gates := gates || 'no shared skills'::text; end if;

    -- required industry: quoted requirement, and none of the talent's employers in it
    q := left(tm_flat(r.required_industry_quote), 40);
    if coalesce(array_length(r.required_industries, 1), 0) > 0 and q <> '' and position(q in jtext) > 0
       and not (r.required_industries && t_inds) then
      gates := gates || 'needs industry experience'::text;
    end if;

    -- deal-breakers
    cname := tm_norm(coalesce(r.c_name, r.company_name));
    if exists (select 1 from unnest(st.excluded_companies) x where tm_norm(x) = cname) then gates := gates || 'excluded company'::text; end if;
    if exists (select 1 from unnest(st.excluded_industries) x, unnest(coalesce(r.c_inds, '{}')) y where tm_norm(x) = tm_norm(y)) then gates := gates || 'excluded industry'::text; end if;
    if exists (select 1 from unnest(st.excluded_title_words) x where tm_norm(r.title) like '%' || tm_norm(x) || '%') then gates := gates || 'excluded title word'::text; end if;
    if st.needs_sponsorship and r.sponsorship = 'no_sponsorship' then gates := gates || 'no sponsorship'::text; end if;

    -- agency: first rule that applies wins
    ag_status := 'employer'; ag_by := 'model'; ag_check := null; ag_evidence := r.agency_quote;
    named := tm_norm(r.named_employer);
    inds_low := array(select tm_norm(x) from unnest(coalesce(r.c_inds, '{}')) x);
    select v2.verdict into verdict from company_verdicts_current v2 where v2.company_linkedin_id = r.company_linkedin_id;
    if verdict is null and (cfg->'seed_agency_names') ? cname then verdict := 'agency'; ag_by := 'seed'; elsif verdict is not null then ag_by := 'recruiter'; end if;
    if verdict = 'agency' then
      if r.agency = 'employer' and named = '' then ag_status := 'needs_check'; ag_check := 'agency_internal_role';
      else ag_status := 'agency'; end if;
    elsif verdict = 'direct_employer' then
      ag_status := 'employer';
    elsif inds_low && array(select jsonb_array_elements_text(cfg->'agency_industries')) then
      ag_status := 'agency'; ag_by := 'linkedin_industry'; ag_evidence := 'LinkedIn industry: ' || array_to_string(r.c_inds, ', ');
    elsif r.agency = 'agency' or (named <> '' and position(named in cname) = 0 and position(cname in named) = 0) then
      ag_status := 'agency'; ag_by := 'model';
      if r.agency <> 'agency' then ag_evidence := 'Names a different employer: ' || r.named_employer; end if;
    elsif r.agency = 'unsure' then
      ag_status := 'needs_check'; ag_by := 'none'; ag_check := 'unsure';
    else
      select * into tally from company_agency_tally t2 where t2.company_linkedin_id = r.company_linkedin_id;
      if found and tally.agency_reads > 0 and tally.employer_reads > 0 then
        ag_status := 'needs_check'; ag_by := 'none'; ag_check := 'conflicting_verdicts';
      end if;
    end if;

    -- weighted score over criteria that have data
    loc  := case when r.workplace_type = 'remote' then (cfg->'location_credit'->>'remote')::numeric else (cfg->'location_credit'->>'other')::numeric end;
    comp := case when st.startup_preference = 'none' or r.c_stage is null or r.c_stage = 'unknown' then null
                 when r.c_stage = 'startup' then case when st.startup_preference = 'any' then 1.0 else null end  -- inferred, round unknown
                 when (cfg->'startup_stages'->st.startup_preference) ? r.c_stage then 1.0 else 0.0 end;
    num := 0; den := 0;
    if sk_score is not null and w_skills > 0 then num := num + w_skills * sk_score; den := den + w_skills; end if;
    if w_role > 0 then num := num + w_role * fam; den := den + w_role; end if;
    if w_sen > 0 then num := num + w_sen * sv; den := den + w_sen; end if;
    if w_loc > 0 then num := num + w_loc * loc; den := den + w_loc; end if;
    if comp is not null and w_comp > 0 then num := num + w_comp * comp; den := den + w_comp; end if;
    raw_score := case when den > 0 then 100 * num / den else 0 end;
    score  := round(raw_score);
    passed := coalesce(array_length(gates, 1), 0) = 0;
    shown  := passed and ag_status = 'employer' and raw_score >= st.min_score;   -- unrounded, as tested

    -- the reason, built from the breakdown
    hdisp := array(select tm_display(x, cfg) from unnest(has) x);
    mdisp := array(select tm_display(x, cfg) from unnest(miss) x);
    fam_txt := case when fam = 1 then 'Same kind of role' when fam > 0 then 'A related kind of role' else 'A different kind of role' end;
    sen_txt := case when req is not null then
                 format('Asks for %s+ years; %s has %s', req, tname, to_char(t_years, 'FM990.0'))
                 || case when req > t_years then format(', %s years short', to_char(req - t_years, 'FM990.0')) else '' end
               else case level_d when 0 then 'Level fits' when -1 then format('One level below %s', tname)
                                 when 1 then format('One level above %s', tname) else 'Level well off' end end;
    reason := case
      when ag_status = 'agency' then 'Not suggested: posted by a staffing agency.'
      when ag_status = 'needs_check' then 'Held for a check: ' || case ag_check
            when 'unsure' then 'the posting doesn''t make clear who the employer is.'
            when 'conflicting_verdicts' then 'this company''s jobs read differently on agency.'
            else 'a confirmed agency hiring for its own team.' end
      when not passed then 'Not suggested: ' || array_to_string(array(
            select replace(coalesce(cfg->'filter_text'->>g, g), '{name}', tname) from unnest(gates) g), '; ') || '.'
      when not shown then format('Not suggested: scored %s, below the minimum of %s.', score, st.min_score)
      else 'Suggested.' end
      || case when coalesce(array_length(js, 1), 0) > 0 then
           format(' Has %s of %s core skills', coalesce(array_length(has, 1), 0), coalesce(array_length(has, 1), 0) + coalesce(array_length(miss, 1), 0))
           || case when array_length(has, 1) > 0 then ' (' || tm_list(hdisp) || ')' else '' end
           || case when array_length(miss, 1) > 0 then '; missing ' || tm_list(mdisp) else '' end || '.'
         else '' end
      || ' ' || fam_txt || '. ' || sen_txt || '.';

    insert into matches (talent_id, job_id, pipeline_run_id, score, passed, shown, filters_failed, breakdown, reason,
                         agency_status, agency_decided_by, check_reason, agency_evidence, settings_version,
                         settings_snapshot, config_version, talent_fact_id, job_fact_id)
    values (p_talent, r.linkedin_job_id, p_run, score, passed, shown, gates,
      jsonb_build_object(
        'skills',       jsonb_build_object('value', sk_score, 'weight', w_skills, 'points', case when sk_score is null then null else round(w_skills * sk_score) end,
                                           'has', to_jsonb(has), 'missing', to_jsonb(miss), 'counted', sk_score is not null and w_skills > 0),
        'role',         jsonb_build_object('value', fam, 'weight', w_role, 'points', round(w_role * fam), 'job_family', r.j_family, 'talent_family', t_family, 'label', fam_txt),
        'seniority',    jsonb_build_object('value', sv, 'weight', w_sen, 'points', round(w_sen * sv), 'required_years', req, 'talent_years', t_years,
                                           'level_gap', level_d, 'job_level', r.j_level, 'talent_level', t_level, 'label', sen_txt),
        'location',     jsonb_build_object('value', loc, 'weight', w_loc, 'points', round(w_loc * loc), 'remote', r.workplace_type = 'remote', 'counted', w_loc > 0),
        'company_type', jsonb_build_object('value', comp, 'weight', w_comp, 'points', case when comp is null then null else round(w_comp * comp) end,
                                           'stage', r.c_stage, 'preference', st.startup_preference, 'counted', comp is not null and w_comp > 0)),
      reason, ag_status, ag_by, ag_check, ag_evidence, st.version,
      to_jsonb(st) - 'talent_id', cfg_row.version, tf.id, r.fact_id);
    n_written := n_written + 1;
  end loop;
  return n_written;
end;
$$;

revoke all on function score_talent(uuid, uuid) from public, anon, authenticated;

commit;
