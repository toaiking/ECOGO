
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { storageService } from '../services/storageService';
import toast from 'react-hot-toast';
import { db } from '../firebaseConfig';
import ConfirmModal from './ConfirmModal';

interface Props {
  onLogout: () => void;
}

const Navbar: React.FC<Props> = ({ onLogout }) => {
  const currentUser = storageService.getCurrentUser();
  const [isSyncing, setIsSyncing] = useState(false);
  const [showConfirmSync, setShowConfirmSync] = useState(false);
  const isOnline = !!db;

  const linkClass = (isActive: boolean) =>
    `flex items-center px-4 py-2 rounded-md transition-colors duration-200 ${
      isActive
        ? 'bg-eco-700 text-white font-medium'
        : 'text-eco-100 hover:bg-eco-600 hover:text-white'
    }`;

  const handleSyncClick = () => {
    if (!isOnline) {
      toast.error("Chưa kết nối mạng/Firebase");
      return;
    }
    setShowConfirmSync(true);
  };

  const confirmSync = async () => {
    setShowConfirmSync(false);
    setIsSyncing(true);
    try {
        const count = await storageService.syncLocalToCloud();
        toast.success(`Đã đồng bộ ${count} đơn hàng lên Cloud!`);
    } catch (e) {
        console.error(e);
        toast.error("Lỗi đồng bộ. Kiểm tra console.");
    } finally {
        setIsSyncing(false);
    }
  };

  return (
    <>
      <nav className="bg-eco-800 shadow-lg sticky top-0 z-50">
        <div className="container mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-white rounded-full flex items-center justify-center text-eco-700 font-bold text-xl">
                <i className="fas fa-leaf"></i>
              </div>
              <div className="flex flex-col">
                 <span className="text-white text-lg font-bold leading-tight">EcoGo</span>
                 <div className="flex items-center gap-1">
                     <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400' : 'bg-gray-400'}`}></span>
                     <span className="text-eco-200 text-xs">{currentUser} | {isOnline ? 'Cloud' : 'Local'}</span>
                 </div>
              </div>
            </div>
            
            <div className="flex items-center space-x-2">
              <div className="hidden md:flex space-x-1">
                <NavLink
                  to="/order"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <i className="fas fa-plus-circle mr-2"></i>
                  <span>Tạo Đơn</span>
                </NavLink>
                <NavLink
                  to="/tracking"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <i className="fas fa-shipping-fast mr-2"></i>
                  <span>Theo Dõi</span>
                </NavLink>
                <NavLink
                  to="/inventory"
                  className={({ isActive }) => linkClass(isActive)}
                >
                  <i className="fas fa-warehouse mr-2"></i>
                  <span>Kho Hàng</span>
                </NavLink>
              </div>

              {/* Mobile Menu Icon (Simplified for this view) */}
              <div className="md:hidden flex space-x-4 pr-2 text-eco-100">
                  <NavLink to="/order"><i className="fas fa-plus-circle text-xl"></i></NavLink>
                  <NavLink to="/tracking"><i className="fas fa-shipping-fast text-xl"></i></NavLink>
                  <NavLink to="/inventory"><i className="fas fa-warehouse text-xl"></i></NavLink>
              </div>
              
              {isOnline && (
                  <button 
                      onClick={handleSyncClick}
                      disabled={isSyncing}
                      className="ml-2 text-eco-200 hover:text-white bg-eco-900/50 hover:bg-eco-700 px-3 py-1 rounded text-xs flex items-center gap-1 transition-colors"
                      title="Đồng bộ dữ liệu cũ lên Cloud"
                  >
                      <i className={`fas fa-cloud-upload-alt ${isSyncing ? 'animate-bounce' : ''}`}></i>
                      <span className="hidden sm:inline">Đồng bộ</span>
                  </button>
              )}
              
              <button 
                onClick={onLogout}
                className="ml-4 text-eco-200 hover:text-white transition-colors"
                title="Đăng xuất"
              >
                <i className="fas fa-sign-out-alt text-lg"></i>
              </button>
            </div>
          </div>
        </div>
      </nav>

      <ConfirmModal 
        isOpen={showConfirmSync}
        title="Đồng bộ dữ liệu"
        message="Bạn có muốn đẩy toàn bộ dữ liệu cũ (từ máy này) lên Cloud không? Lưu ý: Dữ liệu trùng ID trên Cloud sẽ bị ghi đè."
        onConfirm={confirmSync}
        onCancel={() => setShowConfirmSync(false)}
        confirmLabel="Bắt đầu đồng bộ"
        isDanger={false}
      />
    </>
  );
};

export default Navbar;
