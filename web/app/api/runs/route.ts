import { sb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const talent = new URL(req.url).searchParams.get("talent");
  const runs = await sb<any[]>(`pipeline_runs?select=id,talent_id,trigger,status,error,started_at,finished_at,posted_window_used,recovery_mode,n8n_execution_id,talents(name,linkedin_url),pipeline_run_steps(step,status,summary,details,log,counts,error,started_at,finished_at)${talent ? `&talent_id=eq.${talent}` : ""}&order=started_at.desc&limit=25`);
  return Response.json({ runs, n8n: `https://${process.env.N8N_HOST}`, workflows: { onboarding: process.env.N8N_ONBOARDING_WORKFLOW_ID, daily: process.env.N8N_DAILY_WORKFLOW_ID } });
}
