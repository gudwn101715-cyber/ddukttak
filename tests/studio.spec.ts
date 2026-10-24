import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import type { GenerateInput, Project } from '../src/lib/schema';

const createdIds: string[] = [];
const description = '누구나 쉽게 도자기를 만들 수 있는 소규모 공방의 수업과 방문 예약을 소개해 주세요.';

async function createProject(request: APIRequestContext, features: GenerateInput['features'] = ['booking', 'contact']) {
  const response = await request.post('/api/projects', {
    data: { name: `E2E 공방 ${Date.now()}`, description, kind: 'booking', style: 'warm', features },
  });
  expect(response.status()).toBe(201);
  const project = await response.json() as Project;
  createdIds.push(project.id);
  return project;
}

async function openStudio(page: Page, project: Project) {
  await page.goto(`/?studio=websites#editor/${project.id}`);
  await expect(page.getByRole('heading', { level: 1, name: project.name, exact: true })).toBeVisible();
  await expect(page.locator('iframe[title$="미리보기"]')).toBeVisible();
}

async function wizardProject(page: Page) {
  const name = `E2E 처음 만든 공방 ${Date.now()}`;
  await page.goto('/?studio=websites');
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
  const wizard = page.getByRole('dialog');
  await wizard.getByRole('button', { name: /매장 · 예약/ }).click();
  await wizard.getByLabel(/프로젝트 이름/).fill(name);
  await wizard.getByLabel('어떤 앱이면 좋을까요?').fill(description);
  await wizard.getByRole('button', { name: '다음으로' }).click();
  await expect(wizard.getByRole('heading', { name: '어떤 분위기가 마음에 드세요?' })).toBeVisible();
  await wizard.getByRole('button', { name: /자연스럽고 감각적인/ }).click();
  await wizard.getByRole('button', { name: '다음으로' }).click();
  await wizard.getByRole('button', { name: /예약 요청/ }).click();
  await wizard.getByRole('button', { name: /자주 묻는 질문/ }).click();
  await wizard.getByRole('button', { name: '다음으로' }).click();
  await expect(wizard.getByText(name, { exact: true })).toBeVisible();
  const createdResponse = page.waitForResponse(response => response.url().endsWith('/api/projects') && response.request().method() === 'POST');
  await wizard.getByRole('button', { name: '나의 앱 만들기' }).click();
  const response = await createdResponse;
  expect(response.status()).toBe(201);
  const project = await response.json() as Project;
  createdIds.push(project.id);
  await expect(wizard).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`#editor/${project.id}$`));
  return project;
}

test.afterEach(async ({ request }) => {
  for (const id of createdIds.splice(0)) {
    const response = await request.delete(`/api/projects/${id}`);
    expect([204, 404]).toContain(response.status());
  }
});

test('four-step creation produces an isolated working preview, editable by conversation and retained after refresh', async ({ page }) => {
  const project = await wizardProject(page);
  expect(project.kind).toBe('booking');
  expect(project.schema.features).toEqual(expect.arrayContaining(['booking', 'contact', 'faq']));
  expect(project.schema.theme.primary).toBe('#38644a');
  const iframe = page.locator('iframe[title$="미리보기"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  const preview = page.frameLocator('iframe[title$="미리보기"]');
  const blockedFromParent = await preview.locator('body').evaluate(() => {
    try { window.parent.localStorage.getItem('ddukttak-draft'); return false; } catch { return true; }
  });
  expect(blockedFromParent).toBe(true);
  const form = preview.locator('form[data-form="booking"]');
  await form.getByRole('button', { name: '예약 내용 저장하기' }).click();
  expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(false);
  await expect(form.locator('.form-status')).toBeEmpty();
  await form.getByLabel('이름', { exact: true }).fill('김처음');
  await form.getByLabel('이메일', { exact: true }).fill('first@example.com');
  await form.getByLabel('희망 날짜').fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  await form.getByLabel('희망 시간').selectOption('14:00');
  await form.getByRole('button', { name: '예약 내용 저장하기' }).click();
  await expect(form.locator('.form-status')).toContainText('미리보기에 임시 저장');
  await expect(form.locator('.form-status')).toContainText('운영자에게 전송되지 않습니다');
  const faq = preview.locator('#faq details').first();
  await faq.locator('summary').click();
  await expect(faq).toHaveAttribute('open', '');
  await page.getByRole('textbox', { name: '수정 요청', exact: true }).fill('파란색으로 바꾸고, 제목을 "매일 새로운 흙의 이야기"로 바꿔줘');
  const editedResponse = page.waitForResponse(response => response.url().endsWith(`/api/projects/${project.id}/edit`));
  await page.getByRole('button', { name: '수정 요청 보내기', exact: true }).click();
  expect((await editedResponse).status()).toBe(200);
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('매일 새로운 흙의 이야기');
  await expect(preview.locator('.hero .button')).toHaveCSS('background-color', 'rgb(62, 103, 200)');
  await page.reload();
  await expect(page.frameLocator('iframe[title$="미리보기"]').getByRole('heading', { level: 1 })).toHaveText('매일 새로운 흙의 이야기');
  await page.getByRole('button', { name: '모바일 미리보기', exact: true }).click();
  expect(await iframe.evaluate(element => Math.round(element.getBoundingClientRect().width))).toBe(390);
});

test('feature switches change the rendered app and restoring a version preserves the full history', async ({ page, request }) => {
  const project = await createProject(request);
  await openStudio(page, project);
  await page.getByRole('button', { name: /기능 관리/ }).click();
  const gallery = page.locator('.managed-feature').filter({ has: page.getByRole('heading', { name: '이미지 갤러리', exact: true }) });
  await gallery.getByRole('button', { name: '기능 추가', exact: true }).click();
  await expect(gallery.getByRole('button', { name: '추가됨 · 제거', exact: true })).toBeEnabled();
  const contact = page.locator('.managed-feature').filter({ has: page.getByRole('heading', { name: '문의 양식', exact: true }) });
  await contact.getByRole('button', { name: '추가됨 · 제거', exact: true }).click();
  await expect(contact.getByRole('button', { name: '기능 추가', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  let preview = page.frameLocator('iframe[title$="미리보기"]');
  await expect(preview.locator('#gallery')).toBeVisible();
  await expect(preview.locator('#contact')).toHaveCount(0);
  await page.getByRole('button', { name: '변경 기록', exact: true }).click();
  await expect(page.locator('.version-item')).toHaveCount(3);
  await page.locator('.version-item').last().getByRole('button', { name: '이 버전 복원' }).click();
  await expect(page.locator('.version-item')).toHaveCount(4);
  await expect(page.locator('.version-item').first()).toContainText('복원: 첫 번째 앱 완성');
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  preview = page.frameLocator('iframe[title$="미리보기"]');
  await expect(preview.locator('#gallery')).toHaveCount(0);
  await expect(preview.locator('#contact')).toBeVisible();
  const saved = await (await request.get(`/api/projects/${project.id}`)).json() as Project;
  expect(saved.schema).toEqual(project.schema);
  expect(saved.versions).toHaveLength(4);
});

test('automatic checks, local publishing, immutable published output and downloaded standalone execution work', async ({ page, request, context }, testInfo) => {
  const project = await createProject(request, ['booking', 'contact', 'faq']);
  await openStudio(page, project);
  await page.getByRole('button', { name: '실행하기', exact: true }).click();
  await page.getByRole('button', { name: '자동 점검', exact: true }).click();
  await expect(page.locator('.check-results .check-item.passed')).toHaveCount(3);
  await expect(page.locator('.check-results')).toContainText('운영자에게 전달하려면');
  await page.getByRole('button', { name: '로컬 페이지 게시', exact: true }).click();
  const publishedLink = page.getByRole('link', { name: '게시된 페이지 열기' });
  await expect(publishedLink).toBeVisible();
  const publishedPath = await publishedLink.getAttribute('href');
  expect(publishedPath).toMatch(/^\/published\/app-/);
  const published = await context.newPage();
  await published.goto(publishedPath!);
  await expect(published.getByRole('heading', { level: 1 })).toHaveText(project.schema.hero.title, { useInnerText: true });
  await expect(published.getByRole('link', { name: /소개/, exact: true })).toBeVisible();
  const directEdit = page.getByRole('button', { name: '직접 수정', exact: true });
  await directEdit.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('메인 제목').fill('아직 게시하지 않은 새로운 제목');
  await dialog.locator('summary').filter({ hasText: '페이지 소개 영역 수정' }).click();
  await dialog.getByLabel('소개 영역 1 제목', { exact: true }).fill('손으로 빚는 하루');
  await dialog.getByLabel('소개 영역 1 설명', { exact: true }).fill('물레를 돌리며 나만의 그릇을 만드는 시간을 함께해요.');
  await dialog.getByRole('button', { name: '수정 내용 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  const draftPreview = page.frameLocator('iframe[title$="미리보기"]');
  await expect(draftPreview.getByRole('heading', { name: '손으로 빚는 하루', exact: true })).toBeVisible();
  await expect(draftPreview.getByText('물레를 돌리며 나만의 그릇을 만드는 시간을 함께해요.', { exact: true })).toBeVisible();
  const savedDraft = await (await request.get(`/api/projects/${project.id}`)).json() as Project;
  expect(savedDraft.schema.sections[0]).toEqual({ title: '손으로 빚는 하루', description: '물레를 돌리며 나만의 그릇을 만드는 시간을 함께해요.' });
  await page.getByRole('button', { name: '실행 안내', exact: true }).click();
  await published.reload();
  await expect(published.getByRole('heading', { level: 1 })).toHaveText(project.schema.hero.title, { useInnerText: true });
  await expect(published.getByRole('heading', { name: '손으로 빚는 하루', exact: true })).toHaveCount(0);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '앱 파일 내려받기', exact: true }).click();
  const download = await downloadEvent;
  const exportedPath = testInfo.outputPath('standalone.html');
  await download.saveAs(exportedPath);
  const html = await readFile(exportedPath, 'utf8');
  expect(html).toContain('아직 게시하지 않은 새로운 제목');
  const standalone = await context.newPage();
  // Managed cloud Chromium blocks file:// navigation. Execute the exact downloaded
  // document under a fresh static URL, just as an uploaded standalone file runs.
  await standalone.route('**/__ddukttak_export_test__.html', route => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
  await standalone.goto('/__ddukttak_export_test__.html');
  await expect(standalone.getByRole('heading', { level: 1 })).toHaveText('아직 게시하지 않은 새로운 제목');
  await expect(standalone.getByRole('heading', { name: '손으로 빚는 하루', exact: true })).toBeVisible();
  const contact = standalone.locator('form[data-form="contact"]');
  await contact.getByLabel('이름', { exact: true }).fill('김고객');
  await contact.getByLabel('이메일', { exact: true }).fill('customer@example.com');
  await contact.getByLabel('문의 내용').fill('도자기 수업을 문의합니다.');
  await contact.getByRole('button', { name: '문의 내용 저장하기' }).click();
  await expect(contact.locator('.form-status')).toContainText('이 기기에 저장했어요');
  const stored = await standalone.evaluate(name => JSON.parse(localStorage.getItem(`ddukttak-submissions:${name}:contact`) || '[]'), project.name);
  expect(stored).toHaveLength(1);
  expect(stored[0].message).toBe('도자기 수업을 문의합니다.');
  await published.close();
  await standalone.close();
});

test('390px mobile layout navigates without horizontal overflow and recovers unfinished answers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?studio=websites');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.getByRole('button', { name: '템플릿 둘러보기', exact: true }).click();
  await expect(page.getByRole('heading', { name: '시작이 쉬워지는 템플릿' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
  const wizard = page.getByRole('dialog');
  await wizard.getByLabel(/프로젝트 이름/).fill('모바일에서 구상한 아이디어');
  await wizard.getByLabel('어떤 앱이면 좋을까요?').fill(description);
  await wizard.getByRole('button', { name: '다음으로' }).click();
  await expect(wizard.getByRole('heading', { name: '어떤 분위기가 마음에 드세요?' })).toBeVisible();
  expect(await wizard.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: '메뉴 열기', exact: true }).click();
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: '어떤 분위기가 마음에 드세요?' })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '이전', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel(/프로젝트 이름/)).toHaveValue('모바일에서 구상한 아이디어');
  await expect(page.getByRole('dialog').getByLabel('어떤 앱이면 좋을까요?')).toHaveValue(description);
});

test('uploaded gallery photos and custom FAQ and reviews persist, render and export as a standalone app', async ({ page, request }) => {
  const project = await createProject(request, ['gallery', 'faq', 'testimonials']);
  await openStudio(page, project);
  await page.getByRole('button', { name: '직접 수정', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('summary').filter({ hasText: '갤러리 사진과 설명 수정' }).click();
  const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await dialog.getByLabel('갤러리 1 사진 올리기', { exact: true }).setInputFiles({ name: 'handmade-cup.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(dialog.locator('.content-image-preview img').first()).toBeVisible();
  await dialog.getByLabel('갤러리 1 제목', { exact: true }).fill('나만의 찻잔 사진');
  await dialog.locator('summary').filter({ hasText: '자주 묻는 질문 수정' }).click();
  await dialog.getByLabel('질문 1', { exact: true }).fill('아이와 함께 참여할 수 있나요?');
  await dialog.getByLabel('답변 1', { exact: true }).fill('초등학생부터 보호자와 함께 참여할 수 있어요.');
  await dialog.locator('summary').filter({ hasText: '고객 후기 수정' }).click();
  await dialog.getByLabel('후기 1 내용', { exact: true }).fill('우리 가족만의 컵을 만들어서 특별했어요.');
  await dialog.getByLabel('후기 1 이름', { exact: true }).fill('도자기를 사랑하는 가족');
  await dialog.getByRole('button', { name: '수정 내용 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const preview = page.frameLocator('iframe[title$="미리보기"]');
  await expect(preview.getByRole('heading', { name: '나만의 찻잔 사진', exact: true })).toBeVisible();
  const photo = preview.locator('#gallery img').first();
  await expect(photo).toBeVisible();
  await expect(photo).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const question = preview.locator('#faq details').filter({ hasText: '아이와 함께 참여할 수 있나요?' });
  await question.locator('summary').click();
  await expect(question.getByText('초등학생부터 보호자와 함께 참여할 수 있어요.', { exact: true })).toBeVisible();
  await expect(preview.getByText('우리 가족만의 컵을 만들어서 특별했어요.', { exact: false })).toBeVisible();
  await expect(preview.getByText('도자기를 사랑하는 가족', { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.frameLocator('iframe[title$="미리보기"]').getByRole('heading', { name: '나만의 찻잔 사진', exact: true })).toBeVisible();
  const saved = await (await request.get(`/api/projects/${project.id}`)).json() as Project;
  expect(saved.schema.content?.gallery[0].image).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved.schema.content?.faq[0].answer).toBe('초등학생부터 보호자와 함께 참여할 수 있어요.');
  expect(saved.schema.content?.testimonials[0].quote).toBe('우리 가족만의 컵을 만들어서 특별했어요.');
  const exported = await (await request.get(`/api/projects/${project.id}/export`)).text();
  expect(exported).toContain(saved.schema.content!.gallery[0].image);
  expect(exported).toContain('나만의 찻잔 사진');
  expect(exported).toContain('초등학생부터 보호자와 함께 참여할 수 있어요.');
  expect(exported).toContain('우리 가족만의 컵을 만들어서 특별했어요.');
});

const damagedDraftCases = [
  { label: 'partial legacy draft', raw: JSON.stringify({ name: '이전 초안' }), step: '2', name: '이전 초안', selected: ['문의 양식'], startsAtIdea: true },
  { label: 'array instead of draft', raw: '[]', step: '2', name: '', selected: ['문의 양식'], startsAtIdea: true },
  { label: 'null draft with orphaned step', raw: 'null', step: '3', name: '', selected: ['문의 양식'], startsAtIdea: true },
  { label: 'malformed saved JSON', raw: '{broken-json', step: '2', name: '', selected: ['문의 양식'], startsAtIdea: true },
  { label: 'wrong field types and NaN step', raw: JSON.stringify({ name: 9, description: {}, features: 'booking', kind: 'unknown', style: 'unknown' }), step: 'NaN', name: '', selected: ['문의 양식'], startsAtIdea: true },
  { label: 'null feature list', raw: JSON.stringify({ name: '필드 복구', description, features: null }), step: 'NaN', name: '필드 복구', selected: ['문의 양식'], startsAtIdea: true },
  { label: 'mixed and duplicate feature values', raw: JSON.stringify({ name: '선택 기능 보존', description, kind: 'booking', style: 'natural', features: ['booking', 'booking', null, 42, 'arbitrary'] }), step: '2', name: '선택 기능 보존', selected: ['예약 요청'], startsAtIdea: false },
  { label: 'infinite saved step', raw: JSON.stringify({ name: '안전한 단계 복구', description, features: ['contact'] }), step: 'Infinity', name: '안전한 단계 복구', selected: ['문의 양식'], startsAtIdea: true },
  { label: 'fractional saved step', raw: JSON.stringify({ name: '정수 단계로 복구', description, features: ['contact'] }), step: '1.5', name: '정수 단계로 복구', selected: ['문의 양식'], startsAtIdea: true },
];

for (const draft of damagedDraftCases) {
  test(`damaged local draft recovers without a blank app: ${draft.label}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    // This test context is isolated. Existing workspace projects are untouched.
    await page.addInitScript(({ raw, step }) => {
      localStorage.setItem('ddukttak-draft', raw);
      localStorage.setItem('ddukttak-draft-step', step);
    }, { raw: draft.raw, step: draft.step });
    await page.goto('/?studio=websites');
    await expect(page.getByRole('button', { name: '새 프로젝트 만들기', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
    const wizard = page.getByRole('dialog');
    await expect(wizard).toBeVisible();
    await expect(page.getByRole('navigation', { name: '메인 메뉴' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('ddukttak-draft-recovery'))).toBe(draft.raw);
    await expect(wizard.locator('.wizard-step.current')).toHaveCount(1);
    if (draft.startsAtIdea) await expect(wizard.getByLabel(/프로젝트 이름/)).toBeVisible();
    // Valid fields survive recovery even if another saved field was unusable.
    for (let step = 0; step < 3 && !(await wizard.getByLabel(/프로젝트 이름/).count()); step++) {
      await wizard.getByRole('button', { name: '이전', exact: true }).click();
    }
    await expect(wizard.getByLabel(/프로젝트 이름/)).toHaveValue(draft.name);
    if (!draft.name) await wizard.getByLabel(/프로젝트 이름/).fill('새로 시작하는 아이디어');
    await wizard.getByLabel('어떤 앱이면 좋을까요?').fill(description);
    await wizard.getByRole('button', { name: '다음으로' }).click();
    await expect(wizard.getByRole('heading', { name: '어떤 분위기가 마음에 드세요?' })).toBeVisible();
    await wizard.getByRole('button', { name: '다음으로' }).click();
    await expect(wizard.locator('.feature-option.selected b')).toHaveText(draft.selected);
    expect(pageErrors).toEqual([]);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ddukttak-draft') || 'null'));
    expect(saved.name).toBe(draft.name || '새로 시작하는 아이디어');
    expect(Array.isArray(saved.features)).toBe(true);
  });
}
