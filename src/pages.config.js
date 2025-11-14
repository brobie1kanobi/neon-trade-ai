import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import Wallet from './pages/Wallet';
import Settings from './pages/Settings';
import WatchlistSettings from './pages/WatchlistSettings';
import CryptoDetails from './pages/CryptoDetails';
import PaymentSuccess from './pages/PaymentSuccess';
import RefundManagement from './pages/RefundManagement';
import VoiceSettings from './pages/VoiceSettings';
import StockDetails from './pages/StockDetails';
import wallet from './pages/wallet';
import Layout from './Layout.jsx';


export const PAGES = {
    "Dashboard": Dashboard,
    "Portfolio": Portfolio,
    "Wallet": Wallet,
    "Settings": Settings,
    "WatchlistSettings": WatchlistSettings,
    "CryptoDetails": CryptoDetails,
    "PaymentSuccess": PaymentSuccess,
    "RefundManagement": RefundManagement,
    "VoiceSettings": VoiceSettings,
    "StockDetails": StockDetails,
    "wallet": wallet,
}

export const pagesConfig = {
    mainPage: "Dashboard",
    Pages: PAGES,
    Layout: Layout,
};