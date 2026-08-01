export interface AgreementReport {
  reviewed: number;
  exactAgreement: number;
  withinOneAgreement: number;
  severeDisagreementRate: number;
  weightedKappa: number;
  confusionMatrix: number[][];
  passes: boolean;
  threshold: { minimumReviewed: number; weightedKappa: number; severeDisagreementRate: number };
}

export function agreement(pairs: Array<{ agent: number; human: number }>): AgreementReport {
  const matrix = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (const pair of pairs) matrix[pair.agent]![pair.human]! += 1;
  const n = pairs.length;
  const exact = pairs.filter(pair => pair.agent === pair.human).length;
  const withinOne = pairs.filter(pair => Math.abs(pair.agent - pair.human) <= 1).length;
  const severe = pairs.filter(pair => Math.abs(pair.agent - pair.human) >= 2).length;
  const row = matrix.map(values => values.reduce((sum, value) => sum + value, 0));
  const col = [0, 1, 2, 3].map(index => matrix.reduce((sum, values) => sum + values[index]!, 0));
  let observed = 0;
  let expected = 0;
  for (let a = 0; a < 4; a += 1) for (let h = 0; h < 4; h += 1) {
    const weight = ((a - h) / 3) ** 2;
    observed += weight * (matrix[a]![h]! / Math.max(1, n));
    expected += weight * ((row[a]! * col[h]!) / Math.max(1, n * n));
  }
  const weightedKappa = n === 0 ? 0 : expected === 0 ? (observed === 0 ? 1 : 0) : 1 - observed / expected;
  const threshold = { minimumReviewed: 300, weightedKappa: 0.7, severeDisagreementRate: 0.05 };
  return {
    reviewed: n,
    exactAgreement: exact / Math.max(1, n),
    withinOneAgreement: withinOne / Math.max(1, n),
    severeDisagreementRate: severe / Math.max(1, n),
    weightedKappa,
    confusionMatrix: matrix,
    passes: n >= threshold.minimumReviewed && weightedKappa >= threshold.weightedKappa
      && severe / Math.max(1, n) <= threshold.severeDisagreementRate,
    threshold,
  };
}
