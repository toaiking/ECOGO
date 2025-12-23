
import React, { useEffect, useState, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { Order, Product, OrderStatus, PaymentMethod } from '../types';
import { storageService } from '../services/storageService';
import RevenueReport from './RevenueReport';
import InventoryIntelligence from './InventoryIntelligence';
import UserGuideModal from './UserGuideModal';
import toast from 'react-hot-toast';

const DashboardHome: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  
  const currentUser = storageService.getCurrentUser() || 'Admin';

  useEffect(() => {
    const unsubOrders = storageService.subscribeOrders(setOrders);
    const unsubProducts = storageService.subscribeProducts(setProducts);
    
    return () => {
      if (unsubOrders) unsubOrders();
      if (unsubProducts) unsubProducts();
    };
  }, []);

  const stats = useMemo(() => {
    const todayStart = new Date().setHours(0,0,0,0);
    const todaysOrders = orders.filter(o => o.createdAt >= todayStart && o.status !== OrderStatus.CANCELLED);
    
    const unverifiedTransfers = orders.filter(o => 
        o.paymentMethod === PaymentMethod.TRANSFER && 
        !o.paymentVerified && 
        o.status !== OrderStatus.CANCELLED
    );

    return {
      todayCount: todaysOrders.length,
      todayRevenue: todaysOrders.reduce((sum, o) => sum + o.totalPrice, 0),
      pendingCount: orders.filter(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.PICKED_UP).length,
      lowStockCount: products.filter(p => p.stockQuantity < 5).length,
      unverifiedTransfers,
      unverifiedAmount: unverifiedTransfers.reduce((sum, o) => sum + o.totalPrice, 0)
    };
  }, [orders, products]);

  const handleQuickVerify = async (id: string, e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      await storageService.updatePaymentVerification(id, true);
      toast.success("Đã khớp tiền! ✅");
  };

  return (
    <div className="max-w-6xl mx-auto pb-24 animate-fade-in px-2">
      
      {/* GREETING & REPORT BUTTON */}
      <div className="mb-6 flex justify-between items-end px-2">
        <div>
            <p className="text-gray-400 text-[10px] font-black uppercase tracking-widest mb-1">Hệ thống EcoGo</p>
            <h1 className="text-3xl font-black text-gray-900 tracking-tighter">Chào {currentUser}!</h1>
        </div>
        <div className="flex gap-2">
            <button 
                onClick={() => setShowGuide(true)}
                className="w-12 h-12 bg-white border-2 border-gray-900 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center text-gray-900 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                title="Hướng dẫn sử dụng"
            >
                <i className="fas fa-book-open"></i>
            </button>
            <button 
                onClick={() => setShowReport(true)}
                className="w-12 h-12 bg-white border-2 border-gray-900 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center text-gray-900 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
                title="Báo cáo doanh thu"
            >
                <i className="fas fa-chart-bar"></i>
            </button>
        </div>
      </div>

      {/* AI INVENTORY INTELLIGENCE */}
      <div className="mb-6 px-2">
          <InventoryIntelligence />
      </div>

      {/* MAIN WIDGET GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 px-2">
          <div className="col-span-2 bg-white p-5 rounded-[2.5rem] border-2 border-gray-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] relative overflow-hidden group">
              <div className="relative z-10">
                  <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Doanh thu hôm nay</div>
                  <div className="text-3xl font-black text-gray-900 tracking-tighter leading-none mb-1">
                      {new Intl.NumberFormat('vi-VN').format(stats.todayRevenue)}đ
                  </div>
                  <div className="flex items-center gap-1 text-[10px] font-bold text-eco-600 uppercase">
                      <i className="fas fa-arrow-up"></i> {stats.todayCount} đơn hàng
                  </div>
              </div>
              <div className="absolute right-4 bottom-4 opacity-10 text-6xl group-hover:scale-110 transition-transform">
                  <i className="fas fa-wallet"></i>
              </div>
          </div>

          <NavLink to="/tracking" className="bg-orange-100 p-5 rounded-[2.5rem] border-2 border-gray-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
              <i className="fas fa-box text-orange-600 text-xl"></i>
              <div>
                  <div className="text-2xl font-black text-gray-900">{stats.pendingCount}</div>
                  <div className="text-[9px] font-black text-orange-700 uppercase">Cần đóng</div>
              </div>
          </NavLink>

          <NavLink to="/inventory" className="bg-red-100 p-5 rounded-[2.5rem] border-2 border-gray-100 shadow-sm flex flex-col justify-between">
              <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
              <div>
                  <div className="text-2xl font-black text-red-600">{stats.lowStockCount}</div>
                  <div className="text-[9px] font-black text-red-400 uppercase">Hết hàng</div>
              </div>
          </NavLink>
      </div>

      {/* QUICK ACTIONS SECTION */}
      <div className="grid grid-cols-1 gap-4 px-2">
          <NavLink to="/order" className="bg-eco-500 p-8 rounded-[3rem] text-white flex items-center justify-between shadow-xl group">
              <div>
                  <h3 className="text-2xl font-black tracking-tight leading-none mb-2 uppercase">Lên đơn ngay</h3>
                  <p className="text-white/70 text-xs font-bold">Tự động trừ kho & tính lãi</p>
              </div>
              <div className="w-16 h-16 bg-white rounded-[2rem] flex items-center justify-center text-eco-600 text-2xl shadow-lg group-hover:rotate-12 transition-transform">
                  <i className="fas fa-plus"></i>
              </div>
          </NavLink>
      </div>

      <RevenueReport isOpen={showReport} onClose={() => setShowReport(false)} />
      <UserGuideModal isOpen={showGuide} onClose={() => setShowGuide(false)} />
    </div>
  );
};

export default DashboardHome;
