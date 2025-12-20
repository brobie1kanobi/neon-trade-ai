import CryptoDetails from './pages/CryptoDetails';
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
import AutoTraderProspects from './pages/AutoTraderProspects';
import __Layout from './Layout.jsx';


export const PAGES = {
    "CryptoDetails": CryptoDetails,
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
    "AutoTraderProspects": AutoTraderProspects,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};