
import React, { useState, useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import Navbar from './components/Navbar';
import DashboardHome from './components/DashboardHome';
import OrderForm from './components/OrderForm';
import TrackingDashboard from './components/TrackingDashboard';
import InventoryManager from './components/InventoryManager';
import CustomerManager from './components/CustomerManager';
import Login from './components/Login';
import { Toaster } from 'react-hot-toast';
import { storageService } from './services/storageService';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const user = storageService.getCurrentUser();
    if (user) {
      setIsAuthenticated(true);
    }
  }, []);

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    storageService.logout();
    setIsAuthenticated(false);
  };

  if (!isAuthenticated) {
    return (
      <>
        <Login onLogin={handleLogin} />
        <Toaster position="bottom-right" />
      </>
    );
  }

  return (
    <HashRouter>
      <div className="min-h-screen bg-gray-50 flex flex-col font-sans">
        <Navbar onLogout={handleLogout} />
        {/* Responsive Container Adjusted: px-3 for mobile, max-w-4xl for tablet focus, max-w-7xl for desktop */}
        <main className="flex-grow container mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-6 max-w-4xl lg:max-w-7xl transition-all">
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardHome />} />
            <Route path="/order" element={<OrderForm />} />
            <Route path="/tracking" element={<TrackingDashboard />} />
            <Route path="/inventory" element={<InventoryManager />} />
            <Route path="/customers" element={<CustomerManager />} />
          </Routes>
        </main>
        <Toaster position="bottom-right" />
      </div>
    </HashRouter>
  );
};

export default App;