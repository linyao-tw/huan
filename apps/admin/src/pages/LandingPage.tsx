import { ThemeToggle } from "@/components/ThemeToggle";
import { Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardBody, CardDescription, CardTitle, Link, SectionHeading, Separator } from "@linyao.tw/ui";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { BroadcastIcon } from "@phosphor-icons/react/dist/csr/Broadcast";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { ClipboardTextIcon } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { CloudSlashIcon } from "@phosphor-icons/react/dist/csr/CloudSlash";
import { EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/csr/EnvelopeSimple";
import { MonitorIcon } from "@phosphor-icons/react/dist/csr/Monitor";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/csr/SquaresFour";
import { StorefrontIcon } from "@phosphor-icons/react/dist/csr/Storefront";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router";

const CONTACT_EMAIL = "contact@linyao.tw";
const PRODUCT_TAGLINE = "跨平台的雲端媒體播放與數位看板系統，支援影片、圖片與文字內容，並可從遠端集中上傳、排程、同步與管理多台播放裝置。";

interface Feature {
	icon: ReactNode;
	title: string;
	description: string;
}

const FEATURES: Feature[] = [
	{ icon: <BroadcastIcon weight="bold" />, title: "遠端集中管理", description: "在瀏覽器上傳素材、編排畫面並指定播放裝置。內容送出後由裝置自行下載與驗證，不需要現場人員插隨身碟。" },
	{
		icon: <SquaresFourIcon weight="bold" />,
		title: "遞迴分割排版",
		description: "把畫面任意水平或垂直切分，每一塊都能再切一次。文字、跑馬燈、圖片、影片、網頁各自獨立設定，比例可以拖曳也可以用鍵盤微調。"
	},
	{ icon: <CalendarBlankIcon weight="bold" />, title: "時段排程", description: "以 IANA 時區、星期與時段安排版面，支援跨午夜區間與日期範圍。衝突時依優先度與精確度決定，規則公開可預期。" },
	{ icon: <CloudSlashIcon weight="bold" />, title: "離線播放", description: "素材必須先完整下載到裝置才會播放。網路斷線時看板照常運作，恢復連線後再自動補上新版本。" },
	{ icon: <MonitorIcon weight="bold" />, title: "多裝置同步", description: "伺服器只宣告「這台裝置應該播哪一個版面修訂」，裝置下載、校驗、再原子性切換，因此不會出現半套內容。" },
	{ icon: <ClipboardTextIcon weight="bold" />, title: "稽核紀錄", description: "登入、配對、發布、刪除等關鍵操作都會留下紀錄，包含操作者與目標對象，方便日後追查。" }
];

const PLATFORMS = [
	{ name: "Raspberry Pi", note: "arm64 / armhf，適合單機看板" },
	{ name: "Windows", note: "x64，可沿用既有數位看板電腦" },
	{ name: "Ubuntu", note: "x64 / arm64，長期執行穩定" },
	{ name: "macOS", note: "Apple Silicon 與 Intel" }
];

const USE_CASES = [
	{ icon: <StorefrontIcon weight="bold" />, title: "餐飲點餐看板", description: "早午餐與正餐菜單依時段自動切換，價格調整當天就能同步到所有分店。" },
	{ icon: <StorefrontIcon weight="bold" />, title: "零售櫥窗", description: "整面牆的影片搭配側邊跑馬燈促銷資訊，畫面比例在後台先看到，實機呈現一致。" },
	{ icon: <ClipboardTextIcon weight="bold" />, title: "辦公室公告", description: "公司公告、會議室狀態與內部儀表板網頁併排顯示，行政人員自己就能更新。" },
	{ icon: <MonitorIcon weight="bold" />, title: "展場導覽", description: "多台裝置播放同一份導覽內容，展期結束以日期區間自動下架，不需要現場收拾。" }
];

export function LandingPage() {
	return (
		<div className="huan-landing">
			<header className="huan-landing__header">
				<RouterLink to="/" className="huan-shell__brand">
					<span className="huan-shell__brand-mark">HUAN</span>
					<span className="huan-shell__brand-han">讙</span>
				</RouterLink>
				<div className="huan-row huan-row--tight">
					<ThemeToggle />
					<Link href="/docs/" size="sm">
						文件
					</Link>
					<Button render={<RouterLink to="/login" />} nativeButton={false} variant="secondary" size="sm">
						登入
					</Button>
				</div>
			</header>

			<main>
				<section className="huan-landing__section" aria-label="產品介紹">
					<div className="huan-hero">
						<div className="huan-hero__copy">
							<Badge variant="accent">雲端數位看板系統</Badge>
							<div className="huan-hero__wordmark">
								<span className="huan-hero__wordmark-latin">HUAN</span>
								<span className="huan-hero__wordmark-han">讙</span>
							</div>
							<h1 className="huan-hero__title" id="hero-heading">
								把畫面設計好，剩下的交給裝置自己完成
							</h1>
							<p className="huan-hero__lede">{PRODUCT_TAGLINE}</p>
							<div className="huan-hero__actions">
								<Button render={<a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("HUAN 讙 採購諮詢")}`} />} nativeButton={false} startIcon={<EnvelopeSimpleIcon weight="bold" />}>
									來信洽詢採購
								</Button>
								<Button render={<RouterLink to="/login" />} nativeButton={false} variant="secondary" endIcon={<ArrowRightIcon weight="bold" />}>
									進入後台
								</Button>
							</div>
							<p className="huan-caption">HUAN 目前僅透過 Email 洽詢採購，網站上不提供線上刷卡或自助訂閱。</p>
						</div>

						<div className="huan-hero__panel" aria-hidden="true">
							<div className="huan-hero__panel-bar">1920 × 1080 · 版面預覽</div>
							<div className="huan-hero__panel-body">
								<div className="huan-hero__cell huan-hero__cell--accent">
									<span className="huan-hero__cell-title">主視覺影片</span>
									<span>video · cover</span>
								</div>
								<div className="huan-hero__cell">
									<span className="huan-hero__cell-title">今日菜單</span>
									<span>text · center</span>
								</div>
								<div className="huan-hero__cell huan-hero__cell--span">
									<span className="huan-hero__cell-title">跑馬燈</span>
									<span>ticker · 120 px/s</span>
								</div>
							</div>
						</div>
					</div>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section" aria-label="功能">
						<SectionHeading level={2} size="lg" description="從內容製作到現場播放，HUAN 只負責把這條路走完，不做多餘的事。">
							功能
						</SectionHeading>
						<div className="huan-feature-grid">
							{FEATURES.map(feature => (
								<Card key={feature.title} variant="material">
									<CardBody>
										<div className="huan-feature">
											<span className="huan-feature__icon" aria-hidden="true">
												{feature.icon}
											</span>
											<CardTitle level={3}>{feature.title}</CardTitle>
											<CardDescription>{feature.description}</CardDescription>
										</div>
									</CardBody>
								</Card>
							))}
						</div>
					</section>
				</div>

				<section className="huan-landing__section" aria-label="支援平台">
					<SectionHeading level={2} size="lg" description="播放器以 Electron 打包，同一份內容在四種平台上呈現一致。">
						支援平台
					</SectionHeading>
					<ul className="huan-platform-list">
						{PLATFORMS.map(platform => (
							<li key={platform.name}>
								<Card variant="outline" size="sm">
									<CardBody>
										<div className="huan-stack huan-stack--sm">
											<CardTitle level={3}>{platform.name}</CardTitle>
											<CardDescription>{platform.note}</CardDescription>
										</div>
									</CardBody>
								</Card>
							</li>
						))}
					</ul>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section" aria-label="使用情境">
						<SectionHeading level={2} size="lg" description="以下是實際在跑的使用情境，不是示意圖。">
							使用情境
						</SectionHeading>
						<div className="huan-usecase-grid">
							{USE_CASES.map(useCase => (
								<Card key={useCase.title} variant="material">
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

				<section className="huan-landing__section" aria-label="離線播放說明">
					<SectionHeading level={2} size="lg">
						關於離線播放，我們把話說清楚
					</SectionHeading>
					<div className="huan-stack">
						<p className="huan-hero__lede">HUAN 是本機優先播放：素材一定要先完整下載到裝置、通過 SHA-256 校驗之後才會播放。網路中斷時看板會繼續播放已經在本機的內容，不會變成黑畫面或錯誤訊息。</p>
						<Alert status="warning">
							<AlertTitle>但也有幾件事離線做不到</AlertTitle>
							<AlertDescription>
								新版本要等所有檔案下載並驗證完成才會原子性切換，因此斷線期間發布的內容不會生效。網頁（URL）內容本身仰賴外部網站，離線時無法載入。此外，RustFS 不是 HUAN
								的永久素材庫：原始檔在轉檔完成後就會刪除，播放產物在所有目標裝置確認並過了保留期後也會回收；之後若有新裝置需要同一份素材，該素材會被標記為「需重新上傳」。我們選擇把這個取捨寫在這裡，而不是等你在後台遇到才發現。
							</AlertDescription>
						</Alert>
					</div>
				</section>

				<div className="huan-landing__band">
					<section className="huan-landing__section huan-landing__section--tight" aria-label="聯絡我們">
						<Card variant="elevated">
							<CardBody>
								<div className="huan-stack">
									<SectionHeading level={2} size="md" description="告訴我們場域、裝置數量與想播的內容，我們會回覆合適的部署方式與報價。">
										想導入 HUAN？
									</SectionHeading>
									<div className="huan-row">
										<Button render={<a href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("HUAN 讙 採購諮詢")}`} />} nativeButton={false} startIcon={<EnvelopeSimpleIcon weight="bold" />}>
											寄信給 {CONTACT_EMAIL}
										</Button>
										<Link href="/docs/">閱讀文件</Link>
									</div>
									<p className="huan-caption">採購僅接受 Email 洽詢。本站不提供線上付款流程。</p>
								</div>
							</CardBody>
						</Card>
					</section>
				</div>
			</main>

			<footer className="huan-landing__footer">
				<div className="huan-landing__footer-inner">
					<div className="huan-stack huan-stack--sm">
						<div className="huan-hero__wordmark">
							<span className="huan-shell__brand-mark">HUAN</span>
							<span className="huan-shell__brand-han">讙</span>
						</div>
						<p className="huan-caption">{PRODUCT_TAGLINE}</p>
					</div>
					<nav aria-label="頁尾" className="huan-stack huan-stack--sm">
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
				<div className="huan-landing__footer-inner">
					<p className="huan-caption">© 麟曜數位工作室</p>
				</div>
			</footer>
		</div>
	);
}
