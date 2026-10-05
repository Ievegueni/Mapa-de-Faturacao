/** Anos para os selectores: dois para trás e um para a frente. */
export function yearOptions(): number[] {
  const y = new Date().getFullYear();
  return [y - 2, y - 1, y, y + 1];
}
