import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, CircleCheck, CirclePause, Database, FileText, Fingerprint, Loader2, RotateCcw, ShieldCheck, Sparkles, Wrench, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Run, TraceEvent } from '../../server/schema';
import { eventData, observed, type Experiment, type Variant } from './experiments';

export function isRunning(run?: Run | null) { return !!run && ['running', 'awaiting_approval'].includes(run.status); }
const statusLabels: Record<Run['status'], string> = { running: 'Running', awaiting_approval: 'Your decision', completed: 'Answered', stopped: 'Limit reached', cancelled: 'Cancelled', failed: 'Failed' };

export function ApprovalActions({ run, onDecision, deciding }: { run: Run; onDecision: (run: Run, approved: boolean) => void; deciding: boolean }) {
  if (!run.approval) return null;
  return <div className="st-approval" role="region" aria-label={`Approval for ${run.variantLabel || 'memory setup'}`}>
    <div><ShieldCheck size={18} /><strong>Pause. This decision is yours.</strong></div>
    <p>Review <code>{run.approval.tool}</code> before it executes.</p>
    <pre>{JSON.stringify(run.approval.arguments, null, 2)}</pre>
    <div className="st-approval-buttons"><button className="st-button st-secondary" disabled={deciding} onClick={() => onDecision(run, false)}>Deny</button><button className="st-button st-primary" disabled={deciding} onClick={() => onDecision(run, true)}><Check size={14} />Approve</button></div>
    <small>Expires after 2 minutes. Completed actions are not rolled back.</small>
  </div>;
}

export default function VariantColumn({ variant, index, experiment, run, runPrediction, busy, deciding, showPredictions, onPredict, onDecision }: {
  variant: Variant; index: number; experiment: Experiment; run?: Run; runPrediction?: boolean | null;
  busy: boolean; deciding: boolean; showPredictions: boolean;
  onPredict: (prediction: boolean | null) => void;
  onDecision: (run: Run, approved: boolean) => void;
}) {
  const [inspector, setInspector] = useState<'context' | 'model' | 'tool' | number | null>(null);
  const evidence = run ? observed(experiment.id, run) : null;
  const running = isRunning(run);
  const latest = run?.events.at(-1);
  const event: TraceEvent | undefined = typeof inspector === 'number' ? run?.events.find(e => e.id === inspector) : run?.events.find(e => e.type === inspector);
  const context = eventData(run?.events.find(e => e.type === 'context'));
  const memoryCount = Array.isArray(context.memories) ? context.memories.length : 0;
  const selectedConfig = run?.config || variant.config;
  const meaningful = run?.events || [];
  const settingValue = run?.config[experiment.variable];
  const settingLabel = typeof settingValue === 'boolean' ? (settingValue ? 'On' : 'Off') : String(settingValue ?? '');
  const inspectedStage = typeof inspector === 'string' ? inspector : event?.type;
  const meterValue = run ? Math.min(100, run.steps / run.config.maxSteps * 100) : 0;

  return <article className={`st-variant st-variant-${index}`} aria-label={variant.label}>
    <header className="st-result-version"><h3>Version {String.fromCharCode(65 + index)}</h3>{run && <p className="st-result-setting">{experiment.variableLabel}: <strong title={settingLabel}>{settingLabel.length > 85 ? `${settingLabel.slice(0, 85)}…` : settingLabel}</strong></p>}</header>

    {showPredictions && <div className="st-prediction">
      {!run ? <><span>Your prediction <small>optional</small></span><div role="group" aria-label={`${variant.label}: ${experiment.question}`}><button disabled={busy} aria-pressed={variant.prediction === true} onClick={() => onPredict(variant.prediction === true ? null : true)}>Yes</button><button disabled={busy} aria-pressed={variant.prediction === false} onClick={() => onPredict(variant.prediction === false ? null : false)}>No</button></div></> : <><span>{runPrediction === null || runPrediction === undefined ? 'You observed' : `You predicted ${runPrediction ? 'yes' : 'no'}`}</span>{evidence !== null && <strong className={runPrediction === evidence ? 'st-match' : ''}>{runPrediction === null || runPrediction === undefined ? (evidence ? 'Yes' : 'No') : runPrediction === evidence ? <><Check size={13} />Matched</> : 'A different outcome'}</strong>}{evidence === null && <small>{running ? 'Observe what happens…' : 'No observation scored'}</small>}</>}</div>}

    <div className="st-unit-result">
      <div className="st-output-header"><h4>Observed result</h4>{run ? <span className={`st-status ${run.status}`}>{running && <Loader2 size={11} className="spinning" />}{statusLabels[run.status]}</span> : <span className="st-status">Waiting</span>}</div>
      {run?.approval && <ApprovalActions run={run} onDecision={onDecision} deciding={deciding} />}
      {evidence !== null && <div className={`st-observation ${evidence ? 'positive' : ''}`}><Fingerprint size={15} /><strong>{evidence ? experiment.positive : experiment.negative}</strong></div>}
      {run?.output ? <div className="st-response"><ReactMarkdown>{run.output}</ReactMarkdown></div> : <div className="st-awaiting"><span className="st-empty-line" /><span className="st-empty-line short" /><p>{running ? run?.status === 'awaiting_approval' ? 'The agent is waiting for you.' : 'Waiting for the model to finish…' : 'Its answer will appear here after you run the comparison.'}</p></div>}
      {run && <div className="st-run-metrics"><span>{run.steps} model {run.steps === 1 ? 'turn' : 'turns'}</span><span>{run.toolCalls} tool {run.toolCalls === 1 ? 'call' : 'calls'}</span><span>{(run.durationMs / 1000).toFixed(1)}s</span>{run.config.mode === 'live' && <span>{run.usage.input + run.usage.output} tokens</span>}</div>}
    </div>

    {run && <details className="st-run-details"><summary>Inspect execution <small>optional</small><ChevronDown size={14} /></summary><p className="st-inspection-help">These controls only show what happened. They do not change or run the agent.</p><div className="st-machine st-detail-machine">      <div className="st-circuit" aria-label={`${variant.label} execution diagram`}>
        <div className="st-circuit-row">
          <button className={`st-circuit-end ${inspectedStage === 'context' ? 'inspecting' : ''}`} onClick={() => setInspector(inspector === 'context' ? null : 'context')} aria-label={`Inspect ${variant.label} context`}><span><FileText size={18} /></span><strong>Context</strong><small>{run ? `${memoryCount} saved ${memoryCount === 1 ? 'fact' : 'facts'}` : 'Your request'}</small></button>
          <ArrowRight size={17} className="st-wire" />
          <button className={`st-model ${running && latest?.type === 'model' ? 'thinking' : ''} ${inspectedStage === 'model' ? 'inspecting' : ''}`} onClick={() => setInspector(inspector === 'model' ? null : 'model')} aria-label={`Inspect ${variant.label} model turns`}>
            <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="st-meter-track" cx="50" cy="50" r="45" /><circle className="st-meter-value" cx="50" cy="50" r="45" pathLength="100" strokeDasharray={`${meterValue} 100`} /></svg>
            <Sparkles size={20} /><strong>Model</strong><small>{run?.steps || 0} / {selectedConfig.maxSteps} turns</small>
          </button>
          <ArrowRight size={17} className="st-wire" />
          <div className={`st-circuit-end st-outcome-node ${run?.status === 'completed' ? 'has-answer' : ''}`}><span>{run?.status === 'stopped' ? <CirclePause size={19} /> : <CircleCheck size={19} />}</span><strong>{run?.status === 'stopped' ? 'Stopped' : 'Answer'}</strong><small>{run ? statusLabels[run.status] : 'Not run yet'}</small></div>
        </div>
        <div className="st-tool-loop"><div className="st-return-wire"><ArrowDown size={13} /><span>request</span></div><button className={`st-tool-module ${!selectedConfig.tools && !selectedConfig.retrieval && !selectedConfig.memory && !selectedConfig.planning ? 'unplugged' : ''} ${inspectedStage === 'tool' ? 'inspecting' : ''}`} onClick={() => setInspector(inspector === 'tool' ? null : 'tool')} aria-label={`Inspect ${variant.label} tools`}><Wrench size={15} /><strong>Tools</strong><span>{run ? `${run.toolCalls} ${run.toolCalls === 1 ? 'call' : 'calls'}` : 'Ready'}</span></button><div className="st-return-wire"><span>result</span><ArrowUpRight size={13} /></div></div>
      </div>
      <div className="st-capabilities"><span className={selectedConfig.memory ? 'enabled' : ''}><Database size={12} />Memory {selectedConfig.memory ? 'on' : 'off'}</span><span className={selectedConfig.approvals ? 'enabled' : ''}><ShieldCheck size={12} />{selectedConfig.approvals ? 'Approval gate' : 'Auto writes'}</span></div>
</div>
    <div className="st-trace-strip"><div><span>The path it took</span><small>{run.events.length} events</small></div><div className="st-event-tape">{meaningful.map(e => <button key={e.id} className={`${e.type} ${inspector === e.id ? 'selected' : ''}`} title={e.title} aria-label={`Inspect ${variant.label} event ${e.id}: ${e.title}`} aria-pressed={inspector === e.id} onClick={() => setInspector(inspector === e.id ? null : e.id)}>{e.type === 'warning' || e.type === 'error' ? <AlertTriangle size={12} /> : e.type === 'model' ? <Sparkles size={12} /> : e.type === 'tool' ? <Wrench size={12} /> : e.type === 'retry' ? <RotateCcw size={12} /> : e.type === 'context' ? <FileText size={12} /> : e.type === 'approval' ? <ShieldCheck size={12} /> : <Check size={12} />}<span>{e.id}</span></button>)}</div></div>

    {inspector !== null && <div className="st-inline-inspector"><header><strong>{event?.title || (inspector === 'context' ? 'What enters the model' : inspector === 'model' ? 'The decision maker' : 'What the harness can execute')}</strong><button aria-label={`Close ${variant.label} inspector`} onClick={() => setInspector(null)}><X size={14} /></button></header><p>{event?.detail || (inspector === 'context' ? 'The harness selects the request, extra context, and enabled memories before asking the model.' : inspector === 'model' ? 'Each request uses one model turn. A tool result needs another turn before the model can use it. This is execution data, not private reasoning.' : 'Only enabled tools can execute. The harness validates names and arguments, then checks approval before a write.')}</p>{event?.data !== undefined && <pre>{JSON.stringify(event.data, null, 2)}</pre>}{!event && <small>Run the experiment to inspect the actual event data.</small>}</div>}
    <details className="st-full-trace"><summary>Full trace & configuration <ChevronDown size={13} /></summary><pre>{JSON.stringify({ config: run.config, memoryScope: run.memoryScope, events: run.events }, null, 2)}</pre></details></details>}
  </article>;
}
