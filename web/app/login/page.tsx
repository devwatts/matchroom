import LoginForm from "@/components/LoginForm";
export const metadata = { title: "Log in · Matchroom" };
export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <main className="login">
      <div className="login-card tile">
        <span className="logo"><span><i></i><i></i></span>matchroom</span>
        <div><span className="mono muted">Recruiter access</span><h1>Daily matches for every talent.</h1></div>
        <p className="hint" style={{ fontSize: 15 }}>New York jobs, agency posts removed, every match explained. Enter the team password to continue.</p>
        <LoginForm next={next && next.startsWith("/") ? next : "/"} />
      </div>
      <div className="login-strip" aria-hidden="true">
        <span className="chip c-active">matched</span><span className="chip c-failed">agency removed</span><span className="chip c-check">needs a check</span><span className="chip c-adding">running</span>
      </div>
    </main>
  );
}
