import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ChevronDown, ImagePlus, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import { defaultAppContent, type AppContent, type AppSchema } from '../lib/schema';

interface ContentEditorProps {
  schema: AppSchema;
  onChange: (schema: AppSchema) => void;
  onError?: (message: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

const isWebImage = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
};
const canPreview = (value: string) => value.startsWith('data:image/') || isWebImage(value);

async function preparePhoto(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('JPG, PNG, WebP 사진을 선택해 주세요.');
  }
  if (file.size > 10 * 1024 * 1024) throw new Error('사진 한 장은 10MB 이하로 선택해 주세요.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('사진을 읽지 못했어요. 다른 사진으로 다시 시도해 주세요.'));
      element.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 100_000_000) {
      throw new Error('사진 크기가 너무 커요. 작은 사진을 선택해 주세요.');
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1280 / Math.max(image.naturalWidth, image.naturalHeight));
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이 브라우저에서 사진을 준비하지 못했어요. 다른 브라우저로 시도해 주세요.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.72, 0.6, 0.45]) {
      const encoded = canvas.toDataURL('image/jpeg', quality);
      if (encoded.startsWith('data:image/jpeg;base64,') && encoded.length <= 300_000) return encoded;
    }
    // Detailed photographs can remain large even at lower quality. Reduce the
    // dimensions once more so the saved app remains easy to download and open.
    const smaller = document.createElement('canvas');
    smaller.width = Math.max(1, Math.round(canvas.width * 0.6));
    smaller.height = Math.max(1, Math.round(canvas.height * 0.6));
    const smallContext = smaller.getContext('2d');
    if (!smallContext) throw new Error('사진을 준비하지 못했어요. 다시 시도해 주세요.');
    smallContext.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    const encoded = smaller.toDataURL('image/jpeg', 0.6);
    if (!encoded.startsWith('data:image/jpeg;base64,') || encoded.length > 300_000) {
      throw new Error('사진이 너무 복잡해 줄이지 못했어요. 크기를 줄이거나 다른 사진을 선택해 주세요.');
    }
    return encoded;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Content controls live inside the shared edit dialog; the dialog owns saving. */
export default function ContentEditor({ schema, onChange, onError, onBusyChange }: ContentEditorProps) {
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState<number | null>(null);
  const current = useRef(schema);
  const alive = useRef(true);
  current.current = schema;
  const content = schema.content ?? defaultAppContent(schema.kind);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const fail = (message: string) => {
    setError(message);
    onError?.(message);
  };
  const update = (key: keyof AppContent, items: AppContent[keyof AppContent]) => {
    const latest = current.current;
    const next = { ...(latest.content ?? defaultAppContent(latest.kind)), [key]: items } as AppContent;
    onChange({ ...latest, content: next });
  };
  const gallery = (index: number, field: keyof AppContent['gallery'][number], value: string) => {
    const items = (current.current.content ?? defaultAppContent(current.current.kind)).gallery;
    update('gallery', items.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };
  const faq = (index: number, field: keyof AppContent['faq'][number], value: string) => {
    update('faq', content.faq.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };
  const testimonial = (index: number, field: keyof AppContent['testimonials'][number], value: string) => {
    update('testimonials', content.testimonials.map((item, i) => i === index ? { ...item, [field]: value } : item));
  };
  const upload = async (index: number, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || uploading !== null) return;
    setError('');
    setUploading(index);
    onBusyChange?.(true);
    try {
      const encoded = await preparePhoto(file);
      if (alive.current) gallery(index, 'image', encoded);
    } catch (reason) {
      if (alive.current) fail(reason instanceof Error ? reason.message : '사진을 준비하지 못했어요. 다시 시도해 주세요.');
    } finally {
      if (alive.current) setUploading(null);
      onBusyChange?.(false);
    }
  };

  return <div className="content-editor">
    {schema.features.includes('gallery') && <details className="edit-details">
      <summary>갤러리 사진과 설명 수정 <ChevronDown size={15} /></summary>
      <p className="content-editor-note">내 사진을 올리거나 사진 주소를 넣어주세요. 올린 사진은 앱 파일에 함께 담겨요.</p>
      {content.gallery.map((item, index) => <div className="section-edit" key={index}>
        <div><span>갤러리 {index + 1}</span><button className="icon-button" type="button" aria-label={`갤러리 ${index + 1} 삭제`} disabled={uploading !== null} onClick={() => update('gallery', content.gallery.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>
        <div className="content-image-upload">
          {canPreview(item.image) && <div className="content-image-preview"><img src={item.image} alt={`${item.title} 사진`} referrerPolicy="no-referrer" /><button className="icon-button" type="button" aria-label={`갤러리 ${index + 1} 사진 제거`} disabled={uploading !== null} onClick={() => gallery(index, 'image', '')}><X size={14} /></button></div>}
          <label className={`button secondary content-upload-label ${uploading !== null ? 'is-busy' : ''}`}>
            {uploading === index ? <LoaderCircle className="spin" size={15} /> : <ImagePlus size={15} />}
            {uploading === index ? '사진을 준비하고 있어요…' : '내 사진 올리기'}
            <input className="sr-only" aria-label={`갤러리 ${index + 1} 사진 올리기`} type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading !== null} onChange={event => void upload(index, event)} />
          </label>
          <span className="content-image-hint">JPG · PNG · WebP, 최대 10MB</span>
        </div>
        <label className="field-label">또는 사진 주소<input aria-label={`갤러리 ${index + 1} 사진 주소`} type="url" value={item.image.startsWith('data:') ? '' : item.image} placeholder={item.image.startsWith('data:') ? '올린 사진을 사용하고 있어요' : 'https://로 시작하는 사진 주소'} maxLength={2000} disabled={uploading !== null} onChange={event => gallery(index, 'image', event.target.value.trim())} onBlur={() => { if (item.image && !item.image.startsWith('data:') && !isWebImage(item.image)) fail('사진 주소는 https://로 시작해야 해요. 주소를 고치거나 내 사진을 올려주세요.'); }} /></label>
        <label className="field-label">사진 제목<input aria-label={`갤러리 ${index + 1} 제목`} value={item.title} maxLength={120} onChange={event => gallery(index, 'title', event.target.value)} /></label>
        <label className="field-label">사진 설명<textarea aria-label={`갤러리 ${index + 1} 설명`} rows={2} value={item.description} maxLength={500} onChange={event => gallery(index, 'description', event.target.value)} /></label>
      </div>)}
      <button className="button secondary full-width" type="button" disabled={content.gallery.length >= 6 || uploading !== null} onClick={() => update('gallery', [...content.gallery, { title: '새로운 순간', description: '사진에 담긴 이야기를 소개해 주세요.', image: '' }])}><Plus size={15} />갤러리 추가</button>
      {!content.gallery.length && <p className="content-editor-note">사진을 추가하면 미리보기에 갤러리가 나타나요.</p>}
    </details>}

    {schema.features.includes('faq') && <details className="edit-details">
      <summary>자주 묻는 질문 수정 <ChevronDown size={15} /></summary>
      <p className="content-editor-note">방문자가 궁금해할 질문과 실제 서비스에 맞는 답변을 적어주세요.</p>
      {content.faq.map((item, index) => <div className="section-edit" key={index}>
        <div><span>질문과 답변 {index + 1}</span><button className="icon-button" type="button" aria-label={`질문 ${index + 1} 삭제`} onClick={() => update('faq', content.faq.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>
        <label className="field-label">질문<input aria-label={`질문 ${index + 1}`} value={item.question} maxLength={120} onChange={event => faq(index, 'question', event.target.value)} /></label>
        <label className="field-label">답변<textarea aria-label={`답변 ${index + 1}`} rows={3} value={item.answer} maxLength={1500} onChange={event => faq(index, 'answer', event.target.value)} /></label>
      </div>)}
      <button className="button secondary full-width" type="button" disabled={content.faq.length >= 10} onClick={() => update('faq', [...content.faq, { question: '어떤 점이 궁금하신가요?', answer: '방문자에게 알려드릴 내용을 적어주세요.' }])}><Plus size={15} />질문과 답변 추가</button>
    </details>}

    {schema.features.includes('testimonials') && <details className="edit-details">
      <summary>고객 후기 수정 <ChevronDown size={15} /></summary>
      <p className="content-editor-note">예시를 실제 고객이 남긴 후기로 바꿔주세요. 이름은 공개 동의를 받은 범위로 적어주세요.</p>
      {content.testimonials.map((item, index) => <div className="section-edit" key={index}>
        <div><span>고객 후기 {index + 1}</span><button className="icon-button" type="button" aria-label={`후기 ${index + 1} 삭제`} onClick={() => update('testimonials', content.testimonials.filter((_, i) => i !== index))}><Trash2 size={14} /></button></div>
        <label className="field-label">후기 내용<textarea aria-label={`후기 ${index + 1} 내용`} rows={3} value={item.quote} maxLength={1000} onChange={event => testimonial(index, 'quote', event.target.value)} /></label>
        <label className="field-label">고객 이름<input aria-label={`후기 ${index + 1} 이름`} value={item.name} maxLength={80} onChange={event => testimonial(index, 'name', event.target.value)} /></label>
      </div>)}
      <button className="button secondary full-width" type="button" disabled={content.testimonials.length >= 6} onClick={() => update('testimonials', [...content.testimonials, { quote: '실제 고객의 후기를 적어주세요.', name: '고객 이름' }])}><Plus size={15} />고객 후기 추가</button>
    </details>}
    {error && <div className="form-error" role="alert">{error}<button type="button" className="icon-button" aria-label="사진 안내 닫기" onClick={() => setError('')}><X size={14} /></button></div>}
  </div>;
}
