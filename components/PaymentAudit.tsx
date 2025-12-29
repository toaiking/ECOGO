
import React, { useState, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod, BankConfig, ShopConfig } from '../types';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';
import { reconciliationService, ReconciliationResult } from '../services/reconciliationService';
import { differenceInDays } from 'date-fns';
import ConfirmModal from './ConfirmModal';

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
  const [searchTerm, setSearchTerm] = useState('');
  const [filterBatch, setFilterBatch] = useState<string>('ALL');
  
  // Selection States
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedGroupKeys, setSelectedGroupKeys] = useState<Set<string>>(new Set());
  
  // UI States
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [activeGroup, setActiveGroup] = useState<CustomerDebtGroup | null>(null); // For Detail Modal
  
  // Custom Confirmation State
  const [confirmation, setConfirmation] = useState<{
      isOpen: boolean;
      title: string;
      message: string;
      onConfirm: () => void;
  }>({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Success Modal State
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [successData, setSuccessData] = useState<{ count: number, totalAmount: number }>({ count: 0, totalAmount: 0 });

  // PDF Reconciliation States
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconciliationResult | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [isGeneratingQR, setIsGeneratingQR] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const shopConfigRef = useRef<ShopConfig | null>(null);
  const bankConfigRef = useRef<BankConfig | null>(null);

  useEffect(() => {
    const unsub = storageService.subscribeOrders((allOrders) => {
      // Filter: Only Transfer + Not Verified + Not Cancelled
      const filtered = (allOrders || [])
        .filter(o => o.paymentMethod === PaymentMethod.TRANSFER && !o.paymentVerified && o.status !== OrderStatus.CANCELLED)
        .sort((a, b) => b.createdAt - a.createdAt);
      setOrders(filtered);
    });
    
    const loadConfigs = async () => {
        bankConfigRef.current = await storageService.getBankConfig();
        shopConfigRef.current = await storageService.getShopConfig();
    };
    loadConfigs();

    return () => { if (unsub) unsub(); };
  }, []);

  // Extract unique batches from UNPAID orders
  const batches = useMemo(() => {
      const uniqueBatches = new Set<string>();
      orders.forEach(o => {
          if (o.batchId) uniqueBatches.add(o.batchId);
      });
      return Array.from(uniqueBatches).sort().reverse(); // Newest batch first
  }, [orders]);

  const customerGroups = useMemo(() => {
      const groups: Record<string, CustomerDebtGroup> = {};
      const now = Date.now();

      orders.forEach(o => {
          // 1. Filter by Search
          const matchSearch = !searchTerm || 
            normalizeString(o.customerName).includes(normalizeString(searchTerm)) || 
            o.customerPhone.includes(searchTerm) || 
            o.id.includes(searchTerm.toUpperCase());
          
          // 2. Filter by Batch
          const matchBatch = filterBatch === 'ALL' || o.batchId === filterBatch;

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
  }, [orders, searchTerm, filterBatch]);

  const totalDebtAmount = useMemo(() => customerGroups.reduce((sum, g) => sum + g.totalAmount, 0), [customerGroups]);

  // --- ACTIONS ---

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

  // --- CORE CONFIRM LOGIC (BATCH UPDATE OPTIMIZATION) ---
  const executeConfirm = async (ordersToConfirm: Order[], totalMoney: number, countCustomers: number) => {
      // 1. Prepare Success Data
      const successPayload = { count: countCustomers, totalAmount: totalMoney };
      const loadId = toast.loading("Đang cập nhật...");
      
      try {
          // 2. Extract IDs
          const orderIds = ordersToConfirm.map(o => o.id);

          // 3. Execute Batch Update using specialized method (Partial Update)
          await storageService.updatePaymentVerificationBatch(orderIds, true);
          
          // 4. Add a single summary notification
          storageService.addNotification({
              title: 'Xác nhận thu tiền',
              message: `Đã xác nhận thanh toán cho ${countCustomers} khách hàng. Tổng thu: ${new Intl.NumberFormat('vi-VN').format(totalMoney)}đ`,
              type: 'info'
          });

          // 5. Update UI State
          setSuccessData(successPayload);
          setShowSuccessModal(true);
          setConfirmation({ ...confirmation, isOpen: false });
          setActiveGroup(null);
          setIsSelectionMode(false);
          setSelectedGroupKeys(new Set());
          
          toast.dismiss(loadId);
      } catch (error) {
          console.error(error);
          toast.error("Có lỗi khi cập nhật dữ liệu. Vui lòng thử lại.", { id: loadId });
      }
  };

  const handleManualConfirm = (group: CustomerDebtGroup) => {
      setConfirmation({
          isOpen: true,
          title: "Xác nhận thu tiền?",
          message: `Khách ${group.customerName} đã thanh toán đủ ${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ?\n(${group.orders.length} đơn hàng sẽ được gạch nợ)`,
          onConfirm: () => executeConfirm(group.orders, group.totalAmount, 1)
      });
  };

  const handleBulkConfirm = () => {
      if (selectedGroupKeys.size === 0) return;
      
      const selectedGroups = customerGroups.filter(g => selectedGroupKeys.has(g.key));
      const totalMoney = selectedGroups.reduce((sum, g) => sum + g.totalAmount, 0);
      const totalOrdersCount = selectedGroups.reduce((sum, g) => sum + g.orders.length, 0);

      setConfirmation({
          isOpen: true,
          title: "Thu tiền hàng loạt?",
          message: `Xác nhận đã thu ${new Intl.NumberFormat('vi-VN').format(totalMoney)}đ từ ${selectedGroupKeys.size} khách hàng?\n(Tổng ${totalOrdersCount} đơn hàng)`,
          onConfirm: () => {
              const allOrders = selectedGroups.flatMap(g => g.orders);
              executeConfirm(allOrders, totalMoney, selectedGroups.length);
          }
      });
  };

  const handleConfirmAllInBatch = () => {
      if (filterBatch === 'ALL' || customerGroups.length === 0) return;

      const totalMoney = customerGroups.reduce((sum, g) => sum + g.totalAmount, 0);
      const totalOrdersCount = customerGroups.reduce((sum, g) => sum + g.orders.length, 0);
      const customerCount = customerGroups.length;

      setConfirmation({
          isOpen: true,
          title: `Thu hết lô ${filterBatch}?`,
          message: `Bạn chắc chắn đã nhận đủ tiền cho toàn bộ lô này?\n\n- Khách: ${customerCount}\n- Đơn: ${totalOrdersCount}\n- Tiền: ${new Intl.NumberFormat('vi-VN').format(totalMoney)}đ`,
          onConfirm: () => {
              const allOrders = customerGroups.flatMap(g => g.orders);
              executeConfirm(allOrders, totalMoney, customerCount);
          }
      });
  };

  const handleShareDebtQR = async (group: CustomerDebtGroup) => {
      const bankConfig = bankConfigRef.current;
      const shopConfig = shopConfigRef.current;

      if (!bankConfig || !bankConfig.accountNo) {
          toast.error("Vui lòng cài đặt thông tin Ngân hàng trước.");
          return;
      }
      setIsGeneratingQR(true);
      const toastId = toast.loading("Đang tạo phiếu nợ...");
      
      try {
          // XỬ LÝ TÊN KHÁCH KHÔNG DẤU (Giống logic trong PDF/Tracking)
          let cleanName = normalizeString(group.customerName).toUpperCase();
          cleanName = cleanName.replace(/[^A-Z0-9 ]/g, '');
          if (cleanName.length > 25) {
              cleanName = cleanName.substring(0, 25).trim();
          }

          const orderIds = group.orders.map(o => o.id).join(' ');
          // Content: DH [LIST_IDS] [NAME]
          const desc = `DH ${orderIds} ${cleanName}`;
          // Limit total content length for safety (VietQR typical limits around 50 chars for some banks, but description field can take more in standard QR)
          // We truncate if extremely long
          const finalDesc = desc.length > 50 ? desc.substring(0, 50) : desc;

          const qrUrl = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template || 'compact2'}.png?amount=${group.totalAmount}&addInfo=${encodeURIComponent(finalDesc)}&accountName=${encodeURIComponent(bankConfig.accountName)}`;
          
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.src = qrUrl;
          
          await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; });

          // Helper drawing logic
          const W = 800; const cardMargin = 40; const contentW = W - (cardMargin * 2);
          const qrNatW = img.naturalWidth || 1; const qrNatH = img.naturalHeight || 1; const qrRatio = qrNatH / qrNatW;
          const qrDisplayW = 400; const qrDisplayH = qrDisplayW * qrRatio;
          const headerHeight = 260; const qrSectionHeight = qrDisplayH + 60; const infoBoxPadding = 40; const generalInfoHeight = 100; const orderBlockHeight = 100; const itemsHeight = (group.orders.length * orderBlockHeight) + 80; const infoBoxH = generalInfoHeight + itemsHeight; const footerHeight = 140; const H = cardMargin + headerHeight + qrSectionHeight + infoBoxH + footerHeight + cardMargin;

          const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); if (!ctx) throw new Error("Canvas error"); canvas.width = W; canvas.height = H;
          ctx.fillStyle = '#F8FAFC'; ctx.fillRect(0, 0, W, H);
          const cardX = cardMargin; const cardY = cardMargin;
          ctx.shadowColor = "rgba(0, 0, 0, 0.1)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 15; ctx.fillStyle = '#FFFFFF';
          if ((ctx as any).roundRect) { ctx.beginPath(); (ctx as any).roundRect(cardX, cardY, contentW, H - (cardMargin * 2), 40); ctx.fill(); } else { ctx.fillRect(cardX, cardY, contentW, H - (cardMargin * 2)); }
          ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
          let cursorY = cardY + 80;
          const shopName = (shopConfig?.shopName || 'ECOGO LOGISTICS').toUpperCase();
          ctx.fillStyle = '#15803D'; ctx.font = 'bold 40px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(shopName, W / 2, cursorY); cursorY += 50;
          ctx.fillStyle = '#64748B'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillText('PHIẾU THANH TOÁN CÔNG NỢ', W / 2, cursorY); cursorY += 70;
          ctx.fillStyle = '#DC2626'; ctx.font = 'bold 80px Arial, sans-serif'; ctx.fillText(`${new Intl.NumberFormat('vi-VN').format(group.totalAmount)}đ`, W / 2, cursorY); cursorY += 60;
          const qrX = (W - qrDisplayW) / 2; ctx.drawImage(img, qrX, cursorY, qrDisplayW, qrDisplayH); cursorY += qrDisplayH + 50;
          const boxX = cardX + 20; const boxW = contentW - 40;
          ctx.fillStyle = '#F1F5F9'; if ((ctx as any).roundRect) { ctx.beginPath(); (ctx as any).roundRect(boxX, cursorY, boxW, infoBoxH, 24); ctx.fill(); } else { ctx.fillRect(boxX, cursorY, boxW, infoBoxH); }
          let textY = cursorY + 50; const leftX = boxX + 40; const rightX = boxX + boxW - 40;
          ctx.textAlign = 'left'; ctx.font = 'normal 24px Arial, sans-serif'; ctx.fillStyle = '#64748B'; ctx.fillText("Khách hàng:", leftX, textY);
          ctx.textAlign = 'right'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillStyle = '#0F172A'; ctx.fillText(group.customerName, rightX, textY); textY += 40;
          ctx.textAlign = 'left'; ctx.font = 'normal 24px Arial, sans-serif'; ctx.fillText("Số điện thoại:", leftX, textY);
          ctx.textAlign = 'right'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillText(group.customerPhone, rightX, textY); textY += 30;
          ctx.beginPath(); ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.moveTo(leftX, textY); ctx.lineTo(rightX, textY); ctx.stroke(); ctx.setLineDash([]); textY += 40;
          ctx.textAlign = 'left'; ctx.font = 'bold 22px Arial, sans-serif'; ctx.fillStyle = '#334155'; ctx.fillText("Chi tiết các đơn nợ:", leftX, textY); textY += 40;
          group.orders.forEach(o => {
              ctx.textAlign = 'left'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillStyle = '#0F172A'; ctx.fillText(`#${o.id}`, leftX, textY);
              ctx.textAlign = 'right'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillStyle = '#DC2626'; ctx.fillText(`${new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ`, rightX, textY); textY += 35;
              ctx.textAlign = 'left'; ctx.font = 'normal 20px Arial, sans-serif'; ctx.fillStyle = '#64748B'; ctx.fillText(new Date(o.createdAt).toLocaleDateString('vi-VN'), leftX, textY);
              const itemsText = o.items.map(i => i.name).join(', '); const truncatedItems = itemsText.length > 30 ? itemsText.substring(0, 27) + '...' : itemsText;
              ctx.textAlign = 'right'; ctx.fillText(truncatedItems, rightX, textY); textY += 50;
          });
          cursorY += infoBoxH + 50;
          if (bankConfig) {
              ctx.textAlign = 'center'; ctx.fillStyle = '#64748B'; ctx.font = 'italic 20px Arial, sans-serif';
              const bankLine1 = `Ngân hàng: ${bankConfig.bankId} - ${bankConfig.accountNo}`; const bankLine2 = `Chủ TK: ${bankConfig.accountName}`;
              ctx.fillText(bankLine1, W / 2, cursorY); ctx.fillText(bankLine2, W / 2, cursorY + 30);
          }

          const dataUrl = canvas.toDataURL('image/png');
          const file = dataURLtoFile(dataUrl, `debt-${group.customerPhone}.png`);
          
          if (navigator.share) {
              await navigator.share({ files: [file], title: `Công nợ ${group.customerName}`, text: `Chi tiết công nợ khách hàng ${group.customerName}` });
              toast.success("Đã mở chia sẻ!");
          } else {
              const a = document.createElement('a'); a.href = dataUrl; a.download = `debt-${group.customerPhone}.png`; a.click();
              toast.success("Đã tải ảnh xuống");
          }
      } catch (e: any) { console.error(e); toast.error("Lỗi: " + e.message); } finally { setIsGeneratingQR(false); toast.dismiss(toastId); }
  };

  const handleSmartPaste = () => {
      try {
          const result = reconciliationService.reconcileFromText(pasteText, orders);
          setReconcileResult(result);
          setShowPasteModal(false);
          if (result.matchedOrders.length > 0) { setShowReconcileModal(true); } else { toast.error("Không tìm thấy đơn hàng nào khớp!"); }
      } catch (e) {
          toast.error("Lỗi xử lý văn bản.");
      }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      
      const loadId = toast.loading("Đang đọc file PDF...");
      try {
          const result = await reconciliationService.reconcileOrders(file, orders);
          setReconcileResult(result);
          if (result.matchedOrders.length > 0) {
              setShowReconcileModal(true);
              toast.success(`Tìm thấy ${result.matchedOrders.length} đơn khớp!`);
          } else {
              toast.error("Không tìm thấy đơn hàng nào trong file này.");
          }
      } catch (err: any) {
          toast.error("Lỗi đọc PDF: " + err.message);
      } finally {
          toast.dismiss(loadId);
          e.target.value = ''; // Reset input
      }
  };

  const confirmReconciliation = async () => {
      if (!reconcileResult) return;
      setIsReconciling(true);
      
      await executeConfirm(reconcileResult.matchedOrders, reconcileResult.totalMatchedAmount, reconcileResult.matchedOrders.length);
      
      setIsReconciling(false);
      setShowReconcileModal(false);
      setReconcileResult(null);
      setPasteText('');
  };

  const handleGroupClick = (group: CustomerDebtGroup) => {
      if (isSelectionMode) {
          setSelectedGroupKeys(prev => {
              const newSet = new Set(prev);
              if (newSet.has(group.key)) newSet.delete(group.key);
              else newSet.add(group.key);
              if (newSet.size === 0) setIsSelectionMode(false);
              return newSet;
          });
      } else {
          setActiveGroup(group);
      }
  };

  const handleLongPress = (group: CustomerDebtGroup) => {
      setIsSelectionMode(true);
      setSelectedGroupKeys(new Set([group.key]));
      if (navigator.vibrate) navigator.vibrate(50);
  };

  return (
    <div className="max-w-4xl mx-auto pb-24 animate-fade-in px-3">
        {/* Header Control */}
        <div className="sticky top-16 z-30 bg-gray-50/95 pt-3 pb-2 backdrop-blur-sm mb-4">
            <div className="flex justify-between items-center mb-4">
                <div>
                    <h1 className="text-xl font-black text-gray-900 uppercase tracking-tighter italic">Đối Soát <span className="text-orange-500">Công Nợ</span></h1>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Tổng nợ: {new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(totalDebtAmount)}đ ({customerGroups.length} khách)</p>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        className="h-10 px-4 rounded-xl bg-white border-2 border-gray-900 text-gray-900 font-bold text-xs flex items-center justify-center shadow-sm active:scale-95 transition-all uppercase"
                        title="Import PDF Sao kê"
                    >
                        <i className="fas fa-file-pdf mr-2 text-red-500 text-lg"></i> PDF
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handlePdfUpload} accept="application/pdf" className="hidden" />
                    
                    <button 
                        onClick={() => setShowPasteModal(true)}
                        className="w-10 h-10 rounded-xl bg-black text-white flex items-center justify-center shadow-lg active:scale-95 transition-all"
                        title="Dán tin nhắn"
                    >
                        <i className="fas fa-paste"></i>
                    </button>
                </div>
            </div>

            {/* Batch Filter (Dropdown) & Search */}
            <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                    <div className="relative flex-grow">
                        <select
                            value={filterBatch}
                            onChange={(e) => setFilterBatch(e.target.value)}
                            className="w-full appearance-none bg-white border-2 border-gray-200 text-gray-800 py-3 px-4 pr-8 rounded-xl font-bold text-xs uppercase focus:outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-50 transition-all shadow-sm cursor-pointer"
                        >
                            <option value="ALL">📦 Tất cả các lô</option>
                            {batches.map(b => <option key={b} value={b}>📦 {b}</option>)}
                        </select>
                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
                            <i className="fas fa-chevron-down text-xs"></i>
                        </div>
                    </div>
                    
                    {filterBatch !== 'ALL' && customerGroups.length > 0 && (
                        <button
                            onClick={handleConfirmAllInBatch}
                            className="bg-green-600 text-white px-4 py-2 rounded-xl font-black text-[10px] uppercase shadow-md hover:bg-green-700 transition-all active:scale-95 flex flex-col items-center justify-center shrink-0 min-w-[80px]"
                        >
                            <i className="fas fa-check-double text-base mb-0.5"></i>
                            <span>Thu hết lô</span>
                        </button>
                    )}
                </div>

                <div className="relative group">
                    <i className="fas fa-search absolute left-4 top-3.5 text-gray-400 group-focus-within:text-orange-500 transition-colors"></i>
                    <input 
                        value={searchTerm} 
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Tìm tên khách, sđt hoặc mã đơn..." 
                        className="w-full pl-12 pr-4 py-3 bg-white border-2 border-gray-100 rounded-2xl shadow-sm outline-none focus:border-orange-500 focus:ring-4 focus:ring-orange-50 font-bold text-gray-800 transition-all text-sm"
                    />
                </div>
            </div>
        </div>

        {/* Compact List View */}
        <div className="space-y-3">
            {customerGroups.length === 0 ? (
                <div className="py-20 text-center text-gray-300">
                    <i className="fas fa-check-circle text-6xl mb-4 opacity-20 text-green-500"></i>
                    <p className="font-bold uppercase tracking-widest text-xs">Tuyệt vời! Không có công nợ {filterBatch !== 'ALL' ? `trong lô ${filterBatch}` : ''}.</p>
                </div>
            ) : (
                customerGroups.map(group => {
                    const isSelected = selectedGroupKeys.has(group.key);
                    return (
                        <div 
                            key={group.key} 
                            onClick={() => handleGroupClick(group)}
                            onContextMenu={(e) => { e.preventDefault(); handleLongPress(group); }}
                            className={`flex items-center p-4 bg-white rounded-2xl border transition-all duration-200 cursor-pointer active:scale-[0.98] ${isSelected ? 'border-orange-500 bg-orange-50 ring-1 ring-orange-500' : 'border-gray-100 hover:border-gray-300 hover:shadow-md'}`}
                        >
                            {/* Checkbox for selection mode */}
                            {isSelectionMode ? (
                                <div className={`w-6 h-6 mr-4 rounded-lg border-2 flex items-center justify-center transition-colors shrink-0 ${isSelected ? 'bg-orange-500 border-orange-500 text-white' : 'border-gray-300 bg-white'}`}>
                                    <i className="fas fa-check text-[10px]"></i>
                                </div>
                            ) : (
                                <div className="w-10 h-10 mr-3 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 font-black text-sm shrink-0 uppercase border border-white shadow-sm">
                                    {group.customerName.charAt(0)}
                                </div>
                            )}

                            <div className="flex-grow min-w-0">
                                <h3 className="font-black text-gray-800 text-sm truncate uppercase">{group.customerName}</h3>
                                <p className="text-[11px] text-gray-400 font-bold font-mono">{group.customerPhone}</p>
                            </div>

                            <div className="text-right shrink-0">
                                <div className="text-base font-black text-red-600">
                                    {new Intl.NumberFormat('vi-VN', { notation: "compact", maximumFractionDigits: 1 }).format(group.totalAmount).replace('T', 'tr').replace('Tr', 'tr')}
                                </div>
                                <div className="flex justify-end gap-1 mt-1">
                                    <span className="bg-gray-100 text-gray-600 text-[9px] font-bold px-1.5 py-0.5 rounded">{group.orders.length} đơn</span>
                                    {group.daysOld > 3 && <span className="bg-red-100 text-red-600 text-[9px] font-bold px-1.5 py-0.5 rounded">{group.daysOld} ngày</span>}
                                </div>
                            </div>
                        </div>
                    );
                })
            )}
        </div>

        {/* Floating Bulk Action Bar */}
        {isSelectionMode && selectedGroupKeys.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 w-[90%] max-w-md bg-gray-900 text-white p-3 rounded-2xl shadow-2xl z-50 flex items-center justify-between animate-slide-up">
                <div className="flex items-center gap-3 pl-2">
                    <span className="font-black text-xl text-orange-500">{selectedGroupKeys.size}</span>
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase text-gray-400">Đã chọn</span>
                        <span className="text-xs font-bold">Khách hàng</span>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={() => { setIsSelectionMode(false); setSelectedGroupKeys(new Set()); }} className="w-10 h-10 rounded-xl bg-gray-800 text-gray-400 flex items-center justify-center hover:bg-gray-700"><i className="fas fa-times"></i></button>
                    <button onClick={handleBulkConfirm} className="px-4 h-10 rounded-xl bg-orange-600 text-white font-bold text-xs uppercase hover:bg-orange-700 flex items-center gap-2 shadow-lg">
                        <i className="fas fa-check-circle"></i> Xác nhận thu
                    </button>
                </div>
            </div>
        )}

        {/* Detail Modal */}
        {activeGroup && (
            <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setActiveGroup(null)}>
                <div className="bg-white w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-slide-up" onClick={e => e.stopPropagation()}>
                    {/* Header */}
                    <div className="p-5 bg-gray-50 border-b border-gray-100 relative">
                        <div className="text-center">
                            <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Tổng nợ phải thu</div>
                            <div className="text-3xl font-black text-red-600 tracking-tighter">
                                {new Intl.NumberFormat('vi-VN').format(activeGroup.totalAmount)}<span className="text-sm align-top text-red-400 ml-0.5">đ</span>
                            </div>
                        </div>
                        <div className="mt-4 bg-white p-3 rounded-xl border border-gray-100 flex items-center justify-between shadow-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center font-black text-gray-600 text-sm border border-white shadow-inner">
                                    {activeGroup.customerName.charAt(0)}
                                </div>
                                <div>
                                    <div className="font-black text-gray-900 uppercase text-sm">{activeGroup.customerName}</div>
                                    <div className="text-[10px] font-mono font-bold text-gray-500">{activeGroup.customerPhone}</div>
                                </div>
                            </div>
                            <a href={`tel:${activeGroup.customerPhone}`} className="w-9 h-9 rounded-full bg-green-50 text-green-600 flex items-center justify-center hover:bg-green-600 hover:text-white transition-all"><i className="fas fa-phone-alt text-xs"></i></a>
                        </div>
                        <button onClick={() => setActiveGroup(null)} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
                    </div>

                    {/* Order List */}
                    <div className="flex-grow overflow-y-auto p-4 bg-gray-50/50 space-y-3">
                        {activeGroup.orders.map((o, idx) => (
                            <div key={o.id} className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                                <div className="flex justify-between items-center mb-2 pb-2 border-b border-gray-50">
                                    <span className="font-black text-gray-800 text-xs">#{o.id}</span>
                                    <span className="text-[10px] font-bold text-gray-400">{new Date(o.createdAt).toLocaleDateString('vi-VN')} {o.batchId ? `• ${o.batchId}` : ''}</span>
                                </div>
                                <div className="space-y-1">
                                    {o.items.map((i, iIdx) => (
                                        <div key={iIdx} className="flex justify-between text-xs">
                                            <span className="text-gray-600 truncate mr-2">{i.name}</span>
                                            <span className="font-bold text-gray-900 whitespace-nowrap">x{i.quantity}</span>
                                        </div>
                                    ))}
                                </div>
                                <div className="mt-2 pt-2 border-t border-gray-50 text-right font-black text-sm text-red-500">
                                    {new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Actions Footer */}
                    <div className="p-4 bg-white border-t border-gray-100 space-y-3">
                        <button 
                            onClick={() => handleManualConfirm(activeGroup)}
                            className="w-full py-3.5 bg-gray-900 text-white rounded-xl font-bold text-sm uppercase shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                        >
                            <i className="fas fa-money-bill-wave text-green-400"></i> Xác nhận đã thu đủ tiền
                        </button>
                        <div className="grid grid-cols-3 gap-3">
                            <button onClick={() => handleZalo(activeGroup)} className="py-3 bg-blue-50 text-blue-600 rounded-xl font-bold text-xs hover:bg-blue-100 transition-colors uppercase">Zalo Nhắc</button>
                            <button onClick={() => handleSms(activeGroup)} className="py-3 bg-gray-100 text-gray-600 rounded-xl font-bold text-xs hover:bg-gray-200 transition-colors uppercase">SMS</button>
                            <button onClick={() => handleShareDebtQR(activeGroup)} className="py-3 bg-red-50 text-red-600 rounded-xl font-bold text-xs hover:bg-red-100 transition-colors uppercase">Gửi QR</button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Custom Confirmation Modal */}
        <ConfirmModal 
            isOpen={confirmation.isOpen}
            title={confirmation.title}
            message={confirmation.message}
            onConfirm={confirmation.onConfirm}
            onCancel={() => setConfirmation({...confirmation, isOpen: false})}
            confirmLabel="Xác nhận"
        />

        {/* Paste Modal */}
        {showPasteModal && (
            <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4 animate-fade-in">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
                    <div className="p-5 border-b border-gray-100 bg-gray-50">
                        <h3 className="font-black text-gray-900 uppercase">Smart Paste</h3>
                        <p className="text-xs text-gray-500 mt-1">Dán tin nhắn SMS/App Ngân hàng để đối soát tự động</p>
                    </div>
                    <div className="p-4">
                        <textarea 
                            className="w-full h-40 p-3 bg-gray-50 border-2 border-gray-200 rounded-xl outline-none focus:border-black font-medium text-sm resize-none"
                            placeholder="Ví dụ: Tài khoản ... biến động +150,000 VND. Nội dung: DH ABC12345..."
                            value={pasteText}
                            onChange={e => setPasteText(e.target.value)}
                            autoFocus
                        ></textarea>
                    </div>
                    <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-3">
                        <button onClick={() => setShowPasteModal(false)} className="flex-1 py-3 bg-white border border-gray-300 rounded-xl font-bold text-sm text-gray-600 hover:bg-gray-100">Hủy</button>
                        <button onClick={handleSmartPaste} className="flex-1 py-3 bg-black text-white rounded-xl font-bold text-sm hover:bg-gray-800 shadow-lg active:scale-95 transition-all">Quét & Khớp lệnh</button>
                    </div>
                </div>
            </div>
        )}

        {/* Reconciliation Confirm Modal */}
        {showReconcileModal && reconcileResult && (
            <div className="fixed inset-0 z-[110] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4 animate-fade-in">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                    <div className="p-5 bg-green-50 border-b border-green-100 text-center">
                        <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3 text-xl">
                            <i className="fas fa-check"></i>
                        </div>
                        <h3 className="font-black text-green-700 text-lg">Tìm thấy {reconcileResult.matchedOrders.length} đơn khớp!</h3>
                        <p className="text-xs text-green-600 mt-1">Tổng tiền: {new Intl.NumberFormat('vi-VN').format(reconcileResult.totalMatchedAmount)}đ</p>
                    </div>
                    <div className="max-h-60 overflow-y-auto p-4 bg-white space-y-2">
                        {reconcileResult.matchedOrders.map(o => (
                            <div key={o.id} className="flex justify-between items-center text-sm p-2 bg-gray-50 rounded-lg border border-gray-100">
                                <div>
                                    <div className="font-bold text-gray-800">#{o.id}</div>
                                    <div className="text-xs text-gray-500">{o.customerName}</div>
                                </div>
                                <div className="font-bold text-green-600">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ</div>
                            </div>
                        ))}
                    </div>
                    <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-3">
                        <button onClick={() => setShowReconcileModal(false)} className="flex-1 py-3 bg-white border border-gray-300 rounded-xl font-bold text-sm text-gray-600 hover:bg-gray-100">Bỏ qua</button>
                        <button onClick={confirmReconciliation} disabled={isReconciling} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold text-sm hover:bg-green-700 shadow-lg active:scale-95 transition-all">
                            {isReconciling ? 'Đang xử lý...' : 'Xác nhận Đã Thu'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* CELEBRATION MODAL */}
        {showSuccessModal && (
            <div className="fixed inset-0 z-[150] flex items-center justify-center bg-gray-900/90 backdrop-blur-md p-4 animate-fade-in" onClick={() => setShowSuccessModal(false)}>
                <div className="bg-white w-full max-w-sm rounded-[2.5rem] shadow-2xl overflow-hidden transform scale-100 transition-all p-8 text-center relative border-4 border-green-500" onClick={e => e.stopPropagation()}>
                    <div className="absolute inset-0 bg-green-50 opacity-50 pointer-events-none"></div>
                    <div className="relative z-10">
                        <div className="w-24 h-24 bg-green-100 text-green-500 rounded-full flex items-center justify-center text-5xl mx-auto mb-6 shadow-lg animate-bounce">
                            <i className="fas fa-trophy"></i>
                        </div>
                        <h2 className="text-3xl font-black text-gray-900 uppercase tracking-tighter mb-2 italic">Sạch nợ!</h2>
                        <p className="text-gray-500 font-bold text-sm mb-6">
                            Đã thu hoàn tất từ <span className="text-gray-900">{successData.count} khách hàng</span>.
                        </p>
                        <div className="bg-green-500 text-white p-4 rounded-2xl shadow-xl shadow-green-200 mb-6 transform -rotate-1">
                            <div className="text-xs font-bold uppercase tracking-widest opacity-80 mb-1">Tổng tiền đã thu</div>
                            <div className="text-4xl font-black tracking-tighter">
                                {new Intl.NumberFormat('vi-VN').format(successData.totalAmount)}<span className="text-lg align-top ml-1">đ</span>
                            </div>
                        </div>
                        <button 
                            onClick={() => setShowSuccessModal(false)}
                            className="w-full py-4 bg-gray-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg hover:bg-black transition-all active:scale-95"
                        >
                            Tuyệt vời <i className="fas fa-thumbs-up ml-2 text-yellow-400"></i>
                        </button>
                    </div>
                    {/* Decor Icons */}
                    <i className="fas fa-star text-yellow-400 text-xl absolute top-6 left-6 animate-spin-slow"></i>
                    <i className="fas fa-star text-yellow-400 text-2xl absolute bottom-12 right-6 animate-pulse"></i>
                    <i className="fas fa-check text-green-300 text-4xl absolute top-1/2 left-4 opacity-50 rotate-12"></i>
                </div>
            </div>
        )}
    </div>
  );
};

export default PaymentAudit;
