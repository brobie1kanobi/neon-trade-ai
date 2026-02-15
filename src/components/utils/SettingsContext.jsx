import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
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
      // CRITICAL: Always force-fetch settings for sim_trading_mode accuracy
      // Stale cached settings caused the "stuck in sim mode" bug
      invalidateCache(cacheKey);
      const userSettings = await UserSettings.filter({ created_by: user.email });
      currentSettings = userSettings[0];

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

      // CRITICAL: Ensure timezone is always set
      if (!currentSettings.timezone || currentSettings.timezone.trim() === '') {
        currentSettings.timezone = "America/New_York";
      }

      // CRITICAL: Use fresh user data for role check to avoid stale data forcing sim mode
      const freshUser = await base44.auth.me();
      const isAdmin = (freshUser?.role || '').toLowerCase() === 'admin';
      const isCreator = !!freshUser?.is_creator;
      
      console.log('[SettingsContext] Settings loaded - sim_trading_mode:', currentSettings.sim_trading_mode, 'isAdmin:', isAdmin, 'isCreator:', isCreator);

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

      // CRITICAL: Return freshUser so consumers get up-to-date role/is_creator
      return { settings: currentSettings, user: freshUser };
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
      // CRITICAL: Fetch fresh user to avoid stale role/creator data causing forced sim mode
      const freshUser = await base44.auth.me();
      const isAdmin = (freshUser?.role || '').toLowerCase() === 'admin';
      const isCreator = !!freshUser?.is_creator;

      // Force simulation mode for non-admin/non-creator
      if (key === 'sim_trading_mode' && !(isAdmin || isCreator)) {
        value = true;
      }

      if (settings?.id) {
        await UserSettings.update(settings.id, { [key]: value });
      } else {
        const me = freshUser || user;
        await UserSettings.create({
          ...settings,
          [key]: value,
          sim_trading_mode: (key === 'sim_trading_mode') ? value : true,
          created_by: me.email
        });
      }

      // Update local state immediately for responsive UI
      const newSettings = {
        ...settings,
        [key]: value,
        // CRITICAL: When updating sim_trading_mode, use the new value directly
        // For other keys, preserve the current sim_trading_mode
        ...(key !== 'sim_trading_mode' ? {} : {})
      };
      setSettings(newSettings);
      
      // Also update localStorage cache immediately
      try {
        localStorage.setItem('nt_settings_cache', JSON.stringify(newSettings));
      } catch (_e) {}
      
      // CRITICAL: If sim mode changed, force a full page reload to reset all component states
      // This ensures no component retains stale sim/live data
      if (key === 'sim_trading_mode') {
        console.log('[SettingsContext] sim_trading_mode changed to:', value, '- scheduling full refresh');
        // Clear all caches
        invalidateCache();
        try { localStorage.removeItem('nt_settings_cache'); } catch (_e) {}
        // Force reload after a short delay to let the DB update propagate
        setTimeout(() => {
          window.location.reload();
        }, 500);
        return; // Don't continue with normal flow
      }

      // Invalidate cache and refresh
      if (freshUser?.email || user?.email) {
        invalidateCache(`settings:${freshUser?.email || user?.email}`);
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