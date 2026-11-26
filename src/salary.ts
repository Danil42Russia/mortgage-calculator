const salaryBrackets2026 = [
  { ceiling: 2_400_000, rate: 13 },
  { ceiling: 5_000_000, rate: 15 },
  { ceiling: 20_000_000, rate: 18 },
  { ceiling: 50_000_000, rate: 20 },
  { ceiling: Infinity, rate: 22 },
] as const;

function yearToDateTax(gross: number) {
  let floor = 0;
  let taxKopecks = 0;
  for (const { ceiling, rate } of salaryBrackets2026) {
    taxKopecks += (Math.min(gross, ceiling) - floor) * rate;
    if (gross <= ceiling) break;
    floor = ceiling;
  }
  return Math.round(taxKopecks / 100);
}

export interface SalaryMonth {
  month: number;
  gross: number;
  tax: number;
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

  let withheld = 0;
  const months: SalaryMonth[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const cumulativeTax = yearToDateTax(month * monthlyGross);
    const tax = cumulativeTax - withheld;
    withheld = cumulativeTax;
    months.push({ month, gross: monthlyGross, tax, net: monthlyGross - tax });
  }
  const annualGross = monthlyGross * 12;
  const annualNet = annualGross - withheld;
  return { months, annualGross, annualTax: withheld, annualNet, averageNet: annualNet / 12 };
}
