import { ArrowRight, Check, Layers3, Zap } from 'lucide-react';
import type { Run } from '../server/schema';

const stages = [
  { name: 'Context', description: 'Assemble the inputs', lesson: 3 },
  { name: 'Model', description: 'Choose the next move', lesson: 1 },
  { name: 'Permission', description: 'Check the action', lesson: 7 },
  { name: 'Tool', description: 'Execute the request', lesson: 2 },
  { name: 'Feedback', description: 'Return the result', lesson: 0 },
  { name: 'Answer', description: 'Finish or stop', lesson: 8 },
];

// Some lessons span the loop rather than belonging to a single stage.
const lessonFocus: Record<string, number[]> = {
  loop: [0, 1, 2, 3, 4, 5],
  instructions: [1],
  tools: [3],
  context: [0],
  memory: [0],
  retrieval: [3, 4],
  planning: [1],
  permissions: [2],
  limits: [5],
  recovery: [3, 4],
  evaluation: [5],
  observability: [0, 1, 2, 3, 4, 5],
};

const eventStages: Record<string, number> = {
  context: 0, model: 1, tool: 2, approval: 2, retry: 3, result: 4, answer: 5, limit: 5,
};

export default function HarnessMap({ lessonId, run, starting, onChooseLesson }: {
  lessonId: string;
  run: Run | null;
  starting: boolean;
  onChooseLesson: (index: number) => void;
}) {
  const running = !!run && ['running', 'awaiting_approval'].includes(run.status);
  const execution = starting || !!run;
  let selected = lessonFocus[lessonId] || [];
  let label = 'Lesson focus';

  if (execution) {
    const lastStageEvent = run?.events.findLast(event => eventStages[event.type] !== undefined);
    let stage = lastStageEvent ? eventStages[lastStageEvent.type] : 0;
    if (run?.status === 'awaiting_approval') stage = 2;
    if (run?.status === 'completed' || run?.status === 'stopped') stage = 5;
    selected = [stage];
    label = run ? {
      running: 'Run in progress',
      awaiting_approval: 'Awaiting approval',
      completed: 'Run complete',
      stopped: 'Run stopped',
      cancelled: 'Run cancelled',
      failed: 'Run failed',
    }[run.status] : 'Starting run';
  }

  const focus = selected.length === stages.length ? 'Entire loop' : selected.map(index => stages[index].name).join(' + ');

  return <section className={`loop-map ${execution ? 'map-execution' : 'map-lesson'}`} aria-label="The harness execution loop">
    <div className="map-caption">
      <Layers3 size={15} /><span>The harness, at a glance</span>
      <span className="map-focus" id="map-focus" aria-live="polite" aria-atomic="true">
        <span className={`map-indicator ${running ? 'is-running' : ''}`} aria-hidden="true" />
        <span>{label}<span className="map-focus-separator" aria-hidden="true"> · </span><strong>{focus}</strong></span>
      </span>
    </div>
    <div className="pipeline">
      {stages.map((stage, index) => {
        const highlighted = selected.includes(index);
        return <div className="pipeline-item" key={stage.name}>
          <button
            disabled={starting || running}
            onClick={() => onChooseLesson(stage.lesson)}
            className={`pipeline-node ${highlighted ? 'stage-highlighted' : ''}`}
            aria-current={execution && highlighted ? 'step' : undefined}
            aria-describedby={highlighted ? 'map-focus' : undefined}
          >
            <span className="node-dot" aria-hidden="true">{index === 1 ? <Zap size={14} /> : index === 5 ? <Check size={14} /> : index + 1}</span>
            <span><strong>{stage.name}</strong><small>{stage.description}</small></span>
          </button>
          {index < stages.length - 1 && <ArrowRight className="pipe-arrow" size={16} />}
        </div>;
      })}
    </div>
    <div className="loop-return"><span />Tool results return to the model until it answers or a limit is reached.<span /></div>
  </section>;
}
