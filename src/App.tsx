import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, ChevronRight, CircleHelp, Clock3, Code2, Copy, Database, Download, FlaskConical, History, ListChecks, Loader2, Network, Pin, Play, RotateCcw, Settings2, ShieldCheck, Square, Terminal, Trash2, Unplug, X, Zap } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import HarnessMap from './HarnessMap';
import { defaults, lessons } from './lessons';
import type { Config, Memory, Run } from '../server/schema';

type Status = { configured: boolean; model: string; hosted?: boolean };
type HistoryRow = Pick<Run, 'id' | 'createdAt' | 'status' | 'prompt' | 'steps'> & { mode: string };
type Drawer = 'memory' | 'history' | 'connection' | 'knowledge' | null;
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Request failed.');
  return result as T;
}
const isActive = (run: Run | null) => !!run && ['running', 'awaiting_approval'].includes(run.status);
function Toggle({ label, help, checked, onChange }: { label: string; help: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="toggle-row"><span><strong>{label}</strong><small>{help}</small></span><input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} /><span className="switch" aria-hidden="true" /></label>;
}
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }} className="drawer"><header><h2>{title}</h2><button className="icon-button" aria-label="Close panel" onClick={onClose}><X size={20} /></button></header><div className="drawer-body">{children}</div></dialog>;
}
function Markdown({ children }: { children: string }) { return <div className="markdown"><ReactMarkdown>{children}</ReactMarkdown></div>; }

export default function App() {
  const [lessonIndex, setLessonIndex] = useState(0);
  const lesson = lessons[lessonIndex];
  const [config, setConfig] = useState<Config>(defaults);
  const [prompt, setPrompt] = useState(lessons[0].prompt);
  const [context, setContext] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [baseline, setBaseline] = useState<Run | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [knowledge, setKnowledge] = useState<{ id: string; title: string; text: string }[]>([]);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [visited, setVisited] = useState<string[]>(() => { try { const data: unknown = JSON.parse(localStorage.getItem('harness-explored') || '["loop"]'); return Array.isArray(data) ? data.filter((x): x is string => typeof x === 'string' && lessons.some(l => l.id === x)) : ['loop']; } catch { return ['loop']; } });
  const traceRef = useRef<HTMLElement>(null);
  const busy = submitting || isActive(run);
  const update = <K extends keyof Config>(key: K, value: Config[K]) => setConfig(c => ({ ...c, [key]: value }));
  const report = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.');
  async function refresh() { try { setStatus(await api<Status>('/status')); } catch (e) { report(e); } }
  async function refreshMemory() { try { setMemories(await api<Memory[]>(`/memories?mode=${config.mode}`)); } catch (e) { report(e); } }
  useEffect(() => { void refresh(); void api<typeof knowledge>('/knowledge').then(setKnowledge).catch(report); }, []);
  useEffect(() => { void refreshMemory(); }, [config.mode, run?.status]);
  useEffect(() => { try { localStorage.setItem('harness-explored', JSON.stringify(visited)); } catch { /* Browsing can continue without local storage. */ } }, [visited]);
  useEffect(() => {
    if (!run || !isActive(run)) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try { const next = await api<Run>(`/runs/${run!.id}`); if (!disposed) setRun(next); }
      catch (e) { if (!disposed) report(e); }
      if (!disposed) timer = setTimeout(poll, 600);
    }
    timer = setTimeout(poll, 350);
    return () => { disposed = true; clearTimeout(timer); };
  }, [run?.id, run?.status]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(t); }, [notice]);

  function chooseLesson(index: number) {
    if (busy) return;
    setLessonIndex(index);
    const next = lessons[index];
    setPrompt(next.prompt); setContext(next.context || '');
    setConfig({ ...defaults, mode: config.mode, ...next.config });
    setRun(null); setError('');
    setVisited(v => v.includes(next.id) ? v : [...v, next.id]);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  }
  function resetExample() { setPrompt(lesson.prompt); setContext(lesson.context || ''); setConfig({ ...defaults, mode: config.mode, ...lesson.config }); setError(''); }
  async function startRun(event?: React.FormEvent) {
    event?.preventDefault();
    if (busy || !prompt.trim()) return;
    setSubmitting(true); setError(''); setRun(null);
    try { const created = await api<Run>('/runs', { method: 'POST', body: JSON.stringify({ prompt, context, config }) }); setRun(created); setTimeout(() => traceRef.current?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }), 100); }
    catch (e) { report(e); }
    finally { setSubmitting(false); }
  }
  async function decide(approved: boolean) {
    if (!run?.approval) return;
    setDeciding(true);
    try { await api(`/runs/${run.id}/approval`, { method: 'POST', body: JSON.stringify({ id: run.approval.id, approved }) }); setRun(await api<Run>(`/runs/${run.id}`)); }
    catch (e) { report(e); } finally { setDeciding(false); }
  }
  async function cancel() { if (!run) return; try { await api(`/runs/${run.id}/cancel`, { method: 'POST', body: '{}' }); setRun(await api<Run>(`/runs/${run.id}`)); } catch (e) { report(e); } }
  async function openDrawer(value: Drawer) {
    setDrawer(value);
    if (value === 'history') try { setHistory(await api<HistoryRow[]>('/runs')); } catch (e) { report(e); }
    if (value === 'memory') await refreshMemory();
    if (value === 'connection') await refresh();
  }
  async function loadRun(id: string) { try { const saved = await api<Run>(`/runs/${id}`); setRun(saved); setConfig(saved.config); setPrompt(saved.prompt); setContext(saved.context); setDrawer(null); } catch (e) { report(e); } }
  function download() {
    if (!run) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `harness-run-${run.id.slice(0, 8)}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const changes = baseline && run ? Object.keys(config).filter(k => baseline.config[k as keyof Config] !== run.config[k as keyof Config]) : [];

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to lesson</a>
    <aside className="sidebar" aria-label="Learning navigation">
      <a className="brand" href="#main" onClick={e => { e.preventDefault(); chooseLesson(0); }}><span className="brand-mark"><Network size={22} /></span><span>Harness<span className="brand-light">Lab</span><small>Open the black box.</small></span></a>
      <div className="course-label"><BookOpen size={15} /> The field guide <span>12</span></div>
      <nav className="lesson-nav">{lessons.map((item, index) => <button disabled={busy} key={item.id} className={`lesson-link ${index === lessonIndex ? 'selected' : ''}`} aria-current={index === lessonIndex ? 'page' : undefined} onClick={() => chooseLesson(index)}><span className="lesson-number">{String(index + 1).padStart(2, '0')}</span><span>{item.name}</span>{visited.includes(item.id) && index !== lessonIndex && <Check size={13} className="visited-icon" />}{index === lessonIndex && <ChevronRight size={14} />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="progress-label"><span>Your exploration</span><span>{visited.length} / 12</span></div><progress aria-label="Lessons explored" value={visited.length} max={12} /><p>Read a concept. Change a setting.<br />See what happens.</p><button onClick={() => openDrawer('history')}><History size={16} /> Run history</button><button onClick={() => openDrawer('memory')}><Database size={16} /> Memory store <span className="count">{memories.length}</span></button></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">Field guide <ChevronRight size={14} /><span>{lesson.name}</span></div><div className="topbar-actions"><a className="field-studio-link" href="/studio">Experiment studio</a><span className={`connection-dot ${status?.configured ? 'ready' : ''}`} /><button className="text-button connection-button" onClick={() => openDrawer('connection')}>{status === null ? 'Checking connection' : status.configured ? 'OpenAI configured' : 'No API key needed'}<Settings2 size={15} /></button></div></header>
      <main id="main">
        <div className="mobile-nav"><label htmlFor="mobile-lesson">Explore a concept</label><select id="mobile-lesson" disabled={busy} value={lessonIndex} onChange={e => chooseLesson(Number(e.target.value))}>{lessons.map((item, i) => <option key={item.id} value={i}>{i + 1}. {item.name}</option>)}</select></div>
        <div className="mobile-utilities"><button className="text-button" onClick={() => openDrawer('history')}><History size={14} /> Run history</button><button className="text-button" onClick={() => openDrawer('memory')}><Database size={14} /> Memory store ({memories.length})</button></div>
        <div className="page-heading"><div className="eyebrow"><span className="tiny-orbit" /> A hands-on guide to agent systems</div><div className="heading-line"><h1>{lesson.title}</h1><span className="lesson-position">Lesson {lessonIndex + 1} of 12</span></div><p>{lesson.description}</p></div>

        <HarnessMap lessonId={lesson.id} run={run} starting={submitting} onChooseLesson={chooseLesson} />

        <div className="learning-grid">
          <section className="lesson-content" aria-labelledby="concepts-title"><h2 id="concepts-title">What to understand</h2><dl className="concepts">{lesson.concepts.map(concept => <div key={concept.term}><dt>{concept.term}</dt><dd>{concept.text}</dd></div>)}</dl><div className="impact"><h3><Zap size={17} /> What changes in practice</h3><p>{lesson.impact}</p></div><div className="try-it"><h3><FlaskConical size={17} /> Try this experiment</h3><p>{lesson.tryThis}</p>{lesson.id === 'memory' && <button disabled={busy} className="button secondary small" onClick={() => { setPrompt('What do you remember about my preferences?'); setNotice('Recall scenario loaded. Run it to inspect the memories supplied.'); }}>Try recall <ArrowRight size={14} /></button>}{lesson.id === 'retrieval' && <button className="text-button inline-link" onClick={() => openDrawer('knowledge')}>Included knowledge <ArrowRight size={14} /></button>}</div><details className="technical"><summary><Code2 size={16} /> Under the hood <ChevronDown size={15} /></summary><p>{lesson.technical}</p><code>{lesson.source}</code></details><div className="lesson-footer"><span>{lessonIndex === 11 ? 'Keep experimenting with your own scenarios.' : `Up next: ${lessons[lessonIndex + 1].name}`}</span>{lessonIndex < 11 && <button disabled={busy} className="icon-button" aria-label="Next lesson" onClick={() => chooseLesson(lessonIndex + 1)}><ArrowRight size={18} /></button>}</div></section>

          <section className="experiment" aria-labelledby="experiment-title"><div className="experiment-heading"><div><FlaskConical size={18} /><h2 id="experiment-title">Your experiment</h2></div><button type="button" className="icon-button" title="Reset this example" aria-label="Reset this example" disabled={busy} onClick={resetExample}><RotateCcw size={16} /></button></div>
            <form onSubmit={startRun}><fieldset disabled={busy}><legend className="sr-only">Experiment settings</legend><div className="mode-selector" aria-label="Model provider"><button type="button" aria-pressed={config.mode === 'simulator'} className={config.mode === 'simulator' ? 'active' : ''} onClick={() => update('mode', 'simulator')}><FlaskConical size={14} /> Simulator</button><button type="button" aria-pressed={config.mode === 'live'} className={config.mode === 'live' ? 'active' : ''} onClick={() => update('mode', 'live')}><Zap size={14} /> Live OpenAI</button></div><p className="mode-help">{config.mode === 'simulator' ? 'Scripted model · real harness & tools · no API calls' : `${status?.model || 'gpt-5.6-sol'} · real model · uses your API credits`}</p>
              {config.mode === 'live' && !status?.configured && <div className="connection-hint"><Unplug size={16} /><span>{status?.hosted ? <>Configure your key in Azure to run live.</> : <>Add your key to <code>.env</code> to run live.</>}</span><button type="button" className="text-button" onClick={() => openDrawer('connection')}>Setup</button></div>}
              <label className="field-label" htmlFor="scenario">Scenario <span>Make it your own</span></label><textarea id="scenario" className="scenario-input" maxLength={8000} value={prompt} onChange={e => setPrompt(e.target.value)} required rows={3} placeholder="Give the agent a task…" />
              <details className="context-editor" open={lesson.id === 'context' || undefined}><summary>Extra context <span>{context.length ? `${context.length} characters` : 'Optional'}</span><ChevronDown size={14} /></summary><label className="sr-only" htmlFor="context-input">Extra context</label><textarea id="context-input" maxLength={20000} value={context} onChange={e => setContext(e.target.value)} rows={4} placeholder="Paste a brief or background information for this run." /></details>
              <div className="controls-heading"><span>Harness controls</span><span>Change one. Observe the effect.</span></div>
              <Toggle label="General tools" help="Calculate and create local notes" checked={config.tools} onChange={v => update('tools', v)} />
              <Toggle label="Memory" help={`${memories.length} saved ${memories.length === 1 ? 'fact' : 'facts'} · read and remember`} checked={config.memory} onChange={v => update('memory', v)} />
              <Toggle label="Knowledge retrieval" help="Search the included documents" checked={config.retrieval} onChange={v => update('retrieval', v)} />
              <details className="advanced-controls" open={['instructions', 'planning', 'permissions', 'limits', 'recovery', 'evaluation', 'context'].includes(lesson.id) || undefined}><summary><Settings2 size={15} /> More controls <ChevronDown size={15} /></summary><label className="field-label" htmlFor="instructions">Operator instructions</label><textarea id="instructions" maxLength={5000} rows={3} value={config.instructions} onChange={e => update('instructions', e.target.value)} /><Toggle label="Plan before acting" help="Record a short plan using a tool" checked={config.planning} onChange={v => update('planning', v)} /><Toggle label="Require write approval" help="Pause before saving memories or notes" checked={config.approvals} onChange={v => update('approvals', v)} /><Toggle label="Safe retries" help="One retry for a temporary failure" checked={config.retry} onChange={v => update('retry', v)} /><Toggle label="Inject calculator failure" help="Fail the first calculation once per run" checked={config.failOnce} onChange={v => update('failOnce', v)} /><div className="number-fields"><label>Max model turns<input type="number" min={1} max={10} value={config.maxSteps} onChange={e => update('maxSteps', Number(e.target.value))} /></label><label>Extra context limit<input type="number" min={100} max={10000} step={100} value={config.contextChars} onChange={e => update('contextChars', Number(e.target.value))} /><small>Characters, not tokens</small></label></div><label className="field-label" htmlFor="tokens">Output tokens per model turn</label><input id="tokens" type="number" min={256} max={4096} value={config.maxOutputTokens} onChange={e => update('maxOutputTokens', Number(e.target.value))} /><label className="field-label" htmlFor="expected">Expected answer contains</label><input id="expected" maxLength={300} value={config.expected} onChange={e => update('expected', e.target.value)} placeholder="Optional, e.g. 168" /><p className="field-help">A simple text check. It does not judge overall correctness.</p></details>
            </fieldset><div className="run-actions"><button className="button primary" type="submit" disabled={busy || !prompt.trim() || (config.mode === 'live' && !status?.configured)}>{busy ? <Loader2 className="spinning" size={16} /> : <Play size={15} fill="currentColor" />}{busy ? run?.status === 'awaiting_approval' ? 'Waiting for approval' : 'Running experiment' : 'Run experiment'}{!busy && <span className="run-arrow">↵</span>}</button>{busy && <button className="button secondary" type="button" onClick={cancel} disabled={!run}><Square size={13} /> Stop</button>}</div><p className="run-footnote">{config.mode === 'simulator' ? 'Use the example patterns above. For open-ended tasks, switch to live.' : 'Prompts, selected memories, and tool results are sent to OpenAI.'}</p></form>
          </section>
        </div>

        {error && <div className="error-banner" role="alert"><CircleHelp size={18} /><p>{error}</p><button className="icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}
        <section ref={traceRef} className="results" aria-labelledby="results-title"><div className="results-heading"><div><Terminal size={19} /><h2 id="results-title">See the harness at work</h2>{run && <span className={`status-tag ${run.status}`}>{run.status.replace('_', ' ')}</span>}</div>{run && <div className="result-actions"><button className="text-button" disabled={isActive(run)} onClick={() => { setBaseline(run); setNotice('Run pinned. Change one setting and run the same scenario again.'); }}><Pin size={14} /> Pin to compare</button><button className="icon-button" aria-label="Download run trace" title="Download run trace" onClick={download}><Download size={16} /></button></div>}</div>
          {!run ? <div className="results-empty"><div className="empty-path"><span /><span /><span /><ArrowRight size={18} /></div><h3>Your agent’s next move, made visible.</h3><p>Run an experiment to see the context, tool calls, and decisions<br className="desktop-break" /> that turn a request into an answer.</p><span><Play size={12} /> Start with the example on the right</span></div> : <>
            <div className="run-summary"><span><strong>{run.model}</strong>{run.config.mode === 'simulator' && <span className="sim-label">scripted</span>}</span><span>{run.steps} / {run.config.maxSteps} turns</span><span>{run.toolCalls} tool {run.toolCalls === 1 ? 'call' : 'calls'}</span><span><Clock3 size={13} /> {(run.durationMs / 1000).toFixed(1)}s</span><span>{run.config.mode === 'live' ? `${run.usage.input.toLocaleString()} in / ${run.usage.output.toLocaleString()} out tokens` : 'No tokens billed'}</span></div>
            {run.approval && <div className="approval-box" role="region" aria-label="Pending approval"><div className="approval-title"><ShieldCheck size={21} /><div><h3>Your approval is needed</h3><p>The harness paused before <code>{run.approval.tool}</code>. Review the exact action.</p></div></div><pre>{JSON.stringify(run.approval.arguments, null, 2)}</pre><div className="approval-actions"><span>No write has happened yet. Expires in 2 minutes.</span><button className="button secondary small" disabled={deciding} onClick={() => decide(false)}>Deny</button><button className="button primary small" disabled={deciding} onClick={() => decide(true)}><Check size={14} /> Approve action</button></div></div>}
            <div className="run-grid"><div className="trace"><div className="subsection-heading"><h3>Execution trace</h3><span>{run.events.length} events</span></div><ol>{run.events.map(event => <li key={event.id} className={`trace-event event-${event.type}`}><span className="event-marker">{event.id}</span><details><summary><span>{event.title}</span><ChevronDown size={14} /></summary><p>{event.detail}</p>{event.data !== undefined && <pre>{JSON.stringify(event.data, null, 2)}</pre>}</details></li>)}</ol>{isActive(run) && <div className="trace-wait"><span className="pulse-dot" />{run.status === 'awaiting_approval' ? 'Waiting for your decision…' : 'The harness is working…'}</div>}<p className="trace-note">Execution events, not private chain of thought.</p></div><div className="answer"><div className="subsection-heading"><h3>Agent response</h3>{run.output && <button className="icon-button" aria-label="Copy agent response" onClick={() => navigator.clipboard.writeText(run.output).then(() => setNotice('Response copied.')).catch(report)}><Copy size={14} /></button>}</div><div aria-live="polite" aria-atomic="true">{run.output ? <Markdown>{run.output}</Markdown> : <div className="answer-pending"><div className="skeleton" /><div className="skeleton" /><div className="skeleton short" /><p>{run.status === 'awaiting_approval' ? 'The agent will continue after your decision.' : 'The answer appears when the agent finishes.'}</p></div>}</div>{run.evaluation && <div className={`evaluation ${run.evaluation.passed ? 'passed' : 'failed'}`}><ListChecks size={17} /><div><strong>Answer check {run.evaluation.passed ? 'passed' : 'failed'}</strong><p>Contains “{run.evaluation.expected}”</p><small>{run.evaluation.detail}</small></div></div>}<details className="run-settings"><summary>Configuration used for this run <ChevronDown size={14} /></summary><pre>{JSON.stringify(run.config, null, 2)}</pre></details></div></div>
          </>}
        </section>
        {baseline && <section className="comparison"><div className="results-heading"><div><Pin size={17} /><h2>Compare experiments</h2></div><button className="icon-button" aria-label="Clear comparison" onClick={() => setBaseline(null)}><X size={17} /></button></div><p>{run && run.id !== baseline.id ? changes.length ? `Changed controls: ${changes.join(', ')}.` : 'The control settings are identical.' : 'A run is pinned. Change one control and run the same scenario again.'}{run && run.id !== baseline.id && baseline.prompt !== run.prompt && ' The scenario also changed; this is not a controlled comparison.'}{run && baseline.context !== run.context && ' Extra context also changed.'} Memory may change between runs; inspect context events. Live model outputs can vary.</p><div className="compare-grid"><div><h3>Pinned run <span>{baseline.steps} turns · {baseline.status}</span></h3><Markdown>{baseline.output}</Markdown></div><div><h3>Current run <span>{run && run.id !== baseline.id ? `${run.steps} turns · ${run.status}` : 'Waiting for a new run'}</span></h3>{run && run.id !== baseline.id ? <Markdown>{run.output || 'Running…'}</Markdown> : <p className="muted">Your next result will appear here.</p>}</div></div></section>}
        <footer className="page-footer"><span><Network size={14} /> Built to be taken apart.</span><span>Local-first · OpenAI Responses API · GPT-5.6 Sol</span></footer>
      </main>
    </div>
    {notice && <div className="toast" role="status"><Check size={16} />{notice}</div>}
    {drawer && <Modal title={{ memory: 'Persistent memory', history: 'Run history', connection: 'Connect OpenAI', knowledge: 'Included knowledge' }[drawer]} onClose={() => setDrawer(null)}>
      {drawer === 'connection' && <><div className={`connection-status ${status?.configured ? 'configured' : ''}`}><span className="connection-dot ready" /><strong>{status?.configured ? 'API key is configured' : 'The simulator is ready to use'}</strong></div><p>For open-ended scenarios, connect your OpenAI account. The server uses <code>{status?.model || 'gpt-5.6-sol'}</code>.</p><ol className="setup-steps"><li>{status?.hosted ? <>Open your Azure web app’s <strong>Environment variables</strong> settings.</> : <>Open the <code>.env</code> file in this project directory.</>}</li><li>{status?.hosted ? <>Add <code>OPENAI_API_KEY</code> privately and apply the change.</> : <>Paste your key after <code>OPENAI_API_KEY=</code> and save.</>}</li><li>Refresh the connection below, then select <strong>Live OpenAI</strong>.</li></ol><pre>OPENAI_API_KEY=your-key-here{'\n'}OPENAI_MODEL=gpt-5.6-sol</pre><p className="field-help">{status?.hosted ? 'Azure keeps the key in server configuration.' : 'The file is excluded from Git.'} Credentials stay on the server and are never returned to the browser. Refresh checks that a key exists; the first live run verifies account access.</p><button className="button primary" onClick={async () => { await refresh(); setNotice('Connection configuration refreshed.'); }}><RotateCcw size={15} /> Refresh connection</button><div className="drawer-note"><h3>What gets sent?</h3><p>In live mode, the current scenario, instructions, selected memories, extra context, and tool results are sent to OpenAI. Simulator mode makes no model API calls.</p><a href="https://developers.openai.com/api/docs/models/gpt-5.6-sol" target="_blank" rel="noreferrer">Official model documentation ↗</a></div></>}
      {drawer === 'memory' && <><p>Saved facts for <strong>{config.mode === 'simulator' ? 'the simulator' : 'live OpenAI'}</strong>. They survive fresh runs and server restarts. The two modes use separate stores.</p><div className="memory-instruction"><Database size={19} /><p>To save a fact, ask the agent:<br /><strong>“Remember that I prefer short answers.”</strong></p></div>{memories.length ? <ul className="memory-list">{memories.map(memory => <li key={memory.id}><div><p>{memory.content}</p><small>{new Date(memory.createdAt).toLocaleString()}</small></div><button className="icon-button danger" aria-label={`Forget ${memory.content}`} onClick={async () => { try { await api(`/memories/${memory.id}?mode=${config.mode}`, { method: 'DELETE' }); await refreshMemory(); setNotice('Memory removed from future runs. Existing traces keep their snapshots.'); } catch (e) { report(e); } }}><Trash2 size={16} /></button></li>)}</ul> : <div className="drawer-empty">No memories yet. Try the Persistent memory lesson to save your first fact.</div>}<p className="field-help">The latest 20 facts are included when memory is on. Forgetting removes the fact from future context; past traces retain their snapshots.</p><button disabled={busy} className="button secondary" onClick={() => { chooseLesson(4); setDrawer(null); }}>Open memory experiment <ArrowRight size={15} /></button></>}
      {drawer === 'history' && <><p>The latest 30 runs are saved locally, including their context and tool results. Opening a run lets you inspect its trace or reuse its scenario.</p>{history.length ? <ul className="history-list">{history.map(item => <li key={item.id}><button disabled={busy} onClick={() => loadRun(item.id)}><div><strong>{item.prompt}</strong><span>{new Date(item.createdAt).toLocaleString()} · {item.mode} · {item.steps} turns</span></div><span className={`status-tag ${item.status}`}>{item.status.replace('_', ' ')}</span><ChevronRight size={16} /></button></li>)}</ul> : <div className="drawer-empty">Your first experiment will appear here after you run it.</div>}</>}
      {drawer === 'knowledge' && <><p>These documents are bundled with the demo. Search uses keyword overlap so you can inspect exactly where an answer came from.</p>{knowledge.map(doc => <article className="knowledge-document" key={doc.id}><BookOpen size={18} /><h3>{doc.title}</h3><p>{doc.text}</p><code>{doc.id}</code></article>)}</>}
    </Modal>}
  </div>;
}
