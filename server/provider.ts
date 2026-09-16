import OpenAI from 'openai';
import { environment, isHosted } from './environment.js';
import type { ResponseInput, ResponseOutputItem } from 'openai/resources/responses/responses.js';
import type { Config, Memory } from './schema.js';
import { toolDefinitions } from './tools.js';

export type ModelInput = { prompt: string; instructions: string; input: ResponseInput; config: Config; context: string; memories: Memory[]; signal: AbortSignal; memoryScope?: 'persistent' | 'comparison' };
export type ModelOutput = { items: ResponseOutputItem[]; text: string; inputTokens: number; outputTokens: number; incomplete?: boolean };
export type Provider = (request: ModelInput) => Promise<ModelOutput>;
export function credentials() {
  const env = environment();
  return { key: env.OPENAI_API_KEY || '', model: env.OPENAI_MODEL || 'gpt-5.6-sol' };
}
export function createLiveProvider(options: { getCredentials?: typeof credentials; fetch?: typeof fetch } = {}): Provider {
 return async ({ input, instructions, config, signal, memoryScope }) => {
  const { key, model } = (options.getCredentials || credentials)();
  if (!key) throw new Error(isHosted() ? 'Configure OPENAI_API_KEY in the Azure app environment variables, then refresh the connection.' : 'Add OPENAI_API_KEY to the local .env file, save it, and refresh the connection.');
  const client = new OpenAI({ apiKey: key, maxRetries: config.retry ? 1 : 0, timeout: 60000, fetch: options.fetch });
  try {
    const response = await client.responses.create({
      model, instructions, input, tools: toolDefinitions(config, memoryScope),
      parallel_tool_calls: false, store: false, include: ['reasoning.encrypted_content'],
      reasoning: { effort: 'low' }, max_output_tokens: config.maxOutputTokens,
    }, { signal });
    return { items: response.output, text: response.output_text, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, incomplete: response.status !== 'completed' };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof OpenAI.APIError) {
      const hint = error.status === 401 ? 'Check the API key in .env.' : error.status === 429 ? 'Check quota and rate limits, then retry.' : error.status === 404 || error.status === 403 ? 'Check access to the configured model in your OpenAI account.' : 'Check your connection and OpenAI service status.';
      throw new Error(`OpenAI request failed${error.status ? ` (${error.status})` : ''}. ${hint}`);
    }
    throw new Error('OpenAI request could not complete. Check your connection and try again.');
  }
 };
}
export const liveProvider = createLiveProvider();

// A transparent scripted stand-in for the model. The surrounding harness and tools are real.
// It recognizes a small set of requests; it is not a general-purpose language model.
export const simulatorProvider: Provider = async ({ prompt, config, input, context, memories, signal }) => {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, 180);
    function done() { signal.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); reject(signal.reason); }
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  const calls = input.filter(i => typeof i === 'object' && i.type === 'function_call');
  const hasCalled = (name: string) => calls.some(i => 'name' in i && i.name === name);
  const resultFor = (name: string): Record<string, unknown> | undefined => {
    const call = calls.find(i => 'name' in i && i.name === name);
    if (!call || !('call_id' in call)) return;
    const output = input.find(i => 'type' in i && i.type === 'function_call_output' && i.call_id === call.call_id);
    if (output && 'output' in output && typeof output.output === 'string') return JSON.parse(output.output);
  };
  const call = (name: string, args: unknown): ModelOutput => ({ items: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: `call_${calls.length}`, id: `fc_${calls.length}`, status: 'completed' }], text: '', inputTokens: 0, outputTokens: 0 });
  if (config.planning && !hasCalled('make_plan')) return call('make_plan', { steps: ['Inspect the request and available context.', 'Use an appropriate enabled tool.', 'Report the result and any limitations.'] });
  const remember = prompt.match(/^\s*(?:please\s+)?remember(?:\s+that)?\s*[:,-]?\s+([\s\S]+)/i);
  if (remember && config.memory && !hasCalled('save_memory')) return call('save_memory', { content: remember[1].trim().slice(0, 1000) });
  const arithmetic = prompt.match(/(?:calculate|compute|what is)\s+([\d\s.+*/%()-]+[\d)])/i);
  if (arithmetic && config.tools && !hasCalled('calculate')) return call('calculate', { expression: arithmetic[1].trim() });
  const policy = /\b(policy|travel|hotel|refund|launch)\b/i.test(prompt);
  if (policy && config.retrieval && !hasCalled('search_knowledge')) return call('search_knowledge', { query: prompt.slice(0, 300) });
  const note = /\b(create|save|write|draft)\s+(?:a\s+)?note\b/i.test(prompt);
  if (note && config.tools && !hasCalled('create_note')) return call('create_note', { title: 'Your experiment note', body: prompt.replace(/^.*?\bnote\s*:?\s*/i, '') || 'A local note created by the agent harness.' });
  const parts: string[] = [];
  if (remember) {
    const saved = resultFor('save_memory');
    parts.push(saved?.saved ? `Remembered: ${remember[1].trim()}\n\n${saved.scope === 'comparison' ? 'This memory belongs only to this comparison variant. It was not added to the persistent store.' : 'Start a new run and ask what I remember. The saved fact survives because the harness writes it to disk.'}` : saved?.error ? `Memory was not saved: ${saved.error}` : 'Memory is off, so this fact will not be available in the next run.');
  }
  if (arithmetic) {
    const result = resultFor('calculate');
    parts.push(result?.result !== undefined ? `The calculator returned **${result.result}** for ${arithmetic[1].trim()}.` : result?.error ? `The calculation failed: ${result.error}` : 'The calculator is disabled. This simulator does not guess the answer. Enable tools and run again.');
  }
  if (policy) {
    const result = resultFor('search_knowledge');
    const docs = result?.documents as {title: string; text: string; id: string}[] | undefined;
    parts.push(docs?.length ? docs.map(doc => `**${doc.title}** [${doc.id}]\n${doc.text}`).join('\n\n') : 'No policy evidence is available. Enable knowledge retrieval to search the included demo documents.');
  }
  if (note) {
    const result = resultFor('create_note');
    parts.push(result?.created ? `Created a local note: **${(result.note as {title: string}).title}**. You can inspect its contents in the tool result.` : `No note was created. ${result?.error || 'Enable tools to create a note.'}`);
  }
  if (!remember && /\b(remember|preference|prefer|know about me|memory)\b/i.test(prompt)) parts.push(memories.length ? `The harness supplied these saved memories:\n${memories.map(m => `- ${m.content}`).join('\n')}` : 'No saved memories were supplied to this run. Save a fact first, or turn memory on.');
  if (/\b(context|brief|codeword)\b/i.test(prompt)) parts.push(context ? `Here is the context the harness actually included:\n\n${context}` : 'No extra context reached the model. Add a brief in the context field.');
  if (!parts.length) parts.push('This is the scripted simulator. Try “Calculate 24 * 7”, “Remember that I prefer concise answers”, “What is the hotel policy?”, or “Create a note: check the launch plan”. Switch to Live OpenAI for open-ended scenarios.');
  let text = parts.join('\n\n');
  if (/\bbullet/i.test(config.instructions)) text = text.split('\n\n').map(p => `- ${p}`).join('\n');
  if (/\b(one sentence|brief|concise)/i.test(config.instructions) && !remember && !policy && !note && parts.length === 1 && !text.includes('\n')) text = text.trim();
  if (/\buppercase\b/i.test(config.instructions)) text = text.toUpperCase();
  return { items: [], text, inputTokens: 0, outputTokens: 0 };
};
