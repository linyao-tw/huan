import { SectionHeading } from "@linyao.tw/ui";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions, annotation }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; annotation?: ReactNode }) {
	return (
		<SectionHeading level={2} size="lg" description={description} action={actions} annotation={annotation}>
			{title}
		</SectionHeading>
	);
}
