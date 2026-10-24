import { describe, expect, it } from 'vitest';
import { artifactSchema, createWorkInputSchema, workKindSchema } from '../src/creative/model';
import { createStarter } from '../src/creative/starters';
import { renderArtifact } from '../src/creative/runtime';
import type { Artifact, WorkKind } from '../src/creative/model';

const kinds: WorkKind[] = ['game', 'story', 'simulation', 'art', 'tool', 'website'];

describe('creative artifact contract', () => {
  it.each(kinds)('%s starter is a validated executable artifact clearly labelled as a starter', kind => {
    const artifact = createStarter(kind, '나만의 창작물', '터치해서 직접 조작할 수 있는 작품을 만들어 보고 싶어요.');
    expect(workKindSchema.parse(kind)).toBe(kind);
    expect(artifactSchema.parse(artifact)).toEqual(artifact);
    expect(artifact.origin).toBe('starter');
    expect(artifact.title).toBe('나만의 창작물');
    expect(artifact.html.length).toBeGreaterThan(0);
    expect(artifact.js.length).toBeGreaterThan(0);
    expect(artifact.instructions.length).toBeGreaterThan(0);
    expect(artifact.js).not.toMatch(/\bimport\s*\(/);
  });

  it('requires an explicit generation mode instead of silently using starter mode', () => {
    const input = { kind: 'game', title: '나의 게임', prompt: '점수를 얻는 터치 게임' };
    expect(createWorkInputSchema.safeParse(input).success).toBe(false);
    expect(createWorkInputSchema.parse({ ...input, mode: 'ai' }).mode).toBe('ai');
    expect(createWorkInputSchema.safeParse({ ...input, mode: 'pretend-ai' }).success).toBe(false);
  });

  it('rejects oversized code and invalid controlled settings without forbidding executable creative code', () => {
    const starter = createStarter('game', '안전한 실행 경계', '점수 게임');
    const executable: Artifact = { ...starter, html: '<button id="run">실행</button>', js: 'document.querySelector("#run").onclick=()=>document.body.dataset.played="yes";' };
    expect(artifactSchema.parse(executable).js).toBe(executable.js);
    for (const value of [
      { ...starter, title: 'x'.repeat(81) },
      { ...starter, js: 'x'.repeat(100_001) },
      { ...starter, html: 'x'.repeat(100_001) },
      { ...starter, css: 'x'.repeat(100_001) },
      { ...starter, origin: 'pretend-ai' },
      { ...starter, settings: { ...starter.settings, accent: 'red; background:url(https://attacker.example)' } },
      { ...starter, settings: { ...starter.settings, difficulty: 'unlimited' } },
    ]) expect(artifactSchema.safeParse(value).success).toBe(false);
  });
});

describe('creative runtime isolation', () => {
  it('exports a standalone shell with a network-isolated opaque-origin code frame', () => {
    const artifact = createStarter('game', '파일로 실행하는 게임', '클릭 게임');
    const html = renderArtifact(artifact, { channel: 'test-runtime-channel' });
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('data-artifact-frame');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain('dduk-runtime-ready');
    expect(html).toContain('dduk-runtime-error');
    expect(html).toContain('test-runtime-channel');
    expect(html).toContain('DDUK_SETTINGS');
  });

  it('escapes host-facing titles and instructions while confining user HTML and script to the nested frame', () => {
    const starter = createStarter('art', '작품', '색을 바꾸는 작품');
    const attack = '<img src=x onerror="window.parent.__HOST_COMPROMISED__=true">';
    const html = renderArtifact({
      ...starter,
      title: '<script>hostAttack()</script>',
      instructions: attack,
      html: '<button id="creative-test-button">터치해 주세요</button>',
      js: 'window.parent.__HOST_COMPROMISED__=true;',
    });
    expect(html).not.toContain('<script>hostAttack()</script>');
    expect(html).not.toContain(attack);
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<button id="creative-test-button">');
    expect(html).toContain('creative-test-button');
  });
});
