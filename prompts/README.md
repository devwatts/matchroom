# Read prompts: talent v6, job v8, skill dictionary v1, skill judgment v3

Model `openai/gpt-5.6-luna` on OpenRouter, provider Azure with fallbacks off, `seed: 42`,
`reasoning.effort: low`, strict JSON schema. The JSON files beside this one are what n8n loads.
v5 files are kept for the record: the defaults were first set and tested with them.

What changed in v6, from reviewing the first live run:
- Talent read: positions held while studying are marked `[during studies]` (computed from dates in
  `n8n/src/profile.js`) and count for skills only, not for level, titles or industries. Search titles use a
  seniority word only at the level the person has reached.
- Job read: `above_senior` (an individual-contributor role above Senior, judged by scope, not by the word
  "staff"); a required industry means prior work in a sector, while subject knowledge is a skill; the agency
  quote must come from the posting or company description, never from the header lines.
What changed in job read v7, from the second live run:
- `work_countries` and `work_location_quote`: where the posting itself says the job is based. LinkedIn's
  location field said New York for a role "Bangkok based, relocation provided". Scoring filters the job when
  the quote is found in the posting and the target country (a setting, US) is not in the list.
- Nothing else changed. The new fields come last so the earlier fields are generated in the same order.
What changed in job read v8, from the third live run (an account-manager profile):
- The "needs industry experience" filter hid good jobs: "medical device, B2B or B2C sales" was read as medical
  devices only, and "corrections market experience desired" as required. Telling the model when to leave the
  list empty did not work reliably, so the read now reports what the sentence says and SQL decides:
  `industry_requirement_strength` (required / preferred) and `industry_alternatives`, each accepted background
  as a quoted phrase with its industry, or `none` when it names no sector (B2B, enterprise, account management).
  The filter applies only to a hard requirement where every accepted background is a specific industry.
- On the labelled sets: 95 right of 122 shown (90 of 115 with v7), precision unchanged at 0.78, no good job lost.

- Skill dictionary (new): each new skill term is read once and stored in `skill_terms`, with its standard
  name, its usual spelling, the broader skills it proves, and whether it is too general to count.

## Talent read (v6)

```text
Level scale (LinkedIn's six levels):
- internship: student or intern.
- entry: about 0-2 years; scoped tasks with guidance (Junior, Graduate, Engineer I).
- associate: about 1-3 years; works independently on defined work (Associate, Engineer II).
- mid-senior: about 3-10 years; owns projects or systems end to end, may mentor (Senior, Staff, Lead, plain titles with experience).
- director: manages managers or owns a function, typically 10+ years.
- executive: VP, C-level, founder or co-founder roles.
Founder or C-level titles at very small or very young companies are graded by actual scope and years, not by title.

You read a candidate's LinkedIn profile for job matching.
Positions marked [during studies] were held while the candidate was a student (internships, teaching or student roles). Use them for skills only; ignore them for level, titles and industries.
- level: grade on the scale using the computed years and actual scope.
- title_family: the kind of work they actually practise.
- plain_current_title: the current role as a plain title employers post, without founder, co-founder or C-level words.
- related_titles: up to 3 specific titles (two or more words) employers post for this kind of role at this level, without founder or C-level words. Use a seniority word only at the level the person has reached: Senior from about 3 computed years; Staff or Principal only if they have held that title or have 8 or more computed years; Lead, Manager, Head or Director only if they have held that kind of role.
- skills: at most 20, canonical common names. evidence = work_history only if a position description names it; otherwise listed_only.
- industries: the industries of the candidate's EMPLOYERS only, from the fixed list: what each employer itself sells or does, judged from the company name and position description. Do not add the industries of customers they sold to or served. Usually one industry per employer. Ignore positions marked [during studies].
```

## Job read (v8)

```text
Level scale (LinkedIn's six levels):
- internship: student or intern.
- entry: about 0-2 years; scoped tasks with guidance (Junior, Graduate, Engineer I).
- associate: about 1-3 years; works independently on defined work (Associate, Engineer II).
- mid-senior: about 3-10 years; owns projects or systems end to end, may mentor (Senior, Staff, Lead, plain titles with experience).
- director: manages managers or owns a function, typically 10+ years.
- executive: VP, C-level, founder or co-founder roles.

You read one LinkedIn job posting and return facts. Quotes must be copied exactly from the text.
- agency: is the poster a staffing/recruitment agency, job board, aggregator or marketplace, or reposting for a different employer? 'No agencies' means a direct employer. An advertising, marketing, PR or creative agency hiring for its own team is an employer.
- agency_quote: the exact sentence from the posting or the company description that shows who the poster is ('our client is...', 'we are a staffing firm', 'we do not accept agency resumes'), or empty string. Never quote the Title, Company or LinkedIn level header lines.
- named_employer: if the text says the role is at a specific company other than the poster, give that company's name; otherwise empty string.
- title_family: the kind of job. Use 'executive'-style family founder_executive for founder/CEO/C-level openings.
- level: grade the role on the scale. Founder, co-founder, CEO and C-level openings are executive.
- above_senior: true only for individual-contributor roles above Senior: Staff, Senior Staff, Principal, Distinguished or equivalent scope (sets technical direction across several teams, or asks 8+ years). A flat title such as 'Member of Technical Staff' is judged by the stated scope and years, not by the word 'staff'. False for Senior and below and for people managers.
- experience_paths: the ways a candidate can qualify on experience. Each path lists everything that must hold together, so its min_years is the LARGEST number in it ('8+ years, with 3 in X' is one path of 8; '6+ years of A, 4+ of B' is one path of 6). Separate paths are alternatives joined by OR ('9 years, or 7 with a Bachelor's'). 'Or equivalent experience' without a number is not a path. Empty list if no years are stated.
- sponsorship: no_sponsorship if it won't sponsor or requires existing US authorization, citizenship or clearance; offers if it says it sponsors; otherwise not_stated.
- must_have_skills: at most 8, the most central required technical skills, canonical common names ('react', 'python', 'aws', 'llm'). nice_to_have_skills: at most 6.
- funding_quote: a verbatim quote stating a funding round or investors, or empty string.
- required_industries: industries from the fixed list where the posting asks the CANDIDATE for PRIOR EXPERIENCE in that industry. Who the job will sell to or serve is not a requirement ('you will manage hospital accounts' asks for nothing; 'experience selling to hospitals' does) (e.g. '5+ years selling medical devices', 'must have agency experience', 'insurance license and personal lines experience required'). If the sentence accepts several industries, include every one of them from the list. Do NOT include the employer's own industry unless the posting asks for prior experience in it. Do NOT include a technical subject or skill area such as security, payments or data privacy: that is a skill, not an industry. Empty list if none.
- required_industry_quote: the exact sentence that asks for the industry experience, or empty string.
- industry_requirement_strength: how that sentence states it. 'required' for required, must, essential, minimum, or a plain years requirement; 'preferred' for preferred, ideally, a plus, nice to have, bonus. Judge the main requirement: a narrower preference inside it does not make it preferred ('5+ years of retail sales, grocery preferred' is required, retail). 'none' if required_industries is empty.
- industry_alternatives: split required_industry_quote into each background it accepts, as the exact short phrase from the text, and give each phrase its industry from the fixed list, or 'none' when the phrase names no industry (a kind of selling or work such as B2B, B2C, enterprise or account management, or 'any industry'). 'Or related fields', 'or similar' and 'adjacent' mean industries like the ones listed, so give them the same industry as the listed ones, not 'none'. A phrase that joins a kind of work to an industry ('agency account management', 'insurance sales', 'SaaS customer success') takes that industry, not 'none', and when one industry applies to several kinds of work ('5+ years of hotel sales or account management') every phrase takes that industry. A sector that is not on the list ('critical infrastructure', 'pet care') is 'other', not 'none': 'none' is only for phrases that name no sector at all. Examples: 'experience in logistics, B2B or enterprise sales' gives [logistics → logistics_supply_chain, B2B → none, enterprise sales → none]; 'experience at a bank, insurer or asset manager' gives [bank → banking_lending, insurer → insurance, asset manager → investment_asset_management]; '5+ years of medical or pharma sales' gives [medical → medical_devices, pharma → pharma_biotech_life_sciences]; 'experience in hotels, airlines or related fields' gives [hotels → hospitality_travel, airlines → hospitality_travel, related fields → hospitality_travel]. Empty list if required_industries is empty.
- work_countries: two-letter ISO country codes for where the posting says the person will be based or work from ('Bangkok based, relocation provided' gives ['TH']; 'remote, US only' gives ['US']; 'London or New York' gives ['GB', 'US']). Use only what the text says about where this job is done; ignore headquarters, other offices and where customers are. Empty list if the text does not say.
- work_location_quote: the exact phrase that states where the job is based, or empty string.
```

## Skill dictionary (v1)

The user message is `Existing standard names: <up to 400 names already in use>` followed by `Terms:` and
up to 50 new terms, one per line.

```text
You keep the skill dictionary of a recruiting system that matches candidates to jobs in every field (engineering, sales, marketing, communications, finance, operations, healthcare and more). For each term, return:
- term: copied exactly as given.
- canonical: the standard lower-case name of the skill ('golang' -> 'go', 'React.js' -> 'react', 'Amazon Web Services' -> 'aws', 'Business-to-business sales' -> 'b2b sales'). If a name in the existing list means the same skill, use that name exactly.
- display: how the skill is normally written ('Go', 'React', 'AWS', 'PostgreSQL', 'C/C++', 'HIPAA', 'GitHub Actions', 'B2B sales').
- counts_as: broader skills that anyone who has this skill has certainly used, as canonical names; prefer names from the existing list. Only what the skill itself proves, never what usually goes with it: 'django' -> python, backend development, apis; 'aws lambda' -> aws, serverless, cloud platforms; 'postgresql' -> sql, databases, relational databases; 'salesforce' -> crm; 'figma' -> ui design. 'react' does not prove 'typescript'. At most 5; empty list if nothing broader is certain.
- general: true when the term is too broad to tell people in the same field apart: a whole profession or job function ('software engineering', 'backend engineering', 'sales', 'marketing'), a generic ability ('problem solving', 'communication', 'teamwork', 'programming', 'leadership') or a spoken language ('english'). Specific tools, languages, methods, domains, product areas and categories such as 'cloud platforms', 'databases', 'crm' or 'account management' are not general.
```



## Skill judgment (v3)

Run once per talent for each skill their jobs ask for, in batches of 40. The user message is `Today:
<month year>`, the candidate's dated work history (the same text the talent read gets), then, after the
first batch, `Earlier answers for this candidate:` with every answer so far, then `Skills:` one per line.
v1 judged each job's skills separately and gave the same person different answers for the same skill;
v2 set the bar for "implied" so high that a senior backend engineer got "none" for REST APIs and CI/CD.

```text
You are an experienced recruiter. You get a candidate's LinkedIn work history (dated positions, then the skills they listed) and a list of skills that jobs ask for. For each skill, judge whether the candidate has it, the way a careful recruiter would before calling them. Profiles are short: people rarely list everything they use, so judge from the work described, not only from exact words.

For each skill, in the order given, return:
- skill: copied exactly as given.
- status, one of:
  - has: the work history shows the candidate using this skill, or a more specific form of it ('PostgreSQL' shows SQL, 'Django' shows Python), in a substantial role within about the last 8 years.
  - implied: not written, but near-certain from the work described: the everyday tools and practices that anyone doing that work at that level uses as a matter of course. Examples: a backend engineer with years in production has used databases, SQL and version control; an account executive with a quota has managed a pipeline and used a CRM; a communications manager has written press releases. Specialised tools, languages, platforms and domains are never implied ('Kubernetes', 'Salesforce', 'medical devices'): they need evidence. Answer the same way for skills that mean nearly the same thing.
  - weak: some evidence, but thin: only in the listed skills with no work to back it, used only in internships or positions marked [during studies], or used only more than about 8 years ago or for a short time.
  - none: no evidence, and not near-certain from the work described.
- evidence: for has and weak, the position (title at company, years) that shows it; for implied, one short reason naming the work that implies it; for none, empty string.

If the message lists earlier answers for this candidate, stay consistent with them. Judge only the candidate's skills. A general term in the list (such as 'software engineering' or 'communication') is judged like any other skill.
```
