function tickInterval(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find(step => step * magnitude >= value) ?? 10) * magnitude;
}

export function valueAxis(values: readonly number[], fitValues = false) {
  const high = Math.max(0, ...values);
  const lowestValue = Math.min(...values);
  const low = fitValues && lowestValue > 0 && lowestValue < high
    ? Math.min(lowestValue, high * 0.95) : Math.min(0, lowestValue);
  const step = tickInterval((high - low || 1) / 4);
  const firstTick = Math.floor(low / step);
  const lastTick = Math.max(firstTick + 1, Math.ceil(high / step));
  return { step, firstTick, lastTick };
}
