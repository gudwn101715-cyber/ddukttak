import { z } from 'zod';

export const workKindSchema = z.enum(['game', 'story', 'simulation', 'art', 'tool', 'website']);
export type WorkKind = z.infer<typeof workKindSchema>;

export const artifactSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(2000),
  instructions: z.string().trim().min(1).max(2000),
  html: z.string().max(100000),
  css: z.string().max(100000),
  js: z.string().max(100000),
  origin: z.enum(['starter', 'ai']),
  settings: z.object({
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    difficulty: z.enum(['easy', 'normal', 'hard']),
  }).strict(),
}).strict();
export type Artifact = z.infer<typeof artifactSchema>;

const identifier = z.string().min(1).max(120).regex(/^[a-zA-Z0-9-]+$/);
const createdAt = z.string().datetime();
export const workVersionSchema = z.object({
  id: identifier, label: z.string().trim().min(1).max(120), createdAt, artifact: artifactSchema,
}).strict();
export type WorkVersion = z.infer<typeof workVersionSchema>;
export const workMessageSchema = z.object({
  id: identifier, role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8000), createdAt,
}).strict();
export type WorkMessage = z.infer<typeof workMessageSchema>;
export const workSchema = z.object({
  id: identifier, title: z.string().trim().min(1).max(80), description: z.string().max(4000),
  kind: workKindSchema, artifact: artifactSchema,
  versions: z.array(workVersionSchema).min(1), messages: z.array(workMessageSchema),
  createdAt, updatedAt: createdAt,
}).strict();
export type Work = z.infer<typeof workSchema>;
export const createWorkInputSchema = z.object({
  kind: workKindSchema, title: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(3).max(4000), mode: z.enum(['starter', 'ai']),
}).strict();
export type CreateWorkInput = z.infer<typeof createWorkInputSchema>;
