import { z } from 'zod';

export const configSchema = z.object({
  mode: z.enum(['simulator', 'live']).default('simulator'),
  instructions: z.string().max(5000).default('Be clear, concise, and helpful. Explain your answer in plain language.'),
  tools: z.boolean().default(true),
  memory: z.boolean().default(true),
  retrieval: z.boolean().default(true),
  planning: z.boolean().default(false),
  approvals: z.boolean().default(true),
  retry: z.boolean().default(true),
  failOnce: z.boolean().default(false),
  maxSteps: z.number().int().min(1).max(10).default(6),
  contextChars: z.number().int().min(100).max(10000).default(4000),
  maxOutputTokens: z.number().int().min(256).max(4096).default(1200),
  expected: z.string().max(300).default(''),
});
export type Config = z.infer<typeof configSchema>;
export const runSchema = z.object({ prompt: z.string().trim().min(1).max(8000), context: z.string().max(20000).default(''), config: configSchema });
export const comparisonSchema = runSchema.omit({ config: true }).extend({
  variants: z.array(z.object({ label: z.string().trim().min(1).max(60), config: configSchema })).min(2).max(4),
}).refine(value => value.variants.every(v => v.config.mode === value.variants[0].config.mode), { message: 'Use the same provider for every variant.' });
export type RunRequest = z.infer<typeof runSchema>;
export type Memory = { id: string; content: string; createdAt: string; source: string };
export type TraceEvent = { id: number; time: string; type: string; title: string; detail: string; data?: unknown };
export type Approval = { id: string; tool: string; arguments: Record<string, unknown> };
export type Run = RunRequest & {
  id: string; createdAt: string; status: 'running' | 'awaiting_approval' | 'completed' | 'stopped' | 'cancelled' | 'failed';
  events: TraceEvent[]; output: string; steps: number; toolCalls: number;
  usage: { input: number; output: number }; durationMs: number; model: string;
  approval?: Approval; evaluation?: { passed: boolean; expected: string; detail: string };
  memoryScope?: 'persistent' | 'comparison'; comparisonId?: string; variantLabel?: string;
};
