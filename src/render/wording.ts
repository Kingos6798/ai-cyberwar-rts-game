// Help text wording: the touch layout swaps "click" for "tap" (mobile port); desktop keeps it as is.
let words = (s: string): string => s;

export function setWording(fn: (s: string) => string): void {
  words = fn;
}

export function word(s: string): string {
  return words(s);
}
