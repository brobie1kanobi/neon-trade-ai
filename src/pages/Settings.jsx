import React from "react";
import { motion } from "framer-motion";

import ThemeSettings from "../components/settings/ThemeSettings";
import TradingSettings from "../components/settings/TradingSettings";
import TradingStrategiesSettings from "../components/settings/TradingStrategiesSettings";
import AccountSettings from "../components/settings/AccountSettings";
import NotificationSettings from "../components/settings/NotificationSettings";
import CurrencySettings from "../components/settings/CurrencySettings";
import DonateSection from "../components/settings/DonateSection";

import VoiceSettingsSection from "../components/settings/VoiceSettingsSection";
import BiometricsSettings from "../components/settings/BiometricsSettings";
import TimeSettings from "../components/settings/TimeSettings";

import KrakenArchitectureSection from "../components/settings/KrakenArchitectureSection";
import SystemHealthPanel from "../components/settings/SystemHealthPanel";
import AIPerformancePanel from "../components/settings/AIPerformancePanel";
import { useSettings } from "../components/utils/SettingsContext";

export default function Settings() {
  const { settings, user, isLoading, updateSetting } = useSettings();

  if (isLoading && !settings) {
    return (
      <div className="p-4 space-y-4">
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-48 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
        <div className="h-32 bg-gray-200 dark:bg-gray-800 rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 pb-8" style={{ backgroundColor: 'var(--primary-bg)' }}>
      <div className="text-center py-4">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Settings
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Customize your NeonTrade AI experience
        </p>
      </div>



      {/* 1) Support & Policies */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7 }}>
        <DonateSection />
      </motion.div>

      {/* 2) Trading Settings */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <TradingSettings
          autoTradingEnabled={settings?.auto_trading_enabled || false}
          onToggleAutoTrading={(value) => updateSetting('auto_trading_enabled', value)}
          simTradingMode={settings?.sim_trading_mode ?? true}
          onToggleSimTrading={(value) => updateSetting('sim_trading_mode', value)}
          user={user}
        />
      </motion.div>

      {/* 2a) Trading Strategies */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.02 }}>
        <TradingStrategiesSettings
          settings={settings}
          onToggle={(key, value) => updateSetting(key, value)}
        />
      </motion.div>



      {/* 2b) System Health (LIVE mode only) */}
      {settings && !settings.sim_trading_mode && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <SystemHealthPanel />
        </motion.div>
      )}

      {/* 2c) AI Performance */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.055 }}>
        <AIPerformancePanel />
      </motion.div>

      {/* 2d) Kraken Architecture & Testing (LIVE mode only) */}
      {settings && !settings.sim_trading_mode && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.06 }}>
          <KrakenArchitectureSection />
        </motion.div>
      )}



      {/* 4) AI Voice & Speech */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
        <VoiceSettingsSection
          settings={settings}
          onToggle={updateSetting}
        />
      </motion.div>

      {/* 5) Appearance */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}>
        <ThemeSettings 
          darkMode={settings?.dark_mode ?? true}
          onToggle={(value) => updateSetting('dark_mode', value)}
        />
      </motion.div>

      {/* 6) Time Format */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 }}>
        <TimeSettings
          value={settings?.time_format || "12h"}
          onChange={(v) => updateSetting('time_format', v)}
          timezone={settings?.timezone || "America/New_York"}
          onTimezoneChange={(v) => updateSetting('timezone', v)}
        />
      </motion.div>

      {/* 7) Localization & Input */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
        <CurrencySettings
          preferredCurrency={settings?.preferred_currency || "USD"}
          defaultInputMode={settings?.default_input_mode || "quantity"}
          onCurrencyChange={(value) => updateSetting('preferred_currency', value)}
          onInputModeChange={(value) => updateSetting('default_input_mode', value)}
        />
      </motion.div>

      {/* 8) Biometric Login */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
        <BiometricsSettings
          settings={settings}
          onToggle={updateSetting}
        />
      </motion.div>

      {/* 9) Notifications */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
        <NotificationSettings
          settings={settings}
          onToggle={updateSetting}
        />
      </motion.div>

      {/* 10) Account */}
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }}>
        <AccountSettings user={user} />
      </motion.div>
    </div>
  );
}