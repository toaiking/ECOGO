
import React, { useEffect, useState, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { Order, Product, OrderStatus, PaymentMethod } from '../types';
import { storageService } from '../services/storageService';
import RevenueReport from './RevenueReport';
import toast from 'react-hot-toast';

const DashboardHome: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  
  const currentUser = storageService.getCurrentUser() || 'Admin';

  useEffect(() => {
    const unsubOrders = storageService.subscribeOrders(setOrders);
    const unsubProducts = storageService.subscribeProducts(setProducts);
    
    // Kiểm tra nếu chưa cài đặt App (PWA)
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
    if (!isStandalone) {
        const timer = setTimeout(() => setShowInstallGuide(true), 2000);
        return () => clearTimeout(timer);
    }

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
        <button 
            onClick={() => setShowReport(true)}
            className="w-12 h-12 bg-white border-2 border-gray-900 rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center text-gray-900 active:translate-x-[2px] active:translate-y-[2px] active:shadow-none transition-all"
        >
            <i className="fas fa-chart-bar"></i>
        </button>
      </div>

      {/* PWA INSTALL NUDGE (Cảm giác như Widget thật) */}
      {showInstallGuide && (
          <div className="mb-6 mx-2 p-4 bg-blue-600 rounded-[2rem] text-white flex items-center justify-between shadow-xl animate-bounce-subtle">
              <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-lg">
                      <i className="fas fa-mobile-alt"></i>
                  </div>
                  <p className="text-xs font-black leading-tight uppercase">Cài đặt App ra màn hình<br/>để dùng như Widget</p>
              </div>
              <button onClick={() => setShowInstallGuide(false)} className="bg-white text-blue-600 px-4 py-2 rounded-xl font-black text-[10px] uppercase">OK</button>
          </div>
      )}

      {/* MAIN WIDGET GRID */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6 px-2">
          
          {/* Revenue Widget */}
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

          {/* Pending Widget */}
          <NavLink to="/tracking" className="bg-orange-100 p-5 rounded-[2.5rem] border-2 border-gray-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex flex-col justify-between">
              <i className="fas fa-box text-orange-600 text-xl"></i>
              <div>
                  <div className="text-2xl font-black text-gray-900">{stats.pendingCount}</div>
                  <div className="text-[9px] font-black text-orange-700 uppercase">Cần đóng</div>
              </div>
          </NavLink>

          {/* Low Stock Widget */}
          <NavLink to="/inventory" className="bg-red-100 p-5 rounded-[2.5rem] border-2 border-gray-100 shadow-sm flex flex-col justify-between">
              <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
              <div>
                  <div className="text-2xl font-black text-red-600">{stats.lowStockCount}</div>
                  <div className="text-[9px] font-black text-red-400 uppercase">Hết hàng</div>
              </div>
          </NavLink>
      </div>

      {/* THE "DEBT WIDGET" - TIỀN CHƯA XÁC NHẬN */}
      {stats.unverifiedTransfers.length > 0 && (
          <div className="mx-2 mb-8">
              <div className="flex justify-between items-center mb-3 px-2">
                  <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Tiền đang treo (Widget)</h3>
                  <NavLink to="/audit" className="text-[10px] font-black text-blue-600 uppercase">Xem hết ({stats.unverifiedTransfers.length})</NavLink>
              </div>
              <div className="bg-gray-900 rounded-[3rem] p-6 text-white shadow-2xl relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-4 opacity-10 text-8xl">
                      <i className="fas fa-hand-holding-usd"></i>
                  </div>
                  
                  <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-2">
                          <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"></span>
                          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Chưa xác nhận tiền về</span>
                      </div>
                      <div className="text-4xl font-black tracking-tighter mb-4">
                          {new Intl.NumberFormat('vi-VN').format(stats.unverifiedAmount)}đ
                      </div>

                      {/* Quick Scrollable Carousel of Debts */}
                      <div className="flex gap-3 overflow-x-auto no-scrollbar pb-2">
                          {stats.unverifiedTransfers.slice(0, 5).map(o => (
                              <div key={o.id} className="min-w-[180px] bg-white/10 backdrop-blur-md border border-white/10 rounded-3xl p-4 flex flex-col justify-between h-28">
                                  <div className="min-w-0">
                                      <div className="text-[10px] font-black text-gray-400 uppercase truncate mb-1">{o.customerName}</div>
                                      <div className="text-sm font-black truncate">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ</div>
                                  </div>
                                  <button 
                                      onClick={(e) => handleQuickVerify(o.id, e)}
                                      className="w-full py-2 bg-white text-gray-900 rounded-xl font-black text-[10px] uppercase shadow-lg active:scale-95 transition-all"
                                  >
                                      Xác nhận ✅
                                  </button>
                              </div>
                          ))}
                          <NavLink to="/audit" className="min-w-[100px] bg-white/5 rounded-3xl flex flex-col items-center justify-center text-gray-400 hover:text-white transition-colors">
                               <i className="fas fa-arrow-right mb-2"></i>
                               <span className="text-[9px] font-black uppercase">Tất cả</span>
                          </NavLink>
                      </div>
                  </div>
              </div>
          </div>
      )}

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
    </div>
  );
};

export default DashboardHome;
