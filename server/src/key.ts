export function isWeReadKey(value: string): boolean {
  return /^wrk-.+/.test(value.trim());
}
