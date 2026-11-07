export function minor(value: string): number {
  if (!/^-?\d{1,10}(\.\d{1,2})?$/.test(value.trim())) {
    throw new Error('Enter a valid amount with at most two decimal places.');
  }

  const negative = value.trim().startsWith('-');
  const [whole, fraction = ''] = value.trim().replace('-', '').split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  if (!Number.isSafeInteger(result) || result > 999999999999) {
    throw new Error('Amount is too large.');
  }

  return negative ? -result : result;
}

export const money = (value: number, language = 'en-SG', currency = 'USD') => {
  if (!Number.isSafeInteger(value)) {
    throw new Error('Balance exceeds the supported integer range.');
  }

  const number = new Intl.NumberFormat(language, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
  return `${currency} ${number}`;
};

export const decimal = (value: number) => `${value < 0 ? '-' : ''}${Math.floor(Math.abs(value) / 100)}.${String(Math.abs(value) % 100).padStart(2, '0')}`;

export function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function validDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    value < '1900-01-01' ||
    value > '9999-12-31' ||
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value
  ) {
    throw new Error('Enter a valid date.');
  }

  return value;
}

export function monthRange(month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month < '1900-01' || month > '9998-12') {
    throw new Error('Invalid month.');
  }

  const [year, m] = month.split('-').map(Number);
  return {
    start: `${month}-01`,
    end: `${m === 12 ? year + 1 : year}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`,
  };
}
