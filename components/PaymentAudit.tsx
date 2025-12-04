
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

  // --- LOGIC GỘP NHÓM KHÁCH HÀNG ---
  const customerGroups = useMemo(() => {
      const groups: Record<string, CustomerDebtGroup> = {};
      const processedIds = new Set<string>(); // Prevent duplicate orders

      filteredOrders.forEach(o => {
          if (processedIds.has(o.id)) return;
          processedIds.add(o.id);

          // Determine Key STRICTLY
          let key = '';

          // Combine ID + Normalized Name to ensure different people with same ID get split
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
              if (!groups[key].customerId && o.customerId) groups[key].customerId = o.customerId;
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

      {/* 2. MAIN LIST */}
      {filteredOrders.length === 0 ? (
           <div className="text-center py-12 flex flex-col items-center justify-center text-gray-300">
               <i className="fas fa-check-circle text-5xl mb-3 opacity-20"></i>
               <p className="text-sm font-medium">Tuyệt vời! Không có đơn nợ nào.</p>
           </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {customerGroups.map(group => {
                const isMulti = group.orders.length > 1;
                return (
                <div key={group.key} className={`bg-white rounded-2xl border border-gray-200 shadow-sm flex flex-col overflow-hidden transition-all hover:shadow-md hover:border-eco-300`}>
                    
                    {/* Header */}
                    <div className="p-4 pb-2 bg-white">
                        <div className="flex justify-between items-start">
                            <div>
                                <div className="flex items-center gap-2">
                                    <div className="font-bold text-gray-900 text-base">{group.customerName}</div>
                                    <ReminderBadge count={group.maxReminders} />
                                    {isMulti && <span className="bg-red-50 text-red-600 text-[9px] font-bold px-1.5 py-0.5 rounded border border-red-100">{group.orders.length} đơn</span>}
                                </div>
                                <div className="flex items-center gap-3 mt-1">
                                    <span className="text-xs text-gray-500 font-mono tracking-tight">{group.customerPhone || 'Không có SĐT'}</span>
                                    {group.customerPhone && (
                                        <div className="flex gap-2">
                                            <a href={`tel:${group.customerPhone}`} className="text-gray-400 hover:text-green-600"><i className="fas fa-phone-alt text-xs"></i></a>
                                            <a href={`https://zalo.me/${group.customerPhone}`} target="_blank" className="text-gray-400 hover:text-blue-600 font-bold text-[9px] border border-gray-300 rounded px-1">Z</a>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="text-lg font-black text-eco-700">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}</div>
                                <div className="text-[9px] font-bold text-gray-400 uppercase">Tổng nợ</div>
                            </div>
                        </div>
                    </div>
                    
                    {/* List of Orders (Always Expanded for Detail Visibility) */}
                    <div className="flex-grow bg-gray-50/50 border-t border-gray-100 border-b">
                        {group.orders.map((o, idx) => (
                            <div key={o.id} className={`p-3 text-xs ${idx < group.orders.length - 1 ? 'border-b border-gray-100' : ''}`}>
                                <div className="flex justify-between items-start gap-2 mb-1">
                                    <div className="flex items-center gap-1.5">
                                        <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[10px]">#{o.id}</span>
                                        {o.batchId && <span className="text-[9px] text-gray-400 border border-gray-200 px-1 rounded bg-white">{o.batchId}</span>}
                                    </div>
                                    <span className="font-bold text-gray-800">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}</span>
                                </div>
                                
                                <div className="text-gray-600 leading-snug pl-1">
                                    {o.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                                </div>
                                {o.notes && <div className="text-[10px] text-gray-400 italic mt-0.5 pl-1"><i className="fas fa-comment-alt mr-1"></i>{o.notes}</div>}
                            </div>
                        ))}
                    </div>

                    {/* Actions */}
                    <div className="p-3 bg-white flex items-center gap-2">
                        <button onClick={() => handleConfirmGroup(group)} className="flex-grow bg-eco-600 hover:bg-eco-700 text-white py-2.5 rounded-xl font-bold text-xs shadow-md shadow-green-100 transition-transform active:scale-95 flex items-center justify-center gap-2">
                            <i className="fas fa-check-circle"></i> Xác nhận tiền về
                        </button>
                        
                        <button onClick={() => handleShareGroupQR(group)} disabled={isSharing} className="w-10 h-10 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-100 border border-blue-100 flex items-center justify-center transition-colors">
                            <i className="fas fa-qrcode"></i>
                        </button>
                        
                        <button onClick={() => {
                            const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0, 2).join(' ');
                            const desc = `TT ${safeName} ${group.orders.length} DON`;
                            const ids = group.orders.map(o => o.id);
                            handleSMS(group.customerPhone, group.customerName, group.totalAmount, desc, ids);
                        }} className="w-10 h-10 bg-orange-50 text-orange-600 rounded-xl hover:bg-orange-100 border border-orange-100 flex items-center justify-center transition-colors">
                            <i className="fas fa-comment-dots"></i>
                        </button>
                    </div>
                </div>
                );
            })}
        </div>
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
