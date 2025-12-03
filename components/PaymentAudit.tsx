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
    const unsub = storageService.subscribeOrders((allOrders) => {
      // Filter: Transfer method + Not Verified + Not Cancelled
      const pending = allOrders.filter(o => 
        o.paymentMethod === PaymentMethod.TRANSFER && 
        !o.paymentVerified && 
        o.status !== OrderStatus.CANCELLED
      );
      setOrders(pending.sort((a, b) => b.createdAt - a.createdAt));
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

  const customerGroups = useMemo(() => {
      const groups: Record<string, CustomerDebtGroup> = {};
      filteredOrders.forEach(o => {
          const key = o.customerId || (o.customerPhone && o.customerPhone.length > 5 ? o.customerPhone : o.customerName);
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

  const handleConfirmSingle = (id: string, name: string) => {
    setTargetIds([id]);
    setConfirmMessage(`Xác nhận tiền về cho đơn #${id} (${name})?`);
    setShowConfirm(true);
  };

  const handleConfirmGroup = (group: CustomerDebtGroup) => {
      const ids = group.orders.map(o => o.id);
      setTargetIds(ids);
      setConfirmMessage(`Xác nhận tiền về đủ ${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ cho ${ids.length} đơn của ${group.customerName}?`);
      setShowConfirm(true);
  };

  const executeConfirm = async () => {
    if (targetIds.length > 0) {
      const firstOrder = orders.find(o => o.id === targetIds[0]);
      const promises = targetIds.map(id => 
          storageService.updatePaymentVerification(id, true, firstOrder ? { name: firstOrder.customerName } : undefined)
      );
      await Promise.all(promises);
      toast.success(`Đã xác nhận tiền về!`);
      setShowConfirm(false);
      setTargetIds([]);
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
        toast.error("Lỗi chia sẻ");
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
          <div className="flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full border bg-orange-50 text-orange-600 border-orange-200" title={`Đã nhắc ${count} lần`}>
              <i className="fas fa-bell text-[8px]"></i> {count}
          </div>
      );
  }

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in px-2 sm:px-4">
      {/* 1. HEADER */}
      <div className="bg-white rounded-2xl p-4 shadow-sm border border-eco-100 mb-4 flex flex-col md:flex-row justify-between items-center gap-3 sticky top-16 z-30">
        <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-eco-50 text-eco-600 flex items-center justify-center text-lg shadow-inner">
                 <i className="fas fa-wallet"></i>
             </div>
             <div>
                 <h2 className="text-[10px] font-bold text-eco-600 uppercase tracking-wide">TỔNG TIỀN CHỜ VỀ</h2>
                 <div className="text-2xl font-black text-eco-700 leading-none">
                     {new Intl.NumberFormat('vi-VN').format(totalAmount)}<span className="text-sm text-gray-400 ml-1">đ</span>
                 </div>
             </div>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-xl">
            <button onClick={() => setViewMode('SINGLE')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${viewMode === 'SINGLE' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500'}`}>Đơn Lẻ</button>
            <button onClick={() => setViewMode('CUSTOMER')} className={`px-3 py-1.5 rounded-lg text-xs font-bold ${viewMode === 'CUSTOMER' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500'}`}>Gộp Khách</button>
        </div>
      </div>

      {/* 2. FILTERS */}
      <div className="flex gap-2 mb-4">
             <div className="relative flex-grow">
                 <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Tìm tên, SĐT..." className="w-full pl-3 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none shadow-sm h-9" />
             </div>
             {batches.length > 0 && (
                 <select value={selectedBatch} onChange={e => setSelectedBatch(e.target.value)} className="w-auto pl-2 pr-6 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold outline-none shadow-sm h-9">
                     <option value="ALL">Tất cả lô</option>
                     {batches.map(b => <option key={b} value={b}>{b}</option>)}
                 </select>
             )}
      </div>

      {/* 3. LIST */}
      {filteredOrders.length === 0 ? (
           <div className="text-center py-10 text-gray-400 text-sm">Không có đơn nợ nào.</div>
      ) : (
          <>
            {/* GRID LAYOUT */}
            {viewMode === 'SINGLE' && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                    {filteredOrders.map(order => (
                        <div key={order.id} className="bg-white rounded-xl p-3 border border-gray-200 shadow-sm hover:border-eco-400 transition-all flex flex-col relative group">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex flex-col">
                                    <div className="font-bold text-gray-800 text-sm leading-tight">{order.customerName}</div>
                                    <div className="text-[10px] text-gray-400 font-mono mt-0.5">{order.customerPhone}</div>
                                </div>
                                <div className="text-right">
                                    <div className="text-base font-black text-eco-700">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ</div>
                                    <ReminderBadge count={order.reminderCount} />
                                </div>
                            </div>
                            
                            <div className="bg-gray-50 p-2 rounded-lg text-[10px] text-gray-600 mb-3 truncate border border-gray-100">
                                {order.items.map(i => i.name).join(', ')}
                            </div>
                            
                            <div className="flex gap-2 mt-auto">
                                <button onClick={() => handleConfirmSingle(order.id, order.customerName)} className="flex-grow bg-eco-600 hover:bg-eco-700 text-white py-2 rounded-lg font-bold text-xs shadow-sm transition-transform active:scale-95">
                                    Xác nhận tiền về
                                </button>
                                <button onClick={() => handleShareSingleQR(order)} disabled={isSharing} className="w-9 h-9 flex items-center justify-center bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-100 transition-colors">
                                    <i className="fas fa-qrcode"></i>
                                </button>
                                <button onClick={() => handleSMS(order.customerPhone, order.customerName, order.totalPrice, `DH ${order.id}`, [order.id])} className="w-9 h-9 flex items-center justify-center bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 border border-orange-100 transition-colors">
                                    <i className="fas fa-comment-dots"></i>
                                </button>
                            </div>
                            
                            {/* Footer Meta */}
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <span className="text-[9px] font-mono text-gray-300">#{order.id.slice(-4)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* CUSTOMER GROUP LAYOUT */}
            {viewMode === 'CUSTOMER' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {customerGroups.map(group => (
                        <div key={group.key} className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 hover:border-eco-300 transition-all">
                            <div className="flex justify-between items-center mb-2 border-b border-gray-50 pb-2">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <div className="font-bold text-gray-800 text-sm">{group.customerName}</div>
                                        <ReminderBadge count={group.maxReminders} />
                                    </div>
                                    <div className="text-[10px] text-gray-400 font-mono">{group.customerPhone} • {group.orders.length} đơn</div>
                                </div>
                                <div className="text-lg font-black text-eco-700">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ</div>
                            </div>
                            
                            <div className="grid grid-cols-[1fr_auto_auto] gap-2 mt-3">
                                <button onClick={() => handleConfirmGroup(group)} className="bg-eco-600 hover:bg-eco-700 text-white py-2 rounded-lg font-bold text-xs shadow-sm transition-transform active:scale-95">
                                    Xác nhận tiền về
                                </button>
                                <button onClick={() => handleShareGroupQR(group)} className="w-9 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center hover:bg-blue-100">
                                    <i className="fas fa-qrcode"></i>
                                </button>
                                <button onClick={() => {
                                    const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0, 2).join(' ');
                                    const desc = `TT ${safeName} ${group.orders.length} DON`;
                                    const ids = group.orders.map(o => o.id);
                                    handleSMS(group.customerPhone, group.customerName, group.totalAmount, desc, ids);
                                }} className="w-9 bg-orange-50 text-orange-600 rounded-lg flex items-center justify-center hover:bg-orange-100">
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
        confirmLabel="Tiền đã về"
        isDanger={false}
      />
    </div>
  );
};

export default PaymentAudit;