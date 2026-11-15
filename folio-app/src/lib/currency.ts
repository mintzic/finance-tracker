export function currencyOptions(defaultCurrency: string, currencies: string[]) {
  return [...new Set([defaultCurrency, ...currencies])].sort();
}
