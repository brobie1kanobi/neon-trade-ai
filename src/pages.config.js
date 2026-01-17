import AutoTraderProspects from './pages/AutoTraderProspects';
import CryptoDetails from './pages/CryptoDetails';
import Home from './pages/Home';
import PaymentSuccess from './pages/PaymentSuccess';
import RefundManagement from './pages/RefundManagement';
import Settings from './pages/Settings';
import StockDetails from './pages/StockDetails';
import TradingStrategies from './pages/TradingStrategies';
import VoiceSettings from './pages/VoiceSettings';
import WatchlistSettings from './pages/WatchlistSettings';
import wallet from './pages/wallet';
import Dashboard from './pages/Dashboard';
import Wallet from './pages/Wallet';
import Portfolio from './pages/Portfolio';
import __Layout from './Layout.jsx';


export const PAGES = {
    "AutoTraderProspects": AutoTraderProspects,
    "CryptoDetails": CryptoDetails,
    "Home": Home,
    "PaymentSuccess": PaymentSuccess,
    "RefundManagement": RefundManagement,
    "Settings": Settings,
    "StockDetails": StockDetails,
    "TradingStrategies": TradingStrategies,
    "VoiceSettings": VoiceSettings,
    "WatchlistSettings": WatchlistSettings,
    "wallet": wallet,
    "Dashboard": Dashboard,
    "Wallet": Wallet,
    "Portfolio": Portfolio,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: __Layout,
};