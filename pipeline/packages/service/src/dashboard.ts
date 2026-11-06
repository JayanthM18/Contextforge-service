export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#09090b">
  <title>ContextForge | RAG Quality Demo</title>
  <style>
    :root{color-scheme:dark;--bg:#09090b;--panel:#111113;--line:#27272a;--muted:#a1a1aa;--text:#f4f4f5;--green:#34d399;--red:#fb7185;--amber:#fbbf24}
    *{box-sizing:border-box}
    body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}
    .topbar{height:58px;padding:0 24px;border-bottom:1px solid #27272acc;display:flex;align-items:center;justify-content:space-between;gap:20px}
    .brand{display:flex;align-items:center;gap:12px;min-width:0}.brand-mark{width:24px;height:24px;border-radius:6px;background:#27272a;display:grid;place-items:center;font:700 11px ui-monospace,monospace;color:#e4e4e7}
    .brand-name{font-size:13px;font-weight:550;color:#e4e4e7}.slash{color:#52525b}.demo-label{padding:2px 8px;border:1px solid #27272a;border-radius:5px;background:#111113;color:#a1a1aa;font:11px ui-monospace,monospace;white-space:nowrap}
    .live{display:inline-flex;align-items:center;gap:7px;padding:4px 10px;border:1px solid #10b98133;border-radius:999px;background:#10b98112;color:#34d399;font-size:11px;font-weight:600;white-space:nowrap}
    .dot{width:6px;height:6px;border-radius:50%;background:#34d399;animation:pulse 1.8s infinite}@keyframes pulse{50%{opacity:.4;box-shadow:0 0 0 4px #34d39922}}
    main{max-width:1000px;margin:0 auto;padding:32px 24px 48px}.intro{margin-bottom:22px}h1{margin:0;font-size:20px;line-height:1.3;font-weight:650;letter-spacing:-.025em}.description{margin:5px 0 0;color:var(--muted);font-size:12px}
    .stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:20px}.stat{padding:13px 15px;border:1px solid #27272acc;border-radius:9px;background:#18181b66}.stat-label{color:var(--muted);font-size:11px;font-weight:550}.stat-value{margin-top:3px;color:#f4f4f5;font:600 25px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace}
    .queue{overflow:hidden;border:1px solid #27272acc;border-radius:9px;background:#18181b33}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 14px;border-bottom:1px solid #27272acc;background:#18181b66}.section-title{color:#d4d4d8;font-size:11px;font-weight:600}.updated{color:#71717a;font:10px ui-monospace,SFMono-Regular,Consolas,monospace}
    #jobs{display:grid;gap:0}.job{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:14px;border-bottom:1px solid #27272a99}.job:last-child{border-bottom:0}.repo{font-weight:600;color:#e4e4e7}.meta{margin-top:3px;color:var(--muted);font-size:11px;overflow-wrap:anywhere}.commit{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.right{display:flex;align-items:center;gap:12px}.badge{padding:3px 8px;border:1px solid #3f3f46;border-radius:999px;color:#a1a1aa;font-size:10px;font-weight:600;text-transform:capitalize}.badge.pass{border-color:#10b98155;color:#34d399}.badge.regression,.badge.tool_error{border-color:#fb718555;color:#fb7185}.badge.running{border-color:#fbbf2455;color:#fbbf24}
    a{color:#34d399;font-size:11px;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}
    .empty{min-height:220px;padding:36px 18px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}.empty-icon{width:40px;height:40px;margin-bottom:10px;display:grid;place-items:center;border:1px solid #27272a;border-radius:50%;background:#18181b;color:#a1a1aa}.empty-icon svg{width:20px;height:20px}.empty strong{font-size:13px;font-weight:600;color:#e4e4e7}.empty p{max-width:380px;margin:4px 0 0;color:var(--muted);font-size:11px}
    .setup{margin-top:16px;border:1px solid #27272acc;border-radius:9px;background:#18181b33;overflow:hidden}.setup summary{padding:12px 14px;color:#d4d4d8;font-size:12px;font-weight:600;cursor:pointer;list-style:none}.setup summary::-webkit-details-marker{display:none}.setup summary:after{content:"＋";float:right;color:#a1a1aa}.setup[open] summary:after{content:"−"}.setup-content{padding:0 16px 16px;border-top:1px solid #27272a99;color:#a1a1aa;font-size:11px}.setup-content h2{margin:16px 0 5px;color:#e4e4e7;font-size:12px}.setup-content p{margin:5px 0}.setup-content ol{margin:6px 0;padding-left:20px}.setup-content li{margin:5px 0}.setup-content code{padding:1px 4px;border-radius:4px;background:#27272a;color:#e4e4e7;font:10px ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.setup-content pre{margin:7px 0;padding:10px 12px;overflow-x:auto;border:1px solid #27272a;border-radius:6px;background:#09090b;color:#d4d4d8;font:10px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace}.setup-note{padding:9px 11px;border-left:2px solid #fbbf24;color:#d4d4d8;background:#fbbf240a}
    footer{margin:16px 0 0;text-align:center;color:#71717a;font-size:10px}
    @media(max-width:600px){.topbar{height:auto;min-height:58px;padding:12px 16px;align-items:flex-start}.brand{gap:8px;flex-wrap:wrap}.live{font-size:0;padding:7px}.live .dot{width:7px;height:7px}main{padding:26px 16px 36px}.stats{gap:8px}.stat{padding:11px}.stat-value{font-size:21px}.stat-label{font-size:10px}.job{grid-template-columns:1fr;gap:10px}.right{justify-content:space-between}}
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand"><div class="brand-mark" aria-hidden="true">CF</div><span class="brand-name">ContextForge</span><span class="slash">/</span><span class="demo-label">RAG Quality Demo</span></div>
    <div class="live"><span class="dot" aria-hidden="true"></span><span id="connection">Connecting</span></div>
  </header>
  <main>
    <div class="intro"><h1>Pull Request Queue</h1><p class="description">Real-time webhook evaluations from GitHub to measured results.</p></div>
    <section class="stats" aria-label="Evaluation summary">
      <div class="stat"><div class="stat-label">Total Evaluations</div><div class="stat-value" id="total">—</div></div>
      <div class="stat"><div class="stat-label">In Queue / Running</div><div class="stat-value" id="active">—</div></div>
      <div class="stat"><div class="stat-label">Passed</div><div class="stat-value" id="passed">—</div></div>
    </section>
    <section class="queue" aria-labelledby="jobs-title">
      <div class="section-heading"><span class="section-title" id="jobs-title">Recent Webhooks</span><span class="updated" id="updated">Waiting for service data</span></div>
      <div id="jobs" aria-live="polite"></div>
    </section>
    <details class="setup">
      <summary>Set up the local GitHub PR demo</summary>
      <div class="setup-content">
        <h2>1. Create the two empty GitHub repositories</h2>
        <p>Create <code>JayanthM18/contextforge-service</code> and <code>JayanthM18/ContextForge-application</code>. Leave README, .gitignore, and license unchecked. Choose visibility for each.</p>
        <h2>2. Commit and push the prepared repositories</h2>
        <p>In each local checkout, inspect the status, commit the prepared files, then push the main branch:</p>
        <pre><code>git status<br>git add -A<br>git commit -m "docs: prepare repository"<br>git push -u origin main</code></pre>
        <p>If a remote already has commits, fetch and inspect its history. Do not force-push.</p>
        <h2>3. Create and install a GitHub App</h2>
        <ol><li>Create the App under the account that owns <code>ContextForge-application</code>. Set its homepage to <code>https://github.com/JayanthM18/contextforge-service</code>.</li><li>Grant Contents: read, Pull requests: read, Checks: read and write, and Issues: read and write. Subscribe to Pull request events.</li><li>Choose a webhook secret. Install the App on <code>JayanthM18/ContextForge-application</code>. Copy the numeric App ID and generate a private key. Keep both the key and secret private.</li></ol>
        <h2>4. Start a quick tunnel</h2>
        <p>Run this in its own terminal and leave it running. Copy the HTTPS hostname it prints:</p>
        <pre><code>cloudflared tunnel --url http://127.0.0.1:3000</code></pre>
        <p>Use <code>https://&lt;your-tunnel-hostname&gt;/webhooks/github</code> as the GitHub App webhook URL. A connection-refused message is expected until the service starts.</p>
        <h2>5. Configure the service <code>.env</code></h2>
        <p>Copy <code>.env.example</code> only if <code>.env</code> does not exist. Set these values for your machine and keep <code>.env</code> uncommitted:</p>
        <pre><code>PROVIDER=gemini<br>GEMINI_API_KEY=&lt;your-key&gt;<br>GITHUB_APP_ID=&lt;numeric-app-id&gt;<br>GITHUB_APP_PRIVATE_KEY=&lt;PEM-on-one-line-with-\\n-newlines&gt;<br>CONTEXTFORGE_WEBHOOK_SECRET=&lt;your-app-webhook-secret&gt;<br>CONTEXTFORGE_GITHUB_REPOSITORY=JayanthM18/ContextForge-application<br>CONTEXTFORGE_REPOSITORY_PATH=&lt;absolute-application-checkout-path&gt;<br>CONTEXTFORGE_CONFIG_PATH=contextforge.gemini.yml<br>CONTEXTFORGE_PUBLIC_URL=https://&lt;your-tunnel-hostname&gt;<br>CONTEXTFORGE_HOST=127.0.0.1<br>CONTEXTFORGE_PORT=3000<br>CONTEXTFORGE_EVALUATION_ENV_KEYS=GEMINI_API_KEY<br>CONTEXTFORGE_APP_ENV_KEYS=PROVIDER,GEMINI_API_KEY,OPENAI_BASE_URL,GEMINI_EMBEDDING_BASE_URL,GENERATION_MODEL,EMBEDDING_MODEL,REASONING_EFFORT,TOP_K</code></pre>
        <h2>6. Build, validate, and start the service</h2>
        <p>From the service checkout, validate against the application checkout’s config, then start the service:</p>
        <pre><code>pnpm install --frozen-lockfile<br>pnpm build<br>pnpm exec node --env-file=.env pipeline/packages/cli/dist/bin.js validate --config &lt;application-checkout&gt;/contextforge.gemini.yml<br>pnpm --filter @contextforge/service start</code></pre>
        <p>In another terminal, check <code>http://127.0.0.1:3000/health</code>; it should return <code>{"status":"ok"}</code>.</p>
        <h2>7. Send a real PR webhook</h2>
        <p>Update the GitHub App webhook URL to the current tunnel URL plus <code>/webhooks/github</code>. Confirm the App is installed and the webhook is active, then open or update a same-repository PR. Watch the service logs and PR for the real Check Run/comment. The job and private report link appear above.</p>
        <p class="setup-note">The local worker runs Docker Compose using PR code on your machine. Use it only for trusted contributors and same-repository PRs. Fork PRs and untrusted code are not supported. Stop the service and tunnel with Ctrl+C. If the tunnel URL changes, update both the .env public URL and GitHub App webhook URL.</p>
      </div>
    </details>
    <footer>Loopback-only dashboard. Detailed retrieval metrics &amp; answers are available in private evaluation reports.</footer>
  </main>
  <script>
    const jobsRoot=document.getElementById("jobs");
    const setText=(id,value)=>{document.getElementById(id).textContent=value};
    function render(jobs){
      const active=jobs.filter(job=>job.status==="running"||job.status==="queued").length;
      const passed=jobs.filter(job=>job.result?.status==="pass").length;
      setText("total",String(jobs.length));setText("active",String(active));setText("passed",String(passed));
      setText("connection","Live Listener");setText("updated","Updated "+new Date().toLocaleTimeString());
      jobsRoot.replaceChildren();
      if(jobs.length===0){
        const empty=document.createElement("div");empty.className="empty";
        const icon=document.createElementNS("http://www.w3.org/2000/svg","svg");icon.setAttribute("viewBox","0 0 24 24");icon.setAttribute("fill","none");icon.setAttribute("stroke","currentColor");icon.setAttribute("aria-hidden","true");
        const path=document.createElementNS("http://www.w3.org/2000/svg","path");path.setAttribute("stroke-linecap","round");path.setAttribute("stroke-linejoin","round");path.setAttribute("stroke-width","1.5");path.setAttribute("d","M7 16V4m0 0a3 3 0 1 0-3 3 3 3 0 0 0 3-3zm10 16v-8a3 3 0 0 0-3-3H7m10 11a3 3 0 1 0 3-3 3 3 0 0 0-3 3z");icon.append(path);
        const iconWrap=document.createElement("div");iconWrap.className="empty-icon";iconWrap.append(icon);
        const title=document.createElement("strong");title.textContent="Waiting for pull-request webhook";
        const message=document.createElement("p");message.textContent="Open or update a PR in your connected repository. Events will appear here automatically.";
        empty.append(iconWrap,title,message);jobsRoot.append(empty);return;
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
        if(job.result?.reportUrl){const link=document.createElement("a");link.href=job.result.reportUrl;link.target="_blank";link.rel="noopener noreferrer";link.textContent="View report";right.append(link)}
        else if(job.result?.status==="tool_error"){const error=document.createElement("span");error.className="meta";error.textContent=job.result.safeMessage;right.append(error)}
        card.append(detail,right);jobsRoot.append(card);
      }
    }
    async function refresh(){
      try{const response=await fetch("/api/jobs",{cache:"no-store"});if(!response.ok)throw new Error("Dashboard API returned "+response.status);const payload=await response.json();render(payload.jobs)}
      catch(error){setText("connection","Disconnected");setText("updated","Retrying automatically")}
    }
    refresh();window.setInterval(refresh,3000);
  </script>
</body>
</html>`;
