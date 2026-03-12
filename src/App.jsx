import './App.css'
import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import VisualEditAgent from '@/lib/VisualEditAgent'
import NavigationTracker from '@/lib/NavigationTracker'
import Layout from './layout';
import Dashboard from './pages/Dashboard';
import Portfolio from './pages/Portfolio';
import MarketAnalysis from './pages/MarketAnalysis';
import Settings from './pages/Settings';
import Home from './pages/Home';
import CryptoDetails from './pages/CryptoDetails';
import StockDetails from './pages/StockDetails';
import TradingStrategies from './pages/TradingStrategies';
import VoiceSettings from './pages/VoiceSettings';
import WatchlistSettings from './pages/WatchlistSettings';
import Wallet from './pages/Wallet';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const mainPageKey = "Dashboard";
const MainPage = Dashboard;

const LayoutWrapper = ({ children, currentPageName }) => (
  <Layout currentPageName={currentPageName}>{children}</Layout>
);

const AuthenticatedApp = () => {
  const { isLoadingAuth, isLoadingPublicSettings, authError, isAuthenticated, navigateToLogin } = useAuth();

  // Show loading spinner while checking app public settings or auth
  if (isLoadingPublicSettings || isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Handle authentication errors
  if (authError) {
    if (authError.type === 'user_not_registered') {
      return <UserNotRegisteredError />;
    } else if (authError.type === 'auth_required') {
      // Redirect to login automatically
      navigateToLogin();
      return null;
    }
  }

  // Render the main app
  return (
    <Routes>
      <Route path="/" element={
        <LayoutWrapper currentPageName="Dashboard">
          <Dashboard />
        </LayoutWrapper>
      } />
      <Route path="/Dashboard" element={<LayoutWrapper currentPageName="Dashboard"><Dashboard /></LayoutWrapper>} />
      <Route path="/Portfolio" element={<LayoutWrapper currentPageName="Portfolio"><Portfolio /></LayoutWrapper>} />
      <Route path="/MarketAnalysis" element={<LayoutWrapper currentPageName="MarketAnalysis"><MarketAnalysis /></LayoutWrapper>} />
      <Route path="/Settings" element={<LayoutWrapper currentPageName="Settings"><Settings /></LayoutWrapper>} />
      <Route path="/Home" element={<LayoutWrapper currentPageName="Home"><Home /></LayoutWrapper>} />
      <Route path="/CryptoDetails" element={<LayoutWrapper currentPageName="CryptoDetails"><CryptoDetails /></LayoutWrapper>} />
      <Route path="/StockDetails" element={<LayoutWrapper currentPageName="StockDetails"><StockDetails /></LayoutWrapper>} />
      <Route path="/TradingStrategies" element={<LayoutWrapper currentPageName="TradingStrategies"><TradingStrategies /></LayoutWrapper>} />
      <Route path="/VoiceSettings" element={<LayoutWrapper currentPageName="VoiceSettings"><VoiceSettings /></LayoutWrapper>} />
      <Route path="/WatchlistSettings" element={<LayoutWrapper currentPageName="WatchlistSettings"><WatchlistSettings /></LayoutWrapper>} />
      <Route path="/Wallet" element={<LayoutWrapper currentPageName="Wallet"><Wallet /></LayoutWrapper>} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};


function App() {

  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router>
          <NavigationTracker />
          <AuthenticatedApp />
        </Router>
        <Toaster />
        <VisualEditAgent />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App