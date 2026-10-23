import { featureKeys, type FeatureKey, type GenerateInput } from './schema';

const kinds: GenerateInput['kind'][] = ['landing', 'booking', 'portfolio', 'store'];
const styles: GenerateInput['style'][] = ['warm', 'minimal', 'bold', 'natural'];

export function restoreDraft(raw: string | null, rawStep: string | null): { input: GenerateInput; step: number; recovered: boolean } {
  const input: GenerateInput = { name: '', description: '', kind: 'landing', style: 'warm', features: ['contact'] };
  let value: unknown;
  try { value = raw === null ? null : JSON.parse(raw); } catch { value = null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { input, step: 0, recovered: raw !== null };
  }
  const draft = value as Record<string, unknown>;
  let recovered = false;
  if (typeof draft.name === 'string') input.name = draft.name.slice(0, 60);
  else recovered = true;
  if (typeof draft.description === 'string') input.description = draft.description.slice(0, 2000);
  else recovered = true;
  if (kinds.includes(draft.kind as GenerateInput['kind'])) input.kind = draft.kind as GenerateInput['kind'];
  else recovered = true;
  if (styles.includes(draft.style as GenerateInput['style'])) input.style = draft.style as GenerateInput['style'];
  else recovered = true;
  if (Array.isArray(draft.features)) {
    input.features = [...new Set(draft.features.filter((item): item is FeatureKey => typeof item === 'string' && featureKeys.includes(item as FeatureKey)))];
    if (input.features.length !== draft.features.length) recovered = true;
  } else recovered = true;
  if (input.name !== draft.name || input.description !== draft.description) recovered = true;
  const requested = rawStep === null ? 0 : Number(rawStep);
  const validStep = Number.isInteger(requested) && requested >= 0 && requested <= 3;
  const step = validStep && input.name.trim() && input.description.trim().length >= 3 ? requested : 0;
  return { input, step, recovered: recovered || !validStep };
}
