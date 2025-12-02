
import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod } from '../types';
import { storageService } from '../services/storageService';
import ConfirmModal from './ConfirmModal';

interface CustomerDebtGroup {
    key: string;
    customerId: string;
    customerName: string;
    customerPhone: string;
    orders: Order[];
    totalAmount: number;
    maxReminders: number;
}

const PaymentAudit: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [bankConfig, setBankConfig] = useState<any>(null);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('ALL');
  
  // Confirmation State
  const [showConfirm, setShowConfirm] = useState(false);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [confirmMessage, setConfirmMessage] = useState('');
  
  // Sharing State
  const [isSharing, setIsSharing] = useState(false);
  
  // View Mode
  const [viewMode, setViewMode] = useState<'SINGLE' | 'CUSTOMER'>('SINGLE');

  useEffect(() => {
    // Subscribe to orders
    const unsub = storageService.subscribeOrders((allOrders) => {
      // Filter: Transfer method + Not Verified + Not Cancelled
      const pending = allOrders.filter(o => 
        o.paymentMethod === PaymentMethod.TRANSFER && 
        !o.paymentVerified && 
        o.status !== OrderStatus.CANCELLED
      );
      // Sort by newest
      setOrders(pending.sort((a, b) => b.createdAt - a.createdAt));
    });

    // Load bank config
    storageService.getBankConfig().then(setBankConfig);

    return () => {
      if (unsub) unsub();
    };
  }, []);

  const batches = useMemo(() => {
    const batchSet = new Set<string>();
    orders.forEach(o => { if (o.batchId) batchSet.add(o.batchId); });
    return Array.from(batchSet).sort();
  }, [orders]);

  // --- FILTERING LOGIC ---
  const filteredOrders = useMemo(() => {
    return orders.filter(o => {
        const matchSearch = searchTerm === '' || 
             o.customerName.toLowerCase().includes(searchTerm.toLowerCase()) || 
             o.customerPhone.includes(searchTerm) || 
             o.id.includes(searchTerm.toUpperCase());
             
        const matchBatch = selectedBatch === 'ALL' || o.batchId === selectedBatch;
        
        return matchSearch && matchBatch;
    });
  }, [orders, searchTerm, selectedBatch]);

  const totalAmount = filteredOrders.reduce((sum, o) => sum + o.totalPrice, 0);

  // --- GROUPING LOGIC ---
  const customerGroups = useMemo(() => {
      const groups: Record<string, CustomerDebtGroup> = {};
      
      filteredOrders.forEach(o => {
          // Group key priority: CustomerID -> Phone -> Name
          const key = o.customerId || (o.customerPhone && o.customerPhone.length > 5 
              ? o.customerPhone 
              : o.customerName);
          
          if (!groups[key]) {
              groups[key] = {
                  key,
                  customerId: o.customerId || '',
                  customerName: o.customerName,
                  customerPhone: o.customerPhone,
                  orders: [],
                  totalAmount: 0,
                  maxReminders: 0
              };
          }
          
          groups[key].orders.push(o);
          groups[key].totalAmount += o.totalPrice;
          groups[key].maxReminders = Math.max(groups[key].maxReminders || 0, o.reminderCount || 0);
      });

      return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredOrders]);

  // --- HANDLERS ---

  const handleConfirmSingle = (id: string, name: string) => {
    setTargetIds([id]);
    setConfirmMessage(`Xác nhận TIỀN ĐÃ VỀ cho đơn #${id} (${name})?`);
    setShowConfirm(true);
  };

  const handleConfirmGroup = (group: CustomerDebtGroup) => {
      const ids = group.orders.map(o => o.id);
      setTargetIds(ids);
      setConfirmMessage(`Xác nhận TIỀN ĐÃ VỀ ĐỦ ${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ cho ${ids.length} đơn của ${group.customerName}?`);
      setShowConfirm(true);
  };

  const executeConfirm = async () => {
    if (targetIds.length > 0) {
      const firstOrder = orders.find(o => o.id === targetIds[0]);
      
      const promises = targetIds.map(id => 
          storageService.updatePaymentVerification(id, true, firstOrder ? { name: firstOrder.customerName } : undefined)
      );
      
      await Promise.all(promises);
      
      toast.success(`Đã xác nhận tiền về cho ${targetIds.length} đơn!`);
      setShowConfirm(false);
      setTargetIds([]);
    }
  };

  // NEW FEATURE: Increment Reminder Count
  const incrementReminder = async (ids: string[]) => {
      await storageService.incrementReminderCount(ids);
  };

  const generateAndShareQR = async (amount: number, content: string, title: string, relatedIds: string[]) => {
    if (!bankConfig || !bankConfig.accountNo) {
        toast.error("Vui lòng cài đặt thông tin Ngân hàng trước");
        return;
    }

    setIsSharing(true);
    const toastId = toast.loading("Đang tạo mã QR...");

    try {
        const url = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template || 'compact2'}.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(bankConfig.accountName)}`;

        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], `QR-${Date.now()}.png`, { type: "image/png" });
        
        // Auto increment reminder count when sharing starts
        await incrementReminder(relatedIds);

        if (navigator.share) {
            await navigator.share({
                title: title,
                text: `Thanh toán: ${content} - Số tiền: ${new Intl.NumberFormat('vi-VN').format(amount)}đ`,
                files: [file]
            });
            toast.dismiss(toastId);
            toast.success("Đã mở chia sẻ & Tăng đếm nhắc nhở!");
        } else {
            await navigator.clipboard.writeText(url);
            toast.dismiss(toastId);
            toast.success("Đã copy link QR (Thiết bị không hỗ trợ chia sẻ ảnh)");
        }
    } catch (e) {
        console.error(e);
        toast.dismiss(toastId);
        toast.error("Lỗi chia sẻ QR");
    } finally {
        setIsSharing(false);
    }
  };

  const handleShareSingleQR = (order: Order) => {
      const desc = `DH ${order.id}`;
      generateAndShareQR(order.totalPrice, desc, `Thanh toán đơn ${order.id}`, [order.id]);
  };

  const handleShareGroupQR = (group: CustomerDebtGroup) => {
      const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase();
      const words = safeName.split(' ');
      const shortName = words.length > 2 ? `${words[0]} ${words[words.length-1]}` : safeName;
      
      const desc = `TT ${shortName} ${group.orders.length} DON`;
      const ids = group.orders.map(o => o.id);
      generateAndShareQR(group.totalAmount, desc, `Thanh toán tổng ${group.orders.length} đơn`, ids);
  };

  const handleSMS = async (phone: string, name: string, amount: number, content: string, relatedIds: string[]) => {
     if (!bankConfig || !bankConfig.accountNo) {
      toast.error("Chưa có thông tin ngân hàng");
      return;
    }

    await incrementReminder(relatedIds);

    const price = new Intl.NumberFormat('vi-VN').format(amount);
    const msg = `Chào ${name}, tổng tiền cần thanh toán là ${price}đ. Vui lòng CK tới STK ${bankConfig.accountNo} (${bankConfig.bankId}) - ${bankConfig.accountName}. Nội dung: ${content}. Cảm ơn!`;
    
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1;
    const separator = isIOS ? '&' : '?';
    
    window.open(`sms:${phone}${separator}body=${encodeURIComponent(msg)}`, '_self');
  };

  // Helper Component for Reminder Badge
  const ReminderBadge = ({ count }: { count?: number }) => {
      if (!count || count === 0) return null;
      const isUrgent = count > 2;
      return (
          <div 
             className={`flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border shadow-sm ${isUrgent ? 'bg-red-50 text-red-600 border-red-200 animate-pulse' : 'bg-orange-50 text-orange-600 border-orange-200'}`} 
             title={`Đã nhắc ${count} lần`}
          >
              <i className="fas fa-bullhorn text-[8px]"></i> {count}
          </div>
      );
  }

  // --- RENDER ---
  return (
    <div className="max-w-6xl mx-auto pb-24 animate-fade-in px-2 sm:px-4">
      
      {/* 1. HEADER SUMMARY */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-eco-100 mb-4 flex flex-col md:flex-row justify-between items-center gap-4 sticky top-16 z-30">
        <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-eco-50 text-eco-600 flex items-center justify-center text-lg shadow-inner">
                 <i className="fas fa-wallet"></i>
             </div>
             <div>
                 <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Tổng công nợ cần thu</h2>
                 <div className="text-2xl font-black text-eco-700 tracking-tight leading-none">
                     {new Intl.NumberFormat('vi-VN').format(totalAmount)}<span className="text-sm text-gray-400 ml-1">đ</span>
                 </div>
             </div>
        </div>
        
        <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-xl">
            <button 
                onClick={() => setViewMode('SINGLE')}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'SINGLE' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                <i className="fas fa-list"></i>
                Đơn Lẻ
            </button>
            <button 
                onClick={() => setViewMode('CUSTOMER')}
                className={`px-3 py-2 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${viewMode === 'CUSTOMER' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
                <i className="fas fa-users"></i>
                Theo Khách
            </button>
        </div>
      </div>

      {/* 2. FILTERS */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
             <div className="relative flex-grow">
                 <i className="fas fa-search absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                 <input 
                     value={searchTerm}
                     onChange={e => setSearchTerm(e.target.value)}
                     placeholder="Tìm tên, SĐT, Mã đơn..."
                     className="w-full pl-9 pr-4 py-2 bg-white border border-gray-200 focus:border-eco-500 rounded-xl text-xs font-medium outline-none shadow-sm transition-all h-9"
                 />
             </div>
             {batches.length > 0 && (
                 <div className="relative min-w-[150px]">
                     <select 
                         value={selectedBatch}
                         onChange={e => setSelectedBatch(e.target.value)}
                         className="w-full appearance-none pl-3 pr-8 py-2 bg-white border border-gray-200 focus:border-eco-500 rounded-xl text-xs font-bold text-gray-700 outline-none shadow-sm cursor-pointer h-9"
                     >
                         <option value="ALL">Lô: Tất cả</option>
                         {batches.map(b => <option key={b} value={b}>{b}</option>)}
                     </select>
                     <i className="fas fa-filter absolute right-3 top-3 text-gray-400 text-[10px] pointer-events-none"></i>
                 </div>
             )}
      </div>

      {/* 3. LIST CONTENT */}
      {filteredOrders.length === 0 ? (
           <div className="bg-white rounded-2xl p-12 text-center border border-dashed border-gray-200">
             <div className="w-16 h-16 bg-eco-50 rounded-full flex items-center justify-center mb-3 mx-auto">
                <i className="fas fa-check-circle text-3xl text-eco-500"></i>
             </div>
             <h3 className="text-sm font-bold text-gray-800">Tuyệt vời!</h3>
             <p className="text-xs text-gray-500 mt-1">Không có công nợ nào cần xử lý.</p>
           </div>
      ) : (
          <>
            {/* VIEW MODE: SINGLE (Compact Grid) */}
            {viewMode === 'SINGLE' && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {filteredOrders.map(order => (
                        <div key={order.id} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm hover:shadow-md hover:border-eco-300 transition-all flex flex-col justify-between">
                            
                            {/* Top Row: Meta Info */}
                            <div className="flex justify-between items-start mb-2 text-[10px] text-gray-400 border-b border-gray-50 pb-2">
                                <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-gray-500">#{order.id.slice(-5)}</span>
                                    {order.batchId && <span className="bg-gray-100 px-1.5 rounded">{order.batchId}</span>}
                                </div>
                                <span>{new Date(order.createdAt).toLocaleDateString('vi-VN', {day: '2-digit', month: '2-digit'})}</span>
                            </div>

                            {/* Middle Row: Content */}
                            <div className="mb-3">
                                <div className="flex justify-between items-start">
                                    <div className="font-bold text-gray-800 text-sm line-clamp-1 mr-2">{order.customerName}</div>
                                    <ReminderBadge count={order.reminderCount} />
                                </div>
                                <div className="text-[10px] text-gray-500 truncate mb-1.5">{order.items.map(i => i.name).join(', ')}</div>
                                <div className="flex justify-between items-end">
                                    <div className="text-[10px] text-gray-400 font-mono">{order.customerPhone}</div>
                                    <div className="text-lg font-black text-eco-700 leading-none">
                                        {new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<span className="text-xs ml-0.5">đ</span>
                                    </div>
                                </div>
                            </div>

                            {/* Bottom Row: Actions */}
                            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
                                <button 
                                    onClick={() => handleConfirmSingle(order.id, order.customerName)}
                                    className="h-9 px-3 rounded-lg bg-eco-600 hover:bg-eco-700 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm active:scale-95"
                                >
                                    <i className="fas fa-check-circle"></i> Xác nhận tiền về
                                </button>
                                <button 
                                    onClick={() => handleShareSingleQR(order)}
                                    disabled={isSharing}
                                    className="h-9 w-9 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-100 flex items-center justify-center transition-colors"
                                    title="Gửi QR & Nhắc nhở"
                                >
                                    <i className="fas fa-qrcode"></i>
                                </button>
                                <button 
                                    onClick={() => handleSMS(order.customerPhone, order.customerName, order.totalPrice, `DH ${order.id}`, [order.id])}
                                    className="h-9 w-9 rounded-lg bg-orange-50 text-orange-600 hover:bg-orange-100 border border-orange-100 flex items-center justify-center transition-colors"
                                    title="Gửi SMS & Nhắc nhở"
                                >
                                    <i className="fas fa-comment-dots"></i>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* VIEW MODE: CUSTOMER GROUPS (Compact) */}
            {viewMode === 'CUSTOMER' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customerGroups.map(group => (
                        <div key={group.key} className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col hover:border-eco-300 transition-colors">
                            {/* Group Header */}
                            <div className="p-3 bg-gray-50/80 border-b border-gray-100 flex justify-between items-center">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <h3 className="font-bold text-gray-800 text-sm">{group.customerName}</h3>
                                        <ReminderBadge count={group.maxReminders} />
                                    </div>
                                    <div className="text-[10px] text-gray-500 flex items-center gap-2 mt-0.5">
                                        <span className="font-mono">{group.customerPhone || '---'}</span>
                                        <span className="bg-white border px-1 rounded font-bold text-gray-600">{group.orders.length} đơn</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-lg font-black text-eco-700">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}<span className="text-[10px] text-gray-400">đ</span></div>
                                </div>
                            </div>

                            {/* Orders List (Ultra Compact) */}
                            <div className="flex-grow p-2 space-y-1 bg-white max-h-40 overflow-y-auto">
                                {group.orders.map(o => (
                                    <div key={o.id} className="flex justify-between items-center text-[10px] p-1.5 rounded hover:bg-gray-50 border border-transparent hover:border-gray-100">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <span className="text-gray-400 font-mono">#{o.id.slice(-4)}</span>
                                            <span className="text-gray-600 truncate">{o.items.map(i => i.name).join(', ')}</span>
                                        </div>
                                        <span className="font-bold text-gray-800 whitespace-nowrap ml-2">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Action Bar */}
                            <div className="p-2 bg-gray-50 border-t border-gray-100 grid grid-cols-[1fr_auto_auto] gap-2">
                                <button 
                                    onClick={() => handleConfirmGroup(group)}
                                    className="bg-eco-600 hover:bg-eco-700 text-white py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 transition-colors shadow-sm"
                                >
                                    <i className="fas fa-check-double"></i> Xác nhận tiền về
                                </button>
                                <button 
                                    onClick={() => handleShareGroupQR(group)}
                                    className="w-10 bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 rounded-lg flex items-center justify-center transition-colors"
                                    title="Gửi QR Tổng"
                                >
                                    <i className="fas fa-qrcode"></i>
                                </button>
                                <button 
                                    onClick={() => {
                                        const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0, 2).join(' ');
                                        const desc = `TT ${safeName} ${group.orders.length} DON`;
                                        const ids = group.orders.map(o => o.id);
                                        handleSMS(group.customerPhone, group.customerName, group.totalAmount, desc, ids);
                                    }}
                                    className="w-10 bg-white border border-orange-200 text-orange-600 hover:bg-orange-50 rounded-lg flex items-center justify-center transition-colors"
                                    title="Nhắc nhở SMS"
                                >
                                    <i className="fas fa-comment-dots"></i>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
          </>
      )}

      <ConfirmModal 
        isOpen={showConfirm}
        title="Xác nhận thanh toán"
        message={confirmMessage}
        onConfirm={executeConfirm}
        onCancel={() => setShowConfirm(false)}
        confirmLabel="Đúng, Tiền đã về"
        isDanger={false}
      />
    </div>
  );
};

export default PaymentAudit;
