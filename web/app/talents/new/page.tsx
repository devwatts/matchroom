import { sb } from "@/lib/db";
import AddTalentForm from "@/components/AddTalentForm";
export const dynamic = "force-dynamic";
export default async function NewTalent() {
  const templates = await sb<any[]>("role_templates?select=id,name&order=name");
  return (
    <main className="wrapx">
      <div><span className="mono muted">New talent</span><h1>Paste a LinkedIn link. We&apos;ll do the rest.</h1></div>
      <AddTalentForm templates={templates} />
    </main>
  );
}
