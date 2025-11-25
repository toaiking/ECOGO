
import React, { useEffect, useState, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import { Order, Product, OrderStatus } from '../types';
import { storageService } from '../services/storageService';

const DashboardHome: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
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
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const todaysOrders = orders.filter(o => o.createdAt >= todayStart);
    const pendingOrders = orders.filter(o => o.status === OrderStatus.PENDING || o.status === OrderStatus.PICKED_UP);
    const deliveringOrders = orders.filter(o => o.status === OrderStatus.IN_TRANSIT);
    
    const todayRevenue = todaysOrders
        .filter(o => o.status !== OrderStatus.CANCELLED)
        .reduce((sum, o) => sum + o.totalPrice, 0);

    const lowStockCount = products.filter(p => p.stockQuantity < 5).length;

    return {
      todayCount: todaysOrders.length,
      todayRevenue,
      pendingCount: pendingOrders.length,
      deliveringCount: deliveringOrders.length,
      lowStockCount
    };
  }, [orders, products]);

  const StatCard = ({ title, value, subValue, icon, color, to }: any) => (
    <NavLink to={to} className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 hover:shadow-md transition-all group">
      <div className="flex justify-between items-start mb-2">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${color} text-white text-lg shadow-md group-hover:scale-110 transition-transform`}>
          <i className={`fas ${icon}`}></i>
        </div>
        {subValue && <span className="text-xs font-bold text-gray-400 bg-gray-50 px-2 py-1 rounded-full">{subValue}</span>}
      </div>
      <div className="text-2xl font-black text-gray-800 mt-2">{value}</div>
      <div className="text-sm font-medium text-gray-500">{title}</div>
    </NavLink>
  );

  return (
    <div className="max-w-6xl mx-auto pb-10 animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-black text-gray-800 tracking-tight">Xin chào, {currentUser}! 👋</h1>
        <p className="text-gray-500">Đây là tổng quan tình hình kinh doanh hôm nay.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard 
          title="Đơn hôm nay" 
          value={stats.todayCount} 
          icon="fa-calendar-day" 
          color="bg-blue-500" 
          to="/tracking"
        />
        <StatCard 
          title="Doanh thu ngày" 
          value={new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(stats.todayRevenue)} 
          subValue={new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(stats.todayRevenue)}
          icon="fa-coins" 
          color="bg-green-500" 
          to="/tracking"
        />
        <StatCard 
          title="Cần xử lý gấp" 
          value={stats.pendingCount} 
          icon="fa-clock" 
          color="bg-yellow-500" 
          to="/tracking"
        />
        <StatCard 
          title="Sắp hết hàng" 
          value={stats.lowStockCount} 
          icon="fa-exclamation-triangle" 
          color="bg-red-500" 
          to="/inventory"
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-2xl p-6 text-white shadow-xl flex flex-col justify-between items-start relative overflow-hidden group">
           <div className="absolute right-[-20px] top-[-20px] text-gray-700 opacity-20 text-9xl group-hover:scale-110 transition-transform rotate-12">
              <i className="fas fa-plus-circle"></i>
           </div>
           <div className="relative z-10">
             <h3 className="text-xl font-bold mb-2">Tạo Đơn Hàng Mới</h3>
             <p className="text-gray-400 text-sm mb-4 max-w-xs">Lên đơn nhanh chóng, tự động trừ kho và tính toán doanh thu.</p>
           </div>
           <NavLink to="/order" className="relative z-10 bg-white text-black px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-gray-100 transition-colors shadow-lg">
              Tạo Ngay <i className="fas fa-arrow-right ml-2"></i>
           </NavLink>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm flex flex-col">
            <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
               <i className="fas fa-shipping-fast text-eco-600"></i> Trạng thái giao vận
            </h3>
            {stats.deliveringCount > 0 ? (
               <div className="flex-1 flex flex-col items-center justify-center text-center p-4 bg-blue-50 rounded-xl border border-blue-100">
                  <div className="text-3xl font-black text-blue-600 mb-1">{stats.deliveringCount}</div>
                  <div className="text-sm text-blue-800 font-bold">Đơn đang đi giao</div>
                  <p className="text-xs text-blue-600 mt-2">Hãy kiểm tra và cập nhật trạng thái khi hoàn tất.</p>
               </div>
            ) : (
               <div className="flex-1 flex flex-col items-center justify-center text-center text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                   <i className="fas fa-check-circle text-3xl mb-2 opacity-50"></i>
                   <span className="text-sm">Hiện không có đơn đang giao</span>
               </div>
            )}
            <NavLink to="/tracking" className="mt-4 text-center text-sm font-bold text-eco-600 hover:underline">
               Xem chi tiết quản lý <i className="fas fa-chevron-right text-xs"></i>
            </NavLink>
        </div>
      </div>
    </div>
  );
};

export default DashboardHome;
