
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
  
  // Selection State for Modal
  const [selectedGroup, setSelectedGroup] = useState<CustomerDebtGroup | null>(null);

  // Confirm Modal State
  const [confirmData, setConfirmData] = useState<{isOpen: boolean, ids: string[], message: string}>({
      isOpen: false, ids: [], message: ''
  });

  // Sharing State
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    const unsub = storageService.subscribeOrders((allOrders) => {
      // 1. DATA CLEANING
      const validOrders = new Map<string, Order>();
      const validIdRegex = /^[A-Z0-9]{8}$/;

      if (allOrders && Array.isArray(allOrders)) {
          allOrders.forEach(o => {
              if (!o || !o.id) return;
              if (!validIdRegex.test(o.id)) return;
              if (!o.customerName || !o.items || o.items.length === 0) return;
              if (o.status === OrderStatus.CANCELLED) return;
              if (o.paymentMethod !== PaymentMethod.TRANSFER) return;
              if (o.paymentVerified) return;

              validOrders.set(o.id, o); 
          });
      }
      
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
      const processedIds = new Set<string>(); 

      filteredOrders.forEach(o => {
          if (processedIds.has(o.id)) return;
          processedIds.add(o.id);

          let key = '';
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

  // --- ACTIONS ---

  const executeConfirm = async () => {
    if (confirmData.ids.length > 0) {
      const firstOrder = orders.find(o => o.id === confirmData.ids[0]);
      const promises = confirmData.ids.map(id => 
          storageService.updatePaymentVerification(id, true, firstOrder ? { name: firstOrder.customerName } : undefined)
      );
      await Promise.all(promises);
      toast.success(`Đã xác nhận tiền về!`);
      setConfirmData({ isOpen: false, ids: [], message: '' });
      setSelectedGroup(null); // Close modal on success
    }
  };

  const handleConfirmGroup = (group: CustomerDebtGroup) => {
      const ids = group.orders.map(o => o.id);
      setConfirmData({
          isOpen: true,
          ids: ids,
          message: `Xác nhận tiền về đủ ${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ cho ${ids.length} đơn của ${group.customerName}?`
      });
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

  const handleSMS = async (group: CustomerDebtGroup) => {
     const phone = group.customerPhone;
     if (!phone) { toast.error("Khách không có SĐT"); return; }
     if (!bankConfig || !bankConfig.accountNo) { toast.error("Chưa có thông tin ngân hàng"); return; }
     
     const ids = group.orders.map(o => o.id);
     await incrementReminder(ids);
     
     const safeName = group.customerName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').toUpperCase().split(' ').slice(0, 2).join(' ');
     const content = `TT ${safeName} ${group.orders.length} DON`;
     const price = new Intl.NumberFormat('vi-VN').format(group.totalAmount);
     
     const msg = `Chào ${group.customerName}, tiền hàng là ${price}đ. CK tới ${bankConfig.accountNo} (${bankConfig.bankId}) - ${bankConfig.accountName}. ND: ${content}. Tks!`;
     
     const ua = navigator.userAgent.toLowerCase();
     const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1;
     const separator = isIOS ? '&' : '?';
     window.open(`sms:${phone}${separator}body=${encodeURIComponent(msg)}`, '_self');
  };

  const ReminderBadge = ({ count }: { count?: number }) => {
      if (!count || count === 0) return null;
      return (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 border border-orange-200">
              <i className="fas fa-bell text-[8px]"></i> {count}
          </span>
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

      {/* 2. TABLE LIST */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          {filteredOrders.length === 0 ? (
               <div className="text-center py-20 flex flex-col items-center justify-center text-gray-300">
                   <i className="fas fa-check-circle text-5xl mb-3 opacity-20"></i>
                   <p className="text-sm font-medium">Tuyệt vời! Không có đơn nợ nào.</p>
               </div>
          ) : (
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-100 text-gray-500 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                            <th className="p-3 text-center w-12">#</th>
                            <th className="p-3">Khách Hàng</th>
                            <th className="p-3 hidden sm:table-cell">SĐT / Liên hệ</th>
                            <th className="p-3 text-center">Số đơn</th>
                            <th className="p-3 text-center hidden sm:table-cell">Đã nhắc</th>
                            <th className="p-3 text-right">Tổng nợ</th>
                            <th className="p-3 text-center w-20"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {customerGroups.map((group, idx) => (
                            <tr 
                                key={group.key} 
                                onClick={() => setSelectedGroup(group)}
                                className="hover:bg-blue-50 cursor-pointer transition-colors group"
                            >
                                <td className="p-3 text-center font-bold text-gray-400 text-xs">{idx + 1}</td>
                                <td className="p-3">
                                    <div className="font-bold text-gray-800 text-sm">{group.customerName}</div>
                                    <div className="sm:hidden text-[10px] text-gray-500 font-mono mt-0.5">{group.customerPhone}</div>
                                </td>
                                <td className="p-3 hidden sm:table-cell">
                                    <span className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{group.customerPhone || '---'}</span>
                                </td>
                                <td className="p-3 text-center">
                                    <span className="text-xs font-bold bg-gray-100 text-gray-700 px-2 py-1 rounded-full">{group.orders.length}</span>
                                </td>
                                <td className="p-3 text-center hidden sm:table-cell">
                                    <ReminderBadge count={group.maxReminders} />
                                </td>
                                <td className="p-3 text-right">
                                    <span className="font-black text-eco-600 text-sm">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}</span>
                                </td>
                                <td className="p-3 text-center">
                                    <button className="text-gray-300 group-hover:text-blue-600 transition-colors">
                                        <i className="fas fa-chevron-right"></i>
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
          )}
      </div>

      {/* 3. DETAIL POPUP (MODAL) */}
      {selectedGroup && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setSelectedGroup(null)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                  {/* Header */}
                  <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50">
                      <div>
                          <div className="flex items-center gap-2">
                              <h3 className="font-bold text-xl text-gray-800">{selectedGroup.customerName}</h3>
                              <ReminderBadge count={selectedGroup.maxReminders} />
                          </div>
                          <div className="text-sm text-gray-500 font-mono mt-1 flex items-center gap-2">
                              <i className="fas fa-phone-alt text-xs"></i> {selectedGroup.customerPhone || 'Không có SĐT'}
                          </div>
                      </div>
                      <div className="text-right">
                          <div className="text-[10px] font-bold text-gray-400 uppercase">Tổng nợ</div>
                          <div className="text-xl font-black text-eco-600">{new Intl.NumberFormat('vi-VN').format(selectedGroup.totalAmount)}đ</div>
                      </div>
                  </div>

                  {/* Order List */}
                  <div className="flex-grow overflow-y-auto p-4 space-y-3 bg-gray-50/30">
                      <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Chi tiết đơn hàng ({selectedGroup.orders.length})</div>
                      {selectedGroup.orders.map(o => (
                          <div key={o.id} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm">
                              <div className="flex justify-between items-start mb-1">
                                  <div className="flex items-center gap-2">
                                      <span className="font-mono font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded text-[10px]">#{o.id}</span>
                                      {o.batchId && <span className="text-[10px] text-gray-400 border border-gray-100 px-1.5 rounded">{o.batchId}</span>}
                                  </div>
                                  <span className="font-bold text-gray-800 text-sm">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}</span>
                              </div>
                              <div className="text-xs text-gray-700 leading-relaxed pl-1">
                                  {o.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                              </div>
                              {o.notes && <div className="text-[10px] text-orange-600 italic mt-1 bg-orange-50 px-2 py-1 rounded border border-orange-100 inline-block"><i className="fas fa-sticky-note mr-1"></i>{o.notes}</div>}
                          </div>
                      ))}
                  </div>

                  {/* Footer Actions */}
                  <div className="p-4 bg-white border-t border-gray-100 grid grid-cols-2 gap-3">
                      <button 
                          onClick={() => handleConfirmGroup(selectedGroup)} 
                          className="col-span-2 py-3 bg-eco-600 hover:bg-eco-700 text-white font-bold rounded-xl shadow-lg shadow-green-200 transition-transform active:scale-95 flex items-center justify-center gap-2"
                      >
                          <i className="fas fa-check-circle"></i> Xác nhận Đã nhận tiền
                      </button>
                      
                      <button 
                          onClick={() => handleShareGroupQR(selectedGroup)} 
                          disabled={isSharing}
                          className="py-3 bg-white border border-gray-200 hover:border-blue-300 hover:bg-blue-50 text-blue-700 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
                      >
                          <i className="fas fa-qrcode"></i> Gửi mã QR
                      </button>
                      
                      <button 
                          onClick={() => handleSMS(selectedGroup)} 
                          className="py-3 bg-white border border-gray-200 hover:border-orange-300 hover:bg-orange-50 text-orange-600 font-bold rounded-xl transition-colors flex items-center justify-center gap-2 shadow-sm"
                      >
                          <i className="fas fa-comment-dots"></i> Nhắn SMS
                      </button>
                  </div>
              </div>
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
