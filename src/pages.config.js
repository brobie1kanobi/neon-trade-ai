/**
 * pages.config.js - Page routing configuration
 * 
 * This file is AUTO-GENERATED. Do not add imports or modify PAGES manually.
 * Pages are auto-registered when you create files in the ./pages/ folder.
 * 
 * THE ONLY EDITABLE VALUE: mainPage
 * This controls which page is the landing page (shown when users visit the app).
 * 
 * Example file structure:
 * 
 *   import HomePage from './pages/HomePage';
 *   import Dashboard from './pages/Dashboard';
 *   import Settings from './pages/Settings';
 *   
 *   export const PAGES = {
 *       "HomePage": HomePage,
 *       "Dashboard": Dashboard,
 *       "Settings": Settings,
 *   }
 *   
 *   export const pagesConfig = {
 *       mainPage: "HomePage",
 *       Pages: PAGES,
 *   };
 * 
 * Example with Layout (wraps all pages):
 *
 *   import Home from './pages/Home';
 *   import Settings from './pages/Settings';
 *   import __Layout from './Layout.jsx';
 *
 *   export const PAGES = {
 *       "Home": Home,
 *       "Settings": Settings,
 *   }
 *
 *   export const pagesConfig = {
 *       mainPage: "Home",
 *       Pages: PAGES,
 *       Layout: __Layout,
 *   };
 *
 * To change the main page from HomePage to Dashboard, use find_replace:
 *   Old: mainPage: "HomePage",
 *   New: mainPage: "Dashboard",
 *
 * The mainPage value must match a key in the PAGES object exactly.
 */
import AutoTraderProspects from './pages/AutoTraderProspects';
import CryptoDetails from './pages/CryptoDetails';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import Portfolio from './pages/Portfolio';
import StockDetails from './pages/StockDetails';
import TradingStrategies from './pages/TradingStrategies';
import VoiceSettings from './pages/VoiceSettings';
import Wallet from './pages/Wallet';
import WatchlistSettings from './pages/WatchlistSettings';
import wallet from './pages/wallet';
import PaymentSuccess from './pages/PaymentSuccess';
import RefundManagement from './pages/RefundManagement';
import Settings from './pages/Settings';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AutoTraderProspects": AutoTraderProspects,
    "CryptoDetails": CryptoDetails,
    "Dashboard": Dashboard,
    "Home": Home,
    "Portfolio": Portfolio,
    "StockDetails": StockDetails,
    "TradingStrategies": TradingStrategies,
    "VoiceSettings": VoiceSettings,
    "Wallet": Wallet,
    "WatchlistSettings": WatchlistSettings,
    "wallet": wallet,
    "PaymentSuccess": PaymentSuccess,
    "RefundManagement": RefundManagement,
    "Settings": Settings,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};