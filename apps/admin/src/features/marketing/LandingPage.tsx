import "@/features/marketing/landing.css";
import { OsIcon, type OsKey } from "@/shared/components/OsIcon";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { Badge, Button, Card, CardBody, CardDescription, CardTitle, Link, Separator } from "@linyao.tw/ui";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { BroadcastIcon } from "@phosphor-icons/react/dist/csr/Broadcast";
import { BuildingOfficeIcon } from "@phosphor-icons/react/dist/csr/BuildingOffice";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { CloudSlashIcon } from "@phosphor-icons/react/dist/csr/CloudSlash";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { ForkKnifeIcon } from "@phosphor-icons/react/dist/csr/ForkKnife";
import { MapTrifoldIcon } from "@phosphor-icons/react/dist/csr/MapTrifold";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { StorefrontIcon } from "@phosphor-icons/react/dist/csr/Storefront";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";

const CONTACT_EMAIL = "contact@linyao.tw";
const MAILTO = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("HUAN 讙 採購諮詢")}`;

/** 目錄條目式的敘述：適合 meta description 與頁尾，不適合當首屏的主打。 */
const PRODUCT_TAGLINE = "跨平台的雲端媒體播放與數位看板系統，支援影片、圖片與文字內容，並可從遠端集中上傳、排程、同步與管理多台播放裝置。";

interface Shot {
	src: string;
	alt: string;
	caption: string;
}

interface Step {
	number: string;
	title: string;
	text: string;
	shot: Shot;
}

const STEPS: Step[] = [
	{
		number: "01",
		title: "上傳素材",
		text: "影片、圖片與 HTML 拖進瀏覽器就好。伺服器會自己轉檔、產生縮圖與播放版本，狀態一路看得到。",
		shot: { src: "/screenshots/media.png", alt: "素材庫畫面，顯示上傳區與各素材的處理狀態", caption: "素材庫" }
	},
	{
		number: "02",
		title: "切版面",
		text: "把畫面水平或垂直切開，每一塊都能再切一次。比例用拖的或直接輸入數字，同一份版面在 1080p 與 4K 上維持相同構圖。",
		shot: { src: "/screenshots/layout-editor.png", alt: "版面編輯器，左側素材、中間預覽、右側屬性面板", caption: "版面編輯器" }
	},
	{
		number: "03",
		title: "排時段、發布",
		text: "以星期與時段安排版面，支援跨午夜與日期範圍。多個排程同時命中時依優先度與精確度決定，規則是公開的。",
		shot: { src: "/screenshots/schedules.png", alt: "排程畫面，顯示週視圖與衝突判定規則", caption: "排程" }
	}
];

const PLATFORMS: { os: OsKey; name: string; note: string }[] = [
	{ os: "raspberry-pi", name: "Raspberry Pi", note: "arm64 / armhf，適合單機看板" },
	{ os: "windows", name: "Windows", note: "x64，可沿用既有數位看板電腦" },
	{ os: "ubuntu", name: "Ubuntu", note: "x64 / arm64，伺服器與工控機常見的選擇" },
	{ os: "macos", name: "macOS", note: "Apple Silicon 與 Intel" }
];

interface Feature {
	icon: ReactNode;
	title: string;
	description: string;
}

const FEATURES: Feature[] = [
	{ icon: <BroadcastIcon weight="bold" size={24} />, title: "遠端集中管理", description: "在瀏覽器上傳素材、編排畫面並指定播放裝置。內容送出後由裝置自行下載與驗證，不需要現場人員插隨身碟。" },
	{
		icon: <SquaresFourIcon weight="bold" size={24} />,
		title: "遞迴分割排版",
		description: "把畫面任意水平或垂直切分，每一塊都能再切一次。文字、跑馬燈、圖片、影片、網頁各自獨立設定，比例可以拖曳也可以用鍵盤微調。"
	},
	{ icon: <CalendarBlankIcon weight="bold" size={24} />, title: "時段排程", description: "以 IANA 時區、星期與時段安排版面，支援跨午夜區間與日期範圍。衝突時依優先度與精確度決定，規則公開可預期。" },
	{
		icon: <MonitorIcon weight="bold" size={24} />,
		title: "多裝置同步",
		description: "發布之後不會出現一半新、一半舊的畫面。裝置要把所有檔案下載並校驗完成才整批切換，切換的那一刻不會閃黑或播到殘缺內容。"
	},
	{ icon: <CloudSlashIcon weight="bold" size={24} />, title: "離線續播", description: "素材先下載到本機才播放。網路中斷時看板照常運作，恢復連線後再自動補上新版本。" },
	{ icon: <ShieldCheckIcon weight="bold" size={24} />, title: "安全與稽核", description: "密碼以 Argon2id 保存、支援兩步驟驗證，登入、配對、發布與刪除都會留下含操作者與對象的紀錄。" }
];

const USE_CASES: Feature[] = [
	{ icon: <ForkKnifeIcon weight="bold" size={24} />, title: "餐飲點餐看板", description: "早午餐與正餐菜單依時段自動切換，價格調整當天就能同步到所有分店。" },
	{ icon: <StorefrontIcon weight="bold" size={24} />, title: "零售櫥窗", description: "整面牆的影片搭配側邊跑馬燈促銷資訊，畫面比例在後台先看到，實機呈現一致。" },
	{ icon: <BuildingOfficeIcon weight="bold" size={24} />, title: "辦公室公告", description: "公司公告、會議室狀態與內部儀表板網頁併排顯示，行政人員自己就能更新。" },
	{ icon: <MapTrifoldIcon weight="bold" size={24} />, title: "展場導覽", description: "多台裝置播放同一份導覽內容，展期結束以日期區間自動下架，不需要現場收拾。" }
];

const CAVEATS = [
	{ title: "斷線期間發布的內容不會生效", text: "新版本要等所有檔案下載並校驗完成才整批切換，所以離線時發布的東西會等到連線恢復才出現。" },
	{ title: "網頁內容需要連線", text: "版面裡的網址區塊是即時載入外部網站，那份內容不在本機，離線時會是空白。" },
	{ title: "伺服器不長期保存素材", text: "原始檔轉檔後刪除，播放產物在所有裝置確認並過保留期後回收。之後有新裝置需要同一份素材時會標記為「需重新上傳」。" }
];

function ProductShot({ shot }: { shot: Shot }) {
	return (
		<figure className="huan-shot">
			<figcaption className="huan-shot__bar">{shot.caption}</figcaption>
			{/* width/height 是圖的原始尺寸：沒有它，圖片載入時底下的文字會先往上擠再被推下去。 */}
			<img className="huan-shot__image" src={shot.src} alt={shot.alt} width={1280} height={720} loading="lazy" decoding="async" />
		</figure>
	);
}

export function LandingPage() {
	return (
		<div className="huan-landing">
			<header className="huan-landing__header huan-landing__inner">
				<RouterLink to="/" className="huan-shell__brand">
					<span className="huan-shell__brand-mark">HUAN</span>
					<span className="huan-shell__brand-han">讙</span>
				</RouterLink>
				<div className="huan-row huan-row--tight">
					<ThemeToggle />
					<Button render={<a href="/docs/" />} nativeButton={false} variant="quiet" size="sm">
						文件
					</Button>
					<Button render={<RouterLink to="/login" />} nativeButton={false} variant="secondary" size="sm">
						登入
					</Button>
				</div>
			</header>

			<main>
				<section className="huan-landing__section huan-landing__section--hero huan-landing__inner" aria-labelledby="hero-heading">
					<div className="huan-hero">
						<div className="huan-hero__copy">
							<Badge variant="accent">雲端數位看板系統</Badge>
							<h1 className="huan-hero__title" id="hero-heading">
								排好畫面，看板自己接手
							</h1>
							<p className="huan-hero__lede">在瀏覽器切版面、排時段，內容自動送到 Raspberry Pi、Windows、Ubuntu 與 macOS 的播放裝置。素材先下載到本機才播，斷網也不會變黑畫面。</p>
							<div className="huan-hero__actions">
								<Button render={<a href={MAILTO} />} nativeButton={false} size="lg" startIcon={<EnvelopeSimpleIcon weight="bold" />}>
									來信洽詢採購
								</Button>
								<Button render={<RouterLink to="/login" />} nativeButton={false} variant="secondary" size="lg" endIcon={<ArrowRightIcon weight="bold" />}>
									進入後台
								</Button>
							</div>
						</div>

						<ProductShot shot={{ src: "/screenshots/layout-editor.png", alt: "HUAN 的版面編輯器，畫面被切成多個區塊並各自指定內容", caption: "版面編輯器 · 1920 × 1080" }} />
					</div>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section huan-landing__inner" aria-labelledby="platforms-heading">
						<span className="huan-section__eyebrow">支援平台</span>
						<h2 className="huan-section__title" id="platforms-heading">
							同一份內容，四種平台
						</h2>
						<p className="huan-section__lede">播放器以 Electron 打包，同一份版面在四種作業系統上呈現一致。</p>
						<ul className="huan-platform-strip huan-section__body">
							{PLATFORMS.map(platform => (
								<li key={platform.name}>
									<span className="huan-platform-strip__icon">
										<OsIcon os={platform.os} size="1.5rem" />
									</span>
									<span className="huan-platform-strip__name">{platform.name}</span>
									<span className="huan-platform-strip__note">{platform.note}</span>
								</li>
							))}
						</ul>
					</section>
				</div>

				<section className="huan-landing__section huan-landing__inner" aria-labelledby="how-heading">
					<span className="huan-section__eyebrow">怎麼運作</span>
					<h2 className="huan-section__title" id="how-heading">
						三個步驟，從素材到現場
					</h2>
					<p className="huan-section__lede">整條路只有這三步。做完之後裝置會自己把內容拿下去播，不需要有人到現場。</p>
					<div className="huan-steps huan-section__body">
						{STEPS.map(step => (
							<article className="huan-step" key={step.number}>
								<div className="huan-step__copy">
									<span className="huan-step__number">{step.number}</span>
									<h3 className="huan-step__title">{step.title}</h3>
									<p className="huan-step__text">{step.text}</p>
								</div>
								<ProductShot shot={step.shot} />
							</article>
						))}
					</div>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section huan-landing__inner" aria-labelledby="offline-heading">
						<div className="huan-split">
							<div>
								<span className="huan-section__eyebrow">離線與多裝置</span>
								<h2 className="huan-section__title" id="offline-heading">
									網路斷了，看板還在播
								</h2>
								<p className="huan-section__lede">HUAN 是本機優先播放：素材一定要先完整下載到裝置、通過 SHA-256 校驗之後才會播。</p>
								<ul className="huan-points huan-section__body">
									<li>
										<span className="huan-points__icon">
											<CheckCircleIcon weight="fill" size={20} />
										</span>
										<span>網路中斷時繼續播已經在本機的內容，不會變成黑畫面或錯誤訊息。</span>
									</li>
									<li>
										<span className="huan-points__icon">
											<CheckCircleIcon weight="fill" size={20} />
										</span>
										<span>新版本整批切換，不會出現一半新、一半舊的畫面。</span>
									</li>
									<li>
										<span className="huan-points__icon">
											<CheckCircleIcon weight="fill" size={20} />
										</span>
										<span>每台裝置的線上狀態、版本、磁碟與最後回報時間都看得到。</span>
									</li>
								</ul>
							</div>
							<ProductShot shot={{ src: "/screenshots/devices.png", alt: "裝置列表，顯示每台裝置的線上狀態、平台、版本與磁碟使用量", caption: "裝置" }} />
						</div>
					</section>
				</div>

				<section className="huan-landing__section huan-landing__inner" aria-labelledby="features-heading">
					<span className="huan-section__eyebrow">功能</span>
					<h2 className="huan-section__title" id="features-heading">
						只做這條路上該做的事
					</h2>
					<p className="huan-section__lede">從內容製作到現場播放，HUAN 只負責把這條路走完，不做多餘的事。</p>
					<div className="huan-feature-grid huan-section__body">
						{FEATURES.map(feature => (
							<div className="huan-feature" key={feature.title}>
								<span className="huan-feature__icon" aria-hidden="true">
									{feature.icon}
								</span>
								<h3 className="huan-feature__title">{feature.title}</h3>
								<p className="huan-feature__text">{feature.description}</p>
							</div>
						))}
					</div>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section huan-landing__inner" aria-labelledby="usecases-heading">
						<span className="huan-section__eyebrow">使用情境</span>
						<h2 className="huan-section__title" id="usecases-heading">
							同一套系統，四種完全不同的現場
						</h2>
						<div className="huan-usecase-grid huan-section__body">
							{USE_CASES.map(useCase => (
								<Card key={useCase.title} variant="elevated">
									<CardBody>
										<div className="huan-feature">
											<span className="huan-feature__icon" aria-hidden="true">
												{useCase.icon}
											</span>
											<CardTitle level={3}>{useCase.title}</CardTitle>
											<CardDescription>{useCase.description}</CardDescription>
										</div>
									</CardBody>
								</Card>
							))}
						</div>
					</section>
				</div>

				<section className="huan-landing__section huan-landing__inner" aria-labelledby="honest-heading">
					<span className="huan-section__eyebrow">我們把話說清楚</span>
					<h2 className="huan-section__title" id="honest-heading">
						離線做得到什麼，做不到什麼
					</h2>
					<p className="huan-section__lede">我們選擇把這個取捨寫在這裡，而不是等你在後台遇到才發現。</p>
					<ul className="huan-caveats huan-section__body">
						{CAVEATS.map(caveat => (
							<li key={caveat.title}>
								<h3 className="huan-caveat__title">{caveat.title}</h3>
								<p className="huan-caveat__text">{caveat.text}</p>
							</li>
						))}
					</ul>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section huan-landing__section--cta huan-landing__inner" aria-labelledby="cta-heading">
						<div className="huan-cta">
							<h2 className="huan-cta__title" id="cta-heading">
								想導入 HUAN？
							</h2>
							<p className="huan-hero__lede">告訴我們場域、裝置數量與想播的內容，我們會回覆合適的部署方式與報價。</p>
							<div className="huan-cta__actions">
								<Button render={<a href={MAILTO} />} nativeButton={false} size="lg" startIcon={<EnvelopeSimpleIcon weight="bold" />}>
									寄信給 {CONTACT_EMAIL}
								</Button>
								<Link href="/docs/">閱讀文件</Link>
							</div>
							<p className="huan-landing__caption">採購僅接受 Email 洽詢，本站不提供線上付款流程。</p>
						</div>
					</section>
				</div>
			</main>

			<footer className="huan-landing__footer">
				<div className="huan-landing__inner">
					<div className="huan-landing__footer-top">
						<div className="huan-stack huan-stack--sm">
							<div className="huan-shell__brand">
								<span className="huan-shell__brand-mark">HUAN</span>
								<span className="huan-shell__brand-han">讙</span>
							</div>
							<p className="huan-landing__caption">{PRODUCT_TAGLINE}</p>
						</div>
						<nav aria-label="頁尾" className="huan-landing__footer-nav">
							<Link href="/docs/" size="sm">
								文件
							</Link>
							<Link href={`mailto:${CONTACT_EMAIL}`} size="sm">
								{CONTACT_EMAIL}
							</Link>
							<Link render={<RouterLink to="/login" />} size="sm">
								登入
							</Link>
						</nav>
					</div>
					<Separator spacing="none" />
					<div className="huan-landing__footer-bottom">
						<p className="huan-landing__caption">© 麟曜數位工作室</p>
					</div>
				</div>
			</footer>
		</div>
	);
}
