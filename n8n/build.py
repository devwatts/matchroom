"""Assemble the four n8n workflows from n8n/src/*.js and prompts/*.json, deploy them through the
n8n public API (create or update by name), activate them, and export the JSON into n8n/.

Usage: python3 n8n/build.py            (reads N8N_HOST, N8N_API_KEY, WEBHOOK_SHARED_SECRET from .env)
"""
import json, os, pathlib, urllib.request, uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
env = dict(l.strip().split("=", 1) for l in open(ROOT / ".env") if "=" in l and not l.startswith("#"))
BASE = f"https://{env['N8N_HOST']}/api/v1"
HDR = {"X-N8N-API-KEY": env["N8N_API_KEY"], "Content-Type": "application/json", "Accept": "application/json"}


def api(method, path, body=None):
    req = urllib.request.Request(BASE + path, method=method, headers=HDR, data=json.dumps(body).encode() if body is not None else None)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} -> {e.code}: {e.read().decode()[:500]}")


lib = (ROOT / "n8n/src/lib.js").read_text()
prompts = {"talent": json.loads((ROOT / "prompts/talent_read_v6.json").read_text()),
           "job": json.loads((ROOT / "prompts/job_read_v8.json").read_text()),
           "skills": json.loads((ROOT / "prompts/skill_terms_v1.json").read_text()),
           "evidence": json.loads((ROOT / "prompts/skill_evidence_v3.json").read_text())}


def code(name, file, x, y, with_prompts=False, extra=()):
    js = lib + ("\nconst PROMPTS = " + json.dumps(prompts) + ";\n" if with_prompts else "") \
        + "".join("\n" + (ROOT / "n8n/src" / f).read_text() for f in extra) + "\n" + (ROOT / "n8n/src" / file).read_text()
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name)), "name": name, "type": "n8n-nodes-base.code", "typeVersion": 2,
            "position": [x, y], "parameters": {"jsCode": js}}


def chain(*names):
    return {a: {"main": [[{"node": b, "type": "main", "index": 0}]]} for a, b in zip(names, names[1:])}


def find(name):
    for w in api("GET", "/workflows?limit=100").get("data", []):
        if w["name"] == name:
            return w
    return None


def upsert(wf, activate=True):
    cur = find(wf["name"])
    if cur:
        if cur.get("active"):
            api("POST", f"/workflows/{cur['id']}/deactivate")
        res = api("PUT", f"/workflows/{cur['id']}", wf)
    else:
        res = api("POST", "/workflows", wf)
    if activate:
        api("POST", f"/workflows/{res['id']}/activate")
    out = dict(wf, id=res["id"])
    (ROOT / "n8n" / (wf["name"].split(" ")[0] + ".json")).write_text(json.dumps(out, indent=1))
    print("deployed", wf["name"], res["id"])
    return res["id"]


# credential for the webhook's shared-secret header
cred_name = "Webhook shared secret"
creds = api("GET", "/credentials?limit=100").get("data", []) if True else []
cred = next((c for c in creds if c["name"] == cred_name), None)
if not cred:
    cred = api("POST", "/credentials", {"name": cred_name, "type": "httpHeaderAuth",
                                        "data": {"name": "x-webhook-secret", "value": env["WEBHOOK_SHARED_SECRET"]}})
SETTINGS = {"executionOrder": "v1", "timezone": "America/New_York", "saveManualExecutions": True, "saveDataSuccessExecution": "all"}

# W4 error handler first, so the others can point at it
w4 = upsert({"name": "W4 Error handler", "settings": SETTINGS, "connections": chain("Error Trigger", "Record failure"),
             "nodes": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "w4-trigger")), "name": "Error Trigger", "type": "n8n-nodes-base.errorTrigger",
                        "typeVersion": 1, "position": [0, 0], "parameters": {}},
                       code("Record failure", "w4_error.js", 260, 0)]}, activate=False)
S2 = dict(SETTINGS, errorWorkflow=w4)

w2 = upsert({"name": "W2 Talent run", "settings": S2,
             "connections": chain("When called by W1 or W3", "Discover", "Filter", "Match"),
             "nodes": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "w2-trigger")), "name": "When called by W1 or W3",
                        "type": "n8n-nodes-base.executeWorkflowTrigger", "typeVersion": 1.1, "position": [0, 0], "parameters": {"inputSource": "passthrough"}},
                       code("Discover", "w2_discover.js", 260, 0),
                       code("Filter", "w2_filter.js", 520, 0, with_prompts=True, extra=("profile.js",)),
                       code("Match", "w2_match.js", 780, 0)]})


def call_w2(name, x, y, continue_on_fail=False):
    n = {"id": str(uuid.uuid5(uuid.NAMESPACE_URL, name)), "name": name, "type": "n8n-nodes-base.executeWorkflow", "typeVersion": 1.2,
         "position": [x, y], "parameters": {"source": "database", "workflowId": {"__rl": True, "mode": "id", "value": w2},
                                            "mode": "each", "options": {"waitForSubWorkflow": True}}}
    if continue_on_fail:
        n["onError"] = "continueRegularOutput"
    return n


upsert({"name": "W1 Talent onboarding", "settings": S2,
        "connections": chain("Talent added (webhook)", "Start run", "Enrich", "Run W2: discover, filter, match"),
        "nodes": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "w1-webhook")), "name": "Talent added (webhook)", "type": "n8n-nodes-base.webhook",
                   "typeVersion": 2, "position": [0, 0], "webhookId": str(uuid.uuid5(uuid.NAMESPACE_URL, "talent-added")),
                   "parameters": {"httpMethod": "POST", "path": "talent-added", "authentication": "headerAuth", "responseMode": "onReceived", "options": {}},
                   "credentials": {"httpHeaderAuth": {"id": cred["id"], "name": cred_name}}},
                  code("Start run", "w1_start.js", 260, 0),
                  code("Enrich", "w1_enrich.js", 520, 0, with_prompts=True, extra=("profile.js",)),
                  call_w2("Run W2: discover, filter, match", 780, 0)]})

upsert({"name": "W3 Daily schedule", "settings": S2,
        "connections": chain("Every day 08:00 New York", "Prepare daily runs", "Run W2 for each talent"),
        "nodes": [{"id": str(uuid.uuid5(uuid.NAMESPACE_URL, "w3-schedule")), "name": "Every day 08:00 New York", "type": "n8n-nodes-base.scheduleTrigger",
                   "typeVersion": 1.2, "position": [0, 0], "parameters": {"rule": {"interval": [{"field": "cronExpression", "expression": "0 8 * * *"}]}}},
                  code("Prepare daily runs", "w3_prepare.js", 260, 0),
                  call_w2("Run W2 for each talent", 520, 0, continue_on_fail=True)]})
