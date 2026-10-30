export function isSensitiveEnvironmentKey(key: string): boolean {
  return /(?:^|[_-])(?:PASSWORD|PASSWD|PASS|SECRET|TOKEN|CREDENTIALS?|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)(?:$|[_-])/i.test(key);
}

export function displayEnvironmentValue(
  key: string,
  value: string,
  reveal: boolean,
  hidden: string
): string {
  return !reveal && isSensitiveEnvironmentKey(key) ? hidden : value;
}

export function environmentLines(value: unknown, reveal: boolean, hidden: string): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const text = String(entry);
      const separator = text.indexOf('=');
      if (separator < 0) return text;
      const key = text.slice(0, separator);
      return `${key}=${displayEnvironmentValue(key, text.slice(separator + 1), reveal, hidden)}`;
    });
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).map(([key, item]) =>
      item === null || item === undefined
        ? key
        : `${key}=${displayEnvironmentValue(key, String(item), reveal, hidden)}`
    );
  }
  return [];
}
