import { defaultAppContent, featureLabels, validateSchema } from './schema';
import type { AppSchema, FeatureKey, GenerateInput } from './schema';

const themes: Record<GenerateInput['style'], AppSchema['theme']> = {
  warm: { primary: '#b95e3c', background: '#fcf6ee', font: 'serif', radius: 'soft' },
  minimal: { primary: '#272b32', background: '#fafafa', font: 'modern', radius: 'square' },
  bold: { primary: '#6951d9', background: '#f6f4fe', font: 'modern', radius: 'soft' },
  natural: { primary: '#38644a', background: '#f5f7ef', font: 'serif', radius: 'soft' },
};

export function generateSchema(input: GenerateInput): AppSchema {
  const name = input.name.trim();
  const description = input.description.trim();
  const features = [...input.features];
  const defaults: Record<GenerateInput['kind'], { eyebrow: string; title: string; button: string; sections: AppSchema['sections'] }> = {
    landing: {
      eyebrow: 'A LITTLE IDEA, A BETTER EVERYDAY', title: `${name},\n당신의 일상에 더 가까이`, button: '자세히 알아보기',
      sections: [
        { title: '작은 차이에서 시작해요', description: '익숙한 일상에 새로운 가치를 더합니다. 꼭 필요한 경험을 세심하게 준비했어요.' },
        { title: '당신에게 맞춘 경험', description: '처음 만나는 순간부터 편안하게. 누구나 쉽고 즐겁게 이용할 수 있도록 만들었어요.' },
        { title: '함께 만들어 가는 내일', description: '당신의 이야기에 귀 기울이며, 오래 함께할 수 있는 서비스를 만들어 갑니다.' },
      ],
    },
    booking: {
      eyebrow: 'MAKE TIME FOR YOURSELF', title: `당신만을 위한 시간,\n${name}`, button: '예약 문의하기',
      sections: [
        { title: '오롯이 나에게 집중하는 시간', description: '일상의 속도를 잠시 늦추고 나만의 시간을 만나보세요. 편안한 공간과 세심한 안내가 함께합니다.' },
        { title: '원하는 날짜에 간편하게', description: '아래 예약 폼에서 편한 날짜와 시간을 선택해 주세요. 입력 내용은 이 기기에 저장되며, 운영자에게 자동 전송되지는 않습니다.' },
        { title: '처음이라도 괜찮아요', description: '궁금한 점은 언제든 문의해 주세요. 처음 방문하시는 분도 편안하게 시작하실 수 있어요.' },
      ],
    },
    portfolio: {
      eyebrow: 'SELECTED WORKS & LITTLE STORIES', title: `생각을 담고,\n새로운 장면을 만듭니다`, button: '작업 살펴보기',
      sections: [
        { title: '관찰에서 시작하는 디자인', description: '일상 속 작은 순간에서 영감을 얻고, 쓰는 사람의 경험을 생각하며 작업합니다.' },
        { title: '한 가지 일에 깊이 있게', description: '기획부터 완성까지, 각 프로젝트의 이야기가 잘 드러나도록 세심하게 다듬습니다.' },
        { title: '다음 이야기는 함께', description: '새로운 프로젝트와 협업 제안을 기다립니다. 좋은 생각이 있다면 편하게 들려주세요.' },
      ],
    },
    store: {
      eyebrow: 'THOUGHTFULLY MADE, EVERYDAY LOVED', title: `오래 곁에 두고 싶은,\n${name}`, button: '컬렉션 둘러보기',
      sections: [
        { title: '좋은 것을 고르는 기준', description: '오랫동안 함께할 수 있는 소재와 정성스러운 마감. 매일의 일상을 조금 더 특별하게 만들어 줄 제품을 소개합니다.' },
        { title: '작지만 확실한 취향', description: '자신만의 취향을 발견하는 즐거움을 만나보세요. 하나하나 신중하게 고른 컬렉션을 준비했어요.' },
        { title: '제품이 궁금하다면', description: '아래 문의 폼으로 궁금한 점을 남겨보세요. 온라인 결제는 제공하지 않는 상품 소개 페이지입니다.' },
      ],
    },
  };
  const content = defaults[input.kind];
  return validateSchema({
    name, description, kind: input.kind, theme: themes[input.style] ?? themes.warm,
    hero: { eyebrow: content.eyebrow, title: content.title, subtitle: description, buttonText: content.button },
    features, sections: content.sections, content: defaultAppContent(input.kind),
  });
}

const featurePatterns: Record<FeatureKey, string> = {
  contact: '문의|연락|contact', booking: '예약|booking', gallery: '갤러리|사진|이미지|gallery',
  faq: '자주\\s*묻는\\s*질문|질문\\s*답변|faq', newsletter: '뉴스레터|소식\\s*구독|구독|newsletter',
  testimonials: '고객\\s*후기|후기|리뷰|testimonials',
};

type EditableTextField = 'name' | keyof AppSchema['hero'];

/** Match each complete target once so a button name cannot also become the app name. */
function quotedEdits(prompt: string): Partial<Record<EditableTextField, string>> {
  const targets: { field: EditableTextField; pattern: string }[] = [
    { field: 'buttonText', pattern: '버튼(?:의)?(?:\\s*(?:이름|텍스트|문구|내용))?|CTA(?:\\s*(?:버튼|이름|텍스트|문구|내용))?' },
    { field: 'eyebrow', pattern: '상단\\s*문구|영문\\s*문구|작은\\s*제목' },
    { field: 'subtitle', pattern: '부\\s*제목|서브\\s*타이틀|소개|설명' },
    { field: 'title', pattern: '(?:메인\\s*)?(?:제목|타이틀|헤드라인)' },
    { field: 'name', pattern: '(?:서비스|앱|브랜드)(?:의)?\\s*이름|이름' },
  ];
  const labels = targets.map(target => `(?:${target.pattern})`).join('|');
  // The left boundary prevents 제목 from matching the suffix of 부제목. Specific
  // targets are consumed before their generic suffixes are considered.
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_])(${labels})(?:을|를|은|는|이|가|의|\\s)*(?:텍스트|문구|내용)?(?:을|를|는|은|\\s)*(?:"([^\"]{1,4000})"|'([^']{1,4000})'|“([^”]{1,4000})”|‘([^’]{1,4000})’)`, 'giu');
  const edits: Partial<Record<EditableTextField, string>> = {};
  for (const match of prompt.matchAll(pattern)) {
    const target = targets.find(item => new RegExp(`^(?:${item.pattern})$`, 'iu').test(match[1]));
    const value = (match[2] ?? match[3] ?? match[4] ?? match[5])?.trim();
    if (target && value) edits[target.field] = value;
  }
  return edits;
}

/** An honest local editor: only supported, deterministic edits are reported as applied. */
export function editSchema(original: AppSchema, prompt: string): { schema: AppSchema; summary: string; changed: boolean } {
  const schema = validateSchema(original);
  const initialState = JSON.stringify(schema);
  const changes: string[] = [];
  const input = prompt.trim();
  const intent = input.replace(/“[^”]*”|‘[^’]*’|"[^"]*"|'[^']*'/g, '');

  for (const [feature, pattern] of Object.entries(featurePatterns) as [FeatureKey, string][]) {
    const matched = new RegExp(`(?:${pattern})([^,。.\\n]{0,30})`, 'i').exec(intent);
    if (!matched) continue;
    const tail = matched[1];
    const remove = /제거|삭제|없애|빼\s*줘|빼고|remove|delete/i.test(tail);
    const add = /추가|넣|만들|보여|생성|add|include/i.test(tail) || /추가|넣|만들|생성|add|include/i.test(intent);
    if (remove && schema.features.includes(feature)) {
      schema.features = schema.features.filter(value => value !== feature);
      changes.push(`${featureLabels[feature]} 제거`);
    } else if (!remove && add && !schema.features.includes(feature)) {
      schema.features.push(feature);
      changes.push(`${featureLabels[feature]} 추가`);
    }
  }

  const colors: [RegExp, string, string][] = [
    [/파란|파랑|블루|blue/i, '#3e67c8', '파란색'], [/초록|녹색|그린|green/i, '#38644a', '초록색'],
    [/보라|퍼플|purple/i, '#7958c7', '보라색'], [/빨간|빨강|레드|red/i, '#b84242', '빨간색'],
    [/주황|오렌지|orange/i, '#c56d36', '주황색'], [/분홍|핑크|pink/i, '#c06585', '분홍색'],
    [/검정|검은|블랙|black/i, '#272b32', '검정색'], [/노란|노랑|yellow/i, '#a17b19', '노란색'],
    [/갈색|브라운|brown/i, '#89634a', '갈색'],
  ];
  const hex = intent.match(/#[0-9a-f]{6}\b/i)?.[0];
  const named = colors.find(([pattern]) => pattern.test(intent));
  if (hex || named) {
    const chosen = hex ?? named![1];
    if (/배경/.test(intent) && !/버튼|포인트|테마|전체/.test(intent)) {
      if (schema.theme.background !== chosen) { schema.theme.background = chosen; changes.push('배경 색상 변경'); }
    } else if (schema.theme.primary !== chosen) {
      schema.theme.primary = chosen;
      changes.push(`포인트 색상을 ${hex ?? named![2]}으로 변경`);
    }
  }

  const style: GenerateInput['style'] | undefined = /파스텔|따뜻|웜|warm/i.test(intent) ? 'warm'
    : /미니멀|심플|깔끔|minimal/i.test(intent) ? 'minimal'
    : /자연|내추럴|natural/i.test(intent) ? 'natural'
    : /대담|화려|강렬|bold/i.test(intent) ? 'bold' : undefined;
  if (style && !hex && !named) {
    const nextTheme = themes[style];
    if (JSON.stringify(schema.theme) !== JSON.stringify(nextTheme)) {
      schema.theme = { ...nextTheme };
      changes.push('디자인 분위기 변경');
    }
  }
  if (/둥글|라운드|rounded/i.test(intent) && schema.theme.radius !== 'soft') {
    schema.theme.radius = 'soft'; changes.push('모서리를 둥글게 변경');
  }
  if (/각진|직각|square/i.test(intent) && schema.theme.radius !== 'square') {
    schema.theme.radius = 'square'; changes.push('모서리를 직각으로 변경');
  }
  if (/고딕|산세리프|sans|모던.*글꼴/i.test(intent)) {
    if (schema.theme.font !== 'modern') { schema.theme.font = 'modern'; changes.push('제목 글꼴을 고딕체로 변경'); }
  } else if (/명조|세리프|serif/i.test(intent) && schema.theme.font !== 'serif') {
    schema.theme.font = 'serif'; changes.push('제목 글꼴을 명조체로 변경');
  }
  const edits = quotedEdits(input);
  const values: [string | undefined, keyof AppSchema['hero'], string, number][] = [
    [edits.buttonText, 'buttonText', '버튼 문구 변경', 80],
    [edits.title, 'title', '메인 제목 변경', 300],
    [edits.subtitle, 'subtitle', '소개 문구 변경', 2000],
    [edits.eyebrow, 'eyebrow', '상단 문구 변경', 120],
  ];
  for (const [value, key, label, limit] of values) {
    const replacement = value?.slice(0, limit).trim();
    if (replacement && schema.hero[key] !== replacement) {
      schema.hero[key] = replacement;
      changes.push(label);
    }
  }
  const name = edits.name?.slice(0, 100).trim();
  if (name && schema.name !== name) { schema.name = name; changes.push('서비스 이름 변경'); }

  const result = validateSchema(schema);
  const changed = JSON.stringify(result) !== initialState;
  return {
    schema: result, changed,
    summary: changed ? `${changes.join(', ')}을 반영했어요. 미리보기에서 확인해 보세요. 이전 버전으로 언제든 돌아갈 수 있어요.`
      : '기본 제작 모드에서 바로 바꿀 수 있는 항목은 색상, 디자인 분위기, 제목·버튼 문구, 문의·예약·갤러리·FAQ·구독·후기 기능이에요. 예: “파란색으로 바꿔줘”, “버튼을 \'문의하기\'로 바꿔줘”, “예약 폼 추가해줘”. 자유로운 요청은 설정에서 AI를 연결하면 사용할 수 있어요.',
  };
}
