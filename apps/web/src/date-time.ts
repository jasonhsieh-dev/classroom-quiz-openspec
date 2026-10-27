const TAIPEI_DATE_TIME_FORMAT = new Intl.DateTimeFormat("zh-TW", {
	timeZone: "Asia/Taipei",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hourCycle: "h23",
});

export function formatTaipeiDateTime(value: string): string {
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return value;
	const parts = Object.fromEntries(
		TAIPEI_DATE_TIME_FORMAT.formatToParts(date).map((part) => [
			part.type,
			part.value,
		]),
	);
	return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
