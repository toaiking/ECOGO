import React, { useState, useEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { storageService } from '../services/storageService';
import toast from 'react-hot-toast';
import { db } from '../firebaseConfig';
import ConfirmModal from './ConfirmModal';
import SettingsModal from './SettingsModal';
import NotificationMenu from './NotificationMenu';
import { Notification } from '../types';

// Khai báo để TypeScript không báo lỗi
declare const __APP_VERSION__: string;

interface Props {
  onLogout: () => void;
}

const Navbar: React.FC<Props> = ({ onLogout }) => {
  const [isSyncing, setIsSyncing] = useState(false);
  const [showConfirmSync, setShowConfirmSync] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNotif, setShowNotif] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isIOS, setIsIOS] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  
  const [unreadCount, setUnreadCount] = useState(0);

  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null); 
  const location = useLocation();
  const isOnline = !!db;
  
  const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.1.15';

  useEffect(() => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(userAgent);
    setIsIOS(ios);

    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    // Close mobile menu when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    const unsubNotif = storageService.subscribeNotifications((notifs) => {
        setUnreadCount(notifs.filter(n => !n.isRead).length);
    });
    
    // Load Logo
    const loadLogo = () => setLogo(storageService.getLogo());
    loadLogo();
    window.addEventListener('logo_updated', loadLogo);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('logo_updated', loadLogo);
      if (unsubNotif) unsubNotif();
    };
  }, []);

  // Close all menus when route changes
  useEffect(() => {
      setIsMobileMenuOpen(false);
      setShowNotif(false);
  }, [location]);

  const handleInstallClick = () => {
    if (isIOS) {
      toast((t) => (
        <div className="flex flex-col gap-2">
          <span className="font-bold">Cài đặt trên iPhone/iPad:</span>
          <span className="text-sm">1. Bấm nút Chia sẻ <i className="fas fa-share-square mx-1"></i></span>
          <span className="text-sm">2. Chọn "Thêm vào MH chính".</span>
          <button onClick={() => toast.dismiss(t.id)} className="bg-gray-200 px-2 py-1 rounded text-xs mt-1">Đóng</button>
        </div>
      ), { duration: 6000, icon: '📱' });
    } else if (installPrompt) {
      installPrompt.prompt();
      installPrompt.userChoice.then((choiceResult: any) => {
        setInstallPrompt(null);
      });
    } else {
        toast.success("App đã được cài đặt.");
    }
  };

  const handleSyncClick = () => {
    if (!isOnline) {
      toast.error("Chưa kết nối mạng/Firebase");
      return;
    }
    setShowConfirmSync(true);
    setIsMobileMenuOpen(false);
  };

  const confirmSync = async () => {
    setShowConfirmSync(false);
    setIsSyncing(true);
    try {
        const count = await storageService.syncLocalToCloud();
        toast.success(`Đã đồng bộ ${count} đơn hàng!`);
    } catch (e) {
        console.error(e);
        toast.error("Lỗi đồng bộ.");
    } finally {
        setIsSyncing(false);
    }
  };

  const toggleNotifications = (e: React.MouseEvent) => {
      e.stopPropagation();
      setShowNotif(!showNotif);
  };

  // Styles
  const desktopLinkClass = (isActive: boolean) =>
    `flex items-center px-3 py-2 rounded-xl transition-all duration-300 ${
      isActive
        ? 'bg-white text-eco-800 font-bold shadow-lg transform scale-105'
        : 'text-eco-100 hover:bg-eco-700/50 hover:text-white font-medium'
    }`;

  const mobileLinkClass = (isActive: boolean) => 
    `p-3 rounded-xl transition-all flex items-center justify-center ${
        isActive 
        ? 'bg-white text-eco-800 shadow-md' 
        : 'text-eco-100 hover:bg-eco-800'
    }`;

  const menuItemClass = "flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-gray-50 text-gray-700 font-medium transition-colors rounded-lg";

  return (
    <>
      <nav className="bg-gradient-to-r from-eco-800 to-eco-900 shadow-xl sticky top-0 z-50 border-b border-eco-700 select-none">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            
            {/* Logo Area */}
            <div className="flex items-center space-x-3">
              <NavLink to="/dashboard" className="w-9 h-9 bg-white rounded-xl shadow-md flex items-center justify-center text-eco-700 font-bold text-xl hover:rotate-12 transition-transform overflow-hidden" aria-label="Trang chủ">
                {logo ? <img src={logo} alt="Logo" className="w-full h-full object-cover" /> : <i className="fas fa-leaf"></i>}
              </NavLink>
              <div className="flex flex-col">
                 <span className="text-white text-lg font-black leading-tight">EcoGo</span>
                 <div className="flex items-center gap-1.5 opacity-90">
                     <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400 shadow-[0_0_8px_rgba(74,222,128,0.6)]' : 'bg-gray-400'}`}></span>
                     <span className="text-eco-200 text-[10px] font-medium tracking-wide">{isOnline ? 'Cloud' : 'Local'} v{appVersion}</span>
                 </div>
              </div>
            </div>
            
            {/* DESKTOP MENU */}
            <div className="hidden md:flex items-center space-x-1">
                <NavLink to="/dashboard" className={({ isActive }) => desktopLinkClass(isActive)}>
                  <i className="fas fa-chart-pie mr-2 text-sm"></i> Tổng Quan
                </NavLink>
                <NavLink to="/order" className={({ isActive }) => desktopLinkClass(isActive)}>
                  <i className="fas fa-plus-circle mr-2 text-sm"></i> Tạo Đơn
                </NavLink>
                <NavLink to="/tracking" className={({ isActive }) => desktopLinkClass(isActive)}>
                  <i className="fas fa-shipping-fast mr-2 text-sm"></i> Theo Dõi
                </NavLink>
                <NavLink to="/audit" className={({ isActive }) => desktopLinkClass(isActive)}>
                  <i className="fas fa-file-invoice-dollar mr-2 text-sm"></i> Đối Soát
                </NavLink>
                <NavLink to="/inventory" className={({ isActive }) => desktopLinkClass(isActive)}>
                  <i className="fas fa-warehouse mr-2 text-sm"></i> Kho
                </NavLink>
                <NavLink to="/customers" className={({ isActive }) => desktopLinkClass(isActive)}>
                  <i className="fas fa-address-book mr-2 text-sm"></i> Khách
                </NavLink>

                <div className="w-px h-6 bg-eco-700 mx-2"></div>

                <div className="relative">
                    <button 
                        ref={notifBtnRef}
                        onClick={toggleNotifications} 
                        className={`p-2 rounded-lg transition-colors relative ${showNotif ? 'bg-eco-900 text-white' : 'text-eco-200 hover:text-white'}`}
                        title="Thông báo"
                        aria-label="Thông báo"
                    >
                        <i className="fas fa-bell"></i>
                        {unreadCount > 0 && (
                            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-eco-900"></span>
                        )}
                    </button>
                    {/* Pass ref of the button so Menu knows what to ignore when clicking outside */}
                    <NotificationMenu 
                        isOpen={showNotif} 
                        onClose={() => setShowNotif(false)} 
                        ignoreRef={notifBtnRef}
                    />
                </div>

                {isOnline && (
                  <button onClick={handleSyncClick} className="p-2 text-eco-200 hover:text-white" title="Đồng bộ" aria-label="Đồng bộ">
                      <i className={`fas fa-cloud-upload-alt ${isSyncing ? 'animate-bounce' : ''}`}></i>
                  </button>
                )}
                <button onClick={() => setShowSettings(true)} className="p-2 text-eco-200 hover:text-white" title="Cài đặt" aria-label="Cài đặt">
                    <i className="fas fa-cog"></i>
                </button>
                <button onClick={onLogout} className="p-2 text-eco-200 hover:text-red-300" title="Đăng xuất" aria-label="Đăng xuất">
                    <i className="fas fa-sign-out-alt"></i>
                </button>
            </div>

            {/* MOBILE ACTION BAR */}
            <div className="md:hidden flex items-center gap-3">
                {/* Notification Bell (Mobile) */}
                <div className="relative">
                    <button 
                        ref={notifBtnRef}
                        onClick={toggleNotifications} 
                        className={`p-3 rounded-xl transition-all relative ${showNotif ? 'bg-eco-700 text-white' : 'text-eco-100'}`}
                        aria-label="Thông báo"
                    >
                        <i className="fas fa-bell text-xl"></i>
                        {unreadCount > 0 && (
                            <span className="absolute top-2 right-2 w-3 h-3 bg-red-500 rounded-full border-2 border-eco-800"></span>
                        )}
                    </button>
                    <NotificationMenu 
                        isOpen={showNotif} 
                        onClose={() => setShowNotif(false)} 
                        ignoreRef={notifBtnRef}
                    />
                </div>

                {/* Priority Actions */}
                <NavLink to="/order" className={({ isActive }) => mobileLinkClass(isActive)} aria-label="Tạo đơn">
                    <i className="fas fa-plus-circle text-xl"></i>
                </NavLink>
                <NavLink to="/tracking" className={({ isActive }) => mobileLinkClass(isActive)} aria-label="Theo dõi đơn">
                    <i className="fas fa-shipping-fast text-xl"></i>
                </NavLink>
                <NavLink to="/audit" className={({ isActive }) => mobileLinkClass(isActive)} aria-label="Đối soát">
                    <i className="fas fa-file-invoice-dollar text-xl"></i>
                </NavLink>

                {/* Hamburger Menu */}
                <button 
                    onClick={(e) => { e.stopPropagation(); setIsMobileMenuOpen(!isMobileMenuOpen); }}
                    className={`p-3 rounded-xl transition-all ${isMobileMenuOpen ? 'bg-eco-700 text-white shadow-inner' : 'text-eco-100'}`}
                    aria-label="Menu"
                >
                    <i className="fas fa-bars text-xl"></i>
                </button>
            </div>
          </div>
        </div>

        {/* MOBILE DROPDOWN MENU */}
        {isMobileMenuOpen && (
            <div 
                ref={mobileMenuRef}
                className="absolute top-16 right-2 w-64 bg-white rounded-2xl shadow-2xl z-[100] border border-gray-100 overflow-hidden animate-fade-in-down origin-top-right md:hidden"
            >
                <div className="bg-gray-50 p-4 border-b border-gray-100 flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-eco-100 flex items-center justify-center text-eco-600 overflow-hidden">
                        {logo ? <img src={logo} alt="Logo" className="w-full h-full object-cover" /> : <i className="fas fa-user"></i>}
                    </div>
                    <div>
                        <div className="font-bold text-gray-800">{storageService.getCurrentUser()}</div>
                        <div className="text-xs text-green-600 font-medium">Đang hoạt động</div>
                    </div>
                </div>

                <div className="p-2 space-y-1 max-h-[70vh] overflow-y-auto">
                    <NavLink to="/dashboard" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700' : ''}`}>
                        <i className="fas fa-chart-pie w-6 text-center"></i> Tổng Quan
                    </NavLink>
                    <NavLink to="/tracking" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700' : ''}`}>
                        <i className="fas fa-shipping-fast w-6 text-center"></i> Theo Dõi Đơn
                    </NavLink>
                    <NavLink to="/audit" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700' : ''}`}>
                        <i className="fas fa-file-invoice-dollar w-6 text-center"></i> Đối Soát CK
                    </NavLink>
                    <NavLink to="/inventory" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700' : ''}`}>
                        <i className="fas fa-warehouse w-6 text-center"></i> Kho Hàng
                    </NavLink>
                    <NavLink to="/customers" className={({isActive}) => `${menuItemClass} ${isActive ? 'bg-eco-50 text-eco-700' : ''}`}>
                        <i className="fas fa-address-book w-6 text-center"></i> Khách Hàng
                    </NavLink>
                    <hr className="my-2 border-gray-100" />
                    {isOnline && (
                        <button onClick={handleSyncClick} className={menuItemClass} aria-label="Đồng bộ Cloud">
                            <i className={`fas fa-cloud-upload-alt w-6 text-center ${isSyncing ? 'text-blue-500' : 'text-gray-400'}`}></i> 
                            <span>Đồng bộ Cloud</span>
                        </button>
                    )}
                    <button onClick={() => { setShowSettings(true); setIsMobileMenuOpen(false); }} className={menuItemClass} aria-label="Cài đặt">
                        <i className="fas fa-cog w-6 text-center text-gray-400"></i> Cài đặt
                    </button>
                    {(installPrompt || isIOS) && (
                        <button onClick={handleInstallClick} className={menuItemClass} aria-label="Cài đặt App">
                            <i className="fas fa-download w-6 text-center text-gray-400"></i> Cài đặt App
                        </button>
                    )}
                    <hr className="my-2 border-gray-100" />
                    <button onClick={onLogout} className={`${menuItemClass} text-red-600 hover:bg-red-50`} aria-label="Đăng xuất">
                        <i className="fas fa-sign-out-alt w-6 text-center"></i> Đăng xuất
                    </button>
                </div>
            </div>
        )}
      </nav>

      <ConfirmModal 
        isOpen={showConfirmSync}
        title="Đồng bộ dữ liệu"
        message="Dữ liệu từ máy này sẽ được đẩy lên Cloud."
        onConfirm={confirmSync}
        onCancel={() => setShowConfirmSync(false)}
        confirmLabel="Đồng ý"
        isDanger={false}
      />
      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </>
  );
};

export default Navbar;