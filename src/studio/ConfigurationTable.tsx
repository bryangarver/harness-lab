import { useId, useState, type CSSProperties, type ReactNode, type Ref } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import type { Config } from '../../server/schema';
import { type Experiment, type Variant } from './experiments';

const features = [
  { key: 'tools', name: 'General tools', description: 'Calculator and local notes' },
  { key: 'memory', name: 'Persistent memory', description: 'Supply saved facts and allow remembering' },
  { key: 'retrieval', name: 'Knowledge retrieval', description: 'Search the bundled policy documents' },
  { key: 'planning', name: 'Planning', description: 'Ask the model to record a plan first' },
  { key: 'approvals', name: 'Human approval', description: 'Pause before a note or memory is saved' },
  { key: 'retry', name: 'Tool recovery', description: 'Retry the temporary calculator failure once' },
  { key: 'failOnce', name: 'Inject a test failure', description: 'Make the first calculator attempt fail' },
] as const;
const settings = [
  { key: 'maxSteps', name: 'Model-turn budget', description: 'Maximum times the harness can ask the model', min: 1, max: 10 },
  { key: 'contextChars', name: 'Extra-context limit', description: 'Characters of your brief supplied to the model', min: 100, max: 10000 },
  { key: 'maxOutputTokens', name: 'Output limit', description: 'Maximum output tokens per model turn', min: 256, max: 4096 },
  { key: 'instructions', name: 'Operator instructions', description: 'Guidance on how the model should respond' },
  { key: 'expected', name: 'Answer check', description: 'Text a completed answer should contain' },
] as const;

export default function ConfigurationTable({ variants, experiment, busy, differences, onChange, onRemove, onAdd, runControl, showResults, hasRun, renderResult, resultsRef }: {
  variants: Variant[]; experiment: Experiment; busy: boolean; differences: string[];
  onChange: (id: string, key: keyof Config, value: Config[keyof Config]) => void;
  onRemove: (id: string) => void; onAdd: () => void;
  runControl: ReactNode; resultsRef: Ref<HTMLTableSectionElement>; showResults: boolean; hasRun: boolean; renderResult: (variant: Variant, index: number) => ReactNode;
}) {
  const [showAdditional, setShowAdditional] = useState(false);
  const additionalId = useId();
  const isDifferent = (key: keyof Config) => differences.includes(key);
  const additionalSettings = settings.filter(setting => setting.key !== experiment.variable && setting.key !== 'maxSteps');
  const additionalDifferences = additionalSettings.filter(setting => isDifferent(setting.key)).length;

  function renderSettingRow(setting: typeof settings[number]) {
    return <tr key={setting.key} className={isDifferent(setting.key) ? 'st-config-different' : ''}>
      <th scope="row"><strong>{setting.name}</strong><small>{setting.description}</small>{experiment.variable === setting.key && <span className="st-focus-label">This experiment</span>}</th>
      {variants.map((v, i) => <td key={v.id}>
        {'min' in setting
          ? <input className="st-config-number" type="number" aria-label={`${setting.name}, version ${String.fromCharCode(65 + i)}`} min={setting.min} max={setting.max} value={v.config[setting.key]} disabled={busy} onChange={e => onChange(v.id, setting.key, Math.max(setting.min, Math.min(setting.max, Number(e.target.value) || setting.min)))} />
          : <textarea rows={setting.key === 'instructions' ? 4 : 2} aria-label={`${setting.name}, version ${String.fromCharCode(65 + i)}`} maxLength={setting.key === 'expected' ? 300 : 5000} placeholder={setting.key === 'expected' ? 'Optional text check' : 'How should the agent respond?'} value={String(v.config[setting.key])} disabled={busy} onChange={e => onChange(v.id, setting.key, e.target.value)} />}
      </td>)}
    </tr>;
  }
  return <section data-versions={variants.length} className="st-config-section" aria-label="Configure and compare harness features">
    <div className="st-config-heading"><div><h2>Choose what each version includes</h2><p>Each column runs the same task. Click a switch to include or exclude a feature.</p></div><button className="st-button st-secondary" disabled={busy || variants.length >= 4} onClick={onAdd}><Plus size={15} />Add version <span>{variants.length}/4</span></button></div>
    <div className="st-config-legend"><span><i />Shaded rows have different settings</span><span>{differences.length === 1 ? 'One setting differs. Everything else is the same.' : differences.length ? `${differences.length} settings differ. Change one at a time to isolate its effect.` : 'All settings match. Switch a feature on in one version and off in another.'}</span></div>
    <p className="st-config-scroll-note">Scroll the table sideways to see every version.</p>
    <div className="st-config-scroll" tabIndex={0} aria-label="Feature comparison table, scroll horizontally for more versions">
      <table className="st-config-table" style={{ '--version-count': variants.length } as CSSProperties}><caption className="sr-only">Harness configuration and observed results. On includes a feature. Off excludes it. Every version runs together.</caption>
        <thead><tr><th scope="col">Feature <small>On = included<br />Off = excluded</small></th>{variants.map((v, i) => <th scope="col" key={v.id}><div className="st-version-title"><span>Version {String.fromCharCode(65 + i)}</span>{variants.length > 2 && <button className="st-icon-button" disabled={busy} aria-label={`Remove version ${String.fromCharCode(65 + i)}`} onClick={() => onRemove(v.id)}><X size={14} /></button>}</div></th>)}</tr></thead>
        <tbody>{settings.filter(setting => setting.key === experiment.variable).map(renderSettingRow)}</tbody>
        <tbody>{[...features].sort((a, b) => Number(b.key === experiment.variable) - Number(a.key === experiment.variable)).map(feature => <tr key={feature.key} className={isDifferent(feature.key) ? 'st-config-different' : ''}><th scope="row"><strong>{feature.name}</strong><small>{feature.description}</small>{experiment.variable === feature.key && <span className="st-focus-label">This experiment</span>}</th>{variants.map((v, i) => <td key={v.id}><button className={`st-feature-switch ${v.config[feature.key] ? 'is-on' : ''}`} type="button" role="switch" aria-label={`${feature.name}, version ${String.fromCharCode(65 + i)}`} aria-checked={v.config[feature.key]} disabled={busy} onClick={() => onChange(v.id, feature.key, !v.config[feature.key])}><i aria-hidden="true" /><span>{v.config[feature.key] ? 'On' : 'Off'}</span></button></td>)}</tr>)}</tbody>
        <tbody>{settings.filter(setting => setting.key !== experiment.variable && setting.key === 'maxSteps').map(renderSettingRow)}</tbody>
        <tbody><tr><td colSpan={variants.length + 1} className="st-config-disclosure-cell">
          <button className="st-config-disclosure" type="button" aria-expanded={showAdditional} aria-controls={additionalId} onClick={() => setShowAdditional(value => !value)}>
            <ChevronDown size={17} aria-hidden="true" />
            <span><strong>Additional settings</strong><small>{showAdditional ? 'Compare and edit every version below' : `Expand ${additionalSettings.length} more settings for every version`}</small></span>
            <span className={`st-config-disclosure-status ${additionalDifferences ? 'has-differences' : ''}`}>{additionalDifferences ? `${additionalDifferences} ${additionalDifferences === 1 ? 'setting differs' : 'settings differ'}` : 'All match'}</span>
          </button>
        </td></tr></tbody>
        <tbody id={additionalId} hidden={!showAdditional} className="st-config-additional">{additionalSettings.map(renderSettingRow)}</tbody>
        {showResults && <tbody ref={resultsRef} className="st-config-results"><tr><th scope="row"><strong>{hasRun ? 'Observed behavior' : 'Optional prediction'}</strong><small>{hasRun ? 'Compare the answers and actions produced by the settings above.' : experiment.question}</small></th>{variants.map((v, i) => <td key={v.id}>{renderResult(v, i)}</td>)}</tr></tbody>}
      </table>
    </div>
    <div className="st-config-actions"><div><strong>{hasRun ? 'Try another configuration whenever you’re ready.' : 'The example is ready. You can run it exactly as shown.'}</strong><p>{hasRun ? 'Flip a switch above, then run all versions again to see its impact.' : `One click runs all ${variants.length} versions. You do not need to click a column or change a setting first.`}</p></div>{runControl}</div>
  </section>;
}
