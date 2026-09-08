export function escape(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
}
export function text(value: unknown, limit = 5000): string { return escape(String(value ?? '').slice(0, limit)); }
export function paragraph(value: unknown, limit = 5000): string { return text(value, limit).replace(/\r?\n/g, '<br>'); }
export function plain(value: unknown): string {
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}
export function safeId(id: string): string {
  if (!/^[\w-]{1,128}$/.test(id)) throw new Error('Invalid identifier');
  return id;
}
export function intPage(value: string | null): number {
  const page = Number(value || 1);
  return Number.isInteger(page) && page > 0 && page <= 1000 ? page : 1;
}
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}
