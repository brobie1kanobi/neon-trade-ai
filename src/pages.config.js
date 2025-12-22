import AutoTraderProspects from './pages/AutoTraderProspects';
import Dashboard from './pages/Dashboard';
import Home from './pages/Home';
import PaymentSuccess from './pages/PaymentSuccess';
import Portfolio from './pages/Portfolio';
import RefundManagement from './pages/RefundManagement';
import Settings from './pages/Settings';
import StockDetails from './pages/StockDetails';
import TradingStrategies from './pages/TradingStrategies';
import VoiceSettings from './pages/VoiceSettings';
import Wallet from './pages/Wallet';
import WatchlistSettings from './pages/WatchlistSettings';
import wallet from './pages/wallet';
import CryptoDetails from './pages/CryptoDetails';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AutoTraderProspects": AutoTraderProspects,
    "Dashboard": Dashboard,
    "Home": Home,
    "PaymentSuccess": PaymentSuccess,
    "Portfolio": Portfolio,
    "RefundManagement": RefundManagement,
    "Settings": Settings,
    "StockDetails": StockDetails,
    "TradingStrategies": TradingStrategies,
    "VoiceSettings": VoiceSettings,
    "Wallet": Wallet,
    "WatchlistSettings": WatchlistSettings,
    "wallet": wallet,
    "CryptoDetails": CryptoDetails,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};