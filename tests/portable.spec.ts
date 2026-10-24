import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/lib/schema';

const portableOrigin = 'http://portable.test';
const workspaceKey = 'ddukttak-portable-workspace-v1';
const artifactPath = process.env.DDUK_PORTABLE_HTML_PATH || path.resolve('artifacts/ddukttak-preview.html');
const description = '가족과 함께 흙으로 나만의 그릇을 만드는 도자기 공방의 체험 수업을 소개해 주세요.';
const tinyPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
let unexpectedRequests: string[];
let requestFailures: string[];
let pageErrors: string[];

test.beforeEach(async ({ context }) => {
  unexpectedRequests = [];
  requestFailures = [];
  pageErrors = [];
  const html = await readFile(artifactPath, 'utf8');
  // Only deliver the exact portable artifact. No application API, dependency,
  // asset or generated-page responses are mocked; every other HTTP request fails.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === portableOrigin && url.pathname === '/' && route.request().resourceType() === 'document') {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
    } else if (url.protocol === 'blob:' || url.protocol === 'data:') {
      await route.continue();
    } else {
      unexpectedRequests.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort('blockedbyclient');
    }
  });
  const observePage = (page: Page) => {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('requestfailed', request => requestFailures.push(`${request.url().split('?')[0]}: ${request.failure()?.errorText}`));
  };
  context.on('page', observePage);
  for (const page of context.pages()) observePage(page);
});

test.afterEach(async () => {
  expect(pageErrors).toEqual([]);
  expect(unexpectedRequests).toEqual([]);
  expect(requestFailures).toEqual([]);
});

async function savedProject(page: Page): Promise<Project> {
  return page.evaluate(key => {
    const workspace = JSON.parse(localStorage.getItem(key) || 'null');
    if (!workspace?.projects?.[0]) throw new Error('The portable workspace did not persist its project.');
    return workspace.projects[0];
  }, workspaceKey);
}

async function createWithWizard(page: Page, name: string, gallery = false) {
  await page.goto(`${portableOrigin}/?studio=websites`, { waitUntil: 'networkidle' });
  expect(await page.evaluate(() => Boolean((window as Window & { __DDUKTTAK_PORTABLE__?: boolean }).__DDUKTTAK_PORTABLE__))).toBe(true);
  await expect(page.getByText('설치 없는 체험판', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '새 프로젝트 만들기', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: /매장 · 예약/ }).click();
  await dialog.getByLabel(/프로젝트 이름/).fill(name);
  await dialog.getByLabel('어떤 앱이면 좋을까요?').fill(description);
  await dialog.getByRole('button', { name: '다음으로' }).click();
  await dialog.getByRole('button', { name: /자연스럽고 감각적인/ }).click();
  await dialog.getByRole('button', { name: '다음으로' }).click();
  await dialog.getByRole('button', { name: /예약 요청/ }).click();
  await dialog.getByRole('button', { name: /자주 묻는 질문/ }).click();
  if (gallery) await dialog.getByRole('button', { name: /이미지 갤러리/ }).click();
  await dialog.getByRole('button', { name: '다음으로' }).click();
  await dialog.getByRole('button', { name: '나의 앱 만들기' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
  return savedProject(page);
}

test('portable artifact creates, edits, restores and runs a saved app with every network dependency blocked', async ({ page }) => {
  const original = await createWithWizard(page, '파일 하나로 만드는 공방');
  const iframe = page.locator('iframe[title$="미리보기"]');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  let preview = page.frameLocator('iframe[title$="미리보기"]');
  const booking = preview.locator('form[data-form="booking"]');
  await booking.getByRole('button', { name: '예약 내용 저장하기' }).click();
  expect(await booking.evaluate(form => (form as HTMLFormElement).checkValidity())).toBe(false);
  await booking.getByLabel('이름', { exact: true }).fill('김처음');
  await booking.getByLabel('이메일', { exact: true }).fill('portable@example.com');
  await booking.getByLabel('희망 날짜').fill(new Date(Date.now() + 86_400_000).toISOString().slice(0, 10));
  await booking.getByLabel('희망 시간').selectOption('14:00');
  await booking.getByRole('button', { name: '예약 내용 저장하기' }).click();
  await expect(booking.locator('.form-status')).toContainText('미리보기에 임시 저장');
  await page.getByRole('textbox', { name: '수정 요청', exact: true }).fill('파란색으로 바꾸고 제목을 "내 손으로 만드는 특별한 하루"로 바꿔줘');
  await page.getByRole('button', { name: '수정 요청 보내기', exact: true }).click();
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('내 손으로 만드는 특별한 하루');
  expect((await savedProject(page)).schema.theme.primary).toBe('#3e67c8');
  await page.reload({ waitUntil: 'networkidle' });
  preview = page.frameLocator('iframe[title$="미리보기"]');
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('내 손으로 만드는 특별한 하루');
  await page.getByRole('button', { name: /기능 관리/ }).click();
  const gallery = page.locator('.managed-feature').filter({ has: page.getByRole('heading', { name: '이미지 갤러리', exact: true }) });
  await gallery.getByRole('button', { name: '기능 추가', exact: true }).click();
  await expect(gallery.getByRole('button', { name: '추가됨 · 제거', exact: true })).toBeEnabled();
  const contact = page.locator('.managed-feature').filter({ has: page.getByRole('heading', { name: '문의 양식', exact: true }) });
  await contact.getByRole('button', { name: '추가됨 · 제거', exact: true }).click();
  await expect(contact.getByRole('button', { name: '기능 추가', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(page.frameLocator('iframe[title$="미리보기"]').locator('#gallery')).toBeVisible();
  await expect(page.frameLocator('iframe[title$="미리보기"]').locator('#contact')).toHaveCount(0);
  await page.getByRole('button', { name: '변경 기록', exact: true }).click();
  await expect(page.locator('.version-item')).toHaveCount(4);
  await page.locator('.version-item').last().getByRole('button', { name: '이 버전 복원', exact: true }).click();
  await expect(page.locator('.version-item')).toHaveCount(5);
  const restored = await savedProject(page);
  expect(restored.schema).toEqual(original.schema);
  await page.getByRole('button', { name: '미리보기', exact: true }).click();
  await expect(page.frameLocator('iframe[title$="미리보기"]').getByRole('heading', { level: 1 })).toHaveText(original.schema.hero.title, { useInnerText: true });
});

test('portable app exports real standalone HTML and publishes an immutable Blob page with uploaded photos', async ({ page, context }, testInfo) => {
  const original = await createWithWizard(page, '다운로드와 실행을 확인하는 공방', true);
  await page.getByRole('button', { name: '직접 수정', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.locator('summary').filter({ hasText: '갤러리 사진과 설명 수정' }).click();
  await dialog.getByLabel('갤러리 1 사진 올리기', { exact: true }).setInputFiles({ name: 'offline-photo.png', mimeType: 'image/png', buffer: tinyPng });
  await expect(dialog.locator('.content-image-preview img').first()).toBeVisible();
  await dialog.getByLabel('갤러리 1 제목', { exact: true }).fill('인터넷 없이 담은 작품 사진');
  await dialog.getByRole('button', { name: '수정 내용 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: '실행하기', exact: true }).click();
  await page.getByRole('button', { name: '자동 점검', exact: true }).click();
  await expect(page.locator('.check-results .check-item.passed')).not.toHaveCount(0);
  await page.getByRole('button', { name: '브라우저 실행본 만들기', exact: true }).click();
  const publishedLink = page.getByRole('link', { name: '저장한 실행본 열기', exact: true });
  await expect(publishedLink).toHaveAttribute('href', /^blob:/);
  const opened = context.waitForEvent('page');
  await publishedLink.click();
  let published = await opened;
  await published.waitForLoadState();
  await expect(published.getByRole('heading', { level: 1 })).toHaveText(original.schema.hero.title, { useInnerText: true });
  const publishedPhoto = published.locator('#gallery img').first();
  await publishedPhoto.scrollIntoViewIfNeeded();
  await expect.poll(() => publishedPhoto.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await page.getByRole('button', { name: '직접 수정', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('메인 제목').fill('수정 중인 새 화면은 따로 보관돼요');
  await dialog.getByRole('button', { name: '수정 내용 저장', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(published.getByRole('heading', { level: 1 })).toHaveText(original.schema.hero.title, { useInnerText: true });
  await published.close();
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '실행하기', exact: true }).click();
  const reopen = context.waitForEvent('page');
  await page.getByRole('link', { name: '저장한 실행본 열기', exact: true }).click();
  published = await reopen;
  await published.waitForLoadState();
  await expect(published.getByRole('heading', { level: 1 })).toHaveText(original.schema.hero.title, { useInnerText: true });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('link', { name: '앱 파일 내려받기', exact: true }).click();
  const download = await downloadEvent;
  const downloadPath = testInfo.outputPath('portable-created-app.html');
  await download.saveAs(downloadPath);
  const exportedHtml = await readFile(downloadPath, 'utf8');
  const saved = await savedProject(page);
  expect(exportedHtml).toContain('수정 중인 새 화면은 따로 보관돼요');
  expect(exportedHtml).toContain('인터넷 없이 담은 작품 사진');
  expect(exportedHtml).toContain(saved.schema.content!.gallery[0].image);
  // Managed Chromium blocks file://. Open the exact downloaded bytes as a Blob,
  // with no intercepted generated-page response or dependency network access.
  const blobUrl = await page.evaluate(html => URL.createObjectURL(new Blob([html], { type: 'text/html' })), exportedHtml);
  const standalone = await context.newPage();
  await standalone.goto(blobUrl);
  await expect(standalone.getByRole('heading', { level: 1 })).toHaveText('수정 중인 새 화면은 따로 보관돼요');
  const photo = standalone.locator('#gallery img').first();
  await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => photo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const contact = standalone.locator('form[data-form="contact"]');
  await contact.getByLabel('이름', { exact: true }).fill('오프라인 방문자');
  await contact.getByLabel('이메일', { exact: true }).fill('offline@example.com');
  await contact.getByLabel('문의 내용').fill('파일에서 직접 작성한 문의입니다.');
  await contact.getByRole('button', { name: '문의 내용 저장하기' }).click();
  await expect(contact.locator('.form-status')).toContainText('이 기기에 저장했어요');
  await standalone.close();
  await published.close();
});
