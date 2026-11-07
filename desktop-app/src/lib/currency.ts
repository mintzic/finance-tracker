const fallbackCurrencies = ['SGD', 'USD', 'EUR', 'GBP', 'MYR', 'CNY', 'AUD', 'THB'];

export function currencyOptions(defaultCurrency: string) {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'currency') => string[] };
  return [...new Set([defaultCurrency, ...(intl.supportedValuesOf?.('currency') ?? fallbackCurrencies)])].sort();
}
