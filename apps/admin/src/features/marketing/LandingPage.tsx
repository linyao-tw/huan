import "@/features/marketing/landing.css";
import { Brand } from "@/shared/components/Brand";
import { OsIcon, type OsKey } from "@/shared/components/OsIcon";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { MARKETING_TITLE, usePageTitle } from "@/shared/hooks/use-document-title";
import { Button, Card, CardBody, CardDescription, CardTitle, Link } from "@linyao.tw/ui";
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
const PRODUCT_TAGLINE = "企業級雲端數位看板與媒體播放平台，支援影片、圖片、文字與網頁內容，並提供遠端素材管理、版面編排、排程發布、多裝置同步與離線播放能力。";

interface Shot {
	src: string;
	alt: string;
	/** 沒給就不畫標題列。首屏那張旁邊已經有大標，再標一次是重複。 */
	caption?: string;
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
		title: "上傳與管理素材",
		text: "直接在瀏覽器上傳影片、圖片與 HTML 內容。系統會自動完成轉檔、縮圖與播放版本處理，並即時顯示每筆素材的處理狀態。",
		shot: { src: "/screenshots/media.png", alt: "素材庫畫面，顯示上傳區與各素材的處理狀態", caption: "素材庫" }
	},
	{
		number: "02",
		title: "設計多區域版面",
		text: "以水平或垂直方式分割畫面，每個區域皆可進一步建立巢狀配置。區域比例可透過拖曳調整或直接輸入數值，確保相同版面在不同解析度下維持一致構圖。",
		shot: { src: "/screenshots/layout-editor.png", alt: "版面編輯器，左側素材、中間預覽、右側屬性面板", caption: "版面編輯器" }
	},
	{
		number: "03",
		title: "建立排程並發布",
		text: "依星期、日期與時段安排播放內容，支援跨午夜排程與有效日期區間。當多個排程同時符合條件時，系統會依優先度與匹配精確度自動決定播放內容，讓排程結果明確且可預期。",
		shot: { src: "/screenshots/schedules.png", alt: "排程畫面，顯示週視圖，以及同一時間有多個排程時播哪一個", caption: "排程" }
	}
];

const PLATFORMS: { os: OsKey; name: string; note: string }[] = [
	{ os: "raspberry-pi", name: "Raspberry Pi", note: "支援 arm64 / armhf，適合空間受限、低功耗或單機型數位看板部署。" },
	{ os: "windows", name: "Windows", note: "支援 x64，可直接延用既有數位看板電腦與商用終端設備。" },
	{ os: "ubuntu", name: "Ubuntu", note: "支援 x64 / arm64，適合工控設備、商用終端與 Linux 部署環境。" },
	{ os: "macos", name: "macOS", note: "支援 Apple Silicon 與 Intel 平台。" }
];

interface Feature {
	icon: ReactNode;
	title: string;
	description: string;
}

const FEATURES: Feature[] = [
	{
		icon: <BroadcastIcon weight="bold" size={24} />,
		title: "集中式遠端管理",
		description: "透過瀏覽器統一管理素材、版面、排程與播放裝置。發布內容後，各裝置會自動完成下載、驗證與更新，降低人工維護與現場操作需求。"
	},
	{
		icon: <SquaresFourIcon weight="bold" size={24} />,
		title: "彈性的多區域版面",
		description: "以水平或垂直方式建立多層次區域配置，每個區域皆可獨立呈現文字、跑馬燈、圖片、影片與網頁內容。尺寸比例支援拖曳調整與精確數值輸入，滿足不同畫面配置需求。"
	},
	{
		icon: <CalendarBlankIcon weight="bold" size={24} />,
		title: "可預期的播放排程",
		description: "依 IANA 時區、星期、時段與日期區間設定播放規則，並支援跨午夜情境。當排程條件重疊時，系統依既定優先度與精確度規則解析，確保播放結果透明且一致。"
	},
	{
		icon: <MonitorIcon weight="bold" size={24} />,
		title: "一致的多裝置發布",
		description: "每台裝置會在所有檔案下載與驗證完成後才啟用新版本，避免部分內容提前更新。版本切換以完整狀態進行，降低播放中斷、畫面閃黑與缺檔風險。"
	},
	{
		icon: <CloudSlashIcon weight="bold" size={24} />,
		title: "本機優先的離線播放",
		description: "播放素材預先同步至裝置本機，網路中斷時仍可持續正常播放。重新連線後，裝置會自動同步並套用最新可用版本。"
	},
	{
		icon: <ShieldCheckIcon weight="bold" size={24} />,
		title: "安全性與操作稽核",
		description: "帳號密碼採用 Argon2id 雜湊保存，並支援兩步驟驗證。登入、裝置配對、內容發布與刪除等重要操作皆會保留操作者與操作對象紀錄，提供完整的稽核依據。"
	}
];

const USE_CASES: Feature[] = [
	{
		icon: <ForkKnifeIcon weight="bold" size={24} />,
		title: "餐飲菜單看板",
		description: "依早餐、午餐、晚餐或促銷時段自動切換菜單內容。價格與品項更新後即可集中發布至各分店，降低逐店維護成本。"
	},
	{
		icon: <StorefrontIcon weight="bold" size={24} />,
		title: "零售與櫥窗展示",
		description: "將品牌影片、商品資訊與即時促銷訊息整合於同一畫面。版面可預先於後台確認，確保不同門市與顯示設備維持一致的視覺呈現。"
	},
	{
		icon: <BuildingOfficeIcon weight="bold" size={24} />,
		title: "企業內部資訊發布",
		description: "整合公司公告、會議室資訊、營運數據與內部網頁，讓行政與營運團隊可直接維護內容，快速發布至辦公空間中的各類顯示設備。"
	},
	{
		icon: <MapTrifoldIcon weight="bold" size={24} />,
		title: "展覽與活動導覽",
		description: "將導覽內容同步發布至多台裝置，並透過日期區間控制上線與下架時間。活動結束後可依排程自動停止播放，減少現場人工操作。"
	}
];

/** 離線那一段的三個要點：每一項都有自己的小標，掃過去就知道在講什麼。 */
const OFFLINE_POINTS: { title: string; text: string }[] = [
	{ title: "離線持續播放", text: "網路中斷時，裝置持續播放已同步至本機的內容，不因連線異常而出現黑畫面或錯誤頁面。" },
	{ title: "完整版本切換", text: "新版本會在所有必要檔案下載並驗證完成後一次套用，避免內容處於新舊版本混合的狀態。" },
	{ title: "集中掌握裝置狀態", text: "從後台查看每台裝置的連線狀態、軟體版本、磁碟使用量與最後回報時間，快速掌握現場運作情況。" }
];

/**
 * 截圖有亮色與深色兩份，由 CSS 依主題決定顯示哪一張。
 *
 * 只放亮色的話，深色頁面上會出現一塊發光的白方塊。不用 JS 切換是因為主題在
 * 第一次繪製前就決定好了，交給 CSS 可以避免載入後才換圖的閃動。
 */
function ProductShot({ shot }: { shot: Shot }) {
	const dark = shot.src.replace(/\.png$/, "-dark.png");
	return (
		<figure className="huan-shot">
			{shot.caption !== undefined && <figcaption className="huan-shot__bar">{shot.caption}</figcaption>}
			{/* width/height 是圖的原始尺寸：沒有它，圖片載入時底下的文字會先往上擠再被推下去。 */}
			<img className="huan-shot__image huan-shot__image--light" src={shot.src} alt={shot.alt} width={1280} height={720} loading="lazy" decoding="async" />
			<img className="huan-shot__image huan-shot__image--dark" src={dark} alt={shot.alt} width={1280} height={720} loading="lazy" decoding="async" />
		</figure>
	);
}

export function LandingPage() {
	usePageTitle(MARKETING_TITLE);

	return (
		<div className="huan-landing">
			<header className="huan-landing__header huan-landing__inner">
				<RouterLink to="/" className="huan-shell__brand">
					<Brand />
				</RouterLink>
				<div className="huan-row huan-row--tight">
					<ThemeToggle />
					<Button aria-label="文件（在新視窗開啟）" render={<a href="/docs/" target="_blank" rel="noopener noreferrer" />} nativeButton={false} variant="quiet" size="sm">
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
							<h1 className="huan-hero__title" id="hero-heading">
								集中管理每一個畫面，穩定發布到每一台裝置
							</h1>
							<p className="huan-hero__lede">
								HUAN 是專為數位看板打造的雲端內容管理與播放平台。從版面設計、內容排程到裝置發布，都可直接在瀏覽器完成；播放內容預先同步至裝置本機，即使網路中斷，現場畫面依然持續穩定播放。
							</p>
							<div className="huan-hero__actions">
								<Button render={<a href={MAILTO} />} nativeButton={false} size="lg" startIcon={<EnvelopeSimpleIcon weight="bold" />}>
									來信洽詢採購
								</Button>
								<Button render={<RouterLink to="/login" />} nativeButton={false} variant="secondary" size="lg" endIcon={<ArrowRightIcon weight="bold" />}>
									進入後台
								</Button>
							</div>
						</div>

						<ProductShot shot={{ src: "/screenshots/layout-editor.png", alt: "HUAN 的版面編輯器，畫面被切成多個區塊並各自指定內容" }} />
					</div>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section huan-landing__inner" aria-labelledby="platforms-heading">
						<h2 className="huan-section__title" id="platforms-heading">
							跨平台部署，一套內容一致呈現
						</h2>
						<p className="huan-section__lede">HUAN Player 以 Electron 建構，支援主流桌面與嵌入式作業系統。無論部署於單機看板、既有商用電腦或工控設備，都能使用相同的版面、內容與管理流程。</p>
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
					<h2 className="huan-section__title" id="how-heading">
						三個步驟，完成從內容到現場的發布流程
					</h2>
					<p className="huan-section__lede">從素材建立、版面編排到播放排程，HUAN 將完整工作流程整合於同一套管理介面。發布完成後，各播放裝置會自動同步、驗證並套用最新內容，無需逐台進行現場操作。</p>
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
								<h2 className="huan-section__title" id="offline-heading">
									即使網路中斷，播放仍持續運作
								</h2>
								<p className="huan-section__lede">HUAN 採用本機優先的播放架構。所有素材都必須完整下載至播放裝置，並通過 SHA-256 完整性驗證後才會正式啟用，降低網路品質對現場播放的影響。</p>
								<ul className="huan-points huan-section__body">
									{OFFLINE_POINTS.map(point => (
										<li key={point.title}>
											<span className="huan-points__icon">
												<CheckCircleIcon weight="fill" size={20} />
											</span>
											<span className="huan-points__copy">
												<span className="huan-points__title">{point.title}</span>
												<span className="huan-points__text">{point.text}</span>
											</span>
										</li>
									))}
								</ul>
							</div>
							<ProductShot shot={{ src: "/screenshots/devices.png", alt: "裝置列表，顯示每台裝置的線上狀態、平台、版本與磁碟使用量", caption: "裝置" }} />
						</div>
					</section>
				</div>

				<section className="huan-landing__section huan-landing__inner" aria-labelledby="features-heading">
					<h2 className="huan-section__title" id="features-heading">
						為數位看板營運所設計的完整能力
					</h2>
					<p className="huan-section__lede">從內容建立、排程發布到多裝置管理，HUAN 提供數位看板日常營運所需的核心功能，讓內容管理與現場播放維持一致、可靠且可控。</p>
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
						<h2 className="huan-section__title" id="usecases-heading">
							一套平台，適用多種數位顯示場景
						</h2>
						<p className="huan-section__lede">從單一門市到多據點部署，HUAN 可依不同產業與現場需求組合版面、內容與播放規則，在同一套管理平台上維持一致的營運流程。</p>
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

				<div className="huan-landing__band">
					<section className="huan-landing__section huan-landing__section--cta huan-landing__inner" aria-labelledby="cta-heading">
						<div className="huan-cta">
							{/* 整頁最後看到的是這隻獸，當作署名。純裝飾，旁邊就是產品名。 */}
							<span className="huan-cta__mark" aria-hidden="true" />
							<h2 className="huan-cta__title" id="cta-heading">
								準備導入 HUAN？
							</h2>
							<p className="huan-cta__lede">告訴我們您的使用場域、預計部署的裝置數量，以及希望呈現的內容形式。我們會依實際需求提供合適的部署建議與報價。</p>
							<div className="huan-cta__actions">
								<Button render={<a href={MAILTO} />} nativeButton={false} size="lg" startIcon={<EnvelopeSimpleIcon weight="bold" />}>
									寄信給 {CONTACT_EMAIL}
								</Button>
								<Link href="/docs/" target="_blank" rel="noopener noreferrer">
									閱讀文件
								</Link>
							</div>
							<p className="huan-landing__caption">HUAN 採專案洽詢方式提供導入與採購服務，目前不提供線上付款。</p>
						</div>
					</section>
				</div>
			</main>

			<footer className="huan-landing__footer">
				<div className="huan-landing__inner">
					<div className="huan-landing__footer-top">
						<div className="huan-stack huan-stack--sm">
							<div className="huan-shell__brand">
								<Brand />
							</div>
							<p className="huan-landing__caption">{PRODUCT_TAGLINE}</p>
						</div>
						<nav aria-label="頁尾" className="huan-landing__footer-nav">
							<Link href="/docs/" size="sm" target="_blank" rel="noopener noreferrer">
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
					<div className="huan-landing__footer-bottom">
						<p className="huan-landing__caption">© 麟曜數位工作室</p>
					</div>
				</div>
			</footer>
		</div>
	);
}
