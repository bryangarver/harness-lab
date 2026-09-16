import type { Config, Run, TraceEvent } from '../../server/schema';
import { defaults } from '../lessons';

export type Experiment = {
  id: string; name: string; title: string; description: string; topics: string[];
  prompt: string; context?: string; variable: keyof Config; variableLabel: string;
  presets: Partial<Config>[]; question: string; positive: string; negative: string;
  help: string; insight: string; nextQuestion: string; lesson: string;
};
export const experiments: Experiment[] = [
  {
    id: 'loop', name: 'Close the loop', title: 'Where does the loop break?',
    description: 'Give the agents the same calculation. Change only how many turns their harness allows. Will they all reach an answer?',
    topics: ['The agent loop', 'Budgets'], prompt: 'Calculate 24 * 7 and explain the result.',
    variable: 'maxSteps', variableLabel: 'Model-turn budget', presets: [{ maxSteps: 1 }, { maxSteps: 2 }, { maxSteps: 4 }],
    question: 'Will it deliver a final answer?', positive: 'Final answer delivered', negative: 'Stopped before a final answer',
    help: 'A turn is one model request. Tool results need another turn to reach the model.',
    insight: 'A successful tool call and a finished agent task are different events. The harness needs to feed the tool result back into another model turn before the model can answer.',
    nextQuestion: 'What happens if you also ask the agent to make a plan first?', lesson: 'loop',
  },
  {
    id: 'tools', name: 'Give it a tool', title: 'An answer is not evidence of a tool.',
    description: 'Keep the task fixed. Give one harness a calculator and leave the other without it. Compare the path, as well as the answer.',
    topics: ['Tool access', 'Validation'], prompt: 'Calculate (180 * 3) + (45 * 2).',
    variable: 'tools', variableLabel: 'General tools', presets: [{ tools: false }, { tools: true }],
    question: 'Will it request the calculator?', positive: 'Calculator requested', negative: 'No calculator request',
    help: 'General tools enables the calculator and local note tool. Other tools have their own controls.',
    insight: 'Only tools the harness exposes and validates can actually execute. A live model may still answer arithmetic unaided; the execution trace tells you whether it actually used the calculator.',
    nextQuestion: 'Can two harnesses return the same answer by different paths?', lesson: 'tools',
  },
  {
    id: 'memory', name: 'Make it remember', title: 'Same model. Different memories.',
    description: 'Teach the agent a fact, then ask two fresh agents what they remember. Let only one harness supply the saved memory.',
    topics: ['Persistent memory', 'Context'], prompt: 'What do you remember about my preferences?',
    variable: 'memory', variableLabel: 'Memory access', presets: [{ memory: false }, { memory: true }],
    question: 'Will a saved fact reach the model?', positive: 'Saved memory supplied', negative: 'No saved memory supplied',
    help: 'Both variants start from the same saved memory snapshot. This switch controls whether those facts are included.',
    insight: 'Remembering comes from storage and recall around the model. Turning memory off does not erase a fact; it keeps the fact out of that run’s context. Comparison writes are isolated, while Teach a fact writes durable memory.',
    nextQuestion: 'Try your own preference. Can the agent recall it in a completely new comparison?', lesson: 'memory',
  },
  {
    id: 'permissions', name: 'Stay in control', title: 'Who gets the final say?',
    description: 'Ask both agents to create a local note. Give one harness an approval gate. Watch exactly where execution pauses.',
    topics: ['Permissions', 'Human decisions'], prompt: 'Create a note: Review the prototype on Friday.',
    variable: 'approvals', variableLabel: 'Require write approval', presets: [{ approvals: false }, { approvals: true }],
    question: 'Will it ask before the write?', positive: 'Approval requested', negative: 'No approval requested',
    help: 'Notes are local run artifacts. This experiment does not send messages or write arbitrary files.',
    insight: 'A prompt can suggest caution, but the harness enforces the pause. The approval gate runs after the model proposes an action and before the tool executes it. A denial is returned to the model as an observation.',
    nextQuestion: 'Deny the action. Does the agent still claim that it created the note?', lesson: 'permissions',
  },
  {
    id: 'context', name: 'Reveal a missing fact', title: 'Can it know what it never saw?',
    description: 'The answer is at the end of the brief. Give each harness a different context allowance and inspect what actually reaches the model.',
    topics: ['Context selection', 'Truncation'], prompt: 'What codeword appears in the extra context? Use only the supplied context.',
    context: 'Project brief: We are designing an accessible learning experience for a mixed audience. Keep the explanation practical and show every execution step. The launch codeword is ORBIT.',
    variable: 'contextChars', variableLabel: 'Extra-context characters', presets: [{ contextChars: 100 }, { contextChars: 200 }, { contextChars: 1000 }],
    question: 'Will the codeword reach the model?', positive: 'ORBIT was supplied in context', negative: 'ORBIT was absent from context',
    help: 'This teaching limit counts characters, not tokens, and trims only the extra context field.',
    insight: 'Selecting context changes the information available to the agent before it begins. A dropped fact is not a reasoning failure. Open the Context event to distinguish missing input from an incorrect answer.',
    nextQuestion: 'Move the codeword to the beginning of the brief. What changes?', lesson: 'context',
  },
  {
    id: 'retrieval', name: 'Find the evidence', title: 'A plausible answer needs a source.',
    description: 'Ask about an internal travel policy. Change whether the harness can retrieve documents, then check the evidence behind the answer.',
    topics: ['Retrieval', 'Grounding'], prompt: 'What is our hotel budget in the travel policy? Cite the source.',
    variable: 'retrieval', variableLabel: 'Knowledge retrieval', presets: [{ retrieval: false }, { retrieval: true }],
    question: 'Will it retrieve a document?', positive: 'Documents retrieved', negative: 'No documents retrieved',
    help: 'Search uses the bundled travel, launch, and support policies. It does not search the internet.',
    insight: 'Retrieval brings external evidence into the loop as a tool result. The travel policy specifies $180 per night. Without that document, a plausible number is a guess. This lab uses keyword search so the mechanism stays visible.',
    nextQuestion: 'Ask about refunds instead. Which source does the agent use?', lesson: 'retrieval',
  },
  {
    id: 'recovery', name: 'Recover from failure', title: 'Break the tool. Watch the harness.',
    description: 'Make the first calculator attempt fail in every variant. Let only one harness retry the temporary failure.',
    topics: ['Recovery', 'Bounded retries'], prompt: 'Calculate 144 / 12.',
    variable: 'retry', variableLabel: 'Safe retries', presets: [{ failOnce: true, retry: false }, { failOnce: true, retry: true }],
    question: 'Will the harness retry the tool?', positive: 'Harness retried the calculator', negative: 'No harness retry',
    help: 'The injected fault resets for every variant. Only this known read-only failure is retried, once.',
    insight: 'The harness can recover from a transient tool failure without asking the model to invent a workaround. Writes are not automatically retried. A live model can also request another call independently; the trace distinguishes that from a harness retry.',
    nextQuestion: 'How is a harness retry different from a new tool request by the model?', lesson: 'recovery',
  },
  {
    id: 'planning', name: 'Give it a plan', title: 'Planning has a cost, too.',
    description: 'Use the same small turn budget. Ask one agent to record a plan before it calculates. Does the extra structure help it finish?',
    topics: ['Planning', 'Execution cost'], prompt: 'Calculate (12 * 8) + 24 and explain the result.',
    variable: 'planning', variableLabel: 'Plan before acting', presets: [{ planning: false, maxSteps: 2 }, { planning: true, maxSteps: 2 }],
    question: 'Will it record a visible plan?', positive: 'Plan recorded', negative: 'No plan recorded',
    help: 'Planning adds a tool and a model instruction. It consumes a turn, and live adherence can vary.',
    insight: 'A recorded plan is an artifact, not completed work. Planning can improve coordination on harder tasks while using budget on simple ones. Inspect both the plan event and whether the run reached a final answer.',
    nextQuestion: 'Add a third turn to the planning harness. Can it now finish?', lesson: 'planning',
  },
  {
    id: 'instructions', name: 'Shape the answer', title: 'One task. Two ways to answer.',
    description: 'Keep the tools and task identical. Change only the operator instructions and observe the presentation of the result.',
    topics: ['Instructions', 'Guidance'], prompt: 'Calculate 24 * 7.',
    variable: 'instructions', variableLabel: 'Operator instructions', presets: [{ instructions: 'Use plain sentences.' }, { instructions: 'Use bullet points.' }],
    question: 'Will the answer use bullet points?', positive: 'Bullet points appeared', negative: 'No bullet points appeared',
    help: 'The simulator recognizes bullets and uppercase. Live OpenAI can follow more expressive instructions.',
    insight: 'Instructions guide a model’s behavior, while code enforces tool access and budgets. A style request can change the output without changing the task or the calculation. Live adherence should be observed rather than assumed.',
    nextQuestion: 'Try “Use uppercase.” Or use live mode to teach a different audience.', lesson: 'instructions',
  },
  {
    id: 'evaluation', name: 'Question the score', title: 'The answer stayed. The grade changed.',
    description: 'Ask both agents the same arithmetic question. Give their answers different text checks. What does a passing grade actually prove?',
    topics: ['Evaluation', 'Observability'], prompt: 'Calculate 24 * 7.',
    variable: 'expected', variableLabel: 'Answer must contain', presets: [{ expected: '169' }, { expected: '168' }],
    question: 'Will the answer check pass?', positive: 'Answer check passed', negative: 'Answer check failed',
    help: 'This is a case-insensitive substring check on a completed answer, not a general quality score.',
    insight: 'An evaluation is only as useful as its assertion. Changing the expected string changes the grade even when the answer is unchanged. A passing text check does not prove factuality, safety, or quality outside that narrow condition.',
    nextQuestion: 'Set the expected text to a word in the explanation. What have you really tested?', lesson: 'evaluation',
  },
];

export type Variant = { id: string; label: string; config: Config; prediction: boolean | null };
export function makeVariants(experiment: Experiment, mode: Config['mode']): Variant[] {
  return experiment.presets.map((preset, i) => ({ id: crypto.randomUUID(), label: `Harness ${String.fromCharCode(65 + i)}`, config: { ...defaults, ...preset, mode }, prediction: null }));
}
export function eventData(event?: TraceEvent): Record<string, unknown> {
  return event?.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data as Record<string, unknown> : {};
}
export function observed(experimentId: string, run: Run): boolean | null {
  if (!['completed', 'stopped'].includes(run.status)) return null;
  const context = eventData(run.events.find(e => e.type === 'context'));
  switch (experimentId) {
    case 'loop': return run.status === 'completed';
    case 'tools': return run.events.some(e => e.type === 'tool' && e.title === 'Requested calculate');
    case 'memory': return Array.isArray(context.memories) && context.memories.length > 0;
    case 'permissions': return run.events.some(e => e.title === 'Waiting for your approval');
    case 'context': return String(context.includedContext || '').includes('ORBIT');
    case 'retrieval': return run.events.some(e => e.type === 'result' && Array.isArray(eventData(e).documents) && (eventData(e).documents as unknown[]).length > 0);
    case 'recovery': return run.events.some(e => e.type === 'retry');
    case 'planning': return run.events.some(e => e.type === 'result' && e.title === 'make_plan returned a result');
    case 'instructions': return /(^|\n)\s*[-*]\s/.test(run.output);
    case 'evaluation': return run.evaluation?.passed ?? null;
    default: return null;
  }
}
export function changedControls(variants: Variant[]): string[] {
  if (!variants.length) return [];
  return (Object.keys(defaults) as (keyof Config)[]).filter(key => key !== 'mode' && variants.some(v => v.config[key] !== variants[0].config[key]));
}
export const controlNames: Partial<Record<keyof Config, string>> = {
  tools: 'tools', memory: 'memory', retrieval: 'retrieval', planning: 'planning', approvals: 'approval', retry: 'retries', failOnce: 'fault injection', maxSteps: 'turn budget', contextChars: 'context limit', instructions: 'instructions', expected: 'answer check', maxOutputTokens: 'output limit',
};
