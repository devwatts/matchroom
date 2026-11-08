import { sb, triggerOnboarding } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await sb(`talents?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ status: "adding" }) });
  try { await triggerOnboarding(id); } catch (e: any) { return Response.json({ error: e.message }, { status: 502 }); }
  return Response.json({ ok: true });
}
