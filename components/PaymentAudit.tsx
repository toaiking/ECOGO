
import React, { useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod, BankConfig } from '../types';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';
import { reconciliationService } from '../services/reconciliationService';
import ConfirmModal from './ConfirmModal';
import { differenceInDays } from 'date-fns';

interface CustomerDebtGroup {
    key: string;
    customerName: string;
    customerPhone: string;
    orders: Order[];
    totalAmount: number;
    daysOld: number;
}

const dataURLtoFile = (dataurl: string, filename: string) => {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) u8arr[n] = bstr.charCodeAt(n);
    return new File([u8arr], filename, { type: mime });
};

const PaymentAudit: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [bankConfig, setBankConfig] = useState<BankConfig | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedBatch, setSelectedBatch] = useState('ALL');
  
  // Selection States
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  
  // UI States
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [activeGroup, setActiveGroup] = useState<CustomerDebtGroup | null>(null);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [isGeneratingQR, setIsGeneratingQR] = useState(false);

  const qrImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const unsub = storageService.subscribeOrders((allOrders) => {
      const filtered = (allOrders || [])
        .filter(o => o.paymentMethod === PaymentMethod.TRANSFER && !o.paymentVerified && o.status !== OrderStatus.CANCELLED)
        .sort((a, b) => b.createdAt - a.createdAt);
      setOrders(filtered);
    });
    storageService.getBankConfig().then(setBankConfig);
    return () => { if (unsub) unsub(); };
  }, []);

  const batches = useMemo(() => {
    const batchSet = new Set<string>();
    orders.forEach(o => { if (o.batchId) batchSet.add(o.batchId); });
    return Array.from(batchSet).sort();
  }, [orders]);

  const customerGroups = useMemo(() => {
      const groups: Record<string, CustomerDebtGroup> = {};
      const now = Date.now();

      orders.forEach(o => {
          const matchSearch = !searchTerm || 
            normalizeString(o.customerName).includes(normalizeString(searchTerm)) || 
            o.customerPhone.includes(searchTerm) || 
            o.id.includes(searchTerm.toUpperCase());
          const matchBatch = selectedBatch === 'ALL' || o.batchId === selectedBatch;
          if (!matchSearch || !matchBatch) return;

          let key = o.customerId || normalizePhone(o.customerPhone) || `${normalizeString(o.customerName)}|${normalizeString(o.address)}`;

          if (!groups[key]) {
              groups[key] = {
                  key,
                  customerName: o.customerName,
                  customerPhone: o.customerPhone,
                  orders: [],
                  totalAmount: 0,
                  daysOld: 0
              };
          }
          groups[key].orders.push(o);
          groups[key].totalAmount += o.totalPrice;
          const days = differenceInDays(now, o.createdAt);
          if (days > groups[key].daysOld) groups[key].daysOld = days;
      });
      
      return Object.values(groups).sort((a, b) => b.daysOld - a.daysOld);
  }, [orders, searchTerm, selectedBatch]);

  // Actions for Reminders
  const handleSms = (group: CustomerDebtGroup) => {
      const msg = `Chào ${group.customerName}, tổng nợ đơn hàng của bạn là ${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ. Vui lòng kiểm tra và thanh toán giúp shop nhé. Cảm ơn!`;
      const ua = navigator.userAgent.toLowerCase();
      const separator = (ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1) ? '&' : '?';
      window.open(`sms:${group.customerPhone}${separator}body=${encodeURIComponent(msg)}`, '_self');
      storageService.incrementReminderCount(group.orders.map(o => o.id));
  };

  const handleZalo = (group: CustomerDebtGroup) => {
      window.open(`https://zalo.me/${normalizePhone(group.customerPhone).replace(/^0/, '84')}`, '_blank');
      storageService.incrementReminderCount(group.orders.map(o => o.id));
  };

  const handleShareDebtQR = async (group: CustomerDebtGroup) => {
      if (!bankConfig || !bankConfig.accountNo) {
          toast.error("Vui lòng cài đặt thông tin Ngân hàng trước.");
          return;
      }
      setIsGeneratingQR(true);
      const toastId = toast.loading("Đang tạo phiếu nợ...");
      
      try {
          const orderIds = group.orders.map(o => o.id).join(' ');
          const qrUrl = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template || 'compact2'}.png?amount=${group.totalAmount}&addInfo=${encodeURIComponent(`DH ${orderIds}`)}&accountName=${encodeURIComponent(bankConfig.accountName)}`;
          
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.src = qrUrl;
          
          await new Promise((resolve, reject) => {
              img.onload = resolve;
              img.onerror = reject;
          });

          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error("Canvas error");

          const W = 800;
          const qrSize = 500;
          // Calculate height based on number of items
          const items = Array.from(new Set(group.orders.flatMap(o => o.items.map(i => i.name))));
          const H = 650 + (items.length * 45);
          
          canvas.width = W;
          canvas.height = H;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, W, H);

          // Header
          ctx.fillStyle = '#1e3a8a'; // Dark blue
          ctx.fillRect(0, 0, W, 140);
          ctx.fillStyle = '#ffffff';
          ctx.font = 'bold 42px Arial';
          ctx.textAlign = 'center';
          ctx.fillText('PHIẾU THANH TOÁN CÔNG NỢ', W/2, 85);

          // Customer
          ctx.fillStyle = '#374151';
          ctx.font = 'bold 32px Arial';
          ctx.fillText(group.customerName.toUpperCase(), W/2, 190);
          
          // Total
          ctx.fillStyle = '#ef4444';
          ctx.font = 'black 70px Arial';
          ctx.fillText(`${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ`, W/2, 280);

          // QR
          ctx.drawImage(img, (W - qrSize) / 2, 320, qrSize, qrSize);

          // Footer info
          ctx.fillStyle = '#9ca3af';
          ctx.font = 'italic 24px Arial';
          ctx.fillText('Vui lòng quét mã QR để thanh toán nhanh chóng', W/2, H - 40);

          const dataUrl = canvas.toDataURL('image/png');
          const file = dataURLtoFile(dataUrl, `debt-${group.customerName}.png`);
          
          if (navigator.share) {
              await navigator.share({ files: [file], title: `Công nợ ${group.customerName}` });
          } else {
              const a = document.createElement('a');
              a.href = dataUrl;
              a.download = `debt-${group.customerName}.png`;
              a.click();
          }
          storageService.incrementReminderCount(group.orders.map(o => o.id));
          toast.success("Đã tạo phiếu nợ!");
      } catch (e) {
          console.error(e);
          toast.error("Lỗi khi tạo ảnh QR");
      } finally {
          setIsGeneratingQR(false);
          toast.dismiss(toastId);
      }
  };

  const toggleSelectGroup = (key: string, e: React.MouseEvent) => {
      e.stopPropagation();
      setSelectedGroupKeys(prev => {
          const next = new Set(prev);
          if (next.has(key)) next.delete(key);
          else next.add(key);
          setIsSelectionMode(next.size > 0);
          return next;
      });
  };

  const handleSmartPaste = () => {
      if (!pasteText.trim()) return;
      const result = reconciliationService.reconcileFromText(pasteText, orders);
      if (result.matchedOrders.length > 0) {
          const ids = result.matchedOrders.map(o => o.id);
          confirmBulkPayment(ids);
          setShowPasteModal(false);
          setPasteText('');
      } else {
          toast.error("Không tìm thấy mã đơn nào trong nội dung dán.");
      }
  };

  const confirmBulkPayment = async (orderIds: string[]) => {
      const loading = toast.loading(`Đang xử lý ${orderIds.length} đơn...`);
      try {
          const promises = orderIds.map(id => storageService.updatePaymentVerification(id, true));
          await Promise.all(promises);
          toast.success(`Đã xác nhận thanh toán cho ${orderIds.length} đơn!`);
          setSelectedGroupKeys(new Set());
          setIsSelectionMode(false);
      } catch (e) {
          toast.error("Lỗi khi cập nhật dữ liệu.");
      } finally {
          toast.dismiss(loading);
      }
  };

  const executeBulkConfirm = () => {
      const ids: string[] = [];
      customerGroups.forEach(g => {
          if (selectedGroupKeys.has(g.key)) {
              g.orders.forEach(o => ids.push(o.id));
          }
      });
      confirmBulkPayment(ids);
      setShowBulkConfirm(false);
  };

  const getAgingStyle = (days: number) => {
      if (days >= 5) return 'bg-red-100 text-red-700 border-red-200';
      if (days >= 2) return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      return 'bg-eco-100 text-eco-700 border-eco-200';
  };

  return (
    <div className="max-w-6xl mx-auto pb-32 animate-fade-in px-2 sm:px-4">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col gap-4 mb-6 sticky top-16 z-30 bg-gray-50/95 py-2 backdrop-blur-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-black text-gray-800 uppercase tracking-tighter">Đối soát công nợ</h2>
              <button 
                  onClick={() => setShowPasteModal(true)}
                  className="bg-black text-white px-4 py-2 rounded-xl font-bold text-xs uppercase shadow-lg active:scale-95 transition-all flex items-center gap-2"
              >
                  <i className="fas fa-magic"></i> Smart-Paste (AI)
              </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative">
                  <i className="fas fa-search absolute left-3 top-3 text-gray-400 text-xs"></i>
                  <input 
                      value={searchTerm} 
                      onChange={e => setSearchTerm(e.target.value)}
                      placeholder="Tìm khách, SĐT, mã đơn..." 
                      className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 focus:ring-2 focus:ring-eco-500 outline-none text-sm font-medium text-gray-800" 
                  />
              </div>
              <select 
                  value={selectedBatch} 
                  onChange={e => setSelectedBatch(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-xl border border-gray-200 outline-none text-sm font-bold bg-white text-gray-800"
              >
                  <option value="ALL">Tất cả các lô hàng</option>
                  {batches.map(b => <option key={b} value={b}>{b}</option>)}
              </select>
          </div>
      </div>

      {/* SUMMARY CARDS */}
      <div className="flex overflow-x-auto no-scrollbar gap-3 mb-6 pb-2">
          <div className="flex-shrink-0 min-w-[140px] bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <div className="text-[10px] font-black text-gray-400 uppercase">Tổng nợ</div>
              <div className="text-xl font-black text-red-600">{new Intl.NumberFormat('vi-VN').format(customerGroups.reduce((s, g) => s + g.totalAmount, 0))}đ</div>
          </div>
          <div className="flex-shrink-0 min-w-[140px] bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <div className="text-[10px] font-black text-gray-400 uppercase">Số khách nợ</div>
              <div className="text-xl font-black text-gray-800">{customerGroups.length}</div>
          </div>
          <div className="flex-shrink-0 min-w-[140px] bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
              <div className="text-[10px] font-black text-gray-400 uppercase">Đơn chờ CK</div>
              <div className="text-xl font-black text-blue-600">{orders.length}</div>
          </div>
      </div>

      {/* CUSTOMER LIST */}
      <div className="space-y-3">
          {customerGroups.length === 0 ? (
              <div className="text-center py-20 text-gray-300">
                  <i className="fas fa-check-circle text-5xl mb-4 opacity-20"></i>
                  <p className="font-bold">Tuyệt vời! Không còn công nợ cần xử lý.</p>
              </div>
          ) : (
              customerGroups.map(group => (
                  <div 
                      key={group.key}
                      onClick={() => setActiveGroup(group)}
                      className={`bg-white rounded-2xl border-2 transition-all cursor-pointer p-4 flex items-center gap-3 sm:gap-4 ${
                          selectedGroupKeys.has(group.key) ? 'border-eco-500 bg-eco-50 shadow-md' : 'border-gray-100 hover:border-gray-200 shadow-sm'
                      }`}
                  >
                      {/* Selection Checkbox */}
                      <div 
                          onClick={(e) => toggleSelectGroup(group.key, e)}
                          className={`w-6 h-6 rounded-lg border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                              selectedGroupKeys.has(group.key) ? 'bg-eco-600 border-eco-600 text-white' : 'border-gray-300 bg-white'
                          }`}
                      >
                          {selectedGroupKeys.has(group.key) && <i className="fas fa-check text-xs"></i>}
                      </div>

                      {/* Main Info */}
                      <div className="flex-grow min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                              <span className="font-black text-gray-800 text-sm truncate uppercase">{group.customerName}</span>
                              <span className={`text-[9px] font-black px-2 py-0.5 rounded-full border whitespace-nowrap uppercase ${getAgingStyle(group.daysOld)}`}>
                                  {group.daysOld === 0 ? 'Hôm nay' : `${group.daysOld} ngày`}
                              </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-gray-400">
                              <span className="font-mono">{group.customerPhone || 'N/A'}</span>
                              <span className="bg-gray-100 px-1.5 py-0.5 rounded font-bold text-gray-500">{group.orders.length} đơn</span>
                          </div>
                      </div>

                      {/* Remind Buttons (Hidden on very small screens, use group modal instead) */}
                      <div className="hidden sm:flex items-center gap-1 shrink-0">
                          <button onClick={(e) => { e.stopPropagation(); handleZalo(group); }} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-100" title="Zalo"><i className="fab fa-facebook-messenger text-xs"></i></button>
                          <button onClick={(e) => { e.stopPropagation(); handleSms(group); }} className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center border border-orange-100" title="SMS"><i className="fas fa-comment-dots text-xs"></i></button>
                      </div>

                      {/* Price Area */}
                      <div className="text-right flex-shrink-0 ml-1">
                          <div className="text-sm font-black text-red-600 leading-none">{new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ</div>
                          <div className="text-[9px] font-bold text-gray-400 uppercase mt-1">Chờ nợ</div>
                      </div>
                  </div>
              ))
          )}
      </div>

      {/* FLOATING ACTION BAR */}
      {isSelectionMode && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[50] w-[95%] max-w-md animate-slide-up">
              <div className="bg-gray-900 text-white rounded-2xl shadow-2xl p-4 flex items-center justify-between border border-gray-700">
                  <div className="flex items-center gap-3">
                      <button 
                        onClick={() => { setSelectedGroupKeys(new Set()); setIsSelectionMode(false); }}
                        className="w-8 h-8 rounded-full bg-gray-800 flex items-center justify-center hover:bg-gray-700"
                      >
                          <i className="fas fa-times text-xs"></i>
                      </button>
                      <div>
                          <div className="text-[10px] font-bold text-gray-400 uppercase leading-none">Đã chọn</div>
                          <div className="text-lg font-black leading-none mt-1">{selectedGroupKeys.size} khách</div>
                      </div>
                  </div>
                  <button 
                    onClick={() => setShowBulkConfirm(true)}
                    className="bg-eco-600 hover:bg-eco-500 px-6 py-2.5 rounded-xl font-black text-sm uppercase shadow-lg shadow-eco-900 transition-all active:scale-95"
                  >
                      Xác nhận đã nhận <i className="fas fa-check-double ml-1"></i>
                  </button>
              </div>
          </div>
      )}

      {/* SMART PASTE MODAL */}
      {showPasteModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-scale-in">
                  <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="font-black text-gray-800 uppercase text-sm tracking-tight">Smart-Paste (Đối soát nhanh)</h3>
                      <button onClick={() => setShowPasteModal(false)} className="text-gray-400"><i className="fas fa-times"></i></button>
                  </div>
                  <div className="p-6 space-y-4">
                      <p className="text-xs text-gray-500 font-medium">Dán nội dung tin nhắn báo tiền về của Ngân hàng hoặc Zalo vào đây. AI sẽ tự động tìm mã đơn hàng.</p>
                      <textarea 
                          value={pasteText}
                          onChange={e => setPasteText(e.target.value)}
                          className="w-full h-40 p-4 bg-gray-50 border-2 border-gray-200 rounded-2xl outline-none focus:border-black font-medium text-sm resize-none text-gray-800"
                          placeholder="VD: +150,000 VND ND: DH ABC123456..."
                      />
                      <button 
                          onClick={handleSmartPaste}
                          className="w-full py-4 bg-black text-white rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all"
                      >
                          Bắt đầu AI Scanning <i className="fas fa-magic ml-2"></i>
                      </button>
                  </div>
              </div>
          </div>
      )}

      {/* GROUP DETAIL MODAL */}
      {activeGroup && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setActiveGroup(null)}>
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh] animate-scale-in" onClick={e => e.stopPropagation()}>
                  <div className="p-6 border-b border-gray-100 bg-gray-50 flex justify-between items-start">
                      <div className="min-w-0">
                          <h3 className="font-black text-xl text-gray-800 uppercase truncate pr-4">{activeGroup.customerName}</h3>
                          <p className="text-sm font-bold text-gray-400 mt-1">{activeGroup.customerPhone || 'Không có SĐT'}</p>
                      </div>
                      <div className="text-right flex-shrink-0">
                          <div className="text-[10px] font-black text-gray-400 uppercase">Tổng nợ</div>
                          <div className="text-2xl font-black text-red-600 leading-none mt-1">{new Intl.NumberFormat('vi-VN').format(activeGroup.totalAmount)}đ</div>
                      </div>
                  </div>

                  <div className="flex-grow overflow-y-auto p-4 space-y-3 bg-gray-50/30">
                      {activeGroup.orders.map(o => (
                          <div key={o.id} className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm flex justify-between items-center group">
                              <div className="min-w-0">
                                  <div className="flex items-center gap-2 mb-1">
                                      <span className="font-black text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg text-[11px]">#{o.id}</span>
                                      <span className="text-[10px] text-gray-400 font-bold italic">{new Date(o.createdAt).toLocaleDateString('vi-VN')}</span>
                                  </div>
                                  <div className="text-[11px] font-bold text-gray-500 leading-tight truncate max-w-[220px]">
                                      {o.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                                  </div>
                              </div>
                              <div className="text-right">
                                  <div className="font-black text-gray-800 text-sm">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ</div>
                                  <button 
                                      onClick={() => confirmBulkPayment([o.id])}
                                      className="text-[9px] font-black text-blue-600 uppercase hover:underline mt-1"
                                    >Xác nhận lẻ</button>
                              </div>
                          </div>
                      ))}
                  </div>

                  <div className="p-4 bg-white border-t border-gray-100 flex flex-col gap-3">
                      <div className="grid grid-cols-3 gap-2">
                          <button onClick={() => handleZalo(activeGroup)} className="py-3 bg-blue-50 text-blue-600 border border-blue-100 rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2"><i className="fab fa-facebook-messenger"></i> Zalo</button>
                          <button onClick={() => handleSms(activeGroup)} className="py-3 bg-orange-50 text-orange-600 border border-orange-100 rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2"><i className="fas fa-comment-dots"></i> SMS</button>
                          <button onClick={() => handleShareDebtQR(activeGroup)} disabled={isGeneratingQR} className="py-3 bg-indigo-50 text-indigo-600 border border-indigo-100 rounded-xl font-bold text-xs uppercase flex items-center justify-center gap-2"><i className="fas fa-qrcode"></i> Gửi QR</button>
                      </div>
                      <button 
                        onClick={() => { confirmBulkPayment(activeGroup.orders.map(o => o.id)); setActiveGroup(null); }}
                        className="w-full py-4 bg-black text-white rounded-2xl font-black uppercase text-xs shadow-xl active:scale-95 transition-all"
                      >
                          Xác nhận Đã trả nợ Toàn bộ <i className="fas fa-check-double ml-1"></i>
                      </button>
                  </div>
              </div>
          </div>
      )}

      <ConfirmModal 
          isOpen={showBulkConfirm} 
          title="Xác nhận thanh toán?" 
          message={`Hệ thống sẽ cập nhật trạng thái "Đã thanh toán" cho toàn bộ đơn hàng của ${selectedGroupKeys.size} khách hàng đã chọn.`}
          onConfirm={executeBulkConfirm}
          onCancel={() => setShowBulkConfirm(false)}
          confirmLabel="Xác nhận ngay"
      />
    </div>
  );
};

export default PaymentAudit;
