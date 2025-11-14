import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { UserSettings } from "@/entities/all";
import { useUser } from "@/components/hooks/useUser";
import { getCached, invalidateCache } from "@/components/hooks/useDataFetching";

const SettingsContext = createContext();

export const useSettings = () => {
  const context = useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context;
};

export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastFetch, setLastFetch] = useState(0);
  
  // Use centralized user hook
  const { user } = useUser();

  const loadSettings = useCallback(async (force = false) => {
    if (!user?.email) {
      setIsLoading(false);
      return { settings: null, user: null };
    }

    try {
      const cacheKey = `settings:${user.email}`;
      
      let currentSettings;
      if (force) {
        invalidateCache(cacheKey);
        const userSettings = await UserSettings.filter({ created_by: user.email });
        currentSettings = userSettings[0];
      } else {
        currentSettings = await getCached(
          cacheKey,
          async () => {
            const userSettings = await UserSettings.filter({ created_by: user.email });
            return userSettings[0];
          },
          5 * 60 * 1000 // 5 minute cache
        );
      }

      if (!currentSettings) {
        currentSettings = {
          dark_mode: true,
          auto_trading_enabled: false,
          notifications_enabled: true,
          notify_on_trade: true,
          notify_on_deposit_withdrawal: true,
          notify_on_market_news: false,
          bank_connected: false,
          preferred_currency: "USD",
          default_input_mode: "quantity",
          sim_trading_mode: true,
          has_seen_welcome: false,
          credits_balance: 0,
          tts_enabled: true,
          tts_voice_uri: '',
          biometrics_enabled: false,
          has_seen_biometrics_prompt: false,
          time_format: "12h"
        };
      }

      const isAdmin = (user?.role || '').toLowerCase() === 'admin';
      const isCreator = !!user?.is_creator;

      // Enforce simulation mode for non-admin/non-creator
      if (!(isAdmin || isCreator) && currentSettings.sim_trading_mode === false && currentSettings.id) {
        try {
          await UserSettings.update(currentSettings.id, { sim_trading_mode: true });
        } catch (_e) {}
        currentSettings.sim_trading_mode = true;
      }

      setSettings(currentSettings);
      setLastFetch(Date.now());
      setIsLoading(false);

      // Cache to localStorage
      try {
        localStorage.setItem('nt_settings_cache', JSON.stringify(currentSettings));
      } catch (_e) {}

      return { settings: currentSettings, user };
    } catch (error) {
      console.error("Settings loading error:", error);
      
      // Try to use localStorage cache
      try {
        const cache = localStorage.getItem('nt_settings_cache');
        if (cache) setSettings(JSON.parse(cache));
      } catch (_e) {}
      
      setIsLoading(false);
      return { settings, user };
    }
  }, [user, settings]);

  const updateSetting = useCallback(async (key, value) => {
    try {
      const isAdmin = (user?.role || '').toLowerCase() === 'admin';
      const isCreator = !!user?.is_creator;

      // Force simulation mode for non-admin/non-creator
      if (key === 'sim_trading_mode' && !(isAdmin || isCreator)) {
        value = true;
      }

      if (settings?.id) {
        await UserSettings.update(settings.id, { [key]: value });
      } else {
        const me = user || await base44.auth.me();
        await UserSettings.create({
          ...settings,
          [key]: value,
          sim_trading_mode: (key === 'sim_trading_mode') ? value : true,
          created_by: me.email
        });
      }

      // Update local state
      setSettings(prev => ({
        ...prev,
        [key]: value,
        ...(key !== 'sim_trading_mode' ? { sim_trading_mode: prev?.sim_trading_mode ?? true } : {})
      }));

      // Invalidate cache and refresh
      if (user?.email) {
        invalidateCache(`settings:${user.email}`);
      }
      setTimeout(() => loadSettings(true), 1500);

    } catch (error) {
      console.error("Error updating setting:", error);
      throw error;
    }
  }, [settings, user, loadSettings]);

  useEffect(() => {
    if (user) {
      loadSettings();
    }
  }, [user, loadSettings]);

  return (
    <SettingsContext.Provider value={{
      settings,
      user,
      isLoading,
      loadSettings,
      updateSetting
    }}>
      {children}
    </SettingsContext.Provider>
  );
}