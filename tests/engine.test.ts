import { describe, expect, it } from 'vitest';
import { generateSchema, editSchema } from '../src/lib/generator';
import { featureKeys, validateSchema } from '../src/lib/schema';
import type { AppKind, GenerateInput } from '../src/lib/schema';
import { renderAppHtml } from '../src/lib/renderer';

const input: GenerateInput = {
  name: '오늘의 공방',
  description: '처음 만드는 사람도 편하게 참여하는 도자기 체험 공방입니다.',
  kind: 'booking',
  style: 'warm',
  features: ['booking', 'contact', 'faq'],
};
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCsAJp7/9k=';
const customContent = {
  gallery: [{ title: '내가 빚은 찻잔', description: '손으로 만든 유일한 작품', image: tinyPng }],
  faq: [{ question: '준비물이 있나요?', answer: '편한 옷차림으로 오시면 됩니다.' }],
  testimonials: [{ quote: '처음이라도 차근차근 배울 수 있었어요.', name: '김수강생' }],
};

describe('structured app generation', () => {
  it.each<AppKind>(['landing', 'booking', 'portfolio', 'store'])('%s creates a validated app using the requested data', kind => {
    const schema = generateSchema({ ...input, kind });
    expect(validateSchema(schema)).toEqual(schema);
    expect(schema.name).toBe(input.name);
    expect(schema.kind).toBe(kind);
    expect(schema.hero.subtitle).toBe(input.description);
    expect(schema.features).toEqual(input.features);
    expect(schema.sections.length).toBeGreaterThan(0);
    expect(schema.hero.buttonText.length).toBeGreaterThan(0);
  });

  it('produces distinct requested styles and accepts every known feature', () => {
    const styles: GenerateInput['style'][] = ['warm', 'minimal', 'bold', 'natural'];
    const schemas = styles.map(style => generateSchema({ ...input, style, features: [...featureKeys] }));
    expect(new Set(schemas.map(schema => schema.theme.primary)).size).toBe(styles.length);
    for (const schema of schemas) expect(schema.features).toEqual(featureKeys);
  });

  it('rejects malformed structures, unknown feature types, and style injection', () => {
    const schema = generateSchema(input);
    const invalid = [
      null,
      {},
      { ...schema, name: '' },
      { ...schema, kind: 'arbitrary-code' },
      { ...schema, features: ['execute-script'] },
      { ...schema, sections: [] },
      { ...schema, theme: { ...schema.theme, primary: 'red; background:url(javascript:alert(1))' } },
      { ...schema, theme: { ...schema.theme, primary: '#fff' } },
      { ...schema, theme: { ...schema.theme, font: 'url(https://untrusted.example)' } },
    ];
    for (const value of invalid) expect(() => validateSchema(value)).toThrow();
  });

  it('removes raw-code properties and duplicate features instead of passing model extras through', () => {
    const schema = generateSchema(input);
    const safe = validateSchema({
      ...schema,
      script: 'alert(1)',
      features: ['contact', 'contact'],
      hero: { ...schema.hero, onclick: 'alert(1)' },
    });
    expect(safe.features).toEqual(['contact']);
    expect(safe).not.toHaveProperty('script');
    expect(safe.hero).not.toHaveProperty('onclick');
  });
});

describe('local conversation editing', () => {
  it('updates color without mutating its input or other fields', () => {
    const schema = generateSchema(input);
    const snapshot = structuredClone(schema);
    const result = editSchema(schema, '파란색으로 바꿔줘');
    expect(result.changed).toBe(true);
    expect(result.schema.theme.primary).not.toBe(schema.theme.primary);
    expect(result.schema.hero).toEqual(schema.hero);
    expect(result.schema.features).toEqual(schema.features);
    expect(result.schema.sections).toEqual(schema.sections);
    expect(schema).toEqual(snapshot);
  });

  it('changes quoted title and CTA text', () => {
    const schema = generateSchema(input);
    const result = editSchema(schema, '제목을 "나만의 도자기를 만드는 시간"으로 바꿔줘, 버튼을 "체험 신청하기"로 바꿔줘');
    expect(result.changed).toBe(true);
    expect(result.schema.hero.title).toBe('나만의 도자기를 만드는 시간');
    expect(result.schema.hero.buttonText).toBe('체험 신청하기');
    expect(result.schema.hero.subtitle).toBe(input.description);
  });

  it('treats words inside quoted replacement text as content rather than edit instructions', () => {
    const schema = generateSchema({ ...input, features: ['contact'] });
    const result = editSchema(schema, '제목을 "파란 달과 예약 이야기"로 바꿔줘');
    expect(result.changed).toBe(true);
    expect(result.schema.hero.title).toBe('파란 달과 예약 이야기');
    expect(result.schema.theme).toEqual(schema.theme);
    expect(result.schema.features).toEqual(schema.features);
  });

  it.each([
    ['버튼 이름을 "문의하기"로 바꿔줘', 'buttonText', '문의하기'],
    ['부제목을 "내 이야기"로 바꿔줘', 'subtitle', '내 이야기'],
    ['작은 제목을 "WELCOME"으로', 'eyebrow', 'WELCOME'],
  ] as const)('targets only the intended field for %s', (prompt, field, value) => {
    const schema = generateSchema(input);
    const result = editSchema(schema, prompt);
    expect(result.changed).toBe(true);
    expect(result.schema).toEqual({ ...schema, hero: { ...schema.hero, [field]: value } });
  });

  it('assigns multiple quoted edits to their distinct intended fields once', () => {
    const schema = generateSchema(input);
    const result = editSchema(schema, '작은 제목을 "HELLO THERE"로, 부제목을 "우리 공방의 새 이야기"로, 버튼 이름을 "문의하기"로 바꿔줘');
    expect(result.schema).toEqual({
      ...schema,
      hero: { ...schema.hero, eyebrow: 'HELLO THERE', subtitle: '우리 공방의 새 이야기', buttonText: '문의하기' },
    });
  });

  it('does not mark an identical trimmed quoted replacement as a new edit', () => {
    const schema = generateSchema(input);
    schema.hero.buttonText = '문의하기';
    const result = editSchema(schema, '버튼 이름을 "  문의하기  "로 바꿔줘');
    expect(result.changed).toBe(false);
    expect(result.schema).toEqual(schema);
  });

  it('adds and removes requested features while preserving the others', () => {
    const schema = generateSchema({ ...input, features: ['contact'] });
    const withBooking = editSchema(schema, '예약 폼 추가해줘');
    expect(withBooking.changed).toBe(true);
    expect(withBooking.schema.features).toEqual(['contact', 'booking']);
    const withFaq = editSchema(withBooking.schema, '자주 묻는 질문 추가해줘');
    expect(withFaq.schema.features).toContain('faq');
    const removed = editSchema(withFaq.schema, '예약 폼 삭제해줘');
    expect(removed.changed).toBe(true);
    expect(removed.schema.features).toEqual(['contact', 'faq']);
  });

  it('does not claim success for an unsupported request', () => {
    const schema = generateSchema(input);
    const result = editSchema(schema, '매주 수요일 고객들에게 문자 메시지를 전송해줘');
    expect(result.changed).toBe(false);
    expect(result.schema).toEqual(schema);
    expect(result.summary).toContain('기본 제작 모드');
  });
});

describe('standalone sandbox renderer', () => {
  it('renders responsive HTML with actual selected form and FAQ components', () => {
    const html = renderAppHtml(generateSchema(input));
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toContain('name="viewport"');
    expect(html).toContain('<form');
    expect(html).toContain('type="date"');
    expect(html).toContain('<details');
    expect(html).toContain(input.name);
    expect(html).toMatch(/기기|브라우저/);
  });

  it('escapes user content in markup and prevents breaking out of the renderer script', () => {
    const schema = generateSchema(input);
    const attack = '</script><script>window.__INJECTED__ = true</script><img src=x onerror=alert(1)>';
    schema.name = attack;
    schema.hero.title = attack;
    schema.hero.subtitle = attack;
    schema.sections[0].title = attack;
    const html = renderAppHtml(schema);
    expect(html).not.toContain('<script>window.__INJECTED__ = true</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).toContain('&lt;');
  });
});

describe('user-authored gallery, FAQ, and review content', () => {
  it('accepts safe uploaded PNG and HTTPS images and retains content through local edits', () => {
    const schema = validateSchema({ ...generateSchema(input), content: customContent });
    expect(schema.content).toEqual(customContent);
    const httpsSchema = validateSchema({
      ...schema,
      content: { ...customContent, gallery: [{ ...customContent.gallery[0], image: 'https://images.example.com/photo.jpg' }] },
    });
    expect(httpsSchema.content?.gallery[0].image).toBe('https://images.example.com/photo.jpg');
    const jpegSchema = validateSchema({
      ...schema,
      content: { ...customContent, gallery: [{ ...customContent.gallery[0], image: tinyJpeg }] },
    });
    expect(jpegSchema.content?.gallery[0].image).toBe(tinyJpeg);
    const edited = editSchema(schema, '파란색으로 바꿔줘');
    expect(edited.changed).toBe(true);
    expect(edited.schema.content).toEqual(customContent);
  });

  it.each([
    { label: 'JavaScript scheme', image: 'javascript:alert(1)' },
    { label: 'insecure HTTP', image: 'http://images.example.com/insecure.jpg' },
    { label: 'SVG payload', image: 'data:image/svg+xml;base64,PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+' },
    { label: 'HTML payload', image: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' },
    { label: 'oversized image', image: `data:image/png;base64,${'A'.repeat(350_001)}` },
  ])('rejects unsafe image content: $label', ({ image }) => {
    expect(() => validateSchema({
      ...generateSchema(input),
      content: { ...customContent, gallery: [{ ...customContent.gallery[0], image }] },
    })).toThrow();
  });

  it('escapes custom content while rendering uploaded images and feature details', () => {
    const attack = '<img src=x onerror="alert(1)">';
    const schema = validateSchema({
      ...generateSchema({ ...input, features: ['gallery', 'faq', 'testimonials'] }),
      content: {
        gallery: [{ title: attack, description: attack, image: tinyPng }],
        faq: [{ question: attack, answer: attack }],
        testimonials: [{ quote: attack, name: attack }],
      },
    });
    const html = renderAppHtml(schema);
    expect(html).toContain(tinyPng);
    expect(html).not.toContain(attack);
    expect(html).toContain('&lt;img');
    expect(html).toContain('id="gallery"');
    expect(html).toContain('id="faq"');
    expect(html).toContain('id="testimonials"');
  });

  it('omits emptied content sections and points navigation and primary actions to remaining sections', () => {
    const schema = validateSchema({
      ...generateSchema({ ...input, features: ['gallery', 'faq', 'testimonials', 'contact'] }),
      content: { gallery: [], faq: [], testimonials: [] },
    });
    const html = renderAppHtml(schema);
    for (const id of ['gallery', 'faq', 'testimonials']) {
      expect(html).not.toContain(`id="${id}"`);
      expect(html).not.toContain(`href="#${id}"`);
    }
    expect(html).toContain('<a class="button" href="#contact">');
    const noInteractiveSections = renderAppHtml({ ...schema, features: ['gallery'] });
    expect(noInteractiveSections).toContain('<a class="button" href="#about">');
  });
});
