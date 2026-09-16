import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, Check, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Database, Download, FlaskConical, Lightbulb, Loader2, MessageSquare, Network, NotebookPen, Plus, RotateCcw, Save, Settings2, ShieldCheck, Sparkles, Square, Trash2, X } from 'lucide-react';
import type { Config, Memory, Run } from '../../server/schema';
import { lessons } from '../lessons';
import { changedControls, experiments, makeVariants, type Variant } from './experiments';
import { request } from './api';
import ConfigurationTable from './ConfigurationTable';
import VariantColumn, { ApprovalActions, isRunning } from './VariantColumn';
import './studio.css';

type SavedComparison = { id: string; experimentId: string; runIds: string[]; predictions: (boolean | null)[]; note: string; createdAt: string };
type Connection = { configured: boolean; model: string; hosted?: boolean };
const fingerprint = (prompt: string, context: string, variants: Variant[]) => JSON.stringify({ prompt, context, variants: variants.map(v => ({ label: v.label, config: v.config })) });
function readSaved(key: string, session = false): SavedComparison[] {
  try { const value: unknown = JSON.parse((session ? sessionStorage : localStorage).getItem(key) || '[]'); return Array.isArray(value) ? value.filter((v): v is SavedComparison => !!v && typeof v === 'object' && typeof v.id === 'string' && experiments.some(e => e.id === v.experimentId) && Array.isArray(v.runIds) && v.runIds.every((id: unknown) => typeof id === 'string') && Array.isArray(v.predictions)) : []; } catch { return []; }
}
function writeSaved(key: string, value: SavedComparison[], session = false) { try { (session ? sessionStorage : localStorage).setItem(key, JSON.stringify(value)); } catch { /* Experiments work even if browser storage is unavailable. */ } }

export default function Studio() {
  const [experimentIndex, setExperimentIndex] = useState(0);
  const experiment = experiments[experimentIndex];
  const [mode, setMode] = useState<Config['mode']>('simulator');
  const [variants, setVariants] = useState<Variant[]>(() => makeVariants(experiments[0], 'simulator'));
  const [prompt, setPrompt] = useState(experiments[0].prompt);
  const [context, setContext] = useState('');
  const [runs, setRuns] = useState<Record<string, Run>>({});
  const [predictions, setPredictions] = useState<Record<string, boolean | null>>({});
  const [comparisonId, setComparisonId] = useState('');
  const [runFingerprint, setRunFingerprint] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [connection, setConnection] = useState<Connection | null>(null);
  const [showConnection, setShowConnection] = useState(false);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [fact, setFact] = useState('I prefer concise answers with one concrete example.');
  const [prepRun, setPrepRun] = useState<Run | null>(null);
  const [prepSubmitting, setPrepSubmitting] = useState(false);
  const [deciding, setDeciding] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNotebook, setShowNotebook] = useState(false);
  const [notebook, setNotebook] = useState<SavedComparison[]>(() => readSaved('harness-studio-notebook'));
  const [reflection, setReflection] = useState('');
  const [explain, setExplain] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [showPredictions, setShowPredictions] = useState(false);
  const resultsRef = useRef<HTMLTableSectionElement>(null);
  const revealResults = useRef(false);
  const allRuns = Object.values(runs);
  const busy = submitting || restoring || prepSubmitting || isRunning(prepRun) || allRuns.some(isRunning);
  const finished = variants.every(v => !!runs[v.id] && !isRunning(runs[v.id])) && allRuns.length > 0;
  const usable = finished && allRuns.every(r => ['completed', 'stopped'].includes(r.status));
  const dirty = !!runFingerprint && runFingerprint !== fingerprint(prompt, context, variants);
  const differences = changedControls(variants);
  const activeKeys = [...Object.entries(runs).filter(([, r]) => isRunning(r)).map(([key, r]) => `${key}:${r.id}`), ...(isRunning(prepRun) ? [`prep:${prepRun!.id}`] : [])].join('|');
  const activeCount = allRuns.filter(isRunning).length;
  const lesson = lessons.find(l => l.id === experiment.lesson)!;

  useEffect(() => {
    if (!comparisonId || !revealResults.current) return;
    revealResults.current = false;
    resultsRef.current?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [comparisonId]);

  function fail(e: unknown) { setError(e instanceof Error ? e.message : 'The request could not complete.'); }
  async function refreshConnection() { try { setConnection(await request<Connection>('/status')); } catch (e) { fail(e); } }
  async function restoreComparison(saved: SavedComparison) {
    setRestoring(true); setError('');
    try {
      const restored = await Promise.all(saved.runIds.map(id => request<Run>(`/runs/${encodeURIComponent(id)}`)));
      const index = experiments.findIndex(e => e.id === saved.experimentId);
      const restoredVariants = restored.map((r, i) => ({ id: r.id, label: r.variantLabel || `Harness ${String.fromCharCode(65 + i)}`, config: r.config, prediction: saved.predictions[i] ?? null }));
      setExperimentIndex(index); setMode(restored[0].config.mode); setPrompt(restored[0].prompt); setContext(restored[0].context);
      setVariants(restoredVariants); setRuns(Object.fromEntries(restored.map(r => [r.id, r]))); setPredictions(Object.fromEntries(restoredVariants.map(v => [v.id, v.prediction])));
      setComparisonId(saved.id); setRunFingerprint(fingerprint(restored[0].prompt, restored[0].context, restoredVariants)); setReflection(saved.note || ''); setPrepRun(null); setShowNotebook(false);
      writeSaved('harness-studio-current', [saved], true);
    } catch { setError('This comparison could not be loaded. The server retains the latest 30 runs; older runs may have expired.'); writeSaved('harness-studio-current', [], true); }
    finally { setRestoring(false); }
  }
  useEffect(() => {
    void refreshConnection();
    const saved = readSaved('harness-studio-current', true)[0];
    if (saved) void restoreComparison(saved); else setRestoring(false);
  }, []);
  useEffect(() => { let ignore = false; request<Memory[]>(`/memories?mode=${mode}`).then(value => { if (!ignore) setMemories(value); }).catch(fail); return () => { ignore = true; }; }, [mode, prepRun?.status]);
  useEffect(() => { writeSaved('harness-studio-notebook', notebook); }, [notebook]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 4000); return () => clearTimeout(timeout); }, [notice]);
  useEffect(() => {
    if (!activeKeys) return;
    let disposed = false;
    let timeout: ReturnType<typeof setTimeout>;
    const pending = activeKeys.split('|').map(pair => { const split = pair.indexOf(':'); return { key: pair.slice(0, split), id: pair.slice(split + 1) }; });
    async function poll() {
      const results = await Promise.allSettled(pending.map(async item => ({ ...item, run: await request<Run>(`/runs/${item.id}`) })));
      if (disposed) return;
      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.key === 'prep') setPrepRun(result.value.run);
          else setRuns(previous => ({ ...previous, [result.value.key]: result.value.run }));
        } else fail(result.reason);
      }
      timeout = setTimeout(poll, 400);
    }
    timeout = setTimeout(poll, 180);
    return () => { disposed = true; clearTimeout(timeout); };
  }, [activeKeys]);

  function reset(index: number, selectedMode = mode) {
    if (busy) return;
    const next = experiments[index];
    setExperimentIndex(index); setVariants(makeVariants(next, selectedMode)); setPrompt(next.prompt); setContext(next.context || '');
    setRuns({}); setPredictions({}); setRunFingerprint(''); setComparisonId(''); setReflection(''); setError(''); setPrepRun(null); setExplain(false); setShowContext(!!next.context); setShowPredictions(false);
    writeSaved('harness-studio-current', [], true);
  }
  function updateVariant(id: string, key: keyof Config, value: Config[keyof Config]) { setVariants(previous => previous.map(v => v.id === id ? { ...v, config: { ...v.config, [key]: value } } : v)); }
  function addVariant() {
    if (busy || variants.length >= 4) return;
    setVariants(previous => [...previous, { id: crypto.randomUUID(), label: `Harness ${String.fromCharCode(65 + previous.length)}`, config: { ...previous.at(-1)!.config }, prediction: null }]);
  }
  function removeVariant(id: string) {
    setVariants(previous => previous.filter(v => v.id !== id).map((v, i) => ({ ...v, label: `Harness ${String.fromCharCode(65 + i)}` })));
    setRuns({}); setRunFingerprint(''); setComparisonId(''); writeSaved('harness-studio-current', [], true);
  }
  async function runAll() {
    if (busy || !prompt.trim()) return;
    revealResults.current = true; setSubmitting(true); setError(''); setRuns({}); setExplain(false); setReflection('');
    writeSaved('harness-studio-current', [], true);
    try {
      const comparison = await request<{ id: string; runs: Run[] }>('/comparisons', { prompt, context, variants: variants.map(v => ({ label: v.label, config: { ...v.config, mode } })) });
      setComparisonId(comparison.id); setRuns(Object.fromEntries(comparison.runs.map((r, i) => [variants[i].id, r]))); setPredictions(Object.fromEntries(variants.map(v => [v.id, v.prediction])));
      setRunFingerprint(fingerprint(prompt, context, variants));
      writeSaved('harness-studio-current', [{ id: comparison.id, experimentId: experiment.id, runIds: comparison.runs.map(r => r.id), predictions: variants.map(v => v.prediction), note: '', createdAt: new Date().toISOString() }], true);
    } catch (e) { revealResults.current = false; fail(e); }
    finally { setSubmitting(false); }
  }
  async function stopAll() {
    const pending = [...allRuns.filter(isRunning), ...(isRunning(prepRun) ? [prepRun!] : [])];
    const results = await Promise.allSettled(pending.map(r => request(`/runs/${r.id}/cancel`, {})));
    results.forEach(r => { if (r.status === 'rejected') fail(r.reason); });
  }
  async function decide(run: Run, approved: boolean) {
    if (!run.approval) return;
    setDeciding(previous => [...previous, run.id]);
    try { await request(`/runs/${run.id}/approval`, { id: run.approval.id, approved }); }
    catch (e) { fail(e); }
    finally { setDeciding(previous => previous.filter(id => id !== run.id)); }
  }
  async function teachFact() {
    if (busy || !fact.trim()) return;
    setPrepSubmitting(true); setError('');
    try { setPrepRun(await request<Run>('/runs', { prompt: `Remember that ${fact.trim()}`, context: '', config: { ...variants[0].config, mode, memory: true, approvals: true, maxSteps: 6, planning: false } })); }
    catch (e) { fail(e); } finally { setPrepSubmitting(false); }
  }
  function saveComparison() {
    if (!usable || dirty) return;
    const saved = { id: comparisonId, experimentId: experiment.id, runIds: variants.map(v => runs[v.id].id), predictions: variants.map(v => predictions[v.id] ?? null), note: reflection.trim(), createdAt: new Date().toISOString() };
    setNotebook(previous => [saved, ...previous.filter(entry => entry.id !== comparisonId)].slice(0, 20));
    writeSaved('harness-studio-current', [saved], true); setNotice('Comparison saved to your notebook.');
  }
  function exportComparison() {
    const blob = new Blob([JSON.stringify({ experiment: experiment.name, reflection, runs: variants.map(v => ({ label: v.label, prediction: predictions[v.id], run: runs[v.id] })) }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `harness-comparison-${comparisonId.slice(0, 8)}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const runControl = <div className="st-run-control">{busy && !restoring ? <button className="st-button st-primary" disabled={submitting || prepSubmitting} onClick={stopAll}><Square size={14} />Stop active runs</button> : <button className="st-button st-primary" disabled={busy || !prompt.trim() || (mode === 'live' && !connection?.configured) || (experiment.id === 'memory' && !memories.length)} onClick={runAll}>{restoring ? <Loader2 size={16} className="spinning" /> : <PlayIcon />} {restoring ? 'Restoring…' : 'Run comparison'}<ArrowRight size={16} /></button>}<small role="status">{activeCount ? `${activeCount} ${activeCount === 1 ? 'harness is' : 'harnesses are'} working` : mode === 'simulator' ? `Runs all ${variants.length} versions · no API credits` : `${variants.length} separate runs · uses API credits`}</small></div>;

  return <div className="studio">
    <a className="skip-link" href="#studio-main">Skip to experiment</a>
    <header className="st-topbar"><a className="st-brand" href="/studio"><span><Network size={22} /></span>Harness<span>Lab</span></a><nav aria-label="Learning experience"><a href="/studio" aria-current="page"><FlaskConical size={15} />Experiment studio</a><a href="/"><BookOpen size={15} />Field guide</a></nav><div className="st-top-actions"><label className="st-provider"><span className="st-provider-dot" /><span className="sr-only">Model provider</span><select aria-label="Model provider" disabled={busy} value={mode} onChange={e => { const next = e.target.value as Config['mode']; setMode(next); reset(experimentIndex, next); }}><option value="simulator">Simulator</option><option value="live">Live OpenAI</option></select></label><button className="st-icon-button" aria-label="Connection settings" aria-expanded={showConnection} onClick={() => { setShowConnection(!showConnection); void refreshConnection(); }}><Settings2 size={17} /></button><button className="st-notebook-button" aria-label={`Notebook ${notebook.length}`} aria-expanded={showNotebook} onClick={() => setShowNotebook(!showNotebook)}><NotebookPen size={17} /><span>Notebook</span><small>{notebook.length}</small></button></div></header>

    {showConnection && <section className="st-connection-panel" aria-label="Connection settings"><div><h2>{connection?.configured ? 'Your OpenAI key is configured.' : 'Explore freely. Connect when you’re ready.'}</h2><p>The simulator uses the real harness with scripted model choices. For open-ended scenarios, {connection?.hosted ? <>add <code>OPENAI_API_KEY</code> in the Azure app’s environment variables</> : <>save your key in <code>.env</code></>}, refresh the connection, and choose Live OpenAI.</p><p>Live mode uses <code>{connection?.model || 'gpt-5.6-sol'}</code> and sends each variant’s scenario, context, memories, and tool results to OpenAI. Every column is a separate API run.</p></div><button className="st-button st-secondary" onClick={() => { void refreshConnection(); setNotice('Connection configuration refreshed.'); }}><RotateCcw size={15} />Refresh connection</button><button className="st-icon-button" aria-label="Close connection settings" onClick={() => setShowConnection(false)}><X size={18} /></button></section>}

    {showNotebook && <section className="st-notebook" aria-label="Experiment notebook"><header><div><NotebookPen size={21} /><h2>Your experiment notebook</h2></div><button className="st-icon-button" aria-label="Close notebook" onClick={() => setShowNotebook(false)}><X size={18} /></button></header><p>Keep the comparisons that changed your understanding. Saved links refer to the server’s latest 30 runs; export a comparison to keep a permanent copy.</p>{notebook.length ? <ul>{notebook.map(entry => <li key={entry.id}><button disabled={busy} onClick={() => restoreComparison(entry)}><strong>{experiments.find(e => e.id === entry.experimentId)?.name}</strong><span>{entry.note || `${entry.runIds.length} harnesses compared`}</span><small>{new Date(entry.createdAt).toLocaleString()}</small></button><button className="st-icon-button" aria-label={`Remove notebook entry ${entry.id}`} onClick={() => setNotebook(previous => previous.filter(item => item.id !== entry.id))}><Trash2 size={16} /></button></li>)}</ul> : <div className="st-notebook-empty">Run a comparison, write down what surprised you, and save it here.</div>}</section>}

    <main id="studio-main" className="st-main">
      <div className="st-experiment-nav"><div className="st-experiment-picker"><span>Explore an experiment</span><select aria-label="Choose experiment" disabled={busy} value={experimentIndex} onChange={e => reset(Number(e.target.value))}>{experiments.map((item, index) => <option key={item.id} value={index}>{String(index + 1).padStart(2, '0')} · {item.name}</option>)}</select></div><div className="st-experiment-position"><button className="st-icon-button" disabled={busy || experimentIndex === 0} aria-label="Previous experiment" onClick={() => reset(experimentIndex - 1)}><ChevronLeft size={16} /></button><span>{experimentIndex + 1} <span>/ {experiments.length}</span></span><button className="st-icon-button" disabled={busy || experimentIndex === experiments.length - 1} aria-label="Next experiment" onClick={() => reset(experimentIndex + 1)}><ChevronRight size={16} /></button></div><p>A small change. A visible difference.</p></div>

      <section className="st-introduction"><div><div className="st-topics">{experiment.topics.map(topic => <span key={topic}>{topic}</span>)}</div><h1>{experiment.title}</h1><p>{experiment.description}</p></div><ol className="st-learning-loop" aria-label="Learning process"><li className={!finished ? 'current' : 'done'}><span>1</span>Run comparison</li><li className={finished ? 'current' : ''}><span>2</span>Read results</li><li><span>3</span>Flip a feature</li></ol></section>

      {experiment.id === 'memory' && <section className="st-memory-setup"><div className="st-memory-heading"><Database size={20} /><div><h2>First, give it something to remember.</h2><p>{memories.length ? `${memories.length} saved ${memories.length === 1 ? 'fact is' : 'facts are'} available. Add your own or run with the existing memory.` : 'Save a real preference, then compare two fresh agents with and without access to it.'}</p></div></div><div className="st-teach-row"><label className="sr-only" htmlFor="studio-memory-fact">Fact to remember</label><input id="studio-memory-fact" value={fact} maxLength={1000} disabled={busy} onChange={e => setFact(e.target.value)} /><button className="st-button st-secondary" disabled={busy || !fact.trim() || (mode === 'live' && !connection?.configured)} onClick={teachFact}>{prepSubmitting || isRunning(prepRun) ? <Loader2 className="spinning" size={15} /> : <Plus size={15} />}Teach a fact</button></div>{prepRun?.approval && <ApprovalActions run={prepRun} deciding={deciding.includes(prepRun.id)} onDecision={decide} />}{prepRun && !isRunning(prepRun) && <p className="st-prep-result">{prepRun.output}</p>}{memories.length > 0 && <details><summary>Inspect the saved facts <ChevronDown size={14} /></summary><ul>{memories.map(m => <li key={m.id}>{m.content}</li>)}</ul></details>}</section>}

      <p className="st-start-guidance"><strong>How to use this</strong> Each column is the same agent with a different harness configuration. Start with the supplied settings, run the comparison, then switch a feature on or off to see its impact.</p>
      <section className="st-scenario" aria-label="Shared scenario"><div className="st-scenario-title"><MessageSquare size={19} /><label htmlFor="studio-scenario">Task sent to every version</label><button disabled={busy} className="st-text-button" aria-expanded={showContext} onClick={() => setShowContext(!showContext)}>{context ? `${context.length} context characters` : 'Add context'}<ChevronDown size={13} /></button></div><p id="studio-scenario-hint" className="st-scenario-hint">The example is ready to use. You can also enter your own task.</p><div className="st-scenario-row"><textarea aria-describedby="studio-scenario-hint" id="studio-scenario" aria-label="Shared scenario" rows={2} maxLength={8000} value={prompt} disabled={busy} onChange={e => setPrompt(e.target.value)} /></div>{showContext && <div className="st-context-input"><label htmlFor="studio-context">Extra context shared by every variant</label><textarea id="studio-context" rows={3} maxLength={20000} disabled={busy} value={context} onChange={e => setContext(e.target.value)} placeholder="Paste a brief or facts for the model to use." /></div>}{mode === 'live' && !connection?.configured && <p className="st-connection-required">{connection?.hosted ? <>Configure your key in Azure</> : <>Add your key to <code>.env</code></>}, then <button onClick={() => { setShowConnection(true); void refreshConnection(); }}>refresh the connection</button> to run live.</p>}</section>

      <div className="st-comparison-question"><Lightbulb size={16} /><span>What to look for: <strong>{experiment.question}</strong></span><label><input type="checkbox" checked={showPredictions} onChange={e => setShowPredictions(e.target.checked)} />Make predictions <small>(optional)</small></label></div>
      {dirty && <div className="st-dirty-note"><RotateCcw size={14} />You changed the configuration. The results still show the previous run. Click Run comparison to test the new settings.</div>}
      <ConfigurationTable resultsRef={resultsRef} variants={variants} experiment={experiment} busy={busy} differences={differences} onChange={updateVariant} onRemove={removeVariant} onAdd={addVariant} runControl={runControl} hasRun={allRuns.length > 0} showResults={allRuns.length > 0 || showPredictions} renderResult={(variant, index) => <VariantColumn key={variant.id} variant={variant} index={index} experiment={experiment} run={runs[variant.id]} runPrediction={predictions[variant.id]} busy={busy} deciding={runs[variant.id] ? deciding.includes(runs[variant.id].id) : false} showPredictions={showPredictions} onPredict={value => setVariants(previous => previous.map(v => v.id === variant.id ? { ...v, prediction: value } : v))} onDecision={decide} />} />
      <p className="st-comparison-note"><ShieldCheck size={13} />Every version starts with the same saved memory. Turning memory off excludes it from that version. New memories written during a comparison stay within that version.</p>
      {error && <div className="st-error" role="alert"><CircleHelp size={18} /><p>{error}</p><button className="st-icon-button" aria-label="Dismiss error" onClick={() => setError('')}><X size={16} /></button></div>}

      <section className={`st-discovery ${finished ? 'revealed' : ''}`} aria-label="Discover what changed"><div className="st-discovery-symbol"><Lightbulb size={25} /></div><div className="st-discovery-content"><div className="st-discovery-heading"><h2>{finished ? 'What this comparison teaches' : 'About this experiment'}</h2><button className="st-text-button" aria-expanded={explain} onClick={() => setExplain(!explain)}>{explain ? 'Hide explanation' : finished ? 'Key concepts & technical detail' : 'Explain the concept'}<ChevronDown size={14} /></button></div><p>{finished ? experiment.insight : experiment.help}</p>{explain && <div className="st-explanation"><dl>{lesson.concepts.map(concept => <div key={concept.term}><dt>{concept.term}</dt><dd>{concept.text}</dd></div>)}</dl><details><summary>Under the hood <ChevronDown size={14} /></summary><p>{lesson.technical}</p><code>{lesson.source}</code></details></div>}{finished && <><div className="st-reflection"><label htmlFor="studio-reflection">What surprised you?</label><input id="studio-reflection" maxLength={500} value={reflection} onChange={e => setReflection(e.target.value)} placeholder="Optional: capture the idea you want to remember." /></div><div className="st-discovery-actions"><button className="st-button st-secondary" disabled={!usable || dirty} onClick={saveComparison}><Save size={15} />Save comparison</button><button className="st-text-button" onClick={exportComparison}><Download size={15} />Export evidence</button>{experimentIndex < experiments.length - 1 && <button className="st-next-experiment" disabled={busy} onClick={() => reset(experimentIndex + 1)}>Next experiment <ArrowRight size={17} /></button>}</div><p className="st-next-question"><Sparkles size={14} />{experiment.nextQuestion}</p></>}</div></section>
      <footer className="st-footer"><span>Learn the system by changing it.</span><a href="/">Open the original field guide <ArrowRight size={13} /></a></footer>
    </main>
    {notice && <div className="st-toast" role="status"><Check size={16} />{notice}</div>}
  </div>;
}

function PlayIcon() { return <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M3 1.8 12 7l-9 5.2z" fill="currentColor" /></svg>; }
