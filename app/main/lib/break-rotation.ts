export function generateSequentialOrder(length: number): number[] {
  const indexes = Array.from({ length }, (_, i) => i);
  for (let i = indexes.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
}

export function sanitizeSequentialOrder(
  order: unknown,
  length: number,
): number[] | null {
  if (!Array.isArray(order) || order.length !== length) {
    return null;
  }

  const seen = new Set<number>();
  for (const value of order) {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value >= length ||
      seen.has(value)
    ) {
      return null;
    }
    seen.add(value);
  }

  return order.slice();
}
