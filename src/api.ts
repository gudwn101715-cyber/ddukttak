import type { AppSchema, GenerateInput, Project } from './lib/schema';
import { isPortable } from './offline/mode';
import { offlineApi, exportUrl as portableExportUrl, publishedUrl as portablePublishedUrl } from './offline/workspace';

export type RuntimeStatus = { mode: 'local' | 'ai'; aiConfigured: boolean; hosting: string };
export type CheckResult = { checks: {id:string;label:string;status:'passed'|'warning'|'failed';detail:string}[]; checkedAt:string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || '요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

const remoteApi = {
  status: () => request<RuntimeStatus>('/status'),
  list: () => request<Project[]>('/projects'),
  create: (input: GenerateInput) => request<Project>('/projects', { method:'POST', body:JSON.stringify(input) }),
  edit: (id:string,prompt:string) => request<Project>(`/projects/${id}/edit`, {method:'POST',body:JSON.stringify({prompt})}),
  save: (id:string,schema:AppSchema,label:string) => request<Project>(`/projects/${id}/schema`, {method:'PATCH',body:JSON.stringify({schema,label})}),
  restore: (id:string,versionId:string) => request<Project>(`/projects/${id}/restore`, {method:'POST',body:JSON.stringify({versionId})}),
  publish: (id:string) => request<{project:Project;path:string}>(`/projects/${id}/publish`, {method:'POST'}),
  remove: (id:string) => request<void>(`/projects/${id}`, {method:'DELETE'}),
  check: (id:string) => request<CheckResult>(`/projects/${id}/check`),
  exportUrl: (project:Project) => `/api/projects/${project.id}/export`,
  publishedUrl: (project:Project) => project.publishedSlug ? `/published/${project.publishedSlug}` : '',
};

export const api = isPortable()
  ? { ...offlineApi, exportUrl: portableExportUrl, publishedUrl: portablePublishedUrl }
  : remoteApi;
