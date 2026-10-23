export const featureKeys = ['contact', 'booking', 'gallery', 'faq', 'newsletter', 'testimonials'] as const;
export type FeatureKey = typeof featureKeys[number];
export type AppKind = 'landing' | 'booking' | 'portfolio' | 'store';

export interface AppContent {
  gallery: { title: string; description: string; image: string }[];
  faq: { question: string; answer: string }[];
  testimonials: { quote: string; name: string }[];
}

export interface AppSchema {
  name: string;
  description: string;
  kind: AppKind;
  theme: {
    primary: string;
    background: string;
    font: 'modern' | 'serif';
    radius: 'soft' | 'square';
  };
  hero: { eyebrow: string; title: string; subtitle: string; buttonText: string };
  features: FeatureKey[];
  sections: { title: string; description: string }[];
  content?: AppContent;
}

export interface GenerateInput {
  name: string;
  description: string;
  kind: AppKind;
  style: 'warm' | 'minimal' | 'bold' | 'natural';
  features: FeatureKey[];
}

export interface AppVersion {
  id: string;
  label: string;
  createdAt: string;
  schema: AppSchema;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  kind: AppKind;
  schema: AppSchema;
  createdAt: string;
  updatedAt: string;
  versions: AppVersion[];
  messages: ChatMessage[];
  publishedVersionId?: string;
  publishedSlug?: string;
}

export const featureLabels: Record<FeatureKey, string> = {
  contact: '문의 폼', booking: '예약 폼', gallery: '이미지 갤러리',
  faq: '자주 묻는 질문', newsletter: '소식 구독', testimonials: '고객 후기',
};

export const kindLabels: Record<AppKind, string> = {
  landing: '브랜드 소개', booking: '예약 서비스', portfolio: '포트폴리오', store: '상품 소개',
};

/** Fresh editable defaults for old projects and newly created apps. */
export function defaultAppContent(kind: AppKind): AppContent {
  const gallery: Record<AppKind, AppContent['gallery']> = {
    landing: [
      { title: '매일의 작은 발견', description: '서비스의 특별한 순간과 이야기를 소개해 주세요.', image: '' },
      { title: '새로운 시선으로', description: '고객에게 전하고 싶은 가치를 담아 주세요.', image: '' },
      { title: '오래 머무는 마음', description: '함께 만들어 갈 경험을 소개해 주세요.', image: '' },
    ],
    booking: [
      { title: '편안한 공간', description: '방문할 공간의 사진과 소개를 담아 주세요.', image: '' },
      { title: '나에게 맞는 경험', description: '예약할 수 있는 프로그램을 소개해 주세요.', image: '' },
      { title: '함께하는 시간', description: '진행 과정이나 준비물을 안내해 주세요.', image: '' },
    ],
    portfolio: [
      { title: '브랜드 프로젝트', description: '작업의 의도와 결과를 소개해 주세요.', image: '' },
      { title: '새로운 시도', description: '프로젝트에서 맡은 역할과 과정을 담아 주세요.', image: '' },
      { title: '일상 속 영감', description: '나만의 관점과 작업 이야기를 보여 주세요.', image: '' },
    ],
    store: [
      { title: '첫 번째 컬렉션', description: '제품의 소재와 특징을 소개해 주세요.', image: '' },
      { title: '일상의 작은 취향', description: '제품의 활용 방법과 매력을 담아 주세요.', image: '' },
      { title: '오래 함께할 물건', description: '제품 사진과 관리 방법을 안내해 주세요.', image: '' },
    ],
  };
  return {
    gallery: gallery[kind].map(item => ({ ...item })),
    faq: [
      { question: '처음 이용하는데 괜찮을까요?', answer: '처음 방문하시는 분도 편하게 둘러보실 수 있도록 준비했어요. 운영을 시작하기 전에 실제 이용 방법에 맞게 이 답변을 수정해 주세요.' },
      { question: '더 자세한 내용을 알고 싶어요.', answer: '위의 서비스 소개와 안내를 확인해 주세요. 궁금한 점은 안내된 연락처로 문의해 주세요.' },
      { question: '문의와 예약 정보는 어디에 저장되나요?', answer: '현재 폼은 체험용입니다. 이 브라우저에만 저장되고 운영자에게 전송되지 않아요. 실제 접수를 받으려면 별도의 폼 또는 예약 서비스를 연결해 주세요.' },
    ],
    testimonials: [
      { quote: '예시 후기: 처음부터 끝까지 편안한 경험이었어요. 이 문구를 실제 고객의 후기로 교체해 주세요.', name: '예시 고객 1' },
      { quote: '예시 후기: 일상에 좋은 영감을 더해준 만남이었어요. 이 문구를 실제 고객의 후기로 교체해 주세요.', name: '예시 고객 2' },
    ],
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('앱 설정은 객체여야 합니다.');
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max = 2000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return value.trim();
}

function oneOf<T extends string>(value: unknown, list: readonly T[], label: string): T {
  if (typeof value !== 'string' || !list.includes(value as T)) throw new Error(`${label} 값이 올바르지 않습니다.`);
  return value as T;
}

function color(value: unknown): string {
  if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error('색상은 6자리 HEX 값이어야 합니다.');
  return value.toLowerCase();
}

function imageSource(value: unknown): string {
  if (typeof value !== 'string' || value.length > 350000) throw new Error('이미지는 350,000자 이하의 안전한 이미지 주소여야 합니다.');
  const image = value.trim();
  if (!image) return '';
  if (/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(image)) {
    const payload = image.slice(image.indexOf(',') + 1);
    if (payload.length % 4 === 0) return image;
    throw new Error('이미지 데이터 형식이 올바르지 않습니다.');
  }
  try {
    const url = new URL(image);
    if (url.protocol === 'https:' && url.hostname && !url.username && !url.password) return url.href;
  } catch { /* Report one safe validation error below. */ }
  throw new Error('이미지는 HTTPS 주소 또는 JPEG·PNG·WebP 이미지 데이터만 사용할 수 있습니다.');
}

function validateContent(value: unknown): AppContent {
  const content = record(value);
  if (!Array.isArray(content.gallery) || content.gallery.length > 6) throw new Error('갤러리 항목은 6개 이하여야 합니다.');
  if (!Array.isArray(content.faq) || content.faq.length > 10) throw new Error('자주 묻는 질문은 10개 이하여야 합니다.');
  if (!Array.isArray(content.testimonials) || content.testimonials.length > 6) throw new Error('후기는 6개 이하여야 합니다.');
  return {
    gallery: content.gallery.map(value => {
      const item = record(value);
      if (typeof item.description !== 'string' || item.description.length > 500) throw new Error('갤러리 설명은 500자 이하여야 합니다.');
      return { title: text(item.title, '갤러리 제목', 120), description: item.description.trim(), image: imageSource(item.image) };
    }),
    faq: content.faq.map(value => {
      const item = record(value);
      return { question: text(item.question, '질문', 120), answer: text(item.answer, '답변', 1500) };
    }),
    testimonials: content.testimonials.map(value => {
      const item = record(value);
      return { quote: text(item.quote, '후기 내용', 1000), name: text(item.name, '후기 작성자', 80) };
    }),
  };
}

/** Reconstruct a safe data-only schema; never pass raw model objects into the renderer. */
export function validateSchema(value: unknown): AppSchema {
  const schema = record(value);
  const theme = record(schema.theme);
  const hero = record(schema.hero);
  if (!Array.isArray(schema.features) || schema.features.length > featureKeys.length) throw new Error('기능 목록 형식이 올바르지 않습니다.');
  if (!Array.isArray(schema.sections) || schema.sections.length < 1 || schema.sections.length > 8) throw new Error('소개 영역은 1개 이상 8개 이하여야 합니다.');
  return {
    name: text(schema.name, '이름', 100),
    description: text(schema.description, '설명', 4000),
    kind: oneOf(schema.kind, ['landing', 'booking', 'portfolio', 'store'], '앱 종류'),
    theme: {
      primary: color(theme.primary), background: color(theme.background),
      font: oneOf(theme.font, ['modern', 'serif'], '글꼴'),
      radius: oneOf(theme.radius, ['soft', 'square'], '모서리'),
    },
    hero: {
      eyebrow: text(hero.eyebrow, '상단 문구', 120), title: text(hero.title, '제목', 300),
      subtitle: text(hero.subtitle, '소개 문구', 2000), buttonText: text(hero.buttonText, '버튼 문구', 80),
    },
    features: [...new Set(schema.features.map(feature => oneOf(feature, featureKeys, '기능')))],
    sections: schema.sections.map(section => {
      const item = record(section);
      return { title: text(item.title, '영역 제목', 200), description: text(item.description, '영역 설명', 2000) };
    }),
    ...(schema.content === undefined ? {} : { content: validateContent(schema.content) }),
  };
}
