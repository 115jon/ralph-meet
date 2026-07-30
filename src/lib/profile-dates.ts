const PROFILE_REFERENCE_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  year: "numeric",
};
const PROFILE_REFERENCE_DATE_LOCALE = "en-US";
const PROFILE_REFERENCE_DATE_TIME_ZONE = "UTC";

export function formatProfileReferenceDate(
  value: Date | string | number | null | undefined,
) {
  if (value == null) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return new Intl.DateTimeFormat(PROFILE_REFERENCE_DATE_LOCALE, {
    ...PROFILE_REFERENCE_DATE_FORMAT,
    timeZone: PROFILE_REFERENCE_DATE_TIME_ZONE,
  }).format(date);
}

export function resolveProfileReferenceDate(options: {
  joinedAt?: Date | string | number | null;
  createdAt?: Date | string | number | null;
}) {
  const joinedAtLabel = formatProfileReferenceDate(options.joinedAt);
  if (joinedAtLabel) {
    return {
      label: "Member Since",
      value: joinedAtLabel,
    };
  }

  const createdAtLabel = formatProfileReferenceDate(options.createdAt);
  if (createdAtLabel) {
    return {
      label: "Account Created",
      value: createdAtLabel,
    };
  }

  return {
    label: "Member Since",
    value: "Unknown",
  };
}
