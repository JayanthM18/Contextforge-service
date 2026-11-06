export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#10131c">
  <title>ContextForge | Local demo</title>
  <style>
    :root{color-scheme:dark;--bg:#10131c;--panel:#181d29;--line:#2b3344;--muted:#a4aec1;--text:#f4f6fb;--teal:#5be0c3;--red:#ff7587;--amber:#f5c66c}
    *{box-sizing:border-box}
    body{margin:0;background:radial-gradient(ellipse at 85% -20%,#263852 0,transparent 42%),var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
    main{max-width:1080px;margin:0 auto;padding:52px 24px 80px}
    header{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-bottom:32px}
    .eyebrow{margin:0 0 8px;color:var(--teal);font-size:12px;font-weight:700;letter-spacing:.15em;text-transform:uppercase}
    h1{margin:0;font-size:clamp(30px,5vw,46px);line-height:1.1;letter-spacing:-.04em}
    .intro{max-width:680px;margin:14px 0 0;color:var(--muted)}
    .live{display:flex;align-items:center;gap:9px;padding:8px 12px;border:1px solid var(--line);border-radius:999px;color:var(--muted);white-space:nowrap;font-size:13px}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--teal);box-shadow:0 0 12px #5be0c388}
    .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:36px}
    .stat,.job,.empty,.notice{border:1px solid var(--line);background:linear-gradient(145deg,#1b2130,var(--panel));border-radius:16px}
    .stat{padding:18px 20px}.stat-label{color:var(--muted);font-size:13px}.stat-value{margin-top:5px;font-size:29px;font-weight:700;letter-spacing:-.04em}
    .section-heading{display:flex;justify-content:space-between;align-items:baseline;gap:20px;margin:0 0 14px}
    h2{margin:0;font-size:18px}.updated{color:var(--muted);font-size:12px}
    #jobs{display:grid;gap:12px}
    .job{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:center;padding:18px 20px}
    .repo{font-weight:700}.meta{margin-top:5px;color:var(--muted);font-size:13px;overflow-wrap:anywhere}
    .commit{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
    .right{display:flex;align-items:center;gap:12px}
    .badge{padding:5px 10px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:12px;font-weight:700;text-transform:capitalize}
    .badge.pass{border-color:#246b60;color:var(--teal)}.badge.regression,.badge.tool_error{border-color:#74404c;color:var(--red)}.badge.running{border-color:#695632;color:var(--amber)}
    a{color:var(--teal);font-weight:650;text-decoration:none}a:hover{text-decoration:underline}
    .empty{padding:32px;text-align:center}.empty strong{display:block;font-size:16px}.empty p{max-width:500px;margin:8px auto 0;color:var(--muted)}
    .notice{margin-top:28px;padding:14px 17px;color:var(--muted);font-size:13px}
    @media(max-width:640px){main{padding:32px 16px 56px}header{display:block}.live{width:max-content;margin-top:18px}.stats{gap:9px}.stat{padding:14px}.stat-value{font-size:23px}.job{grid-template-columns:1fr;gap:14px}.right{justify-content:space-between}}
  </style>
</head>
<body>
  <main>
    <header>
      <div>
        <p class="eyebrow">RAG quality · local demo</p>
        <h1>ContextForge</h1>
        <p class="intro">Real pull-request evaluations, from GitHub webhook to measured result. This page reflects the local service queue; it does not start or simulate evaluations.</p>
      </div>
      <div class="live"><span class="dot" aria-hidden="true"></span><span id="connection">Connecting</span></div>
    </header>
    <section class="stats" aria-label="Evaluation summary">
      <div class="stat"><div class="stat-label">Recent evaluations</div><div class="stat-value" id="total">—</div></div>
      <div class="stat"><div class="stat-label">Queued or running</div><div class="stat-value" id="active">—</div></div>
      <div class="stat"><div class="stat-label">Passed</div><div class="stat-value" id="passed">—</div></div>
    </section>
    <section aria-labelledby="jobs-title">
      <div class="section-heading"><h2 id="jobs-title">Recent pull requests</h2><span class="updated" id="updated">Waiting for service data</span></div>
      <div id="jobs" aria-live="polite"></div>
    </section>
    <aside class="notice">Dashboard is loopback-only. For detailed metrics, case scores, answers, and retrieved context, open the private report link on a completed evaluation.</aside>
  </main>
  <script>
    const jobsRoot=document.getElementById("jobs");
    const setText=(id,value)=>{document.getElementById(id).textContent=value};
    function render(jobs){
      const active=jobs.filter(job=>job.status==="running"||job.status==="queued").length;
      const passed=jobs.filter(job=>job.result?.status==="pass").length;
      setText("total",String(jobs.length));setText("active",String(active));setText("passed",String(passed));
      setText("connection","Live");setText("updated","Updated "+new Date().toLocaleTimeString());
      jobsRoot.replaceChildren();
      if(jobs.length===0){
        const empty=document.createElement("div");empty.className="empty";
        const title=document.createElement("strong");title.textContent="Waiting for a pull-request webhook";
        const message=document.createElement("p");message.textContent="Open or update a same-repository PR after the local service is running. The real evaluation will appear here as it moves through the queue.";
        empty.append(title,message);jobsRoot.append(empty);return;
      }
      for(const job of jobs){
        const card=document.createElement("article");card.className="job";
        const detail=document.createElement("div");
        const repo=document.createElement("div");repo.className="repo";repo.textContent=job.repository+(job.pullRequestNumber===null?"":" · PR #"+job.pullRequestNumber);
        const sha=document.createElement("div");sha.className="meta commit";sha.textContent="Commit "+job.commitSha.slice(0,12);
        detail.append(repo,sha);
        const right=document.createElement("div");right.className="right";
        const status=document.createElement("span");status.className="badge "+job.status;status.textContent=job.result?.status??job.status;
        right.append(status);
        if(job.result?.reportUrl){
          const link=document.createElement("a");link.href=job.result.reportUrl;link.target="_blank";link.rel="noopener noreferrer";link.textContent="View report";
          right.append(link);
        }else if(job.result?.status==="tool_error"){
          const error=document.createElement("span");error.className="meta";error.textContent=job.result.safeMessage;right.append(error);
        }
        card.append(detail,right);jobsRoot.append(card);
      }
    }
    async function refresh(){
      try{
        const response=await fetch("/api/jobs",{cache:"no-store"});
        if(!response.ok)throw new Error("Dashboard API returned "+response.status);
        const payload=await response.json();render(payload.jobs);
      }catch(error){
        setText("connection","Disconnected");setText("updated","Retrying automatically");
      }
    }
    refresh();window.setInterval(refresh,3000);
  </script>
</body>
</html>`;
