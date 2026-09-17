// The public landing page and robots.txt. In hosted mode they are served before sign-in and are
// excluded from App Service authentication, so they must stay static: no app data, no credentials.
const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" rx="10" fill="#236b7a"/><path d="M11 10v20m18-20v20M11 20h18" stroke="white" stroke-width="3"/><circle cx="20" cy="20" r="4" fill="#236b7a" stroke="white" stroke-width="2"/></svg>`;
export const publicHeaders = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY', 'Cache-Control': 'public, max-age=300' };
export const robotsTxt = 'User-agent: *\nAllow: /\nDisallow: /api/\n';
export const landingPage = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Harness Lab: learn how AI agent harnesses work</title>
<meta name="description" content="Harness Lab is an educational web app for software developers and learners. It shows how an agent harness assembles context, calls tools, asks for approval, enforces budgets, and records traces around a language model.">
<meta name="robots" content="index,follow">
<meta name="theme-color" content="#236b7a">
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(icon)}">
<style>
:root { color-scheme: light dark; --bg: #f6f8f8; --fg: #1a2426; --muted: #4f5f63; --line: #d7e0e2; --link: #236b7a; --button: #236b7a; }
@media (prefers-color-scheme: dark) { :root { --bg: #0f1719; --fg: #e6edee; --muted: #a3b3b7; --line: #2a3a3e; --link: #7cc4d2; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 42rem; margin: 0 auto; padding: 3rem 1.25rem 4rem; }
header { display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; }
header svg { width: 40px; height: 40px; display: block; }
h1 { font-size: 2rem; margin: 0; letter-spacing: -.01em; }
.tagline { flex-basis: 100%; margin: .25rem 0 0; color: var(--muted); font-size: 1.1rem; }
h2 { font-size: 1.15rem; margin: 2rem 0 .5rem; }
ul { padding-left: 1.25rem; margin: 0; }
li { margin: .25rem 0; }
a { color: var(--link); }
.links { display: flex; flex-wrap: wrap; gap: .75rem; align-items: center; margin-top: 1rem; }
.button { display: inline-block; padding: .55rem 1rem; border-radius: .5rem; background: var(--button); color: #fff; text-decoration: none; font-weight: 600; }
footer { margin-top: 3rem; padding-top: 1rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .9rem; }
</style>
</head>
<body>
<main>
<header>${icon}<h1>Harness Lab</h1><p class="tagline">See how agents work. Open the black box.</p></header>
<p>Harness Lab is a hands-on teaching app about the software around a language model: the agent harness. Read a short lesson, change one control, run an experiment, and inspect exactly what the harness did.</p>
<h2>What it teaches</h2>
<ul>
<li>The agent loop: model, tool, result, answer</li>
<li>Instructions, context selection, and persistent memory</li>
<li>Tool schemas, argument validation, and knowledge retrieval</li>
<li>Human approval before any write</li>
<li>Turn budgets, timeouts, cancellation, and bounded retries</li>
<li>Evaluation checks and inspectable execution traces</li>
</ul>
<p>A scripted simulator runs every lesson without an API key, and the same harness can run against a live OpenAI model.</p>
<h2>Access</h2>
<p>This hosted instance is a private preview that requires its owner's Microsoft sign-in. The source code is public, and the app runs locally with one command.</p>
<p class="links"><a class="button" href="/guide">Open the field guide</a><a class="button" href="/studio">Open the experiment studio</a><a href="https://github.com/bryangarver/harness-lab">Source code on GitHub</a></p>
<footer>Local-first · OpenAI Responses API · Built to be taken apart.</footer>
</main>
</body>
</html>
`;
