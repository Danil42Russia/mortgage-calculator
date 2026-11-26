const salaryBrackets2026 = [
  { ceiling: 2_400_000, rate: 13 },
  { ceiling: 5_000_000, rate: 15 },
  { ceiling: 20_000_000, rate: 18 },
  { ceiling: 50_000_000, rate: 20 },
  { ceiling: Infinity, rate: 22 },
] as const;

function taxForMonth(previousGross: number, cumulativeGross: number) {
  let floor = 0;
  let taxKopecks = 0;
  const rates: number[] = [];
  for (const { ceiling, rate } of salaryBrackets2026) {
    const taxable = Math.min(cumulativeGross, ceiling) - Math.max(previousGross, floor);
    if (taxable > 0) {
      taxKopecks += taxable * rate;
      rates.push(rate);
    }
    if (cumulativeGross <= ceiling) break;
    floor = ceiling;
  }
  return { taxKopecks, rates };
}

export interface SalaryMonth {
  month: number;
  gross: number;
  tax: number;
  rates: number[];
  net: number;
}

export interface SalaryEstimate {
  months: SalaryMonth[];
  annualGross: number;
  annualTax: number;
  annualNet: number;
  averageNet: number;
}

/** Estimate ordinary resident wages in Russia with equal monthly accruals and no deductions. */
export function estimateSalary2026(monthlyGross: number): SalaryEstimate {
  if (!Number.isInteger(monthlyGross) || monthlyGross < 0 || monthlyGross > 1_000_000_000) {
    throw new RangeError('Monthly gross salary must be a whole amount between 0 and 1,000,000,000 rubles');
  }

  let cumulativeTaxKopecks = 0;
  let withheld = 0;
  const months: SalaryMonth[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const { taxKopecks, rates } = taxForMonth((month - 1) * monthlyGross, month * monthlyGross);
    cumulativeTaxKopecks += taxKopecks;
    const cumulativeTax = Math.round(cumulativeTaxKopecks / 100);
    const tax = cumulativeTax - withheld;
    withheld = cumulativeTax;
    months.push({ month, gross: monthlyGross, tax, rates, net: monthlyGross - tax });
  }
  const annualGross = monthlyGross * 12;
  const annualNet = annualGross - withheld;
  return { months, annualGross, annualTax: withheld, annualNet, averageNet: annualNet / 12 };
}
