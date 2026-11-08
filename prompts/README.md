# Read prompts, version v5

Model `openai/gpt-5.6-luna` on OpenRouter, provider Azure with fallbacks off, `seed: 42`,
`reasoning.effort: low`, strict JSON schema. These are the exact prompts used to set and test
the defaults; the JSON files beside this one are what n8n loads.

## Talent read

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
- level: grade on the scale using the computed years and actual scope.
- title_family: the kind of work they actually practise.
- plain_current_title: the current role as a plain title employers post, without founder, co-founder or C-level words.
- related_titles: up to 3 specific titles (two or more words) employers post for this kind of role at this level, without founder or C-level words.
- skills: at most 20, canonical common names. evidence = work_history only if a position description names it; otherwise listed_only.
- industries: the industries of the candidate's EMPLOYERS only, from the fixed list: what each employer itself sells or does, judged from the company name and position description. Do not add the industries of customers they sold to or served. Usually one industry per employer.
```

## Job read

```text
Level scale (LinkedIn's six levels):
- internship: student or intern.
- entry: about 0-2 years; scoped tasks with guidance (Junior, Graduate, Engineer I).
- associate: about 1-3 years; works independently on defined work (Associate, Engineer II).
- mid-senior: about 3-10 years; owns projects or systems end to end, may mentor (Senior, Staff, Lead, plain titles with experience).
- director: manages managers or owns a function, typically 10+ years.
- executive: VP, C-level, founder or co-founder roles.

You read one LinkedIn job posting and return facts. Quotes must be copied exactly from the text.
- agency: is the poster a staffing/recruitment agency, job board, aggregator or marketplace, or reposting for a different employer? 'No agencies' means a direct employer.
- named_employer: if the text says the role is at a specific company other than the poster, give that company's name; otherwise empty string.
- title_family: the kind of job. Use 'executive'-style family founder_executive for founder/CEO/C-level openings.
- level: grade the role on the scale. Founder, co-founder, CEO and C-level openings are executive.
- experience_paths: the ways a candidate can qualify on experience. Each path lists everything that must hold together, so its min_years is the LARGEST number in it ('8+ years, with 3 in X' is one path of 8; '6+ years of A, 4+ of B' is one path of 6). Separate paths are alternatives joined by OR ('9 years, or 7 with a Bachelor's'). 'Or equivalent experience' without a number is not a path. Empty list if no years are stated.
- sponsorship: no_sponsorship if it won't sponsor or requires existing US authorization, citizenship or clearance; offers if it says it sponsors; otherwise not_stated.
- must_have_skills: at most 8, the most central required technical skills, canonical common names ('react', 'python', 'aws', 'llm'). nice_to_have_skills: at most 6.
- funding_quote: a verbatim quote stating a funding round or investors, or empty string.
- required_industries: industries from the fixed list where PRIOR EXPERIENCE is stated as REQUIRED for the candidate (e.g. '5+ years selling medical devices', 'must have agency experience', 'insurance license and personal lines experience required'). Do NOT include the employer's own industry unless the posting requires prior experience in it. Do NOT include industries that are only preferred, a plus, or nice to have. Empty list if none.
- required_industry_quote: the exact sentence that states the requirement, or empty string.
```
