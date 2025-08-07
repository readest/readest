export function formatReadingProgress(
	current: number,
	total: number,
	style: "percentage" | "fraction",
): string {
	if (style === "fraction") {
		return `${current + 1} / ${total}`;
	} else {
		return `${Math.round(((current + 1) / total) * 100)}%`;
	}
}
