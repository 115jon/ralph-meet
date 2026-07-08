const PROFILE_REFERENCE_DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function formatProfileReferenceDate(
  value: Date | string | number | null | undefined,
) {
  if (value == null) return null;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return PROFILE_REFERENCE_DATE_FORMATTER.format(date);
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
