import React from "react";
import AITraderSettingsCard from "@/components/portfolio/AITraderSettingsCard";
import AutoBuyPreferences from "@/components/portfolio/AutoBuyPreferences";
import RiskManagementSettings from "@/components/portfolio/RiskManagementSettings";
import AutoTraderHealth from "@/components/settings/AutoTraderHealth";
import TradingStrategiesSettings from "@/components/settings/TradingStrategiesSettings";
import SystemHealthPanel from "@/components/settings/SystemHealthPanel";
import AIPerformancePanel from "@/components/settings/AIPerformancePanel";
import KrakenArchitectureSection from "@/components/settings/KrakenArchitectureSection";
import { useSettings } from "@/components/utils/SettingsContext";

export default function AITraderSettings() {
  const { settings, updateSetting } = useSettings();

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>AI Trader Settings</h1>
      <AITraderSettingsCard />
      <AutoBuyPreferences />
      <RiskManagementSettings />
      <AutoTraderHealth />
      <TradingStrategiesSettings
        settings={settings}
        onToggle={(key, value) => updateSetting(key, value)}
      />
      {settings && !settings.sim_trading_mode && <SystemHealthPanel />}
      <AIPerformancePanel />
      {settings && !settings.sim_trading_mode && <KrakenArchitectureSection />}
    </div>
  );
}