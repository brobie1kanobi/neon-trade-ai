import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { Home, PieChart, Wallet, Settings, Mic, RefreshCw, Bell, Bot } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import AssistantModal from "./components/ai/AssistantModal";
import WelcomeScreen from "./components/welcome/WelcomeScreen";
import BiometricsSetupModal from "./components/auth/BiometricsSetupModal";
import PushManager from "./components/utils/PushManager";
import NotificationDrawer from "./components/notifications/NotificationDrawer";
import { Toaster } from "@/components/ui/sonner";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsProvider, useSettings } from "./components/utils/SettingsContext";
import { KrakenWebSocketProvider } from "./components/providers/KrakenWebSocketProvider";
import { LongPressTooltip } from "./components/utils/LongPressTooltip";
import { base44 } from "@/api/base44Client";

function LayoutContent({ children, currentPageName }) {
  const location = useLocation();
  const { settings, user, isLoading, updateSetting } = useSettings();
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [showBiometricsPrompt, setShowBiometricsPrompt] = useState(false);
  const [biometricsCheckComplete, setBiometricsCheckComplete] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // This state controls the one-time splash screen for the session
  const [showInitialSplash, setShowInitialSplash] = useState(() => !sessionStorage.getItem('appInitialized'));

  // Enforce SIM globally on app load (admin = all users, non-admin = self)
  // REMOVED: const [simNormalized, setSimNormalized] = useState(false);

  useEffect(() => {
    if (showInitialSplash) {
      const timer = setTimeout(() => {
        setShowInitialSplash(false);
        sessionStorage.setItem('appInitialized', 'true');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [showInitialSplash]);

  // Fetch unread notifications count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      if (!user) return;
      try {
        const notifications = await base44.entities.Notification.filter({ read: false, created_by: user.email });
        setUnreadCount(notifications.length);
      } catch (e) {
        console.error("Failed to fetch notification count:", e);
      }
    };

    if (user) fetchUnreadCount();

    const handleNewNotification = () => {
      setUnreadCount((prev) => prev + 1);
    };

    // Also refetch when drawer is closed (user might have read some)
    if (!isNotificationsOpen && user) {
      fetchUnreadCount();
    }

    window.addEventListener('notification:created', handleNewNotification);
    window.addEventListener('notification:read', fetchUnreadCount); // In case we add this later

    return () => {
      window.removeEventListener('notification:created', handleNewNotification);
      window.removeEventListener('notification:read', fetchUnreadCount);
    };
  }, [user, isNotificationsOpen]);

  // REMOVED: useEffect for disableLiveMode
  // useEffect(() => {
  //   (async () => {
  //     if (simNormalized) return;
  //     try {
  //       await base44.functions.invoke('disableLiveMode', {});
  //     } catch (_e) {
  //       console.error("Failed to disable live mode:", _e);
  //     }
  //     setSimNormalized(true);
  //   })();
  // }, [simNormalized]);

  useEffect(() => {
    const checkForBiometricsPrompt = async () => {
      if (isLoading || !user || !settings) return;

      // Check if we should show welcome screen first
      if (!settings.has_seen_welcome) {
        setShowWelcome(true);
        return;
      }

      // Only check for biometrics if welcome is complete and we haven't checked yet
      // Also ensure biometrics isn't already enabled and prompt hasn't been seen
      if (!settings.biometrics_enabled && !settings.has_seen_biometrics_prompt && !biometricsCheckComplete) {
        // Check if device actually supports biometrics before showing prompt
        if (window.PublicKeyCredential && typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
          try {
            const hasPlatformAuth = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
            if (hasPlatformAuth) {
              setShowBiometricsPrompt(true);
            } else {
              // Device doesn't support biometrics, mark as seen to prevent re-prompting
              await updateSetting('has_seen_biometrics_prompt', true);
            }
          } catch (error) {
            console.error('Error checking biometrics support:', error);
            // On error, mark as seen to prevent loops
            await updateSetting('has_seen_biometrics_prompt', true);
          }
        } else {
          // No WebAuthn support, mark as seen to prevent re-prompting
          await updateSetting('has_seen_biometrics_prompt', true);
        }
        setBiometricsCheckComplete(true); // Mark biometrics check as complete for this session
      }
    };

    checkForBiometricsPrompt();
  }, [user, settings, isLoading, updateSetting, biometricsCheckComplete]);

  const handleWelcomeComplete = async () => {
    await updateSetting('has_seen_welcome', true);
    setShowWelcome(false);
    // After welcome, we'll check for biometrics in the next useEffect cycle
  };

  const handleBiometricsComplete = async () => {
    await updateSetting('biometrics_enabled', true);
    await updateSetting('has_seen_biometrics_prompt', true);
    setShowBiometricsPrompt(false);
  };

  const handleBiometricsDecline = async () => {
    await updateSetting('has_seen_biometrics_prompt', true);
    setShowBiometricsPrompt(false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setTimeout(() => {
      window.location.reload();
    }, 500);
  };

  const darkMode = settings?.dark_mode !== false; // Default to dark mode

  // Left-side nav items (before mic)
  const leftNavItems = [
  { title: "Dashboard", url: createPageUrl("Dashboard"), icon: Home },
  { title: "Portfolio", url: createPageUrl("Portfolio"), icon: PieChart },
  { title: "AI Trader", url: "/AITraderSettings", icon: Bot }];


  // Right-side nav items (after mic)
  const rightNavItems = [
  { title: "Wallet", url: createPageUrl("Wallet"), icon: Wallet },
  { title: "Settings", url: createPageUrl("Settings"), icon: Settings }];


  const micItem = {
    title: "AI",
    action: () => {
      setIsAssistantOpen(true);
      setTimeout(() => {
        if (window && window.__assistantMic && typeof window.__assistantMic.start === 'function') {
          window.__assistantMic.start();
        }
      }, 400);
    },
    icon: Mic
  };

  const notificationItem = {
    title: "Notifications",
    action: () => setIsNotificationsOpen(true),
    icon: Bell
  };

  // Show the initial loading splash screen ONLY on the first load of a session
  if (showInitialSplash) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#000000' }}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-lg flex items-center justify-center neon-glow mx-auto mb-4 overflow-hidden">
            <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68b9d30ff048d7f24e2fe484/83b0737a9_7fed9c694_a365a9198_logo.png" alt="NeonTrade Logo" className="object-contain w-full h-full" />
          </div>
          <p className="neon-text text-lg" style={{ color: '#39FF14' }}>Loading your NeonTrade AI...</p>
        </div>
      </div>);
  }

  // Show welcome screen for new users (after initial splash)
  if (showWelcome && user) {
    return <WelcomeScreen user={user} onComplete={handleWelcomeComplete} />;
  }

  // Show biometrics setup modal after welcome screen (only if device supports it and checks pass)
  if (showBiometricsPrompt && user) {
    return <BiometricsSetupModal isOpen={true} onComplete={handleBiometricsComplete} onDecline={handleBiometricsDecline} />;
  }

  return (
    <div className={`min-h-screen ${darkMode ? 'dark' : ''}`}>
      <style>
        {`
          :root {
            --neon-green: #39FF14;
            --neon-green-rgb: 57, 255, 20;
            --primary-bg: ${darkMode ? '#000000' : '#ffffff'};
            --primary-bg-rgb: ${darkMode ? '0, 0, 0' : '255, 255, 255'};
            --secondary-bg: ${darkMode ? '#111111' : '#f8f9fa'};
            --text-primary: ${darkMode ? '#ffffff' : '#000000'};
            --text-secondary: ${darkMode ? '#a0a0a0' : '#6b7280'};
            --border-color: ${darkMode ? '#333333' : '#e5e7eb'};
            --card-bg: ${darkMode ? '#1a1a1a' : '#ffffff'};
            --safe-area-top: env(safe-area-inset-top, 0px);
            --safe-area-bottom: env(safe-area-inset-bottom, 0px);
          }
          
          .neon-glow { box-shadow: 0 0 10px rgba(var(--neon-green-rgb), 0.5); }
          .neon-text { color: var(--neon-green); text-shadow: 0 0 10px rgba(var(--neon-green-rgb), 0.8); }
          .glass-effect { backdrop-filter: blur(10px); background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); }
          body { 
            background-color: var(--primary-bg); 
            color: var(--text-primary); 
            transition: background-color 0.3s ease;
            overscroll-behavior: none;
            -webkit-overflow-scrolling: touch;
          }
          html {
            overscroll-behavior: none;
          }
        `}
      </style>

      {/* Removed Deno-dependent injection; PushManager now fetches public key from backend */}

      <Toaster position="top-center" richColors />
      <AssistantModal isOpen={isAssistantOpen} onClose={() => setIsAssistantOpen(false)} />
      <NotificationDrawer isOpen={isNotificationsOpen} onOpenChange={setIsNotificationsOpen} />
      <PushManager />

      <div className="flex flex-col h-[100dvh]" style={{ backgroundColor: 'var(--primary-bg)' }}>
        {/* Header with safe area padding */}
        <header className="sticky top-0 z-50 px-4 py-3 border-b"
        style={{
          backgroundColor: 'rgba(var(--primary-bg-rgb), 0.8)',
          borderColor: 'var(--border-color)',
          backdropFilter: 'blur(10px)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 0.75rem)'
        }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center neon-glow overflow-hidden">
                <img src="https://qtrypzzcjebvfcihiynt.supabase.co/storage/v1/object/public/base44-prod/public/68b9d30ff048d7f24e2fe484/83b0737a9_7fed9c694_a365a9198_logo.png" alt="NeonTrade Logo" className="object-contain w-full h-full" />
              </div>
              <h1 className="text-xl font-bold neon-text">NeonTrade AI</h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="flex items-center gap-1 px-3 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors select-none"
                style={{ color: 'var(--text-secondary)' }}>
                <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span className="text-xs hidden sm:inline">Refresh</span>
              </button>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {currentPageName}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content with page transitions */}
        <main className="flex-1 overflow-auto min-h-0">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}>
              
              {children}
            </motion.div>
          </AnimatePresence>
        </main>

        {/* Bottom Navigation with safe area padding */}
        <nav className="opacity-100 flex-shrink-0 z-50 border-t select-none w-full"
        style={{
          backgroundColor: 'var(--primary-bg)',
          borderColor: 'var(--border-color)',
          backdropFilter: 'blur(20px)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)'
        }}>
          <div className="relative mx-auto w-full max-w-[95%] sm:max-w-xl md:max-w-2xl lg:max-w-3xl px-2 sm:px-4">
            {/* Mic button - always centered, raised above bar */}
            <div className="absolute left-1/2 -translate-x-1/2 -top-5 z-20">
              <LongPressTooltip
                content={
                <>
                    <p className="font-semibold text-yellow-400 mb-1">Help, I'm trapped in a microphone button!</p>
                    <p className="text-xs mb-1">I'm Neo, your AI assistant. Click me to release my market wisdom..</p>
                    <p className="text-xs text-gray-300">Or, just ask me some questions, I'm here to help!</p>
                  </>
                }
                className="bg-gray-900 text-white p-3 rounded-lg shadow-lg max-w-xs text-center">
                
                <button
                  onClick={micItem.action}
                  className="bg-slate-950 text-lime-400 neon-glow flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full shadow-2xl select-none">
                  <Mic className="w-6 h-6" />
                </button>
              </LongPressTooltip>
            </div>

            {/* Notification button - mobile only: top-right corner of bar */}
            <button
              onClick={notificationItem.action} className="px-4 rounded-md md:hidden absolute right-1 top-0.5 z-20 flex items-center justify-center w-7 h-7 transition-all duration-200 hover:shadow-lg select-none"

              style={{
                color: 'var(--text-secondary)',
                backgroundColor: 'rgba(255, 255, 255, 0.05)'
              }}>
              <div className="relative">
                <Bell className="w-3.5 h-3.5" />
                {unreadCount > 0 &&
                <span className="absolute -top-2 -right-2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] text-white font-bold ring-1 ring-white dark:ring-black">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                }
              </div>
            </button>

            {/* Main button row */}
            <div className="pt-2 pb-4 opacity-100 flex items-end sm:pb-5">
              {/* LEFT group */}
              <div className="pr-1 opacity-95 flex items-end justify-end gap-1 sm:gap-3 md:gap-4 flex-1 sm:pr-3">
                {leftNavItems.map((item) => {
                  const isActive = location.pathname === item.url;
                  const Component = item.url ? Link : 'button';
                  const props = item.url ? { to: item.url } : { onClick: item.action };
                  return (
                    <Component
                      key={item.title}
                      {...props}
                      className="flex flex-col items-center gap-0.5 sm:gap-1 rounded-lg transition-all duration-200 hover:shadow-lg justify-center shadow-sm select-none w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 p-1 sm:p-2"
                      style={{
                        color: isActive ? 'var(--neon-green)' : 'var(--text-secondary)',
                        backgroundColor: isActive ? 'rgba(var(--neon-green-rgb), 0.1)' : 'rgba(255, 255, 255, 0.05)'
                      }}>
                      <item.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isActive ? 'neon-glow' : ''}`} />
                      <span className="text-[10px] sm:text-xs font-medium leading-tight">{item.title}</span>
                    </Component>);

                })}
              </div>

              {/* CENTER spacer for mic */}
              <div className="w-14 sm:w-16 flex-shrink-0" />

              {/* RIGHT group */}
              <div className="flex items-end justify-start gap-1.5 sm:gap-3 md:gap-4 flex-1 pl-2 sm:pl-3">
                {rightNavItems.map((item) => {
                  const isActive = location.pathname === item.url;
                  const Component = item.url ? Link : 'button';
                  const props = item.url ? { to: item.url } : { onClick: item.action };
                  return (
                    <Component
                      key={item.title}
                      {...props} className="px-1 py-1 rounded-lg flex flex-col items-center gap-0.5 sm:gap-1 transition-all duration-200 hover:shadow-lg justify-center shadow-sm select-none w-12 h-12 sm:w-14 sm:h-14 md:w-16 md:h-16 sm:p-2"

                      style={{
                        color: isActive ? 'var(--neon-green)' : 'var(--text-secondary)',
                        backgroundColor: isActive ? 'rgba(var(--neon-green-rgb), 0.1)' : 'rgba(255, 255, 255, 0.05)'
                      }}>
                      <item.icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isActive ? 'neon-glow' : ''}`} />
                      <span className="text-[10px] sm:text-xs font-medium leading-tight">{item.title}</span>
                    </Component>);

                })}
                {/* Notification button - tablet/desktop inline */}
                <button
                  onClick={notificationItem.action}
                  className="hidden md:flex flex-col items-center justify-center rounded-lg transition-all duration-200 hover:shadow-lg shadow-sm select-none w-10 h-10 md:w-11 md:h-11 p-1.5 self-center ml-auto"
                  style={{
                    color: 'var(--text-secondary)',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)'
                  }}>
                  <div className="relative">
                    <Bell className="w-4 h-4" />
                    {unreadCount > 0 &&
                    <span className="absolute -top-2 -right-2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-600 text-[9px] text-white font-bold ring-1 ring-white dark:ring-black">
                        {unreadCount > 9 ? '9+' : unreadCount}
                      </span>
                    }
                  </div>
                </button>
              </div>
            </div>
          </div>
        </nav>
      </div>
    </div>);
}

export default function Layout({ children, currentPageName }) {
  return (
    <SettingsProvider>
      <KrakenWebSocketProvider>
        <LayoutContent children={children} currentPageName={currentPageName} />
      </KrakenWebSocketProvider>
    </SettingsProvider>);

}