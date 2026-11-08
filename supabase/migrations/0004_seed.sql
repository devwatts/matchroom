-- 0004_seed.sql
-- Scoring config version 1: the rules frozen and tested on 2026-11-08 (frozen setup v4).
-- Operators change these lists in the Supabase dashboard by inserting a new version and marking it active.

begin;

insert into scoring_config (version, active, notes, config) values (1, true,
  'Frozen v4: luna reads (prompt v5), equivalents + covers + likely + word containment, role families, industry filter, agency ladder.',
  '{
 "prompt_version": "v5",
 "model": "openai/gpt-5.6-luna",
 "levels": [
  "internship",
  "entry",
  "associate",
  "mid-senior",
  "director",
  "executive"
 ],
 "aliases": {
  "react.js": "react",
  "reactjs": "react",
  "nodejs": "node.js",
  "node": "node.js",
  "js": "javascript",
  "ts": "typescript",
  "postgres": "postgresql",
  "golang": "go",
  "amazon web services": "aws",
  "amazon web services (aws)": "aws",
  "google cloud platform": "gcp",
  "next": "next.js",
  "nextjs": "next.js",
  "nestjs": "nest.js",
  "k8s": "kubernetes",
  "ml": "machine learning",
  "llms": "llm",
  "large language models": "llm",
  "large language models (llm)": "llm",
  "natural language processing": "nlp",
  "genai": "generative ai",
  "retrieval-augmented generation": "rag",
  "large language models (llms)": "llm",
  "generative ai": "llm",
  "gen ai": "llm",
  "llm applications": "llm",
  "ai agents": "ai agents",
  "agentic systems": "ai agents",
  "agentic ai": "ai agents",
  "agent frameworks": "ai agents",
  "multi-agent systems": "ai agents",
  "agent workflows": "ai agents",
  "rest api": "rest apis",
  "restful apis": "rest apis",
  "front-end development": "frontend development",
  "back-end web development": "backend development",
  "back-end development": "backend development",
  "full-stack development": "full-stack engineering",
  "angularjs": "angular",
  "postgresql": "postgresql",
  "amazon s3": "aws",
  "aws lambda": "aws",
  "retrieval-augmented generation (rag)": "rag",
  "python (programming language)": "python"
 },
 "contain_aliases": {
  "crm": "customer relationship management",
  "crm software": "customer relationship management",
  "customer relationship management (crm)": "customer relationship management",
  "client relationship management": "customer relationship management",
  "business-to-business (b2b)": "b2b sales",
  "business-to-business sales": "b2b sales"
 },
 "contain_stopwords": [
  "&",
  "(crm)",
  "-",
  "a",
  "an",
  "and",
  "experience",
  "for",
  "in",
  "of",
  "skills",
  "the",
  "to",
  "with"
 ],
 "covers": {
  "fastapi": [
   "apis",
   "rest apis",
   "api development",
   "backend development"
  ],
  "express.js": [
   "apis",
   "rest apis",
   "api development",
   "backend development"
  ],
  "nest.js": [
   "apis",
   "rest apis",
   "api development",
   "backend development"
  ],
  "django": [
   "apis",
   "rest apis",
   "api development",
   "backend development"
  ],
  "flask": [
   "apis",
   "rest apis",
   "api development",
   "backend development"
  ],
  "rest apis": [
   "apis",
   "api development"
  ],
  "api design": [
   "apis",
   "api development",
   "rest apis"
  ],
  "node.js": [
   "backend development",
   "javascript"
  ],
  "react": [
   "frontend development",
   "javascript"
  ],
  "next.js": [
   "react",
   "frontend development",
   "server-side rendering",
   "javascript"
  ],
  "angular": [
   "frontend development",
   "javascript"
  ],
  "postgresql": [
   "sql",
   "databases",
   "relational databases"
  ],
  "mysql": [
   "sql",
   "databases",
   "relational databases"
  ],
  "sql": [
   "databases"
  ],
  "mongodb": [
   "databases",
   "nosql"
  ],
  "neo4j": [
   "databases"
  ],
  "rag": [
   "retrieval"
  ],
  "llm": [
   "ai",
   "generative ai"
  ],
  "langchain": [
   "llm",
   "ai agents"
  ],
  "langgraph": [
   "llm",
   "ai agents"
  ],
  "ai agents": [
   "llm"
  ],
  "machine learning": [
   "ai"
  ],
  "full-stack engineering": [
   "frontend development",
   "backend development"
  ],
  "software engineering": [
   "git"
  ]
 },
 "likely": {
  "nest.js": [
   "typescript"
  ],
  "next.js": [
   "typescript"
  ],
  "devops": [
   "ci/cd"
  ],
  "llm": [
   "prompt engineering"
  ],
  "ai agents": [
   "tool calling"
  ]
 },
 "likely_credit": 0.5,
 "skill_credit": {
  "work": 1.0,
  "listed": 0.6,
  "recruiter": 1.0
 },
 "engineering_families": [
  "backend",
  "data_engineering",
  "devops_infra_sre",
  "frontend",
  "fullstack",
  "ml_ai_engineering",
  "mobile",
  "qa_testing",
  "research",
  "security",
  "software_engineering"
 ],
 "near_family_groups": [
  [
   "data_engineering",
   "data_science_analytics",
   "ml_ai_engineering",
   "research"
  ],
  [
   "backend",
   "engineering_management",
   "frontend",
   "fullstack",
   "software_engineering"
  ]
 ],
 "family_credit": {
  "same": 1.0,
  "near": 0.6,
  "other": 0.0
 },
 "agency_industries": [
  "staffing and recruiting",
  "executive search services",
  "temporary help services",
  "human resources"
 ],
 "seed_agency_names": [
  "lensa",
  "mercor",
  "remotehunter",
  "talenthop"
 ],
 "too_junior_years_gap": 3,
 "seniority_by_years_gap": [
  [
   0,
   1.0
  ],
  [
   1,
   0.6
  ],
  [
   2,
   0.3
  ],
  [
   99,
   0.1
  ]
 ],
 "seniority_by_level_gap": {
  "0": 1.0,
  "-1": 0.75,
  "1": 0.4
 },
 "seniority_far_below": 0.25,
 "senior_title_words": [
  "staff",
  "principal",
  "distinguished"
 ],
 "degree_path_words": [
  "master",
  "phd",
  "doctor"
 ],
 "location_credit": {
  "remote": 1.0,
  "other": 0.8
 },
 "startup_stages": {
  "seed_b": [
   "pre_seed",
   "seed",
   "series_a",
   "series_b"
  ],
  "a_d": [
   "series_a",
   "series_b",
   "series_c",
   "series_d"
  ],
  "any": [
   "pre_seed",
   "seed",
   "series_a",
   "series_b",
   "series_c",
   "series_d"
  ]
 },
 "default_weights": {
  "skills": 35,
  "role": 30,
  "seniority": 15,
  "location": 0,
  "company_type": 20
 },
 "default_min_score": 65,
 "years_level_cuts": [
  [
   1,
   "entry"
  ],
  [
   3,
   "associate"
  ],
  [
   10,
   "mid-senior"
  ],
  [
   999,
   "director"
  ]
 ],
 "display_names": {
  "api design": "API design",
  "llm": "LLMs",
  "rag": "RAG",
  "aws": "AWS",
  "sql": "SQL",
  "nlp": "NLP",
  "fastapi": "FastAPI",
  "node.js": "Node.js",
  "javascript": "JavaScript",
  "typescript": "TypeScript",
  "next.js": "Next.js",
  "postgresql": "PostgreSQL",
  "pytorch": "PyTorch",
  "tensorflow": "TensorFlow",
  "ai agents": "AI agents",
  "mlops": "MLOps",
  "llmops": "LLMOps",
  "c#": "C#",
  "c++": "C++",
  "gcp": "GCP",
  "ci/cd": "CI/CD",
  "rest apis": "REST APIs",
  "apis": "APIs",
  "ai": "AI",
  "openai api": "OpenAI API",
  "azure openai": "Azure OpenAI",
  "azure ai search": "Azure AI Search",
  "azure ai foundry": "Azure AI Foundry",
  "sqlalchemy": "SQLAlchemy",
  "ruby on rails": "Ruby on Rails",
  "llm evaluation": "LLM evaluation",
  "ai apis": "AI APIs",
  "go": "Go",
  "c": "C",
  "azure": "Azure",
  "databricks": "Databricks",
  "react": "React",
  "python": "Python",
  "angular": "Angular",
  "django": "Django",
  "java": "Java"
 },
 "filter_text": {
  "too junior": "needs much more experience than {name} has",
  "well below talent level": "well below {name}''s level",
  "not reasonable": "a different kind of role with no shared skills",
  "no shared skills": "none of {name}''s core skills",
  "needs industry experience": "needs industry experience {name} lacks",
  "excluded company": "an excluded company",
  "excluded industry": "an excluded industry",
  "excluded title word": "an excluded title word",
  "no sponsorship": "won''t sponsor a visa"
 },
 "display_words": {
  "ai": "AI",
  "ml": "ML",
  "llm": "LLM",
  "llms": "LLMs",
  "api": "API",
  "apis": "APIs",
  "rag": "RAG",
  "sql": "SQL",
  "nlp": "NLP",
  "saas": "SaaS",
  "crm": "CRM",
  "b2b": "B2B",
  "ui": "UI",
  "ux": "UX",
  "aws": "AWS",
  "gcp": "GCP",
  "seo": "SEO",
  "pr": "PR",
  "etl": "ETL",
  "ci/cd": "CI/CD",
  "ios": "iOS",
  "rest": "REST",
  "devops": "DevOps",
  "openapi": "OpenAPI",
  "graphql": "GraphQL",
  "javascript": "JavaScript",
  "typescript": "TypeScript",
  "unix/linux": "Unix/Linux",
  "gpu": "GPU",
  "cuda": "CUDA",
  "css": "CSS",
  "html": "HTML",
  "b2c": "B2C",
  "kpis": "KPIs",
  "sdk": "SDK",
  "sdks": "SDKs",
  "qa": "QA"
 },
 "startup_inferred": {
  "company_type": "Privately Held",
  "min_founded_year": 2016,
  "max_employees": 500
 }
}'::jsonb);

commit;
