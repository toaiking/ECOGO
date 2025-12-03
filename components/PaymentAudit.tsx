
import React, { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod } from '../types';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';
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
  
  // View Mode
  const [viewMode, setViewMode] = useState<'SINGLE' | 'CUSTOMER'>('SINGLE');
  
  // Expanded Groups State
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Confirm Modal State
  const [confirmData, setConfirmData] = useState<{isOpen: boolean, ids: string[], message: string}>({
      isOpen: false, ids: [], message: ''
  });

  // Sharing State
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    const unsub = storageService.subscribeOrders((allOrders) => {
      // 1. DATA CLEANING: Strict Deduplication & Filtering
      const validOrders = new Map<string, Order>();
      
      // REGEX: ID phải là 8 ký tự, chỉ chứa Chữ Hoa và Số (Ví dụ: A1B2C3D4)
      const validIdRegex = /^[A-Z0-9]{8}$/;

      if (allOrders && Array.isArray(allOrders)) {
          allOrders.forEach(o => {
              if (!o || !o.id) return;
              
              // STRICT ID CHECK
              if (!validIdRegex.test(o.id)) return;

              // INTEGRITY CHECK: Đơn phải có tên khách và ít nhất 1 sản phẩm
              if (!o.customerName || !o.items || o.items.length === 0) return;

              // Filter out Cancelled
              if (o.status === OrderStatus.CANCELLED) return;

              // Filter for Payment Audit: Transfer & Not Verified
              if (o.paymentMethod !== PaymentMethod.TRANSFER) return;
              if (o.paymentVerified) return;

              // Deduplicate by ID (Last write wins strategy usually implies latest data)
              validOrders.set(o.id, o); 
          });
      }
      
      // Convert to array and Sort by newest first
      const sorted = Array.from(validOrders.values())
        .sort((a, b) => b.createdAt - a.createdAt);
      
      setOrders(sorted);
    });

    storageService.getBankConfig().then(setBankConfig);

    return () => { if (unsub) unsub(); };
  }, []);

  const batches = useMemo(() => {
    const batchSet = new Set<string>();
    orders.forEach(o => { if (o.batchId) batchSet.add(o.batchId); });
    return Array.from(batchSet).sort();
  }, [orders]);

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

  // --- LOGIC GỘP NHÓM KHÁCH HÀNG (ĐÃ SỬA LỖI GÁN NHẦM ID) ---
  const customerGroups = useMemo(() => {
      const groups: Record<string, CustomerDebtGroup> = {};
      const processedIds = new Set<string>(); // Prevent duplicate orders

      filteredOrders.forEach(o => {
          if (processedIds.has(o.id)) return;
          processedIds.add(o.id);

          // 1. Determine Key STRICTLY
          let key = '';

          // Combine ID + Normalized Name to ensure different people with same ID (legacy error) get split
          // If customerId exists, we use it, but append name hash to force split if names diverge
          if (o.customerId) {
               key = `${o.customerId}_${normalizeString(o.customerName)}`;
          } else if (o.customerPhone && o.customerPhone.length > 6) {
               key = normalizePhone(o.customerPhone);
          } else {
               const nName = normalizeString(o.customerName);
               const nAddr = normalizeString(o.address || 'unknown');
               key = `${nName}|${nAddr}`; 
          }

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
          } else {
              // Update with better data if available
              if (!groups[key].customerId && o.customerId) {
                  groups[key].customerId = o.customerId;
              }
              if ((!groups[key].customerPhone || groups[key].customerPhone.length < 8) && o.customerPhone) {
                   groups[key].customerPhone = o.customerPhone;
              }
          }

          groups[key].orders.push(o);
          groups[key].totalAmount += (o.totalPrice || 0);
          groups[key].maxReminders = Math.max(groups[key].maxReminders || 0, o.reminderCount || 0);
      });
      
      return Object.values(groups).sort((a, b) => b.totalAmount - a.totalAmount);
  }, [filteredOrders]);

  const handleConfirmSingle = (id: string, name: string) => {
    setConfirmData({
        isOpen: true,
        ids: [id],
        message: `Xác nhận tiền về cho đơn #${id} (${name})?`
    });
  };

  const handleConfirmGroup = (group: CustomerDebtGroup) => {
      const ids = group.orders.map(o => o.id);
      setConfirmData({
          isOpen: true,
          ids: ids,
          message: `Xác nhận tiền về đủ ${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ cho ${ids.length} đơn của ${group.customerName}?`
      });
  };

  const executeConfirm = async () => {
    if (confirmData.ids.length > 0) {
      const firstOrder = orders.find(o => o.id === confirmData.ids[0]);
      const promises = confirmData.ids.map(id => 
          storageService.updatePaymentVerification(id, true, firstOrder ? { name: firstOrder.customerName } : undefined)
      );
      await Promise.all(promises);
      toast.success(`Đã xác nhận tiền về!`);
      setConfirmData({ isOpen: false, ids: [], message: '' });
    }
  };

  const incrementReminder = async (ids: string[]) => {
      await storageService.incrementReminderCount(ids);
  };

  const generateAndShareQR = async (amount: number, content: string, title: string, relatedIds: string[]) => {
    if (!bankConfig || !bankConfig.accountNo) {
        toast.error("Thiếu thông tin Ngân hàng");
        return;
    }
    setIsSharing(true);
    const toastId = toast.loading("Đang tạo QR...");
    try {
        const url = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template || 'compact2'}.png?amount=${amount}&addInfo=${encodeURIComponent(content)}&accountName=${encodeURIComponent(bankConfig.accountName)}`;
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], `QR-${Date.now()}.png`, { type: "image/png" });
        
        await incrementReminder(relatedIds);

        if (navigator.share) {
            await navigator.share({ title: title, text: `Thanh toán ${content}`, files: [file] });
            toast.dismiss(toastId);
            toast.success("Đã mở chia sẻ!");
        } else {
            await navigator.clipboard.writeText(url);
            toast.dismiss(toastId);
            toast.success("Đã copy link QR");
        }
    } catch (e) {
        console.error(e);
        toast.dismiss(toastId);
        toast.error("Lỗi chia sẻ (Trình duyệt không hỗ trợ)");
    } finally {
        setIsSharing(false);
    }
  };

  const handleShareSingleQR = (order: Order) => {
      const desc = `DH ${order.id}`;
      generateAndShareQR(order.totalPrice, desc, `Thanh toán đơn ${order.id}`, [order.id]);
  };

  const handleShareGroupQR = (group: CustomerDebtGroup) => {
      const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0,2).join(' ');
      const desc = `TT ${safeName} ${group.orders.length} DON`;
      const ids = group.orders.map(o => o.id);
      generateAndShareQR(group.totalAmount, desc, `Thanh toán tổng ${group.orders.length} đơn`, ids);
  };

  const handleSMS = async (phone: string, name: string, amount: number, content: string, relatedIds: string[]) => {
     if (!bankConfig || !bankConfig.accountNo) { toast.error("Chưa có thông tin ngân hàng"); return; }
     await incrementReminder(relatedIds);
     const price = new Intl.NumberFormat('vi-VN').format(amount);
     const msg = `Chào ${name}, tiền hàng là ${price}đ. CK tới ${bankConfig.accountNo} (${bankConfig.bankId}) - ${bankConfig.accountName}. ND: ${content}. Tks!`;
     const ua = navigator.userAgent.toLowerCase();
     const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1;
     const separator = isIOS ? '&' : '?';
     window.open(`sms:${phone}${separator}body=${encodeURIComponent(msg)}`, '_self');
  };

  const ReminderBadge = ({ count }: { count?: number }) => {
      if (!count || count === 0) return null;
      return (
          <div className="flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-orange-50 text-orange-600 border border-orange-200 shadow-sm" title={`Đã nhắc ${count} lần`}>
              <i className="fas fa-bell text-[8px]"></i> {count}
          </div>
      );
  }

  const toggleGroup = (key: string) => {
      const newSet = new Set(expandedGroups);
      if (newSet.has(key)) newSet.delete(key);
      else newSet.add(key);
      setExpandedGroups(newSet);
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in px-2 sm:px-4">
      {/* 1. HEADER & SUMMARY */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-eco-100 mb-4 flex flex-col md:flex-row justify-between items-center gap-3 sticky top-16 z-30">
        <div className="flex items-center gap-4">
             <div className="w-11 h-11 rounded-full bg-eco-50 text-eco-600 flex items-center justify-center text-xl shadow-inner ring-4 ring-eco-50/50">
                 <i className="fas fa-hand-holding-usd"></i>
             </div>
             <div>
                 <h2 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">TỔNG TIỀN CHỜ VỀ</h2>
                 <div className="text-2xl font-black text-eco-700 leading-none">
                     {new Intl.NumberFormat('vi-VN').format(totalAmount)}<span className="text-sm text-gray-400 ml-1 font-medium">đ</span>
                 </div>
             </div>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto">
            {/* Batch Filter Dropdown */}
            <div className="relative">
                <select 
                    value={selectedBatch} 
                    onChange={e => setSelectedBatch(e.target.value)}
                    className="appearance-none bg-gray-100 border border-gray-200 text-gray-700 py-2 pl-3 pr-8 rounded-xl text-xs font-bold outline-none focus:border-eco-500 transition-colors cursor-pointer min-w-[120px]"
                >
                    <option value="ALL">📦 Tất cả Lô</option>
                    {batches.map(b => (
                        <option key={b} value={b}>{b}</option>
                    ))}
                </select>
                <i className="fas fa-chevron-down absolute right-3 top-2.5 text-gray-400 text-xs pointer-events-none"></i>
            </div>

             {/* View Toggle */}
            <div className="flex bg-gray-100 p-1 rounded-xl flex-shrink-0">
                <button onClick={() => setViewMode('SINGLE')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'SINGLE' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Đơn Lẻ</button>
                <button onClick={() => setViewMode('CUSTOMER')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${viewMode === 'CUSTOMER' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Gộp Khách</button>
            </div>
            
            {/* Search Filter */}
            <div className="relative flex-grow md:flex-grow-0 md:w-64">
                 <i className="fas fa-search absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                 <input 
                     value={searchTerm} 
                     onChange={e => setSearchTerm(e.target.value)} 
                     placeholder="Tìm tên, SĐT, mã đơn..." 
                     className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none shadow-sm focus:border-eco-400 transition-colors" 
                 />
            </div>
        </div>
      </div>

      {/* 3. LIST CONTENT */}
      {filteredOrders.length === 0 ? (
           <div className="text-center py-12 flex flex-col items-center justify-center text-gray-300">
               <i className="fas fa-check-circle text-5xl mb-3 opacity-20"></i>
               <p className="text-sm font-medium">Tuyệt vời! Không có đơn nợ nào.</p>
           </div>
      ) : (
          <>
            {/* --- SINGLE ORDER VIEW --- */}
            {viewMode === 'SINGLE' && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                    {filteredOrders.map(order => (
                        <div key={order.id} className="bg-white rounded-2xl p-4 border border-gray-200 shadow-sm hover:border-eco-300 hover:shadow-md transition-all flex flex-col relative group">
                            <div className="flex justify-between items-start mb-3">
                                <div className="flex flex-col">
                                    <div className="font-bold text-gray-800 text-sm leading-tight flex items-center gap-2">
                                        {order.customerName}
                                        <ReminderBadge count={order.reminderCount} />
                                    </div>
                                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">{order.customerPhone}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-lg font-black text-eco-700">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}</div>
                                </div>
                            </div>
                            
                            <div className="bg-gray-50 p-2.5 rounded-xl border border-gray-100 mb-4 flex-grow">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="font-mono font-bold text-blue-600 text-xs bg-blue-50 px-1.5 py-0.5 rounded">#{order.id}</span>
                                    {order.batchId && <span className="text-[9px] text-gray-400 bg-white px-1.5 rounded border border-gray-100">{order.batchId}</span>}
                                </div>
                                <div className="text-xs text-gray-700 font-medium leading-relaxed">
                                    {order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-[1fr_auto_auto] gap-2 mt-auto">
                                <button onClick={() => handleConfirmSingle(order.id, order.customerName)} className="bg-eco-600 hover:bg-eco-700 text-white py-2.5 rounded-xl font-bold text-xs shadow-md shadow-green-100 transition-transform active:scale-95 flex items-center justify-center gap-2">
                                    <i className="fas fa-check-circle"></i> Xác nhận tiền về
                                </button>
                                <button onClick={() => handleShareSingleQR(order)} disabled={isSharing} className="w-10 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 border border-blue-100 transition-colors flex items-center justify-center">
                                    <i className="fas fa-qrcode"></i>
                                </button>
                                <button onClick={() => handleSMS(order.customerPhone, order.customerName, order.totalPrice, `DH ${order.id}`, [order.id])} className="w-10 bg-orange-50 text-orange-600 rounded-xl hover:bg-orange-100 border border-orange-100 transition-colors flex items-center justify-center">
                                    <i className="fas fa-comment-dots"></i>
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* --- CUSTOMER GROUP VIEW --- */}
            {viewMode === 'CUSTOMER' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customerGroups.map(group => {
                        const isExpanded = expandedGroups.has(group.key);
                        return (
                        <div key={group.key} className={`bg-white rounded-2xl border transition-all ${isExpanded ? 'shadow-md border-eco-200' : 'shadow-sm border-gray-200 hover:border-eco-300'}`}>
                            {/* Group Header */}
                            <div className="p-4 cursor-pointer" onClick={() => toggleGroup(group.key)}>
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <div className="font-bold text-gray-800 text-base">{group.customerName}</div>
                                            <ReminderBadge count={group.maxReminders} />
                                            {group.orders.length > 1 && <span className="bg-red-100 text-red-600 text-[10px] font-bold px-2 py-0.5 rounded-full">{group.orders.length} đơn</span>}
                                        </div>
                                        <div className="text-xs text-gray-400 font-mono flex items-center gap-1 mt-0.5">
                                            <i className="fas fa-phone-alt text-[9px]"></i> {group.customerPhone || 'N/A'}
                                            {/* Debug Info: Show grouping reason subtly */}
                                            {/* <span className="text-[8px] opacity-30 ml-2">{group.key}</span> */}
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-xl font-black text-eco-700">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ</div>
                                    </div>
                                </div>
                            </div>
                            
                            {/* Expanded Details - TABLE LAYOUT */}
                            {isExpanded && (
                                <div className="border-t border-gray-100 bg-gray-50/50">
                                    <div className="grid grid-cols-[60px_1fr_80px] gap-2 px-4 py-2 bg-gray-100 text-[9px] font-bold text-gray-500 uppercase tracking-wider">
                                        <div>Mã đơn</div>
                                        <div>Chi tiết hàng hóa</div>
                                        <div className="text-right">Thành tiền</div>
                                    </div>
                                    <div className="divide-y divide-gray-100">
                                        {group.orders.map(o => (
                                            <div key={o.id} className="grid grid-cols-[60px_1fr_80px] gap-2 px-4 py-3 text-xs hover:bg-white transition-colors items-start">
                                                <div className="flex flex-col items-start gap-1">
                                                    <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1 py-0.5 rounded w-fit h-fit leading-none">#{o.id}</span>
                                                    {o.batchId && <span className="text-[8px] text-gray-400 bg-white border border-gray-100 px-1 rounded">{o.batchId}</span>}
                                                </div>
                                                <div className="text-gray-700 leading-snug">
                                                    {o.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                                                    {o.notes && <div className="text-[10px] text-gray-400 italic mt-0.5">Note: {o.notes}</div>}
                                                </div>
                                                <div className="text-right font-bold text-gray-800">
                                                    {new Intl.NumberFormat('vi-VN').format(o.totalPrice)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="p-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
                                        <div className="text-xs font-bold text-gray-500 uppercase self-center mr-2">Tổng thanh toán:</div>
                                        <div className="text-base font-black text-eco-700">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ</div>
                                    </div>
                                </div>
                            )}

                            {/* Actions Footer */}
                            <div className="p-3 border-t border-gray-100 flex gap-2">
                                <button onClick={(e) => { e.stopPropagation(); handleConfirmGroup(group); }} className="flex-grow bg-eco-600 hover:bg-eco-700 text-white py-2.5 rounded-xl font-bold text-xs shadow-md shadow-green-100 transition-transform active:scale-95 flex items-center justify-center gap-2">
                                    <i className="fas fa-check-double"></i> Xác nhận {group.orders.length} đơn
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); handleShareGroupQR(group); }} className="w-10 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 border border-blue-100 flex items-center justify-center">
                                    <i className="fas fa-qrcode"></i>
                                </button>
                                <button onClick={(e) => {
                                    e.stopPropagation();
                                    const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0, 2).join(' ');
                                    const desc = `TT ${safeName} ${group.orders.length} DON`;
                                    const ids = group.orders.map(o => o.id);
                                    handleSMS(group.customerPhone, group.customerName, group.totalAmount, desc, ids);
                                }} className="w-10 bg-orange-50 text-orange-600 rounded-xl hover:bg-orange-100 border border-orange-100 flex items-center justify-center">
                                    <i className="fas fa-comment-dots"></i>
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); toggleGroup(group.key); }}
                                    className="w-10 bg-gray-50 text-gray-500 rounded-xl hover:bg-gray-100 border border-gray-200 flex items-center justify-center"
                                >
                                    <i className={`fas fa-chevron-${isExpanded ? 'up' : 'down'}`}></i>
                                </button>
                            </div>
                        </div>
                        );
                    })}
                </div>
            )}
          </>
      )}

      {/* CONFIRM MODAL */}
      <ConfirmModal 
        isOpen={confirmData.isOpen}
        title="Xác nhận thanh toán"
        message={confirmData.message}
        onConfirm={executeConfirm}
        onCancel={() => setConfirmData({ ...confirmData, isOpen: false })}
        confirmLabel="Tiền đã về"
        isDanger={false}
      />
    </div>
  );
};

export default PaymentAudit;
