# matchroom

Talent-to-job matching for a staffing team. Add a talent by LinkedIn URL; every day the pipeline finds new
New York jobs for them, removes posts from staffing agencies, and ranks the rest with a score and a
plain-English reason.

**Design rule:** the model only reads text and turns it into facts. Code and SQL make every decision, so the
same talent, job and settings always give the same score, and every match can say exactly why.

## How it works

| Step | Where | What happens |
|---|---|---|
| Enrich | n8n W1 | Scrape the LinkedIn profile (Apify), read it once into facts: level, years (computed from dates), titles, skills and where each came from, industries |
| Discover | n8n W2 | Search New York LinkedIn jobs for the talent's titles and level; each job is stored once however often it is found |
| Filter | n8n W2 | Read each new posting once (employer or agency, level, years, must-have skills, required industry, where it is based), judge the talent's skills against their work history, look up new companies |
| Match | SQL `score_talent()` | Agency checks, deal-breakers and filters, then a weighted score; every match stores its breakdown, reason and the settings version used |

A daily schedule (W3) runs this for every talent whose matching window is still open; W4 records failures.

## Layout

```
supabase/migrations/   schema, views, the scoring function, pipeline functions (apply in order)
supabase/tests/        database failure tests (run in a transaction, rolled back)
n8n/src/               the Code node sources; n8n/build.py assembles and deploys W1–W4
n8n/test/              failure tests for the shared helpers (node n8n/test/lib.test.js)
prompts/               versioned read prompts and schemas; README shows the active text
web/                   recruiter app (Next.js): talents, matches, settings, runs, analytics
infra/                 docker compose (n8n + app + Caddy) and the deploy script
docs/designs/          the design document: decisions, test results, data model
```

## Running it

1. Create a Supabase project and apply `supabase/migrations/*.sql` in order.
2. Copy `infra/n8n/.env.example` and `web/.env.example` to `.env` files and fill in Supabase, OpenRouter,
   Apify and the shared secrets.
3. `infra/deploy.sh` starts n8n, the app and Caddy on a VM (set `VM=user@host` in `.env`).
4. `python3 n8n/build.py` builds and deploys the four workflows to n8n.

Tests: `node n8n/test/lib.test.js` and
`psql "$SUPABASE_DB_URL" -X -v ON_ERROR_STOP=1 -f supabase/tests/run_safety_test.sql`.

## More

The full reasoning, the test results on hand-labelled jobs and the remaining weak spots are in
[docs/designs/talent-job-matching.md](docs/designs/talent-job-matching.md). Prompt versions and what changed
between them are in [prompts/README.md](prompts/README.md).
