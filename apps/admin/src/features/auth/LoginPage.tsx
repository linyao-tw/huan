import { useLoginMutation, useSessionQuery, useTotpChallengeMutation } from "@/features/auth/hooks";
import { ThemeToggle } from "@/shared/components/ThemeToggle";
import { isApiError, type ApiError } from "@/shared/services/http";
import { queryKeys } from "@/shared/services/query-keys";
import { Alert, AlertDescription, AlertTitle, Button, Card, CardBody, CodeField, Link, PasswordField, SectionHeading, Separator, TextField } from "@linyao.tw/ui";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate, Link as RouterLink, useNavigate, useSearchParams } from "react-router";

type Step = "credentials" | "totp";
type SecondFactor = "code" | "recovery";

/** `next` 只接受站內的絕對路徑，否則就成了開放轉址。 */
function safeNextPath(raw: string | null): string {
	if (!raw) return "/app";
	if (!raw.startsWith("/") || raw.startsWith("//")) return "/app";
	return raw;
}

function loginErrorTitle(error: ApiError): string {
	switch (error.code) {
		case "invalid_credentials":
			return "帳號或密碼不正確";
		case "forbidden":
			return "此帳號已停用";
		case "rate_limited":
			return "嘗試次數過多";
		default:
			return "登入失敗";
	}
}

export function LoginPage() {
	const [searchParams] = useSearchParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const session = useSessionQuery();

	const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);

	const [step, setStep] = useState<Step>("credentials");
	const [identifier, setIdentifier] = useState("");
	const [password, setPassword] = useState("");
	const [challengeToken, setChallengeToken] = useState<string | null>(null);
	const [challengeExpiresAt, setChallengeExpiresAt] = useState<string | null>(null);
	const [secondFactor, setSecondFactor] = useState<SecondFactor>("code");
	const [code, setCode] = useState("");
	const [recoveryCode, setRecoveryCode] = useState("");

	const login = useLoginMutation();
	const challenge = useTotpChallengeMutation();

	// 挑戰憑證是短時效的；過期後留在畫面上只會讓人一直輸入無效的驗證碼。
	useEffect(() => {
		if (!challengeExpiresAt) return;
		const remaining = new Date(challengeExpiresAt).getTime() - Date.now();
		if (remaining <= 0) {
			setStep("credentials");
			setChallengeToken(null);
			return;
		}
		const timer = setTimeout(() => {
			setStep("credentials");
			setChallengeToken(null);
			setChallengeExpiresAt(null);
		}, remaining);
		return () => clearTimeout(timer);
	}, [challengeExpiresAt]);

	if (session.data) return <Navigate to={nextPath} replace />;

	const submitCredentials = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		login.mutate(
			{ identifier, password },
			{
				onSuccess: result => {
					if (result.status === "authenticated") {
						queryClient.setQueryData(queryKeys.session, { user: result.user });
						void navigate(nextPath, { replace: true });
						return;
					}
					setChallengeToken(result.challengeToken);
					setChallengeExpiresAt(result.expiresAt);
					setStep("totp");
				}
			}
		);
	};

	const submitSecondFactor = (event: FormEvent<HTMLFormElement>): void => {
		event.preventDefault();
		if (!challengeToken) return;
		challenge.mutate(secondFactor === "code" ? { challengeToken, code } : { challengeToken, recoveryCode }, {
			onSuccess: result => {
				queryClient.setQueryData(queryKeys.session, result);
				void navigate(nextPath, { replace: true });
			}
		});
	};

	const activeError = step === "credentials" ? login.error : challenge.error;

	return (
		<div className="huan-centered">
			<div className="huan-centered__inner">
				<h1 className="huan-visually-hidden">登入 HUAN 讙 後台</h1>
				<div className="huan-row huan-row--between">
					<RouterLink to="/" className="huan-shell__brand">
						<span className="huan-shell__brand-mark">HUAN</span>
						<span className="huan-shell__brand-han">讙</span>
					</RouterLink>
					<ThemeToggle />
				</div>

				<Card variant="elevated">
					<CardBody>
						<div className="huan-stack">
							<SectionHeading level={2} size="md" description={step === "credentials" ? "請使用管理員提供的帳號登入。" : "這個帳號啟用了兩階段驗證。"}>
								{step === "credentials" ? "登入 HUAN 後台" : "輸入第二階段驗證"}
							</SectionHeading>

							{activeError && isApiError(activeError) ? (
								<Alert status="danger" live="assertive">
									<AlertTitle>{loginErrorTitle(activeError)}</AlertTitle>
									<AlertDescription>{activeError.message}</AlertDescription>
								</Alert>
							) : null}

							{step === "credentials" ? (
								<form className="huan-stack" onSubmit={submitCredentials} noValidate>
									<TextField
										label="Email 或帳號"
										name="identifier"
										autoComplete="username"
										required
										value={identifier}
										onChange={event => setIdentifier(event.target.value)}
										disabled={login.isPending}
									/>
									<PasswordField
										label="密碼"
										name="password"
										autoComplete="current-password"
										required
										value={password}
										onChange={event => setPassword(event.target.value)}
										disabled={login.isPending}
									/>
									<Button type="submit" loading={login.isPending} disabled={identifier.length === 0 || password.length === 0}>
										登入
									</Button>
								</form>
							) : (
								<form className="huan-stack" onSubmit={submitSecondFactor} noValidate>
									{secondFactor === "code" ? (
										<CodeField
											label="驗證器產生的 6 位數驗證碼"
											length={6}
											value={code}
											onValueChange={setCode}
											autoComplete="one-time-code"
											disabled={challenge.isPending}
											description="打開驗證器 App，輸入目前顯示的數字。"
										/>
									) : (
										<TextField
											label="復原碼"
											name="recoveryCode"
											technical
											placeholder="XXXXX-XXXXX"
											value={recoveryCode}
											onChange={event => setRecoveryCode(event.target.value)}
											disabled={challenge.isPending}
											description="每一組復原碼只能使用一次。"
										/>
									)}

									<Button type="submit" loading={challenge.isPending} disabled={secondFactor === "code" ? code.length !== 6 : recoveryCode.trim().length < 10}>
										驗證並登入
									</Button>

									<Separator spacing="sm" />

									<div className="huan-row huan-row--between">
										<Button
											variant="quiet"
											size="sm"
											onClick={() => {
												setSecondFactor(secondFactor === "code" ? "recovery" : "code");
												challenge.reset();
											}}
										>
											{secondFactor === "code" ? "改用復原碼" : "改用驗證碼"}
										</Button>
										<Button
											variant="quiet"
											size="sm"
											startIcon={<ArrowLeftIcon weight="bold" />}
											onClick={() => {
												setStep("credentials");
												setChallengeToken(null);
												setChallengeExpiresAt(null);
												setCode("");
												setRecoveryCode("");
												challenge.reset();
											}}
										>
											回到上一步
										</Button>
									</div>
								</form>
							)}
						</div>
					</CardBody>
				</Card>

				<p className="huan-caption">
					還沒有帳號？HUAN 不開放自助註冊，請聯絡 <Link href="mailto:contact@linyao.tw">contact@linyao.tw</Link>。
				</p>
			</div>
		</div>
	);
}
