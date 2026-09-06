import { Button, EmptyState } from "@linyao.tw/ui";
import { CompassIcon } from "@phosphor-icons/react/dist/csr/Compass";
import { Link as RouterLink } from "react-router";

export function NotFoundPage() {
	return (
		<div className="huan-centered">
			<div className="huan-centered__inner">
				<h1 className="huan-visually-hidden">找不到頁面</h1>
				<EmptyState
					icon={<CompassIcon weight="bold" />}
					eyebrow="404"
					title="這個位址不存在"
					description="連結可能已經失效，或是網址輸入有誤。"
					actions={
						<div className="huan-row huan-row--tight">
							<Button render={<RouterLink to="/" />} nativeButton={false} variant="secondary">
								回到首頁
							</Button>
							<Button render={<RouterLink to="/app" />} nativeButton={false}>
								前往後台
							</Button>
						</div>
					}
				/>
			</div>
		</div>
	);
}
