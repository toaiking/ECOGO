
import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { storageService } from '../services/storageService';
import toast from 'react-hot-toast';
import { db } from '../firebaseConfig';
import ConfirmModal from './ConfirmModal';
import SettingsModal from './SettingsModal';
import NotificationMenu from './NotificationMenu';
import { Order, OrderStatus, PaymentMethod } from '../types';

declare const __APP_VERSION__: string;

interface Props {
  onLogout: () => void;
}

const Navbar: React.FC<Props> = ({ onLogout }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [showConfirmSync, setShowConfirmSync] = useState(false);
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
  
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.2.2';

  useEffect(() => {
    // Theo dõi đơn chưa xác nhận tiền
    const unsubOrders = storageService.subscribeOrders((orders) => {
        const count = orders.filter(o => 
            o.paymentMethod === PaymentMethod.TRANSFER && 
            !o.paymentVerified && 
            o.status !== OrderStatus.CANCELLED
        ).length;
        setUnverifiedCount(count);
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

  const handleSyncClick = () => {
    if (!isOnline) { toast.error("Chưa kết nối mạng"); return; }
    setShowConfirmSync(true);
  };

  const confirmSync = async () => {
    setShowConfirmSync(false);
    setIsSyncing(true);
    try {
        const count = await storageService.syncLocalToCloud();
        toast.success(`Đã đồng bộ ${count} dữ liệu!`);
    } catch (e) { toast.error("Lỗi đồng bộ."); } finally { setIsSyncing(false); }
  };

  const desktopLinkClass = (isActive: boolean) =>
    `flex items-center px-3 py-2 rounded-xl transition-all duration-300 relative ${
      isActive
        ? 'bg-white text-eco-800 font-bold shadow-lg transform scale-105'
        : 'text-eco-100 hover:bg-eco-700/50 hover:text-white font-medium'
    }`;

  const mobileLinkClass = (isActive: boolean) => 
    `p-3 rounded-xl transition-all flex items-center justify-center relative ${
        isActive 
        ? 'bg-white text-eco-800 shadow-md' 
        : 'text-eco-100 hover:bg-eco-800'
    }`;

  const menuItemClass = "flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-gray-50 text-gray-700 font-medium transition-colors rounded-lg relative";

  return (
    <>
      <nav className="bg-gradient-to-r from-eco-800 to-eco-900 shadow-xl sticky top-0 z-50 border-b border-eco-700 select-none">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            
            {/* Logo Area */}
            <div className="flex items-center space-x-3">
              <NavLink to="/dashboard" className="w-9 h-9 bg-white rounded-xl shadow-md flex items-center justify-center text-eco-700 overflow-hidden">
                {logo ? <img src={logo} alt="Logo" className="w-full h-full object-cover" /> : <i className="fas fa-shipping-fast"></i>}
              </NavLink>
              <div className="flex flex-col">
                 <span className="text-white text-lg font-black leading-tight tracking-tighter">EcoGo</span>
                 <div className="flex items-center gap-1.5 opacity-90">
                     <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-400'}`}></span>
                     <span className="text-eco-200 text-[9px] font-bold uppercase tracking-widest">{isOnline ? 'Cloud' : 'Local'} v{appVersion}</span>
                 </div>
              </div>
            </div>
            
            {/* DESKTOP MENU */}
            <div className="hidden md:flex items-center space-x-1">
                <NavLink to="/dashboard" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-th-large mr-2"></i> Tổng Quan</NavLink>
                <NavLink to="/order" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-plus-circle mr-2"></i> Tạo Đơn</NavLink>
                <NavLink to="/tracking" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-tasks mr-2"></i> Theo Dõi</NavLink>
                <NavLink to="/audit" className={({ isActive }) => desktopLinkClass(isActive)}>
                    <i className="fas fa-file-invoice-dollar mr-2"></i> Đối Soát
                    {unverifiedCount > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-eco-800">{unverifiedCount}</span>}
                </NavLink>
                <NavLink to="/inventory" className={({ isActive }) => desktopLinkClass(isActive)}><i className="fas fa-warehouse mr-2"></i> Kho</NavLink>

                <div className="w-px h-6 bg-eco-700 mx-2"></div>

                <div className="relative">
                    <button ref={notifBtnRef} onClick={(e) => {e.stopPropagation(); setShowNotif(!showNotif)}} className={`p-2 rounded-lg relative ${showNotif ? 'bg-eco-900 text-white' : 'text-eco-200 hover:text-white'}`}>
                        <i className="fas fa-bell"></i>
                        {unreadCount > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border border-eco-900"></span>}
                    </button>
                    <NotificationMenu isOpen={showNotif} onClose={() => setShowNotif(false)} ignoreRef={notifBtnRef} />
                </div>
                <button onClick={() => setShowSettings(true)} className="p-2 text-eco-200 hover:text-white"><i className="fas fa-cog"></i></button>
                <button onClick={onLogout} className="p-2 text-eco-200 hover:text-red-300"><i className="fas fa-sign-out-alt"></i></button>
            </div>

            {/* MOBILE ACTION BAR */}
            <div className="md:hidden flex items-center gap-1 sm:gap-2">
                <NavLink to="/order" className={({ isActive }) => mobileLinkClass(isActive)}><i className="fas fa-plus-circle text-xl"></i></NavLink>
                
                <NavLink to="/audit" className={({ isActive }) => mobileLinkClass(isActive)}>
                    <i className="fas fa-file-invoice-dollar text-xl"></i>
                    {unverifiedCount > 0 && <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-eco-800 shadow-sm">{unverifiedCount}</span>}
                </NavLink>

                {/* NÚT THÔNG BÁO CHO MOBILE */}
                <button 
                    ref={mobileNotifBtnRef}
                    onClick={(e) => { e.stopPropagation(); setShowNotif(!showNotif); setIsMobileMenuOpen(false); }}
                    className={`p-3 rounded-xl transition-all flex items-center justify-center relative ${showNotif ? 'bg-white text-eco-800 shadow-md' : 'text-eco-100 hover:bg-eco-800'}`}
                >
                    <i className="fas fa-bell text-xl"></i>
                    {unreadCount > 0 && <span className="absolute top-1.5 right-1.5 bg-red-500 text-white text-[8px] font-black w-4 h-4 rounded-full flex items-center justify-center border-2 border-eco-800 shadow-sm">{unreadCount}</span>}
                </button>

                <button onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(!isMobileMenuOpen); setShowNotif(false); }} className={`p-3 rounded-xl ${isMobileMenuOpen ? 'bg-eco-700 text-white' : 'text-eco-100'}`}><i className="fas fa-bars text-xl"></i></button>
            </div>
          </div>
        </div>

        {/* NOTIFICATION MENU MODAL-LIKE FOR MOBILE */}
        <NotificationMenu 
            isOpen={showNotif} 
            onClose={() => setShowNotif(false)} 
            ignoreRef={mobileNotifBtnRef} 
        />

        {/* MOBILE DROPDOWN */}
        {isMobileMenuOpen && (
            <div ref={mobileMenuRef} className="absolute top-16 right-2 w-64 bg-white rounded-2xl shadow-2xl z-[100] border border-gray-100 overflow-hidden animate-fade-in-down origin-top-right md:hidden">
                <div className="p-2 space-y-1">
                    <NavLink to="/dashboard" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}><i className="fas fa-th-large w-6"></i> Tổng Quan</NavLink>
                    <NavLink to="/tracking" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}><i className="fas fa-tasks w-6"></i> Theo Dõi Đơn</NavLink>
                    <NavLink to="/audit" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}>
                        <i className="fas fa-file-invoice-dollar w-6"></i> Đối Soát CK
                        {unverifiedCount > 0 && <span className="absolute right-4 bg-red-500 text-white text-[10px] font-black px-2 rounded-full">{unverifiedCount} đơn</span>}
                    </NavLink>
                    <NavLink to="/inventory" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}><i className="fas fa-warehouse w-6"></i> Kho Hàng</NavLink>
                    <NavLink to="/customers" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700 font-bold' : ''}`}><i className="fas fa-users w-6"></i> Khách Hàng</NavLink>
                    <hr className="my-2 border-gray-100" />
                    <button onClick={() => { setShowSettings(true); setIsMobileMenuOpen(false); }} className={menuItemClass}><i className="fas fa-cog w-6"></i> Cài đặt</button>
                    <button onClick={onLogout} className={`${menuItemClass} text-red-600`}><i className="fas fa-sign-out-alt w-6"></i> Đăng xuất</button>
                </div>
            </div>
        )}
      </nav>

      <ConfirmModal 
        isOpen={showConfirmSync} title="Đồng bộ dữ liệu" message="Dữ liệu sẽ được đẩy lên Cloud."
        onConfirm={confirmSync} onCancel={() => setShowConfirmSync(false)}
      />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
};

export default Navbar;
