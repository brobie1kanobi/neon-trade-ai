import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { base44 } from '@/api/base44Client';
import { UserSettings } from "@/entities/all";
import { useUser } from "@/components/hooks/useUser";
import { invalidateCache } from "@/components/hooks/useDataFetching";

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
  // CRITICAL: This is the AUTHORITATIVE user object, fetched fresh via base44.auth.me()
  // The useUser hook caches for 10 minutes and can have stale role data
  const [authUser, setAuthUser] = useState(null);

  // useUser only triggers initial load - we fetch fresh user inside loadSettings
  const { user: cachedUser } = useUser();

  const loadSettings = useCallback(async (force = false) => {
    if (!cachedUser?.email) {
      setIsLoading(false);
      return { settings: null, user: null };
    }

    try {
      const cacheKey = `settings:${cachedUser.email}`;

      // Always force-fetch settings to avoid stale sim_trading_mode
      invalidateCache(cacheKey);
      const userSettings = await UserSettings.filter({ created_by: cachedUser.email });
      let currentSettings = userSettings[0];

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
          time_format: "12h",
          timezone: "America/New_York"
        };
      }

      // Ensure timezone is always set
      if (!currentSettings.timezone || currentSettings.timezone.trim() === '') {
        currentSettings.timezone = "America/New_York";
      }

      // CRITICAL: Fetch FRESH user for accurate role/is_creator checks
      const meUser = await base44.auth.me();
      const isAdmin = (meUser?.role || '').toLowerCase() === 'admin';
      const isCreator = !!meUser?.is_creator;

      console.log('[SettingsContext] Settings loaded - sim_trading_mode:', currentSettings.sim_trading_mode, 'isAdmin:', isAdmin, 'isCreator:', isCreator, 'role:', meUser?.role);

      // Enforce simulation mode for non-admin/non-creator
      if (!(isAdmin || isCreator) && currentSettings.sim_trading_mode === false && currentSettings.id) {
        console.log('[SettingsContext] Non-admin user has live mode - forcing back to sim');
        try {
          await UserSettings.update(currentSettings.id, { sim_trading_mode: true });
        } catch (_e) {}
        currentSettings.sim_trading_mode = true;
      }

      setAuthUser(meUser);
      setSettings(currentSettings);
      setLastFetch(Date.now());
      setIsLoading(false);

      try {
        localStorage.setItem('nt_settings_cache', JSON.stringify(currentSettings));
      } catch (_e) {}

      return { settings: currentSettings, user: meUser };
    } catch (error) {
      console.error("Settings loading error:", error);

      try {
        const cache = localStorage.getItem('nt_settings_cache');
        if (cache) setSettings(JSON.parse(cache));
      } catch (_e) {}

      setIsLoading(false);
      return { settings, user: authUser };
    }
  }, [cachedUser?.email]);

  const updateSetting = useCallback(async (key, value) => {
    try {
      // CRITICAL: Fetch fresh user for accurate role check
      const meUser = await base44.auth.me();
      const isAdmin = (meUser?.role || '').toLowerCase() === 'admin';
      const isCreator = !!meUser?.is_creator;

      // Force simulation mode for non-admin/non-creator
      if (key === 'sim_trading_mode' && !(isAdmin || isCreator)) {
        value = true;
      }

      if (settings?.id) {
        await UserSettings.update(settings.id, { [key]: value });
      } else {
        await UserSettings.create({
          ...settings,
          [key]: value,
          sim_trading_mode: (key === 'sim_trading_mode') ? value : true,
          created_by: meUser?.email || cachedUser?.email
        });
      }

      // Update local state immediately
      const newSettings = { ...settings, [key]: value };
      setSettings(newSettings);
      // Also update authUser in case role changed
      setAuthUser(meUser);

      try {
        localStorage.setItem('nt_settings_cache', JSON.stringify(newSettings));
      } catch (_e) {}

      // If sim mode changed, full reload to reset all component states
      if (key === 'sim_trading_mode') {
        console.log('[SettingsContext] sim_trading_mode changed to:', value, '- scheduling full refresh');
        invalidateCache();
        try { localStorage.removeItem('nt_settings_cache'); } catch (_e) {}
        setTimeout(() => { window.location.reload(); }, 500);
        return;
      }

      // For other settings, invalidate and refresh
      if (meUser?.email || cachedUser?.email) {
        invalidateCache(`settings:${meUser?.email || cachedUser?.email}`);
      }
      setTimeout(() => loadSettings(true), 1500);

    } catch (error) {
      console.error("Error updating setting:", error);
      throw error;
    }
  }, [settings, cachedUser, loadSettings]);

  useEffect(() => {
    if (cachedUser) {
      loadSettings();
    }
  }, [cachedUser, loadSettings]);

  return (
    <SettingsContext.Provider value={{
      settings,
      user: authUser,
      isLoading,
      loadSettings,
      updateSetting
    }}>
      {children}
    </SettingsContext.Provider>
  );
};