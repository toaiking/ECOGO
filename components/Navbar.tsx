
import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { storageService } from '../services/storageService';
import { db } from '../firebaseConfig';
import SettingsModal from './SettingsModal';
import NotificationMenu from './NotificationMenu';
import { Order, OrderStatus, PaymentMethod } from '../types';

declare const __APP_VERSION__: string;

interface Props {
  onLogout: () => void;
}

const Navbar: React.FC<Props> = ({ onLogout }) => {
  const [showSettings, setShowSettings] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unverifiedCount, setUnverifiedCount] = useState(0);

  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null); 
  const mobileNotifBtnRef = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const isOnline = !!db;
  
  useEffect(() => {
    const unsubOrders = storageService.subscribeOrders((orders) => {
        const count = orders.filter(o => 
            o.paymentMethod === PaymentMethod.TRANSFER && 
            !o.paymentVerified && 
            o.status !== OrderStatus.CANCELLED
        ).length;
        setUnverifiedCount(count);
        
        if ('setAppBadge' in navigator && count > 0) {
            (navigator as any).setAppBadge(count).catch(() => {});
        }
    });

    const handleClickOutside = (event: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    const unsubNotif = storageService.subscribeNotifications((notifs) => {
        setUnreadCount(notifs.filter(n => !n.isRead).length);
    });
    
    const loadLogo = () => setLogo(storageService.getLogo());
    loadLogo();
    window.addEventListener('logo_updated', loadLogo);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('logo_updated', loadLogo);
      if (unsubNotif) unsubNotif();
      if (unsubOrders) unsubOrders();
    };
  }, []);

  useEffect(() => {
      setIsMobileMenuOpen(false);
      setShowNotif(false);
  }, [location]);

  // Updated Styles for Clean White + Green Accent Look
  const desktopLinkClass = (isActive: boolean) =>
    `flex items-center px-3 py-2 rounded-lg transition-all duration-200 relative text-sm font-bold ${
      isActive
        ? 'bg-eco-50 text-eco-700 shadow-sm'
        : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
    }`;

  const mobileLinkClass = (isActive: boolean) => 
    `p-3 rounded-xl transition-all flex items-center justify-center relative ${
        isActive 
        ? 'bg-eco-50 text-eco-600 shadow-sm' 
        : 'text-slate-400 hover:bg-slate-50'
    }`;

  const menuItemClass = "flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-slate-50 text-slate-700 font-medium transition-colors rounded-lg relative";

  return (
    <>
      <nav className="bg-white shadow-sm border-b border-slate-100 sticky top-0 z-50 select-none backdrop-blur-md bg-white/90">
        <div className="container mx-auto px-3 lg:px-4">
          <div className="flex justify-between items-center h-16">
            
            {/* Logo Area */}
            <div className="flex items-center space-x-3 shrink-0">
              <NavLink to="/dashboard" className="flex items-center gap-2 group">
                <div className="w-9 h-9 bg-eco-600 rounded-xl shadow-lg shadow-eco-100 flex items-center justify-center text-white overflow-hidden group-hover:rotate-12 transition-transform">
                  {logo ? <img src={logo} alt="Logo" className="w-full h-full object-cover" /> : <i className="fas fa-leaf"></i>}
                </div>
                <div className="flex flex-col">
                   <span className="text-slate-800 text-lg font-black leading-tight tracking-tight">EcoGo</span>
                   <div className="flex items-center gap-1 opacity-60">
                       <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-slate-400'}`}></span>
                       <span className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">{isOnline ? 'Online' : 'Local'}</span>
                   </div>
                </div>
              </NavLink>
            </div>
            
            {/* DESKTOP & TABLET MENU */}
            <div className="hidden md:flex items-center space-x-1 lg:space-x-2">
                <NavLink to="/dashboard" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-th-large mr-2"></i>Tổng Quan</NavLink>
                <NavLink to="/order" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-plus-circle mr-2"></i>Tạo Đơn</NavLink>
                <NavLink to="/tracking" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-tasks mr-2"></i>Theo Dõi</NavLink>
                <NavLink to="/audit" className={({ isActive }) => desktopLinkClass(isActive)}>
                    <i className="fas fa-file-invoice-dollar mr-2"></i>Đối Soát
                    {unverifiedCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">{unverifiedCount}</span>}
                </NavLink>
                <NavLink to="/inventory" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-warehouse mr-2"></i>Kho</NavLink>
                <NavLink to="/customers" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-users mr-2"></i>Khách</NavLink>

                <div className="w-px h-6 bg-slate-200 mx-2"></div>

                <div className="relative">
                    <button ref={notifBtnRef} onClick={(e) => {e.stopPropagation(); setShowNotif(!showNotif)}} className={`p-2.5 rounded-xl transition-all ${showNotif ? 'bg-eco-50 text-eco-600' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}>
                        <i className="fas fa-bell text-lg"></i>
                        {unreadCount > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
                    </button>
                    <div className="hidden md:block">
                        <NotificationMenu isOpen={showNotif} onClose={() => setShowNotif(false)} ignoreRef={notifBtnRef} />
                    </div>
                </div>
                <button onClick={() => setShowSettings(true)} className="p-2.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-xl transition-all" title="Cài đặt"><i className="fas fa-cog text-lg"></i></button>
                <button onClick={onLogout} className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Đăng xuất"><i className="fas fa-sign-out-alt text-lg"></i></button>
            </div>

            {/* MOBILE ACTION BAR */}
            <div className="md:hidden flex items-center gap-1">
                <NavLink to="/order" className={({ isActive }) => mobileLinkClass(isActive)} title="Tạo đơn"><i className="fas fa-plus-circle text-xl"></i></NavLink>
                <NavLink to="/tracking" className={({ isActive }) => mobileLinkClass(isActive)} title="Theo dõi"><i className="fas fa-tasks text-xl"></i></NavLink>
                <NavLink to="/audit" className={({ isActive }) => mobileLinkClass(isActive)} title="Đối soát">
                    <div className="relative">
                        <i className="fas fa-file-invoice-dollar text-xl"></i>
                        {unverifiedCount > 0 && <span className="absolute -top-2 -right-2 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center border border-white">{unverifiedCount}</span>}
                    </div>
                </NavLink>

                <button 
                    ref={mobileNotifBtnRef}
                    onClick={(e) => { e.stopPropagation(); setShowNotif(!showNotif); setIsMobileMenuOpen(false); }}
                    className={`p-3 rounded-xl transition-all relative ${showNotif ? 'bg-eco-50 text-eco-600' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                    <i className="fas fa-bell text-xl"></i>
                    {unreadCount > 0 && <span className="absolute top-2 right-2 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white"></span>}
                </button>

                <button onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(!isMobileMenuOpen); setShowNotif(false); }} className={`p-3 rounded-xl transition-all ${isMobileMenuOpen ? 'bg-slate-100 text-slate-900' : 'text-slate-400'}`}><i className="fas fa-bars text-xl"></i></button>
            </div>
          </div>
        </div>

        {/* Only render this instance for Mobile layout */}
        <div className="md:hidden">
            <NotificationMenu isOpen={showNotif} onClose={() => setShowNotif(false)} ignoreRef={mobileNotifBtnRef} />
        </div>

        {/* MOBILE DROPDOWN */}
        {isMobileMenuOpen && (
            <div ref={mobileMenuRef} className="absolute top-16 right-3 w-64 bg-white rounded-2xl shadow-xl shadow-slate-200/50 z-[100] border border-slate-100 overflow-hidden animate-fade-in-down origin-top-right md:hidden">
                <div className="p-2 space-y-1">
                    <NavLink to="/dashboard" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}><i className="fas fa-th-large w-6"></i> Tổng Quan</NavLink>
                    <NavLink to="/inventory" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}><i className="fas fa-warehouse w-6"></i> Kho Hàng</NavLink>
                    <NavLink to="/customers" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}><i className="fas fa-users w-6"></i> Khách Hàng</NavLink>
                    <hr className="my-2 border-slate-100" />
                    <button onClick={() => { setShowSettings(true); setIsMobileMenuOpen(false); }} className={menuItemClass}><i className="fas fa-cog w-6"></i> Cài đặt</button>
                    <button onClick={onLogout} className={`${menuItemClass} text-red-500 hover:bg-red-50 hover:text-red-600`}><i className="fas fa-sign-out-alt w-6"></i> Đăng xuất</button>
                </div>
            </div>
        )}
      </nav>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
};

export default Navbar;
