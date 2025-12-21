import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Globe, ToggleLeft, ToggleRight, Clock } from "lucide-react";
import { InvokeLLM } from "@/integrations/Core";

// Common timezones with friendly names
const TIMEZONES = [
  { value: "Pacific/Honolulu", label: "Hawaii (HST)", offset: "-10:00" },
  { value: "America/Anchorage", label: "Alaska (AKST)", offset: "-09:00" },
  { value: "America/Los_Angeles", label: "Pacific Time (PST)", offset: "-08:00" },
  { value: "America/Denver", label: "Mountain Time (MST)", offset: "-07:00" },
  { value: "America/Chicago", label: "Central Time (CST)", offset: "-06:00" },
  { value: "America/New_York", label: "Eastern Time (EST)", offset: "-05:00" },
  { value: "America/Halifax", label: "Atlantic Time (AST)", offset: "-04:00" },
  { value: "America/Sao_Paulo", label: "São Paulo (BRT)", offset: "-03:00" },
  { value: "Atlantic/South_Georgia", label: "South Georgia (GST)", offset: "-02:00" },
  { value: "Atlantic/Azores", label: "Azores (AZOT)", offset: "-01:00" },
  { value: "UTC", label: "UTC", offset: "+00:00" },
  { value: "Europe/London", label: "London (GMT)", offset: "+00:00" },
  { value: "Europe/Paris", label: "Central Europe (CET)", offset: "+01:00" },
  { value: "Europe/Helsinki", label: "Eastern Europe (EET)", offset: "+02:00" },
  { value: "Europe/Moscow", label: "Moscow (MSK)", offset: "+03:00" },
  { value: "Asia/Dubai", label: "Dubai (GST)", offset: "+04:00" },
  { value: "Asia/Karachi", label: "Pakistan (PKT)", offset: "+05:00" },
  { value: "Asia/Kolkata", label: "India (IST)", offset: "+05:30" },
  { value: "Asia/Dhaka", label: "Bangladesh (BST)", offset: "+06:00" },
  { value: "Asia/Bangkok", label: "Thailand (ICT)", offset: "+07:00" },
  { value: "Asia/Singapore", label: "Singapore (SGT)", offset: "+08:00" },
  { value: "Asia/Shanghai", label: "China (CST)", offset: "+08:00" },
  { value: "Asia/Tokyo", label: "Japan (JST)", offset: "+09:00" },
  { value: "Australia/Sydney", label: "Sydney (AEDT)", offset: "+11:00" },
  { value: "Pacific/Auckland", label: "New Zealand (NZDT)", offset: "+13:00" }
];

export default function CurrencySettings({ 
  preferredCurrency, 
  defaultInputMode,
  timezone,
  onCurrencyChange, 
  onInputModeChange,
  onTimezoneChange
}) {
  const [currencies, setCurrencies] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchCurrencies();
  }, []);

  const fetchCurrencies = async () => {
    setIsLoading(true);
    
    // Fallback currency list
    const fallbackCurrencies = [
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

    try {
      const response = await InvokeLLM({
        prompt: "Provide a list of 15 major world currencies including USD, EUR, GBP, JPY, CAD, AUD, CHF, CNY, INR, BRL, RUB, KRW, MXN, ZAR, SEK. For each currency provide the 3-letter code, full name, country, and flag emoji.",
        add_context_from_internet: true,
        response_json_schema: {
          type: "object",
          properties: {
            currencies: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  name: { type: "string" },
                  country: { type: "string" },
                  flag: { type: "string" }
                }
              }
            }
          }
        }
      });

      if (response?.currencies && Array.isArray(response.currencies) && response.currencies.length > 0) {
        setCurrencies(response.currencies.sort((a, b) => a.code.localeCompare(b.code)));
      } else {
        setCurrencies(fallbackCurrencies);
      }
    } catch (error) {
      console.error('Failed to fetch currencies:', error);
      setCurrencies(fallbackCurrencies);
    }
    
    setIsLoading(false);
  };

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
          <Select 
            value={preferredCurrency} 
            onValueChange={onCurrencyChange}
            disabled={isLoading}
          >
            <SelectTrigger id="currency-select">
              <SelectValue placeholder={isLoading ? "Loading currencies..." : "Select currency"} />
            </SelectTrigger>
            <SelectContent className="max-h-60">
              {currencies.map((currency) => (
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