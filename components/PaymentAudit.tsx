
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
                  totalAmount: 0
              };
          }
          
          groups[key].orders.push(o);
          groups[key].totalAmount += o.totalPrice;
      });

      return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredOrders]);

  // --- HANDLERS ---

  const handleConfirmSingle = (id: string, name: string) => {
    setTargetIds([id]);
    setConfirmMessage(`Xác nhận đã nhận tiền cho đơn #${id} (${name})?`);
    setShowConfirm(true);
  };

  const handleConfirmGroup = (group: CustomerDebtGroup) => {
      const ids = group.orders.map(o => o.id);
      setTargetIds(ids);
      setConfirmMessage(`Xác nhận đã nhận ĐỦ ${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ cho ${ids.length} đơn của ${group.customerName}?`);
      setShowConfirm(true);
  };

  const executeConfirm = async () => {
    if (targetIds.length > 0) {
      const firstOrder = orders.find(o => o.id === targetIds[0]);
      
      const promises = targetIds.map(id => 
          storageService.updatePaymentVerification(id, true, firstOrder ? { name: firstOrder.customerName } : undefined)
      );
      
      await Promise.all(promises);
      
      toast.success(`Đã xác nhận ${targetIds.length} đơn!`);
      setShowConfirm(false);
      setTargetIds([]);
    }
  };

  const generateAndShareQR = async (amount: number, content: string, title: string) => {
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

        if (navigator.share) {
            await navigator.share({
                title: title,
                text: `Thanh toán: ${content} - Số tiền: ${new Intl.NumberFormat('vi-VN').format(amount)}đ`,
                files: [file]
            });
            toast.dismiss(toastId);
            toast.success("Đã mở chia sẻ!");
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
      generateAndShareQR(order.totalPrice, desc, `Thanh toán đơn ${order.id}`);
  };

  const handleShareGroupQR = (group: CustomerDebtGroup) => {
      const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase();
      const words = safeName.split(' ');
      const shortName = words.length > 2 ? `${words[0]} ${words[words.length-1]}` : safeName;
      
      const desc = `TT ${shortName} ${group.orders.length} DON`;
      generateAndShareQR(group.totalAmount, desc, `Thanh toán tổng ${group.orders.length} đơn`);
  };

  const handleSMS = (phone: string, name: string, amount: number, content: string) => {
     if (!bankConfig || !bankConfig.accountNo) {
      toast.error("Chưa có thông tin ngân hàng");
      return;
    }

    const price = new Intl.NumberFormat('vi-VN').format(amount);
    const msg = `Chào ${name}, tổng tiền cần thanh toán là ${price}đ. Vui lòng CK tới STK ${bankConfig.accountNo} (${bankConfig.bankId}) - ${bankConfig.accountName}. Nội dung: ${content}. Cảm ơn!`;
    
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1;
    const separator = isIOS ? '&' : '?';
    
    window.open(`sms:${phone}${separator}body=${encodeURIComponent(msg)}`, '_self');
  };

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
      {/* HEADER STATS */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-6 text-white shadow-lg mb-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
            <h1 className="text-2xl font-black mb-1 flex items-center gap-2"><i className="fas fa-file-invoice-dollar"></i> Đối soát Chuyển khoản</h1>
            <p className="text-blue-100 text-sm">Quản lý công nợ và xác nhận thanh toán</p>
            </div>
            <div className="text-right bg-white/10 p-4 rounded-xl border border-white/20 min-w-[200px]">
            <div className="text-xs text-blue-200 uppercase font-bold">Tổng chờ thu</div>
            <div className="text-3xl font-black">{new Intl.NumberFormat('vi-VN').format(totalAmount)}<span className="text-sm font-normal text-blue-200 ml-1">đ</span></div>
            <div className="text-xs font-bold bg-white/20 inline-block px-2 py-0.5 rounded mt-1">{filteredOrders.length} đơn hàng</div>
            </div>
        </div>
        
        {/* TABS & FILTERS */}
        <div className="mt-6 flex flex-col md:flex-row gap-3">
             <div className="flex bg-blue-900/30 p-1 rounded-xl w-full md:w-auto inline-flex">
                <button 
                    onClick={() => setViewMode('SINGLE')}
                    className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'SINGLE' ? 'bg-white text-blue-700 shadow-md' : 'text-blue-200 hover:bg-white/10'}`}
                >
                    Theo Đơn Lẻ
                </button>
                <button 
                    onClick={() => setViewMode('CUSTOMER')}
                    className={`flex-1 md:flex-none px-6 py-2 rounded-lg text-sm font-bold transition-all ${viewMode === 'CUSTOMER' ? 'bg-white text-blue-700 shadow-md' : 'text-blue-200 hover:bg-white/10'}`}
                >
                    Gộp Theo Khách ({customerGroups.length})
                </button>
            </div>

            {/* SEARCH & BATCH FILTER */}
            <div className="flex-grow flex gap-2">
                 <div className="relative flex-grow">
                     <i className="fas fa-search absolute left-3 top-3 text-blue-200 text-xs"></i>
                     <input 
                         value={searchTerm}
                         onChange={e => setSearchTerm(e.target.value)}
                         placeholder="Tìm tên, SĐT, Mã đơn..."
                         className="w-full pl-9 pr-3 py-2.5 bg-blue-900/30 border border-blue-500/30 rounded-xl text-sm text-white placeholder-blue-300 focus:bg-blue-900/50 outline-none transition-all"
                     />
                 </div>
                 {batches.length > 0 && (
                     <div className="relative min-w-[120px]">
                         <select 
                             value={selectedBatch}
                             onChange={e => setSelectedBatch(e.target.value)}
                             className="w-full appearance-none pl-3 pr-8 py-2.5 bg-blue-900/30 border border-blue-500/30 rounded-xl text-sm text-white font-bold focus:bg-blue-900/50 outline-none"
                         >
                             <option value="ALL">Lô: Tất cả</option>
                             {batches.map(b => <option key={b} value={b}>{b}</option>)}
                         </select>
                         <i className="fas fa-chevron-down absolute right-3 top-3.5 text-blue-200 text-xs pointer-events-none"></i>
                     </div>
                 )}
            </div>
        </div>
      </div>

      {/* VIEW CONTENT */}
      {filteredOrders.length === 0 ? (
           <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-10 flex flex-col items-center justify-center text-center">
             <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-4">
                <i className="fas fa-check text-3xl text-green-500"></i>
             </div>
             <p className="font-bold text-gray-600">Tuyệt vời! Không có công nợ tồn đọng.</p>
             <p className="text-sm text-gray-400">Tất cả đơn chuyển khoản đã được xác nhận (Hoặc không khớp bộ lọc).</p>
           </div>
      ) : (
          <>
            {/* --- SINGLE MODE --- */}
            {viewMode === 'SINGLE' && (
                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-gray-50 text-gray-500 text-[10px] font-bold uppercase tracking-wider border-b border-gray-100">
                            <th className="p-4">Đơn hàng / Hàng hóa</th>
                            <th className="p-4">Khách hàng</th>
                            <th className="p-4 text-right">Số tiền</th>
                            <th className="p-4 text-center">Thao tác</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredOrders.map(order => (
                            <tr key={order.id} className="hover:bg-blue-50/30 transition-colors group">
                                <td className="p-4 align-top">
                                    <div className="flex items-center gap-2 mb-1">
                                        <div className="font-bold text-gray-800 text-sm">#{order.id}</div>
                                        {order.batchId && <div className="text-[9px] bg-gray-100 text-gray-500 px-1.5 rounded border border-gray-200">{order.batchId}</div>}
                                    </div>
                                    <div className="text-xs text-gray-400 mb-1">{new Date(order.createdAt).toLocaleDateString('vi-VN')}</div>
                                    {/* Item Details */}
                                    <div className="text-xs text-gray-600 font-medium bg-gray-50 p-1.5 rounded border border-gray-100 mt-1">
                                        {order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                                    </div>
                                </td>
                                <td className="p-4 align-top">
                                    <div className="font-bold text-gray-800 text-sm">{order.customerName}</div>
                                    <div className="text-xs text-gray-500 font-mono">{order.customerPhone}</div>
                                </td>
                                <td className="p-4 text-right align-top">
                                    <div className="font-black text-blue-600 text-base">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ</div>
                                    <div className="text-[10px] text-gray-400">Chuyển khoản</div>
                                </td>
                                <td className="p-4 align-top">
                                <div className="flex items-center justify-center gap-2">
                                    <button 
                                        onClick={() => handleConfirmSingle(order.id, order.customerName)}
                                        className="bg-green-100 hover:bg-green-200 text-green-700 p-2 rounded-lg transition-colors flex flex-col items-center min-w-[70px] border border-green-200"
                                        title="Xác nhận tiền đã về tài khoản"
                                    >
                                        <i className="fas fa-check-circle text-lg mb-1"></i>
                                        <span className="text-[9px] font-bold uppercase">Xác nhận<br/>Tiền về</span>
                                    </button>

                                    <button 
                                        onClick={() => handleShareSingleQR(order)}
                                        disabled={isSharing}
                                        className="bg-blue-100 hover:bg-blue-200 text-blue-700 p-2 rounded-lg transition-colors flex flex-col items-center min-w-[60px]"
                                        title="QR Code"
                                    >
                                        {isSharing ? <i className="fas fa-spinner fa-spin text-lg mb-1"></i> : <i className="fas fa-qrcode text-lg mb-1"></i>}
                                        <span className="text-[9px] font-bold uppercase mt-2">Gửi QR</span>
                                    </button>

                                    <button 
                                        onClick={() => handleSMS(order.customerPhone, order.customerName, order.totalPrice, `DH ${order.id}`)}
                                        className="bg-yellow-100 hover:bg-yellow-200 text-yellow-700 p-2 rounded-lg transition-colors flex flex-col items-center min-w-[60px]"
                                        title="SMS"
                                    >
                                        <i className="fas fa-comment-dots text-lg mb-1"></i>
                                        <span className="text-[9px] font-bold uppercase mt-2">SMS</span>
                                    </button>
                                </div>
                                </td>
                            </tr>
                            ))}
                        </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* --- CUSTOMER GROUP MODE --- */}
            {viewMode === 'CUSTOMER' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customerGroups.map(group => (
                        <div key={group.key} className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden flex flex-col">
                            {/* Card Header */}
                            <div className="p-4 bg-gray-50 border-b border-gray-100 flex justify-between items-start">
                                <div>
                                    <h3 className="font-bold text-gray-800 text-lg">{group.customerName}</h3>
                                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                                        <i className="fas fa-phone"></i> 
                                        <span className="font-mono">{group.customerPhone || 'Không có SĐT'}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-xl font-black text-blue-600">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ</div>
                                    <div className="text-xs font-bold text-blue-400 bg-blue-50 px-2 py-0.5 rounded inline-block">Nợ: {group.orders.length} đơn</div>
                                </div>
                            </div>

                            {/* Order List (Collapsed view) */}
                            <div className="p-4 bg-white flex-grow">
                                <div className="space-y-3 mb-4">
                                    {group.orders.map(o => (
                                        <div key={o.id} className="border-b border-dashed border-gray-100 last:border-0 pb-2 last:pb-0">
                                            <div className="flex justify-between items-center text-sm mb-1">
                                                <div>
                                                    <span className="font-bold text-gray-700 mr-2">#{o.id}</span>
                                                    <span className="text-gray-500 text-xs">{new Date(o.createdAt).toLocaleDateString('vi-VN', {day:'2-digit', month:'2-digit'})}</span>
                                                </div>
                                                <div className="font-medium text-gray-800">
                                                    {new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ
                                                </div>
                                            </div>
                                            <div className="text-xs text-gray-500 italic">
                                                {o.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Actions Footer */}
                            <div className="p-3 bg-gray-50 border-t border-gray-100 grid grid-cols-3 gap-2">
                                <button 
                                    onClick={() => handleConfirmGroup(group)}
                                    className="bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1 shadow-sm active:scale-95 transition-all"
                                >
                                    <i className="fas fa-check-double"></i> Xác nhận Tiền về
                                </button>
                                <button 
                                    onClick={() => handleShareGroupQR(group)}
                                    disabled={isSharing}
                                    className="bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1 shadow-sm active:scale-95 transition-all"
                                >
                                    <i className="fas fa-qrcode"></i> QR Tổng
                                </button>
                                <button 
                                    onClick={() => {
                                        const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0, 2).join(' ');
                                        const desc = `TT ${safeName} ${group.orders.length} DON`;
                                        handleSMS(group.customerPhone, group.customerName, group.totalAmount, desc);
                                    }}
                                    className="bg-yellow-500 hover:bg-yellow-600 text-white py-2 rounded-lg font-bold text-xs flex items-center justify-center gap-1 shadow-sm active:scale-95 transition-all"
                                >
                                    <i className="fas fa-comment-dots"></i> Nhắc Nợ
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
        confirmLabel="Đúng, Đã nhận tiền"
        isDanger={false}
      />
    </div>
  );
};

export default PaymentAudit;
