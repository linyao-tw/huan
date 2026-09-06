import { useTheme, type ThemePreference } from "@/lib/theme";
import { SegmentedControl, SegmentedControlItem } from "@linyao.tw/ui";

export function ThemeToggle() {
	const { preference, setPreference } = useTheme();
	return (
		<SegmentedControl
			aria-label="介面主題"
			size="sm"
			value={preference}
			onValueChange={next => {
				if (next) setPreference(next as ThemePreference);
			}}
		>
			<SegmentedControlItem value="system">系統</SegmentedControlItem>
			<SegmentedControlItem value="light">亮色</SegmentedControlItem>
			<SegmentedControlItem value="dark">深色</SegmentedControlItem>
		</SegmentedControl>
	);
}
