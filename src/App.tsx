import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, BookOpen,
  CalendarDays, Check, CheckCheck, CheckCircle2, ChevronDown, ChevronRight,
  CircleHelp, Clock3, Code2, Coffee, Copy, ExternalLink, Flower2, FolderOpen,
  Globe2, Grid2X2, Heart, History, LayoutDashboard, LayoutTemplate, LoaderCircle,
  Menu, MessageCircle, Monitor, MoreHorizontal, MousePointer2, Palette, Plus,
  Rocket, Search, Settings2, ShieldCheck, Smartphone, Sparkles, Star, Trash2,
  WandSparkles, Workflow, X, Zap,
} from 'lucide-react';
import { api, type CheckResult, type RuntimeStatus } from './api';
import type { AppSchema, FeatureKey, GenerateInput, Project } from './lib/schema';
import { renderAppHtml } from './lib/renderer';
import { validateSchema } from './lib/schema';
import ContentEditor from './components/ContentEditor';
import { restoreDraft } from './lib/draft';
import { isPortable } from './offline/mode';

type View = 'home' | 'projects' | 'templates' | 'automation' | 'guide' | 'editor';
type Template = { name:string; description:string; kind:GenerateInput['kind']; style:GenerateInput['style']; features:FeatureKey[]; category:string; tag:string };
const templates:Template[] = [
  {name:'온기 커피',description:'따뜻한 감성의 동네 카페. 메뉴를 소개하고 방문 예약을 받는 공간을 만들어 주세요.',kind:'booking',style:'warm',features:['booking','gallery','contact'],category:'매장 · 예약',tag:'가장 많이 선택해요'},
  {name:'스튜디오 모아',description:'나만의 작업과 이야기를 담은 디자이너 포트폴리오를 만들어 주세요.',kind:'portfolio',style:'natural',features:['gallery','contact'],category:'포트폴리오',tag:'나를 보여주는 공간'},
  {name:'작은 아이디어, 큰 시작',description:'새로운 서비스의 가치를 알리고 관심 있는 사람들의 소식을 받아보는 페이지를 만들어 주세요.',kind:'landing',style:'bold',features:['newsletter','faq','testimonials'],category:'서비스 소개',tag:'아이디어를 현실로'},
  {name:'소소한 취향',description:'직접 만든 소품을 소개하는 감각적인 브랜드 카탈로그를 만들어 주세요. 결제 없이 상품 문의를 받고 싶어요.',kind:'store',style:'minimal',features:['gallery','contact','faq'],category:'상품 소개',tag:'우리 브랜드의 첫 시작'},
];
const featureInfo:{key:FeatureKey;name:string;desc:string;icon:typeof CalendarDays}[] = [
  {key:'booking',name:'예약 요청',desc:'방문 날짜와 시간을 간편하게',icon:CalendarDays},
  {key:'contact',name:'문의 양식',desc:'고객의 이야기를 듣는 창구',icon:MessageCircle},
  {key:'gallery',name:'이미지 갤러리',desc:'사진과 작업을 보기 좋게',icon:Grid2X2},
  {key:'faq',name:'자주 묻는 질문',desc:'궁금한 점을 미리 해결해요',icon:CircleHelp},
  {key:'newsletter',name:'소식 받기',desc:'이메일 구독 신청 양식',icon:Heart},
  {key:'testimonials',name:'고객 후기',desc:'신뢰를 더하는 후기 영역',icon:Star},
];
const kinds = [
  {key:'landing',name:'서비스 소개',desc:'아이디어를 매력적인 페이지로',icon:Rocket},
  {key:'booking',name:'매장 · 예약',desc:'우리 가게만의 온라인 공간',icon:Coffee},
  {key:'portfolio',name:'포트폴리오',desc:'나와 나의 작업을 소개해요',icon:Palette},
  {key:'store',name:'상품 소개',desc:'브랜드와 상품을 한눈에',icon:FolderOpen},
] as const;
const styleInfo = [
  {key:'warm',name:'따뜻하고 편안한',color:'#be7956',bg:'#f4e9da',sub:'포근한 색감과 부드러운 분위기'},
  {key:'minimal',name:'깔끔하고 세련된',color:'#252a32',bg:'#f0f1f3',sub:'꼭 필요한 것만, 군더더기 없이'},
  {key:'natural',name:'자연스럽고 감각적인',color:'#557a63',bg:'#e7eddf',sub:'차분한 초록빛과 여유로운 구성'},
  {key:'bold',name:'눈에 띄고 개성 있는',color:'#6355cb',bg:'#eeebfa',sub:'대담한 색과 또렷한 메시지'},
] as const;
const titles:Record<View,string> = {home:'대시보드',projects:'내 프로젝트',templates:'템플릿 둘러보기',automation:'자동화 도우미',guide:'시작 가이드',editor:'제작 스튜디오'};
function getRoute():{view:View;id?:string} {
  const [page,id] = window.location.hash.slice(1).split('/');
  return {view:Object.hasOwn(titles,page) ? page as View : 'home',id};
}
function timeAgo(value:string) {
  const diff = Date.now()-new Date(value).getTime();
  if(diff<60000) return '방금 전';
  if(diff<3600000) return `${Math.floor(diff/60000)}분 전`;
  if(diff<86400000) return `${Math.floor(diff/3600000)}시간 전`;
  return new Date(value).toLocaleDateString('ko-KR');
}
function Logo({small=false}:{small?:boolean}) {return <div className={`brand ${small?'brand-small':''}`}><span className="brand-mark"><Zap size={23} fill="currentColor" strokeWidth={1.7}/></span><span>무엇이든 <strong>뚝딱</strong><span className="brand-period">.</span></span></div>;}
function IconButton({children,label,onClick,disabled=false,className=''}:{children:ReactNode;label:string;onClick:()=>void;disabled?:boolean;className?:string}) {return <button type="button" className={`icon-button ${className}`} title={label} aria-label={label} onClick={onClick} disabled={disabled}>{children}</button>;}
function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}) {
  const root = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(()=>{
    const previous = document.activeElement as HTMLElement|null;
    root.current?.focus();
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape') closeRef.current();
      if(e.key==='Tab') {
        const els=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, textarea, select, a[href], [tabindex="0"]')||[]);
        if(!els.length)return;
        if(e.shiftKey&&document.activeElement===els[0]) {e.preventDefault();els.at(-1)?.focus();}
        else if(!e.shiftKey&&document.activeElement===els.at(-1)) {e.preventDefault();els[0].focus();}
      }
    };
    document.addEventListener('keydown',key);
    const overflow=document.body.style.overflow; document.body.style.overflow='hidden';
    return ()=>{document.removeEventListener('keydown',key);document.body.style.overflow=overflow;previous?.focus();};
  },[]);
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} className={`modal ${wide?'modal-wide':''}`}><div className="modal-title"><div><span className="eyebrow">DDUKTTAK STUDIO</span><h2>{title}</h2></div><IconButton label="닫기" onClick={onClose}><X size={20}/></IconButton></div>{children}</div></div>;
}

function TemplateCover({kind,name,compact=false}:{kind:GenerateInput['kind'];name:string;compact?:boolean}) {
  return <div className={`template-cover cover-${kind} ${compact?'compact':''}`} aria-hidden="true">
    <div className="cover-window"><div className="cover-nav"><span className="cover-name">{name}</span><span>About &nbsp; {kind==='booking'?'Menu':'Works'} &nbsp; Contact</span><span className="cover-nav-button">{kind==='booking'?'예약하기':'시작하기'} ↗</span></div>
      {kind==='booking'?<div className="cafe-scene"><div className="cafe-copy"><span>A LITTLE MOMENT OF WARMTH</span><h3>커피 한 잔,<br/>당신을 위한 쉼.</h3><p>일상의 작은 여유가 시작되는 곳</p><i>우리 공간 둘러보기 ↗</i></div><div className="coffee-art"><div className="coffee-shadow"/><div className="coffee-saucer"/><div className="coffee-handle"/><div className="coffee-cup"><div className="coffee-surface"><span>♡</span></div></div><div className="coffee-bean bean-one"/><div className="coffee-bean bean-two"/><div className="coffee-leaf"/></div></div>
      :kind==='portfolio'?<div className="portfolio-scene"><span>DESIGNER & CREATIVE THINKER</span><h3>좋은 생각을,<br/><em>더 좋은 경험으로.</em></h3><div className="art-collection"><div className="art-poster"><span>moa<br/>studio.</span><Flower2 size={60} strokeWidth={1}/></div><div className="art-orb"><div/><span>Objects of everyday</span></div></div><div className="portfolio-caption">Selected works, 2026 <ArrowDownToLine size={10}/></div></div>
      :kind==='landing'?<div className="landing-scene"><span>MAKE ROOM FOR YOUR NEXT BIG IDEA</span><h3>작은 시작이 만드는<br/><em>무한한 가능성.</em></h3><div className="mini-cta">새로운 시작 함께하기 ↗</div><div className="landing-shapes"><div className="shape-ring"/><div className="shape-block"/><Sparkles size={42}/></div></div>
      :<div className="store-scene"><span>SMALL THINGS, EVERYDAY JOY</span><h3>일상에 스며드는<br/>작고 좋은 취향.</h3><div className="product-art"><div className="vase vase-one"/><div className="vase vase-two"/><div className="product-label">소소한 취향 · collection 01</div></div></div>}
    </div>
  </div>;
}

export default function App() {
  const [route,setRoute]=useState(getRoute);
  const [projects,setProjects]=useState<Project[]>([]);
  const [status,setStatus]=useState<RuntimeStatus|null>(null);
  const [loading,setLoading]=useState(true);
  const [loadError,setLoadError]=useState('');
  const [wizard,setWizard]=useState<GenerateInput|null>(null);
  const [wizardStep,setWizardStep]=useState(0);
  const [toast,setToast]=useState('');
  const [help,setHelp]=useState(false);
  const [mobileNav,setMobileNav]=useState(false);
  const [prompt,setPrompt]=useState('');
  const [filter,setFilter]=useState('전체');
  const [search,setSearch]=useState('');
  const [deleteProject,setDeleteProject]=useState<Project|null>(null);
  const [deleting,setDeleting]=useState(false);
  const notify=(message:string)=>setToast(message);
  const load=async()=>{
    setLoading(true);setLoadError('');
    try {const [list,current]=await Promise.all([api.list(),api.status()]);setProjects(list);setStatus(current);}
    catch(e){setLoadError((e as Error).message);}finally{setLoading(false);}
  };
  useEffect(()=>{void load();const change=()=>{setRoute(getRoute());setMobileNav(false);window.scrollTo(0,0);};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  useEffect(()=>{if(toast){const id=window.setTimeout(()=>setToast(''),4500);return()=>clearTimeout(id);}},[toast]);
  useEffect(()=>{setSearch('');setFilter('전체');},[route.view]);
  const go=(view:View,id?:string)=>{window.location.hash=id?`${view}/${id}`:view;};
  const updateProject=(p:Project)=>setProjects(prev=>[p,...prev.filter(x=>x.id!==p.id)]);
  const start=(template?:Template,description?:string)=>{
    let restored=restoreDraft(null,null);
    if(!template&&!description) {
      try {
        const raw=localStorage.getItem('ddukttak-draft');
        restored=restoreDraft(raw,localStorage.getItem('ddukttak-draft-step'));
        if(restored.recovered&&raw!==null&&!localStorage.getItem('ddukttak-draft-recovery')) {
          localStorage.setItem('ddukttak-draft-recovery',raw);
        }
      } catch {/* creation also works when browser storage is unavailable */}
    }
    setWizardStep(template||description?0:restored.step);
    setWizard(template?{name:template.name,description:template.description,kind:template.kind,style:template.style,features:[...template.features]}:description?{...restored.input,description}:restored.input);
    if(restored.recovered)notify('임시 초안을 확인하고, 사용할 수 있는 답변을 복원했어요.');
  };
  const current=projects.find(p=>p.id===route.id);
  const navItems=[{view:'home' as View,label:'대시보드',icon:LayoutDashboard},{view:'projects' as View,label:'내 프로젝트',icon:FolderOpen},{view:'templates' as View,label:'템플릿 둘러보기',icon:LayoutTemplate},{view:'automation' as View,label:'자동화 도우미',icon:Workflow}];
  const filteredTemplates=templates.filter(t=>(filter==='전체'||t.category===filter)&&(t.name+t.description+t.category).includes(search));
  return <div className={`app-shell ${route.view==='editor'?'is-editor':''}`}>
    {mobileNav&&<div className="mobile-nav-shade" onClick={()=>setMobileNav(false)}/>}
    <aside className={`sidebar ${mobileNav?'nav-open':''}`}>
      <a className="brand-link" href="#home" aria-label="무엇이든 뚝딱 대시보드"><Logo/></a>
      <button className="workspace-switch" onClick={()=>setHelp(true)}><span className="workspace-avatar">나</span><span><b>나의 작업 공간</b><small>Personal workspace</small></span><ChevronDown size={15}/></button>
      <button className="button primary new-project" onClick={()=>start()}><Plus size={18}/> 새 프로젝트 만들기</button>
      <span className="nav-caption">WORKSPACE</span>
      <nav aria-label="메인 메뉴">{navItems.map(n=><button key={n.view} className={`nav-item ${route.view===n.view||(n.view==='projects'&&route.view==='editor')?'active':''}`} onClick={()=>go(n.view)}><n.icon size={19}/><span>{n.label}</span>{n.view==='projects'&&projects.length>0&&<span className="nav-count">{projects.length}</span>}{n.view==='automation'&&<span className="new-label">NEW</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-tip"><span className="tip-icon"><Sparkles size={18}/></span><b>처음이어도 괜찮아요</b><p>아이디어만 가져오세요.<br/>나머지는 뚝딱이 도와드릴게요.</p><button onClick={()=>go('guide')}>시작 가이드 보기 <ArrowUpRight size={15}/></button></div><button className={`nav-item ${route.view==='guide'?'active':''}`} onClick={()=>go('guide')}><BookOpen size={18}/>도움말과 가이드 <ArrowUpRight size={14}/></button><button className="user-profile" onClick={()=>setHelp(true)}><span className="profile-avatar">나</span><span><b>나의 작업 공간</b><small>가볍게 시작하는 첫걸음</small></span><Settings2 size={17}/></button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumbs"><IconButton className="mobile-menu" label="메뉴 열기" onClick={()=>setMobileNav(true)}><Menu size={20}/></IconButton><span>내 작업 공간</span><ChevronRight size={14}/><b>{titles[route.view]}</b></div><div className="topbar-right"><span className="saved-indicator"><span/> 나만의 제작 공간</span><button className="help-button" onClick={()=>go('guide')}><CircleHelp size={17}/><span>이용 가이드</span></button><button className="top-avatar" aria-label="작업 공간 정보" onClick={()=>setHelp(true)}>나</button></div></header>
      <main>
        {isPortable()&&<div className="portable-banner" role="note"><span><Monitor size={16}/><b>설치 없는 체험판</b></span><span>프로젝트는 이 브라우저에만 저장돼요. AI 연결과 실제 고객 응답 수집은 포함되지 않아요.</span></div>}
        {loadError&&<div className="error-banner" role="alert"><span>{loadError}</span><button onClick={()=>void load()}>다시 연결</button></div>}
        {route.view==='home'&&<div className="dashboard page-enter">
          <div className="welcome-line"><span><span className="sun-icon">✳</span> 오늘도, 멋진 아이디어를 현실로</span><span className="welcome-note">코딩은 몰라도 괜찮아요 <Heart size={13}/></span></div>
          <section className="hero">
            <div className="hero-content"><div className="hero-badge"><Sparkles size={13}/> YOUR IDEA, MADE REAL</div><h1>생각만 하세요.<br/>만드는 건 <span>뚝딱</span>이 할게요<svg className="hero-sparkle" width="30" height="34" viewBox="0 0 30 34" fill="none"><path d="m14 0 2 12 12 4-12 3-2 14-4-14L0 16l10-4z" fill="currentColor"/></svg></h1><p>머릿속 아이디어가, 손끝에서 작동하는 앱으로.<br/>말로 설명하고, 눈으로 확인하고, 내 마음대로 바꿔보세요.</p><div className="hero-benefits"><span><Check size={14}/> 코딩 없이</span><span><Check size={14}/> 복잡한 설정 없이</span><span><Check size={14}/> 누구나 쉽게</span></div></div>
            <div className="hero-visual"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="floating-note note-top"><span className="orange-icon"><WandSparkles size={15}/></span> “이런 앱, 만들 수 있을까요?”</div><div className="hero-browser"><div className="browser-dots"><i/><i/><i/><span>나의 첫 번째 앱</span><ShieldCheck size={11}/></div><TemplateCover kind="booking" name="온기 커피" compact/></div><div className="floating-note note-bottom"><span className="check-icon"><Check size={14}/></span><span>물론이죠. <b>이렇게 뚝딱!</b></span><Sparkles size={15}/></div><div className="cursor-sticker"><MousePointer2 size={23} fill="#6d8268"/><span>당신의 아이디어</span></div><span className="visual-star star-one">✳</span><span className="visual-star star-two">✦</span></div>
          </section>
          <section className="prompt-section"><div className="prompt-heading"><span className="sparkle-square"><Sparkles size={19}/></span><h2>어떤 앱을 만들고 싶으세요?</h2><span>한 문장이면 충분해요</span></div><form className="idea-box" onSubmit={e=>{e.preventDefault();start(undefined,prompt.trim()||undefined);}}><label className="sr-only" htmlFor="idea">만들고 싶은 앱 설명</label><textarea id="idea" rows={2} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="예를 들어, 우리 동네 작은 카페의 메뉴를 소개하고 예약을 받는 웹을 만들고 싶어요." maxLength={2000}/><div className="idea-box-bottom"><span><WandSparkles size={14}/> 아이디어를 구체화하는 것부터 함께할게요</span><button className="button dark" type="submit">뚝딱 만들기 <ArrowUpRight size={17}/></button></div></form><div className="idea-chips"><span>이런 건 어때요?</span>{[{label:'☕ 카페 예약 사이트',i:0},{label:'🎨 나만의 포트폴리오',i:1},{label:'🚀 서비스 소개 페이지',i:2}].map(x=><button key={x.i} onClick={()=>start(templates[x.i])}>{x.label}<Plus size={12}/></button>)}</div></section>
          <section className="template-section"><div className="section-heading"><div><h2>막막할 땐, 여기서 시작해요 <span className="small-badge">STARTER</span></h2><p>마음에 드는 시작점을 고르고, 나만의 이야기로 채워보세요.</p></div><button className="text-button" onClick={()=>go('templates')}>전체 템플릿 <ArrowRight size={15}/></button></div><div className="template-grid">{templates.slice(0,3).map(t=><TemplateCard key={t.kind} template={t} onSelect={()=>start(t)}/>)}</div></section>
          <section className="recent-section"><div className="section-heading"><div><h2>나의 프로젝트 <span className="number-badge">{projects.length}</span></h2><p>작은 시작들을 차곡차곡 모아보세요.</p></div>{projects.length>0&&<button className="text-button" onClick={()=>go('projects')}>모두 보기 <ArrowRight size={15}/></button>}</div>{loading?<div className="loading-inline"><LoaderCircle className="spin" size={20}/> 작업 공간을 불러오고 있어요</div>:projects.length?<div className="project-grid">{projects.slice(0,3).map(p=><ProjectCard key={p.id} project={p} onOpen={()=>go('editor',p.id)} onDelete={()=>setDeleteProject(p)}/>)}</div>:<button className="empty-project-banner" onClick={()=>start()}><span className="empty-plus"><Plus size={20}/></span><span><b>나만의 첫 프로젝트를 만들어볼까요?</b><small>완벽한 아이디어가 아니어도 좋아요. 만들면서 다듬으면 되니까요.</small></span><ArrowUpRight size={20}/></button>}</section>
          <footer className="dashboard-footer"><Logo small/><span>누구나 만들 수 있는 세상, 무엇이든 뚝딱.</span><span>MADE FOR YOUR NEXT IDEA <span>✳</span></span></footer>
        </div>}
        {route.view==='templates'&&<div className="content-page page-enter"><PageHeading eyebrow="A GOOD PLACE TO START" title="시작이 쉬워지는 템플릿" description="마음에 드는 분위기를 고르세요. 내용과 기능은 언제든 바꿀 수 있어요."/><div className="filter-bar"><div className="filter-chips">{['전체','매장 · 예약','포트폴리오','서비스 소개','상품 소개'].map(f=><button className={filter===f?'selected':''} key={f} onClick={()=>setFilter(f)}>{f}</button>)}</div><label className="search-box"><Search size={16}/><input placeholder="템플릿 찾기" value={search} onChange={e=>setSearch(e.target.value)} aria-label="템플릿 검색"/></label></div><div className="template-grid library-grid">{filteredTemplates.map(t=><TemplateCard key={t.kind} template={t} onSelect={()=>start(t)}/>)}</div>{!filteredTemplates.length&&<EmptyState icon={Search} title="검색 결과가 없어요" text="다른 단어로 검색하거나 전체 템플릿을 살펴보세요."/>}</div>}
        {route.view==='projects'&&<div className="content-page page-enter"><PageHeading eyebrow="YOUR LITTLE BIG IDEAS" title="나의 프로젝트" description="아이디어를 이어가고, 더 나은 모습으로 다듬어보세요." action={<button className="button primary" onClick={()=>start()}><Plus size={17}/>새 프로젝트</button>}/><div className="filter-bar"><span className="muted">전체 프로젝트 <b className="text-dark">{projects.length}</b></span><label className="search-box"><Search size={16}/><input placeholder="프로젝트 찾기" value={search} onChange={e=>setSearch(e.target.value)} aria-label="프로젝트 검색"/></label></div>{loading?<div className="loading-inline"><LoaderCircle className="spin" size={20}/>불러오는 중</div>:projects.length?<div className="project-grid">{projects.filter(p=>(p.name+p.description).includes(search)).map(p=><ProjectCard key={p.id} project={p} onOpen={()=>go('editor',p.id)} onDelete={()=>setDeleteProject(p)}/>)}</div>:<EmptyState icon={FolderOpen} title="첫 번째 아이디어를 기다리고 있어요" text="예약 사이트부터 나만의 포트폴리오까지, 무엇이든 시작해보세요." action={<button className="button primary" onClick={()=>start()}>첫 프로젝트 만들기 <ArrowUpRight size={16}/></button>}/>}</div>}
        {route.view==='automation'&&<Automation projects={projects} onOpen={p=>go('editor',p.id)} notify={notify}/>}
        {route.view==='guide'&&<Guide onStart={()=>start()}/>}
        {route.view==='editor'&&(current?<Editor key={current.id} project={current} status={status} onChange={updateProject} notify={notify} onBack={()=>go('projects')}/>:loading?<div className="loading-inline"><LoaderCircle className="spin"/>프로젝트를 불러오고 있어요</div>:<EmptyState icon={FolderOpen} title="프로젝트를 찾을 수 없어요" text="내 프로젝트에서 이어서 작업할 앱을 선택해 주세요." action={<button className="button primary" onClick={()=>go('projects')}>내 프로젝트로</button>}/>) }
      </main>
    </div>
    {wizard&&<Wizard initial={wizard} initialStep={wizardStep} status={status} onClose={()=>setWizard(null)} onCreated={p=>{updateProject(p);setWizard(null);setPrompt('');go('editor',p.id);notify('나만의 앱이 만들어졌어요. 미리보기에서 직접 사용해보세요!');}}/>}
    {help&&<Modal title="나만의 작업 공간" onClose={()=>setHelp(false)}><div className="workspace-info"><span className="big-icon"><Flower2 size={34}/></span><h3>마음껏 만들고, 편하게 다듬어요</h3><p>{isPortable()?'이 체험판의 프로젝트는 현재 브라우저에 저장돼요.':'이 작업 공간의 프로젝트는 현재 서버에 저장돼요.'}<br/>중간에 나가도 마지막으로 저장된 작업을 이어갈 수 있어요.</p><div className="info-row"><span>제작 엔진</span><b>{status?.aiConfigured?'AI 연결 설정됨':'기본 제작 모드'}</b></div><div className="info-row"><span>저장 방식</span><b>{isPortable()?'이 브라우저의 개인 작업 공간':'현재 서버의 개인 작업 공간'}</b></div><div className="info-note">{isPortable()?'이 체험 파일은 준비된 구성으로 앱을 만들고 색상·문구·기능을 수정해요. 실제 AI 연결은 전체 버전을 서버에서 실행할 때 사용할 수 있어요.':'기본 제작 모드에서는 준비된 구성으로 앱을 만들고, 색상·문구·기능을 수정할 수 있어요. AI를 연결하면 더 자유로운 대화로 만들 수 있어요.'}</div><button className="button dark full-width" onClick={()=>{setHelp(false);go('guide');}}>자세한 사용법 보기 <ArrowRight size={16}/></button></div></Modal>}
    {deleteProject&&<Modal title="프로젝트를 삭제할까요?" onClose={()=>setDeleteProject(null)}><p className="modal-description">‘{deleteProject.name}’의 작업과 변경 기록, 게시된 페이지가 함께 삭제돼요. 필요한 결과물은 먼저 내려받아 주세요.</p><div className="modal-actions"><button className="button secondary" onClick={()=>setDeleteProject(null)}>돌아가기</button><button className="button danger" disabled={deleting} onClick={async()=>{setDeleting(true);try{await api.remove(deleteProject.id);setProjects(p=>p.filter(x=>x.id!==deleteProject.id));setDeleteProject(null);notify('프로젝트를 삭제했어요.');}catch(e){notify((e as Error).message);}finally{setDeleting(false);}}}>{deleting?<LoaderCircle className="spin" size={16}/>:<Trash2 size={16}/>}삭제하기</button></div></Modal>}
    {toast&&<div className="toast" role="status"><CheckCircle2 size={18}/><span>{toast}</span><button aria-label="알림 닫기" onClick={()=>setToast('')}><X size={14}/></button></div>}
  </div>;
}

function TemplateCard({template:t,onSelect}:{template:Template;onSelect:()=>void}) {return <button className="template-card" onClick={onSelect}><div className="template-card-image"><TemplateCover kind={t.kind} name={t.name}/><span className="template-hover">이 템플릿으로 시작 <ArrowUpRight size={15}/></span></div><div className="template-card-info"><div><span className="template-category">{t.category}</span><h3>{t.name}</h3></div><span className="card-arrow"><ArrowUpRight size={18}/></span></div><span className="template-tag"><span/> {t.tag}</span></button>;}
function ProjectCard({project:p,onOpen,onDelete}:{project:Project;onOpen:()=>void;onDelete:()=>void}) {return <article className="project-card"><button className="project-cover-button" onClick={onOpen} aria-label={`${p.name} 편집`}><TemplateCover kind={p.kind} name={p.name}/><span className="project-state">{p.publishedSlug?<><span className="green-dot"/>로컬 게시됨</>:<><span className="gray-dot"/>제작 중</>}</span></button><div className="project-card-info"><button onClick={onOpen}><h3>{p.name}</h3><span><Clock3 size={12}/>{timeAgo(p.updatedAt)} 수정</span></button><IconButton label={`${p.name} 삭제`} onClick={onDelete}><Trash2 size={16}/></IconButton></div></article>;}
function PageHeading({eyebrow,title,description,action}:{eyebrow:string;title:string;description:string;action?:ReactNode}) {return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action}</div>;}
function EmptyState({icon:Icon,title,text,action}:{icon:typeof FolderOpen;title:string;text:string;action?:ReactNode}) {return <div className="empty-state"><span className="empty-state-icon"><Icon size={30} strokeWidth={1.4}/></span><h2>{title}</h2><p>{text}</p>{action}</div>;}

function Wizard({initial,initialStep,status,onClose,onCreated}:{initial:GenerateInput;initialStep:number;status:RuntimeStatus|null;onClose:()=>void;onCreated:(p:Project)=>void}) {
  const [input,setInput]=useState<GenerateInput>(initial);
  const [step,setStep]=useState(initialStep);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{try{localStorage.setItem('ddukttak-draft',JSON.stringify(input));localStorage.setItem('ddukttak-draft-step',String(step));}catch{/* creation still works when storage is disabled */}},[input,step]);
  const set=<K extends keyof GenerateInput>(key:K,value:GenerateInput[K])=>setInput(prev=>({...prev,[key]:value}));
  const next=()=>{setError('');if(step===0&&(!input.name.trim()||input.description.trim().length<3)){setError('프로젝트 이름과 만들고 싶은 내용을 3자 이상으로 알려주세요.');return;}setStep(s=>s+1);};
  const create=async()=>{setBusy(true);setError('');try{const project=await api.create(input);try{localStorage.removeItem('ddukttak-draft');localStorage.removeItem('ddukttak-draft-step');}catch{/* no draft to remove */}onCreated(project);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <Modal wide title={busy?'아이디어에 모양을 더하고 있어요':'어떤 아이디어를 품고 오셨나요?'} onClose={()=>{if(!busy)onClose();}}><div className="wizard-steps">{['아이디어','디자인','기능 선택','만들기'].map((label,i)=><div key={label} className={`wizard-step ${i===step?'current':''} ${i<step?'done':''}`}><span>{i<step?<Check size={13}/>:i+1}</span>{label}{i<3&&<div/>}</div>)}</div>
    <div className="wizard-body">
      {step===0&&<><h3>무엇을 만들고 싶으세요?</h3><div className="kind-grid">{kinds.map(k=><button key={k.key} className={`option-card ${input.kind===k.key?'selected':''}`} onClick={()=>set('kind',k.key)}><k.icon size={22}/><span><b>{k.name}</b><small>{k.desc}</small></span>{input.kind===k.key&&<CheckCircle2 size={16}/>}</button>)}</div><label className="field-label">프로젝트 이름 <span>나중에 바꿀 수 있어요</span><input autoFocus maxLength={60} placeholder="예: 온기 커피" value={input.name} onChange={e=>set('name',e.target.value)}/></label><label className="field-label">어떤 앱이면 좋을까요?<textarea rows={3} maxLength={2000} placeholder="누구를 위한 앱인지, 어떤 기능이 있으면 좋을지 편하게 적어주세요." value={input.description} onChange={e=>set('description',e.target.value)}/></label></>}
      {step===1&&<><h3>어떤 분위기가 마음에 드세요?</h3><p className="wizard-subtitle">디자인을 몰라도 괜찮아요. 느낌만 골라주세요.</p><div className="style-grid">{styleInfo.map(s=><button key={s.key} className={`style-card ${input.style===s.key?'selected':''}`} onClick={()=>set('style',s.key)}><div className="style-preview" style={{background:s.bg,color:s.color}}><div className="style-preview-nav"><span/><span/></div><b>Aa<span>✳</span></b><div className="style-preview-lines"><i/><i/></div><span className="style-preview-button" style={{background:s.color}}/></div><div className="style-label"><b>{s.name}</b>{input.style===s.key&&<CheckCircle2 size={16}/>}</div><small>{s.sub}</small></button>)}</div></>}
      {step===2&&<><h3>필요한 기능을 더해주세요</h3><p className="wizard-subtitle">지금은 가볍게 골라도 좋아요. 만들고 나서 언제든 추가할 수 있어요.</p><div className="feature-grid">{featureInfo.map(f=><button className={`feature-option ${input.features.includes(f.key)?'selected':''}`} key={f.key} onClick={()=>set('features',input.features.includes(f.key)?input.features.filter(x=>x!==f.key):[...input.features,f.key])}><span className="feature-icon"><f.icon size={20}/></span><span><b>{f.name}</b><small>{f.desc}</small></span><span className="checkbox">{input.features.includes(f.key)&&<Check size={13}/>}</span></button>)}</div><div className="info-note"><CircleHelp size={16}/><span>예약·문의·구독 양식은 방문자의 기기에서 작동해요. 여러 고객의 응답을 한곳에 모으려면 별도 수집 서비스 연결이 필요해요.</span></div></>}
      {step===3&&<><div className="creation-summary"><span className="summary-icon"><WandSparkles size={31}/></span><h3>{busy?'곧 만나게 될 나만의 앱':'준비됐어요. 이제 뚝딱 만들어볼까요?'}</h3><p>선택한 내용을 바탕으로 바로 사용해볼 수 있는 앱을 만들어요.</p></div><div className="summary-card"><b>{input.name}</b><p>{input.description}</p><div className="summary-tags"><span>{kinds.find(x=>x.key===input.kind)?.name}</span><span>{styleInfo.find(x=>x.key===input.style)?.name}</span><span>기능 {input.features.length}개</span></div></div><div className="generation-detail"><span className={busy?'pulse':''}>{busy?<LoaderCircle className="spin" size={17}/>:<CheckCircle2 size={17}/>}</span><div><b>{busy?'구성하고, 화면을 만들고, 작동을 확인하고 있어요':'화면 구성부터 작동하는 기능까지'}</b><p>{status?.aiConfigured?'연결된 AI가 아이디어를 구체화해요.':'검증된 구성요소로 안정적인 첫 결과물을 만들어요.'}</p></div></div></>}
      {error&&<div className="form-error" role="alert">{error}</div>}
    </div><div className="wizard-footer"><span><ShieldCheck size={14}/> 답변은 자동으로 임시 저장돼요</span><div>{step>0&&<button className="button secondary" disabled={busy} onClick={()=>setStep(s=>s-1)}><ArrowLeft size={15}/> 이전</button>}{step<3?<button className="button primary" onClick={next}>다음으로 <ArrowRight size={16}/></button>:<button className="button primary" disabled={busy} onClick={()=>void create()}>{busy?<LoaderCircle className="spin" size={17}/>:<Sparkles size={17}/>} {busy?'만들고 있어요…':'나의 앱 만들기'}</button>}</div></div></Modal>;
}

function Editor({project:p,status,onChange,notify,onBack}:{project:Project;status:RuntimeStatus|null;onChange:(p:Project)=>void;notify:(s:string)=>void;onBack:()=>void}) {
  const [tab,setTab]=useState<'preview'|'features'|'history'|'launch'>('preview');
  const [device,setDevice]=useState<'desktop'|'mobile'>('desktop');
  const [prompt,setPrompt]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [checks,setChecks]=useState<CheckResult|null>(null);
  const [checking,setChecking]=useState(false);
  const [publishedPath,setPublishedPath]=useState(()=>api.publishedUrl(p));
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState<AppSchema>(p.schema);
  const [chatOpen,setChatOpen]=useState(false);
  const messageEnd=useRef<HTMLDivElement>(null);
  const html=useMemo(()=>renderAppHtml(p.schema),[p.schema]);
  useEffect(()=>{messageEnd.current?.scrollIntoView({block:'nearest'});},[p.messages.length]);
  const run=async(fn:()=>Promise<Project>,message?:string)=>{setBusy(true);setError('');try{const updated=await fn();onChange(updated);setChecks(null);if(message)notify(message);return updated;}catch(e){setError((e as Error).message);return null;}finally{setBusy(false);}};
  const edit=async(e?:FormEvent,text?:string)=>{e?.preventDefault();const value=(text||prompt).trim();if(!value||busy)return;const updated=await run(()=>api.edit(p.id,value),'수정했어요. 변경 전 모습도 기록에 남겨뒀어요.');if(updated){setPrompt('');setTab('preview');}};
  const toggleFeature=(key:FeatureKey)=>{const features=p.schema.features.includes(key)?p.schema.features.filter(f=>f!==key):[...p.schema.features,key];void run(()=>api.save(p.id,{...p.schema,features},`${featureInfo.find(f=>f.key===key)?.name} ${features.includes(key)?'추가':'제거'}`),'기능 구성이 저장됐어요.');};
  const check=async()=>{setChecking(true);try{setChecks(await api.check(p.id));}catch(e){notify((e as Error).message);}finally{setChecking(false);}};
  const publish=async()=>{setBusy(true);setError('');try{const result=await api.publish(p.id);onChange(result.project);setPublishedPath(result.path);notify(isPortable()?'이 브라우저에서 열 수 있는 실행본을 저장했어요.':'현재 서버에 게시했어요. 실행 안내에서 확인할 수 있어요.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  return <div className="studio page-enter"><div className="studio-heading"><div className="studio-project-title"><IconButton label="내 프로젝트로 돌아가기" onClick={onBack}><ArrowLeft size={19}/></IconButton><span className="studio-app-icon"><Zap size={19}/></span><div><h1>{p.name}</h1><span><span className="green-dot"/> 저장 완료 · {timeAgo(p.updatedAt)}</span></div></div><div className="studio-actions"><button className="button secondary" onClick={()=>{setDraft(structuredClone(p.schema));setEditing(true);}} disabled={busy}><Settings2 size={16}/><span>직접 수정</span></button><a className="button secondary export-button" href={api.exportUrl(p)} download={`${p.name}.html`}><ArrowDownToLine size={16}/><span>내려받기</span></a><button className="button primary" onClick={()=>setTab('launch')}><Rocket size={16}/>실행하기</button></div></div>
    <div className="studio-tabs"><div>{[{key:'preview',label:'미리보기',icon:Monitor},{key:'features',label:'기능 관리',icon:Grid2X2},{key:'history',label:'변경 기록',icon:History},{key:'launch',label:'실행 안내',icon:Rocket}].map(t=><button className={tab===t.key?'selected':''} key={t.key} onClick={()=>setTab(t.key as typeof tab)}><t.icon size={16}/>{t.label}{t.key==='features'&&<span>{p.schema.features.length}</span>}</button>)}</div><span className="engine-status"><span/>{status?.aiConfigured?'AI 제작 모드':'기본 제작 모드'}</span></div>
    {error&&<div className="form-error editor-error" role="alert">{error}<button onClick={()=>setError('')} aria-label="오류 닫기"><X size={15}/></button></div>}
    <div className="studio-body"><aside className={`chat-panel ${chatOpen?'chat-visible':''}`}><div className="chat-heading"><span className="assistant-avatar"><Sparkles size={18}/></span><div><b>뚝딱 메이커</b><span>함께 만들고, 더 쉽게 다듬어요</span></div><IconButton className="chat-close" label="대화 접기" onClick={()=>setChatOpen(false)}><X size={18}/></IconButton></div><div className="chat-messages"><div className="chat-message assistant"><span className="message-label"><Sparkles size={12}/> 뚝딱</span><p>‘{p.name}’의 첫 모습이 준비됐어요!<br/>오른쪽에서 직접 사용해보세요. 바꾸고 싶은 점은 편하게 말씀해 주세요.</p></div>{p.messages.map(m=><div key={m.id} className={`chat-message ${m.role}`}><span className="message-label">{m.role==='assistant'?<><Sparkles size={12}/> 뚝딱</>:'나'}</span><p>{m.content}</p></div>)}{busy&&<div className="chat-message assistant"><span className="message-label"><LoaderCircle className="spin" size={13}/> 작업 중</span><p>요청한 부분을 살펴보고 있어요…</p></div>}<div ref={messageEnd}/></div><div className="chat-compose"><div className="chat-suggestions">{['초록색으로 바꿔줘','자주 묻는 질문 추가해줘'].map(s=><button key={s} onClick={()=>void edit(undefined,s)} disabled={busy}>{s}<Plus size={11}/></button>)}</div><form onSubmit={e=>void edit(e)}><textarea aria-label="수정 요청" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={'“배경을 따뜻하게 바꿔줘”\n원하는 수정을 말해주세요.'} rows={3} maxLength={2000} onKeyDown={e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();void edit();}}}/><div><span>⌘ / Ctrl + Enter로 보내기</span><button type="submit" aria-label="수정 요청 보내기" disabled={busy||!prompt.trim()}>{busy?<LoaderCircle className="spin" size={17}/>:<ArrowUp size={19}/>}</button></div></form><p><ShieldCheck size={11}/> 수정 전 모습은 자동으로 보관돼요</p></div></aside>
      <div className="editor-content">
        {tab==='preview'&&<div className="preview-panel"><div className="preview-toolbar"><div className="device-toggle"><button className={device==='desktop'?'selected':''} aria-label="PC 미리보기" onClick={()=>setDevice('desktop')}><Monitor size={16}/></button><button className={device==='mobile'?'selected':''} aria-label="모바일 미리보기" onClick={()=>setDevice('mobile')}><Smartphone size={16}/></button></div><span className="preview-address"><ShieldCheck size={12}/>{p.name} · 실시간 미리보기</span><span className="preview-size">{device==='desktop'?'반응형 화면':'390 px'}</span></div><div className={`preview-canvas ${device}`}><iframe title={`${p.name} 미리보기`} srcDoc={html} sandbox="allow-scripts allow-forms" key={`${p.id}-${p.updatedAt}`}/></div><div className="preview-footer"><span><CheckCheck size={13}/> 변경 내용이 미리보기에 반영됐어요</span><span>페이지 안의 버튼과 양식을 직접 눌러보세요 <MousePointer2 size={12}/></span></div></div>}
        {tab==='features'&&<div className="editor-page"><span className="eyebrow">MAKE IT YOURS</span><h2>필요한 기능을, 클릭 한 번에</h2><p>추가한 기능은 바로 미리보기에 나타나요. 언제든 다시 바꿀 수 있어요.</p><div className="feature-manager">{featureInfo.map(f=><div className={`managed-feature ${p.schema.features.includes(f.key)?'enabled':''}`} key={f.key}><span className="feature-icon"><f.icon size={23}/></span><h3>{f.name}</h3><p>{f.desc}</p><button className={`button ${p.schema.features.includes(f.key)?'soft-green':'secondary'}`} disabled={busy} onClick={()=>toggleFeature(f.key)}>{p.schema.features.includes(f.key)?<><Check size={15}/>추가됨 · 제거</>:<><Plus size={15}/>기능 추가</>}</button></div>)}</div><div className="info-note"><CircleHelp size={16}/><span>양식은 방문자의 기기에만 저장돼요. 실제 예약 확정·이메일 발송·응답 수집은 별도 서비스 연결이 필요해요.</span></div></div>}
        {tab==='history'&&<div className="editor-page"><span className="eyebrow">EVERY STEP IS SAVED</span><h2>마음 편히, 이전으로 돌아가요</h2><p>모든 수정은 기록돼요. 복원해도 지금 작업은 사라지지 않아요.</p><div className="version-list">{[...p.versions].reverse().map((v,i)=><div className="version-item" key={v.id}><span className={`version-dot ${i===0?'current':''}`}><History size={17}/></span><div><h3>{v.label}{i===0&&<span className="small-badge">현재 버전</span>}</h3><p>{new Date(v.createdAt).toLocaleString('ko-KR')} · {v.schema.features.length}개 기능</p></div><button className="button secondary small" disabled={busy||i===0} onClick={()=>void run(()=>api.restore(p.id,v.id),'선택한 모습으로 복원했어요. 이전 기록도 그대로 남아있어요.')}>{i===0?'사용 중':'이 버전 복원'}</button></div>)}</div></div>}
        {tab==='launch'&&<div className="editor-page launch-page"><span className="eyebrow">READY, SET, LAUNCH</span><h2>만들었으니, 이제 써볼까요?</h2><p>직접 사용해보고, 파일로 가져가고, 나만의 주소로 공개해보세요.</p><div className="launch-check-card"><div><span className="launch-icon"><ShieldCheck size={24}/></span><div><h3>사용하기 전, 한 번 더 확인해요</h3><p>화면 구성과 기능 설정을 자동으로 점검해요.</p></div></div><button className="button dark" disabled={checking} onClick={()=>void check()}>{checking?<LoaderCircle className="spin" size={16}/>:<Zap size={16}/>}자동 점검</button></div>{checks&&<div className="check-results">{checks.checks.map(c=><div key={c.id} className={`check-item ${c.status}`}><span>{c.status==='passed'?<CheckCircle2 size={18}/>:<CircleHelp size={18}/>}</span><div><b>{c.label}</b><p>{c.detail}</p></div><span className="check-status">{c.status==='passed'?'확인 완료':c.status==='warning'?'안내 확인':'확인 필요'}</span></div>)}</div>}
          <div className="launch-options"><div className="launch-option"><span className="step-number">01</span><h3>{isPortable()?'새 창에서 사용하기':'현재 서버에서 사용하기'}</h3><p>지금 모습 그대로 별도 페이지를 만들어요.<br/>수정 중에도 게시한 모습은 그대로 유지돼요.</p><button className="button secondary" disabled={busy} onClick={()=>void publish()}><Globe2 size={16}/>{isPortable()?(publishedPath?'현재 모습으로 실행본 저장':'브라우저 실행본 만들기'):(publishedPath?'현재 모습으로 다시 게시':'로컬 페이지 게시')}</button>{publishedPath&&<div className="published-link"><a href={publishedPath} target="_blank" rel="noreferrer">{isPortable()?'저장한 실행본 열기':'게시된 페이지 열기'} <ExternalLink size={13}/></a>{!isPortable()&&<IconButton label="게시 경로 복사" onClick={()=>{if(!navigator.clipboard){notify('주소창에서 페이지 주소를 직접 복사해 주세요.');return;}void navigator.clipboard.writeText(new URL(publishedPath,window.location.origin).href).then(()=>notify('현재 서버의 페이지 주소를 복사했어요.')).catch(()=>notify('주소창에서 페이지 주소를 직접 복사해 주세요.'));}}><Copy size={14}/></IconButton>}</div>}<small>인터넷 공유는 아래의 HTML 정적 호스팅 안내를 따라주세요.</small></div><div className="launch-option"><span className="step-number">02</span><h3>내 컴퓨터로 가져가기</h3><p>설치 없이 열리는 HTML 파일이에요.<br/>내려받은 파일을 두 번 누르면 바로 실행돼요.</p><a className="button secondary" href={api.exportUrl(p)} download={`${p.name}.html`}><ArrowDownToLine size={16}/>앱 파일 내려받기</a><small>인터넷 연결 없이도 기본 화면과 양식을 사용할 수 있어요.</small></div></div><div className="public-guide"><div><span className="orange-icon"><Rocket size={21}/></span><h3>다른 사람에게도 보여주고 싶다면?</h3></div><ol><li><b>앱 파일 내려받기</b><span>받은 파일 이름을 index.html로 바꾸고 새 폴더에 넣어요.</span></li><li><b>정적 호스팅에 업로드</b><span>Cloudflare Pages의 직접 업로드 또는 Netlify Drop에 폴더를 올려요.</span></li><li><b>발급된 주소로 접속</b><span>PC와 휴대폰에서 열어보고 버튼과 양식을 확인해 주세요.</span></li></ol><p><CircleHelp size={14}/>예약·문의 내역을 운영자가 받으려면 응답 수집 서비스를 추가로 연결해야 해요. 자세한 서버 실행 안내는 저장소의 README에서 확인할 수 있어요.</p></div></div>}
      </div>
    </div><button className="mobile-chat-toggle button dark" onClick={()=>setChatOpen(!chatOpen)}><MessageCircle size={18}/>뚝딱에게 수정 요청</button>
    {editing&&<Modal title="마음에 드는 모습으로 직접 수정" onClose={()=>setEditing(false)}><DirectEditor draft={draft} onChange={setDraft} busy={busy} onCancel={()=>setEditing(false)} onSave={async()=>{const result=await run(()=>api.save(p.id,draft,'문구와 디자인 직접 수정'),'수정한 내용이 저장됐어요.');if(result)setEditing(false);}}/></Modal>}

  </div>;
}

function DirectEditor({draft:d,onChange,busy,onSave,onCancel}:{draft:AppSchema;onChange:(s:AppSchema)=>void;busy:boolean;onSave:()=>void;onCancel:()=>void}) {
  const [contentBusy,setContentBusy]=useState(false);
  const hero=(key:keyof AppSchema['hero'],value:string)=>onChange({...d,hero:{...d.hero,[key]:value}});
  const theme=(value:Partial<AppSchema['theme']>)=>onChange({...d,theme:{...d.theme,...value}});
  const section=(index:number,key:'title'|'description',value:string)=>onChange({...d,sections:d.sections.map((s,i)=>i===index?{...s,[key]:value}:s)});
  let valid=true;try{validateSchema(d);}catch{valid=false;}
  return <div className="direct-edit"><label className="field-label">프로젝트 이름<input value={d.name} maxLength={60} onChange={e=>onChange({...d,name:e.target.value})}/></label><label className="field-label">메인 제목<textarea rows={2} value={d.hero.title} maxLength={200} onChange={e=>hero('title',e.target.value)}/></label><label className="field-label">소개 문구<textarea rows={3} value={d.hero.subtitle} maxLength={1000} onChange={e=>hero('subtitle',e.target.value)}/></label><div className="edit-field-row"><label className="field-label">버튼 문구<input value={d.hero.buttonText} maxLength={60} onChange={e=>hero('buttonText',e.target.value)}/></label><label className="field-label">포인트 색상<input type="color" value={d.theme.primary} onChange={e=>theme({primary:e.target.value})}/></label></div><details className="edit-details"><summary>디자인 세부 설정 <ChevronDown size={15}/></summary><label className="field-label">배경 색상<input type="color" value={d.theme.background} onChange={e=>theme({background:e.target.value})}/></label><div className="edit-select-row"><label className="field-label">제목 글꼴<select value={d.theme.font} onChange={e=>theme({font:e.target.value as AppSchema['theme']['font']})}><option value="modern">깔끔한 고딕체</option><option value="serif">감성적인 명조체</option></select></label><label className="field-label">모서리<select value={d.theme.radius} onChange={e=>theme({radius:e.target.value as AppSchema['theme']['radius']})}><option value="soft">부드럽게</option><option value="square">반듯하게</option></select></label></div></details><details className="edit-details"><summary>페이지 소개 영역 수정 <ChevronDown size={15}/></summary><label className="field-label">페이지 소개<textarea rows={2} value={d.description} maxLength={2000} onChange={e=>onChange({...d,description:e.target.value})}/></label>{d.sections.map((s,i)=><div className="section-edit" key={i}><div><span>소개 영역 {i+1}</span><IconButton label={`소개 영역 ${i+1} 삭제`} disabled={d.sections.length<=1} onClick={()=>onChange({...d,sections:d.sections.filter((_,j)=>j!==i)})}><Trash2 size={14}/></IconButton></div><label className="field-label">영역 제목<input aria-label={`소개 영역 ${i+1} 제목`} value={s.title} maxLength={200} onChange={e=>section(i,'title',e.target.value)}/></label><label className="field-label">영역 설명<textarea aria-label={`소개 영역 ${i+1} 설명`} rows={3} value={s.description} maxLength={2000} onChange={e=>section(i,'description',e.target.value)}/></label></div>)}<button className="button secondary full-width" disabled={d.sections.length>=8} onClick={()=>onChange({...d,sections:[...d.sections,{title:'새로운 이야기',description:'이곳에 나만의 이야기를 적어주세요.'}]})}><Plus size={15}/>소개 영역 추가</button></details><ContentEditor schema={d} onChange={onChange} onBusyChange={setContentBusy}/><div className="modal-actions"><button className="button secondary" onClick={onCancel}>돌아가기</button><button className="button primary" disabled={busy||contentBusy||!valid} onClick={onSave}>{busy?<LoaderCircle className="spin" size={15}/>:<Check size={15}/>}수정 내용 저장</button></div></div>;
}

function Automation({projects,onOpen,notify}:{projects:Project[];onOpen:(p:Project)=>void;notify:(s:string)=>void}) {
  const [selected,setSelected]=useState('');
  const [result,setResult]=useState<CheckResult|null>(null);
  const [busy,setBusy]=useState(false);
  const active=projects.find(p=>p.id===(selected||projects[0]?.id));
  return <div className="content-page page-enter"><PageHeading eyebrow="LESS WORK, MORE CREATING" title="번거로운 일은 뚝딱에게" description="앱을 만들고 다듬는 동안, 반복되는 작업은 자동으로 처리해요."/><div className="automation-banner"><div><span className="automation-symbol"><Workflow size={31}/></span><h2>아이디어에만 집중하세요.</h2><p>화면 구성부터 기능 연결, 변경 기록까지.<br/>하나하나 신경 쓰지 않아도 자연스럽게 이어져요.</p></div><div className="flow-diagram"><span><MessageCircle size={22}/>아이디어</span><i/><span><WandSparkles size={22}/>자동 제작</span><i/><span><ShieldCheck size={22}/>점검 · 저장</span></div></div><div className="automation-grid">{[{icon:WandSparkles,title:'반복 없는 앱 제작',text:'선택한 디자인과 기능으로 작동하는 화면을 자동으로 구성해요.'},{icon:History,title:'수정할 때마다 기록',text:'무엇을 바꿨는지 저장하고, 이전 모습으로 언제든 돌아갈 수 있어요.'},{icon:ShieldCheck,title:'내보내기 전 자동 점검',text:'구성 데이터와 필수 요소를 확인하고, 추가로 확인할 사항을 알려드려요.'}].map(x=><div className="automation-card" key={x.title}><span className="feature-icon"><x.icon size={23}/></span><span className="enabled-tag"><span/>사용 가능</span><h3>{x.title}</h3><p>{x.text}</p></div>)}</div><div className="automation-check"><h2>내 프로젝트, 지금 점검해볼까요?</h2><p>실행할 준비가 됐는지 빠르게 살펴보세요.</p>{projects.length?<><div className="project-check-select"><select aria-label="점검할 프로젝트" value={active?.id||''} onChange={e=>{setSelected(e.target.value);setResult(null);}}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="button primary" disabled={busy} onClick={async()=>{if(!active)return;setBusy(true);try{setResult(await api.check(active.id));}catch(e){notify((e as Error).message);}finally{setBusy(false);}}}>{busy?<LoaderCircle className="spin" size={16}/>:<Zap size={16}/>}자동 점검 시작</button><button className="button secondary" onClick={()=>active&&onOpen(active)}>프로젝트 열기 <ArrowUpRight size={15}/></button></div>{result&&<div className="check-results">{result.checks.map(c=><div key={c.id} className={`check-item ${c.status}`}><span>{c.status==='passed'?<CheckCircle2 size={18}/>:<CircleHelp size={18}/>}</span><div><b>{c.label}</b><p>{c.detail}</p></div></div>)}</div>}</>:<div className="info-note">프로젝트를 만들면 자동 점검을 사용할 수 있어요.</div>}</div></div>;
}
function Guide({onStart}:{onStart:()=>void}) {return <div className="content-page guide-page page-enter"><PageHeading eyebrow="YOUR FIRST APP STARTS HERE" title="처음이어도, 어렵지 않아요" description="아이디어가 작동하는 앱이 되기까지. 네 걸음이면 충분해요."/><div className="guide-steps">{[{icon:MessageCircle,title:'만들고 싶은 것을 알려주세요',text:'“우리 가게 예약 사이트를 만들고 싶어요.” 평소 말하듯 설명해 주세요. 이름과 용도를 알려주면 시작할 수 있어요.'},{icon:Palette,title:'분위기와 기능을 골라보세요',text:'디자인 용어를 몰라도 괜찮아요. 따뜻한 느낌, 깔끔한 느낌 중 고르고 필요한 기능을 체크해 주세요.'},{icon:WandSparkles,title:'직접 써보고, 편하게 수정해요',text:'미리보기의 버튼을 눌러보세요. “초록색으로 바꿔줘”, “제목을 ‘우리의 이야기’로 바꿔줘”처럼 요청하거나 직접 수정할 수 있어요.'},{icon:Rocket,title:'내려받고, 실제로 실행해요',text:'실행 안내에서 점검한 뒤 HTML 파일을 내려받으세요. 파일을 두 번 누르면 브라우저에서 열려요. 인터넷 공개 방법도 함께 안내해요.'}].map((g,i)=><div className="guide-step" key={g.title}><span className="guide-number">0{i+1}</span><span className="guide-step-icon"><g.icon size={24}/></span><div><h2>{g.title}</h2><p>{g.text}</p></div></div>)}</div><div className="guide-faq"><h2>궁금한 점, 미리 알려드려요</h2>{[{q:'AI 연결 없이도 사용할 수 있나요?',a:isPortable()?'네. 이 파일은 외부 AI 없이 기본 제작과 지원하는 색상·문구·기능 수정을 실행해요. 실제 AI 연결은 전체 소스 버전을 서버에서 실행할 때 사용할 수 있어요.':'네. 기본 제작 모드에서는 검증된 구성으로 앱을 만들고, 기능 추가·색상 변경·제목이나 버튼 문구 수정 등을 할 수 있어요. 자유로운 요구사항을 해석하는 AI 제작 모드는 운영자가 서버에서 AI를 연결하면 사용할 수 있어요.'},{q:'작업하다 나가면 사라지나요?',a:isPortable()?'이 체험판의 질문과 프로젝트는 현재 브라우저에만 저장돼요. 다른 컴퓨터와 공유되지 않으며 브라우저 데이터를 지우면 사라져요. 필요한 결과물은 HTML 파일로 내려받아 보관해 주세요.':'질문에 답하는 동안은 브라우저에 임시 저장하고, 만들어진 프로젝트와 수정 기록은 현재 서버에 저장해요. 서버의 데이터 폴더를 삭제하면 프로젝트도 사라지므로 운영할 때는 백업해 주세요.'},{q:'예약이나 문의를 실제로 받을 수 있나요?',a:'현재 양식은 입력과 확인을 체험할 수 있으며, 방문자의 기기에만 저장돼요. 운영자가 여러 사람의 응답을 받거나 이메일을 발송하려면 별도 데이터베이스·양식 수집 서비스 연결이 필요해요.'},{q:'다른 사람에게 앱 주소를 공유할 수 있나요?',a:isPortable()?'체험판의 실행본 주소는 이 브라우저에서만 열려요. 다른 사람에게 보여주려면 HTML 파일을 내려받아 전달하거나 정적 호스팅 서비스에 올려주세요.':'현재 서버에 게시한 주소는 그 서버에 접근할 수 있는 환경에서 열려요. 인터넷에 공개하려면 내려받은 index.html을 정적 호스팅 서비스에 업로드하세요. 실행 안내 탭에서 순서대로 안내해 드려요.'}].map(f=><details key={f.q}><summary>{f.q}<Plus size={17}/></summary><p>{f.a}</p></details>)}</div><div className="guide-cta"><span>작은 아이디어 하나면 준비 끝.</span><h2>첫 번째 앱, 함께 만들어볼까요?</h2><button className="button primary" onClick={onStart}><Sparkles size={17}/>나의 첫 앱 만들기 <ArrowRight size={17}/></button></div></div>;}
