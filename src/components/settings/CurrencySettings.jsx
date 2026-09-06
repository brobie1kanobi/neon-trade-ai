import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DollarSign, Globe, ToggleLeft, ToggleRight } from "lucide-react";

// Static list of major currencies — fixed reference data, no AI/network call needed.
const CURRENCIES = [
  { code: 'AUD', name: 'Australian Dollar', country: 'Australia', flag: '🇦🇺' },
  { code: 'BRL', name: 'Brazilian Real', country: 'Brazil', flag: '🇧🇷' },
  { code: 'CAD', name: 'Canadian Dollar', country: 'Canada', flag: '🇨🇦' },
  { code: 'CHF', name: 'Swiss Franc', country: 'Switzerland', flag: '🇨🇭' },
  { code: 'CNY', name: 'Chinese Yuan', country: 'China', flag: '🇨🇳' },
  { code: 'EUR', name: 'Euro', country: 'European Union', flag: '🇪🇺' },
  { code: 'GBP', name: 'British Pound', country: 'United Kingdom', flag: '🇬🇧' },
  { code: 'INR', name: 'Indian Rupee', country: 'India', flag: '🇮🇳' },
  { code: 'JPY', name: 'Japanese Yen', country: 'Japan', flag: '🇯🇵' },
  { code: 'KRW', name: 'South Korean Won', country: 'South Korea', flag: '🇰🇷' },
  { code: 'MXN', name: 'Mexican Peso', country: 'Mexico', flag: '🇲🇽' },
  { code: 'NOK', name: 'Norwegian Krone', country: 'Norway', flag: '🇳🇴' },
  { code: 'RUB', name: 'Russian Ruble', country: 'Russia', flag: '🇷🇺' },
  { code: 'SEK', name: 'Swedish Krona', country: 'Sweden', flag: '🇸🇪' },
  { code: 'USD', name: 'US Dollar', country: 'United States', flag: '🇺🇸' },
  { code: 'ZAR', name: 'South African Rand', country: 'South Africa', flag: '🇿🇦' }
];

export default function CurrencySettings({
  preferredCurrency,
  defaultInputMode,
  onCurrencyChange,
  onInputModeChange
}) {
  return (
    <Card style={{ backgroundColor: 'var(--card-bg)', borderColor: 'var(--border-color)' }}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Globe className="w-5 h-5 neon-text" />
          Localization & Input
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="currency-select" style={{ color: 'var(--text-primary)' }}>
            Preferred Currency
          </Label>
          <Select value={preferredCurrency} onValueChange={onCurrencyChange}>
            <SelectTrigger id="currency-select">
              <SelectValue placeholder="Select currency" />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {CURRENCIES.map((currency) => (
                <SelectItem key={currency.code} value={currency.code}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-[1.5rem]">{currency.flag || '🏳️'}</span>
                    <span className="font-medium">{currency.code}</span>
                    <span className="text-sm text-gray-500">- {currency.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-3">
          <Label style={{ color: 'var(--text-primary)' }}>
            Default Trading Input Mode
          </Label>
          <div className="flex items-center justify-between p-3 border rounded-lg"
               style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--secondary-bg)' }}>
            <div className="flex items-center gap-3">
              <DollarSign className="w-5 h-5 neon-text" />
              <div>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>
                  {defaultInputMode === 'quantity' ? 'Quantity Mode' : 'Currency Amount Mode'}
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  {defaultInputMode === 'quantity'
                    ? 'Input number of shares/coins to trade'
                    : 'Input dollar amount to spend/receive'
                  }
                </p>
              </div>
            </div>
            <button
              onClick={() => onInputModeChange(defaultInputMode === 'quantity' ? 'currency' : 'quantity')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
            >
              {defaultInputMode === 'quantity' ? (
                <ToggleLeft className="w-6 h-6" style={{ color: 'var(--text-secondary)' }} />
              ) : (
                <ToggleRight className="w-6 h-6 neon-text" />
              )}
            </button>
          </div>
        </div>

      </CardContent>
    </Card>
  );
}