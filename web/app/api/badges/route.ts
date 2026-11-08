import { sb } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() {
  const [running, held] = await Promise.all([
    sb<any[]>("pipeline_runs?status=eq.running&select=id"),
    sb<any[]>("talent_matches?agency_status=eq.needs_check&select=company_linkedin_id"),
  ]);
  return Response.json({ running: running.length, checks: new Set(held.map(h => h.company_linkedin_id)).size });
}
