import LiveRuns from "@/components/LiveRuns";
export const dynamic = "force-dynamic";
export default async function Runs({ searchParams }: { searchParams: Promise<{ talent?: string }> }) {
  const { talent } = await searchParams;
  return (
    <main className="wrapx">
      <div><span className="mono muted">Pipeline · step by step</span><h1>Live runs</h1></div>
      <LiveRuns focusTalent={talent} />
    </main>
  );
}
