
import React, { useEffect, useState, useMemo, useRef, useDeferredValue, useCallback } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { Order, OrderStatus, PaymentMethod, OrderItem, Product, Customer, ShopConfig, BankConfig } from '../types';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { OrderCard } from './OrderCard';
import ConfirmModal from './ConfirmModal';
import RoutePlannerModal from './RoutePlannerModal'; 
import ShipperSummaryModal from './ShipperSummaryModal';
import { generateDeliveryMessage } from '../services/geminiService';
import { ProductDetailModal, ProductEditModal } from './InventoryManager';

type SortOption = 'NEWEST' | 'ROUTE' | 'STATUS';

const dataURLtoFile = (dataurl: string, filename: string) => {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)?.[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
};

const TrackingDashboard: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]); 
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [filterStatus, setFilterStatus] = useState<OrderStatus[]>([]);
  
  const [filterBatch, setFilterBatch] = useState<string[]>(() => {
      try {
          const saved = localStorage.getItem('ecogo_filter_batch');
          return saved ? JSON.parse(saved) : [];
      } catch {
          return [];
      }
  });

  useEffect(() => {
      localStorage.setItem('ecogo_filter_batch', JSON.stringify(filterBatch));
  }, [filterBatch]);

  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const [sortBy, setSortBy] = useState<SortOption>('NEWEST');
  const [isCompactMode, setIsCompactMode] = useState(false); 
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [activeEditProductRow, setActiveEditProductRow] = useState<number | null>(null); 
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const observerTarget = useRef<HTMLDivElement>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const editModalRef = useRef<HTMLDivElement>(null);
  const statusDropdownBtnRef = useRef<HTMLButtonElement>(null);
  const batchDropdownBtnRef = useRef<HTMLButtonElement>(null);
  const [activeDropdown, setActiveDropdown] = useState<'STATUS' | 'BATCH' | null>(null);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, width: 0 });

  const [isListeningSearch, setIsListeningSearch] = useState(false);

  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);

  const [isPrinting, setIsPrinting] = useState(false);
  const [printProgress, setPrintProgress] = useState(0); // NEW: Print progress state
  const [showBatchSplitModal, setShowBatchSplitModal] = useState(false);
  const [showPrintTypeModal, setShowPrintTypeModal] = useState(false);
  const [ordersToPrint, setOrdersToPrint] = useState<Order[]>([]);

  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showShipperSummary, setShowShipperSummary] = useState(false); // NEW: State for summary modal

  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProductMode, setEditProductMode] = useState<'IMPORT' | 'SET'>('SET');

  const [showRoutePlanner, setShowRoutePlanner] = useState(false);
  
  const [moveBatchData, setMoveBatchData] = useState<{isOpen: boolean, targetBatch: string}>({ isOpen: false, targetBatch: '' });
  const [qrState, setQrState] = useState<{ isOpen: boolean, url: string, order: Order | null }>({ isOpen: false, url: '', order: null });
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [visibleCount, setVisibleCount] = useState(20);

  // Sync Confirmation State
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [pendingProductUpdate, setPendingProductUpdate] = useState<Product | null>(null);
  
  // GPS Location State
  const [isGettingLocation, setIsGettingLocation] = useState(false);

  const qrImgRef = useRef<HTMLImageElement | null>(null);
  const shopConfigRef = useRef<ShopConfig | null>(null);
  const bankConfigRef = useRef<BankConfig | null>(null);

  const statusLabels: Record<OrderStatus, string> = { [OrderStatus.PENDING]: 'Chờ xử lý', [OrderStatus.PICKED_UP]: 'Đã lấy hàng', [OrderStatus.IN_TRANSIT]: 'Đang giao', [OrderStatus.DELIVERED]: 'Đã giao', [OrderStatus.CANCELLED]: 'Đã hủy' };

  useEffect(() => {
      const observer = new IntersectionObserver(
          ([entry]) => { setIsHeaderVisible(entry.isIntersecting); setActiveDropdown(null); },
          { threshold: 0, rootMargin: "-70px 0px 0px 0px" }
      );
      if (observerTarget.current) observer.observe(observerTarget.current);
      return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const unsubOrders = storageService.subscribeOrders(setOrders);
    const unsubProducts = storageService.subscribeProducts(setProducts);
    const unsubCustomers = storageService.subscribeCustomers(setCustomers);

    const handleWindowEvents = () => setActiveDropdown(null);
    window.addEventListener('resize', handleWindowEvents);
    window.addEventListener('scroll', handleWindowEvents, true);
    return () => { 
        if (unsubOrders) unsubOrders(); 
        if (unsubProducts) unsubProducts();
        if (unsubCustomers) unsubCustomers(); 
        window.removeEventListener('resize', handleWindowEvents); 
        window.removeEventListener('scroll', handleWindowEvents, true); 
    };
  }, []);

  useEffect(() => {
      if (qrState.isOpen && qrState.url) {
          storageService.getShopConfig().then(c => shopConfigRef.current = c);
          storageService.getBankConfig().then(c => bankConfigRef.current = c);
          const img = new Image();
          img.crossOrigin = "Anonymous";
          img.src = qrState.url;
          img.onload = () => {
              qrImgRef.current = img;
          };
      } else {
          qrImgRef.current = null;
      }
  }, [qrState.isOpen, qrState.url]);

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (activeEditProductRow !== null && !(event.target as Element).closest('.product-dropdown-container')) setActiveEditProductRow(null);
          if (activeDropdown) {
              const dropdownEl = document.getElementById('floating-dropdown-portal');
              const statusBtn = statusDropdownBtnRef.current;
              const batchBtn = batchDropdownBtnRef.current;
              if (dropdownEl && !dropdownEl.contains(event.target as Node) && statusBtn && !statusBtn.contains(event.target as Node) && batchBtn && !batchBtn.contains(event.target as Node)) setActiveDropdown(null);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeEditProductRow, activeDropdown]);

  const handleViewDetail = (order: Order) => {
      setDetailOrder(order);
  };

  const handleDeleteClick = useCallback((id: string) => { setDeleteId(id); setShowDeleteConfirm(true); }, []);
  const handleEdit = useCallback((order: Order) => { setEditingOrder(JSON.parse(JSON.stringify(order))); setActiveEditProductRow(null); setDetailOrder(null); }, []);
  const handleSplitBatch = useCallback(async (order: Order) => { await storageService.splitOrderToNextBatch(order.id, order.batchId); toast.success('Đã chuyển đơn sang lô sau!'); if(detailOrder?.id === order.id) setDetailOrder(null); }, [detailOrder]);

  const handleShowQR = useCallback(async (order: Order) => { 
      const bankConfig = await storageService.getBankConfig(); 
      if (!bankConfig || !bankConfig.accountNo) { 
          toast.error("Vui lòng cài đặt thông tin Ngân hàng trước."); 
          return; 
      }
      
      // XỬ LÝ TÊN KHÔNG DẤU (Giống logic trong PDF)
      let cleanName = normalizeString(order.customerName).toUpperCase();
      cleanName = cleanName.replace(/[^A-Z0-9 ]/g, '');
      if (cleanName.length > 25) {
          cleanName = cleanName.substring(0, 25).trim();
      }
      
      const desc = `DH ${order.id} ${cleanName}`; 
      const url = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template || 'compact2'}.png?amount=${order.totalPrice}&addInfo=${encodeURIComponent(desc)}&accountName=${encodeURIComponent(String(bankConfig.accountName))}`; 
      setQrState({ isOpen: true, url, order }); 
  }, []);

  const handleShareQR = async () => {
        if (!qrState.url || !qrState.order) return;
        const qrImg = qrImgRef.current;
        if (!qrImg) {
            toast.error("Đang tải ảnh QR, vui lòng đợi giây lát và thử lại.");
            return;
        }
        const toastId = toast.loading("Đang tạo ảnh chi tiết...", { position: 'bottom-center' });
        try {
            const shopConfig = shopConfigRef.current;
            const bankConfig = bankConfigRef.current;
            const order = qrState.order;
            
            const W = 800;
            const cardMargin = 40; 
            const contentW = W - (cardMargin * 2);
            const qrNatW = qrImg.naturalWidth || 1;
            const qrNatH = qrImg.naturalHeight || 1;
            const qrRatio = qrNatH / qrNatW;
            const qrDisplayW = 400; 
            const qrDisplayH = qrDisplayW * qrRatio;
            const headerHeight = 260; 
            const qrSectionHeight = qrDisplayH + 60; 
            const infoBoxPadding = 40;
            const infoContentW = contentW - (infoBoxPadding * 2);
            const lineHeight = 50;
            const generalInfoHeight = 140; 
            const itemsHeight = (order.items.length * lineHeight) + 80; 
            const infoBoxH = generalInfoHeight + itemsHeight;
            const footerHeight = 140;
            const H = cardMargin + headerHeight + qrSectionHeight + infoBoxH + footerHeight + cardMargin;

            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error("Canvas error");
            canvas.width = W;
            canvas.height = H;

            ctx.fillStyle = '#F8FAFC'; ctx.fillRect(0, 0, W, H);
            const cardX = cardMargin; const cardY = cardMargin;
            ctx.shadowColor = "rgba(0, 0, 0, 0.1)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 15;
            ctx.fillStyle = '#FFFFFF';
            if ((ctx as any).roundRect) { ctx.beginPath(); (ctx as any).roundRect(cardX, cardY, contentW, H - (cardMargin * 2), 40); ctx.fill(); } else { ctx.fillRect(cardX, cardY, contentW, H - (cardMargin * 2)); }
            ctx.shadowColor = "transparent"; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

            let cursorY = cardY + 80;
            const shopName = (shopConfig?.shopName || 'ECOGO LOGISTICS').toUpperCase();
            ctx.fillStyle = '#15803D'; ctx.font = 'bold 40px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(shopName, W / 2, cursorY); cursorY += 50;
            ctx.fillStyle = '#94A3B8'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillText('PHIẾU THANH TOÁN', W / 2, cursorY); cursorY += 70;
            ctx.fillStyle = '#15803D'; ctx.font = 'bold 80px Arial, sans-serif'; ctx.fillText(`${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ`, W / 2, cursorY); cursorY += 60;
            const qrX = (W - qrDisplayW) / 2; ctx.drawImage(qrImg, qrX, cursorY, qrDisplayW, qrDisplayH); cursorY += qrDisplayH + 50;
            const boxX = cardX + 20; const boxW = contentW - 40;
            ctx.fillStyle = '#F1F5F9'; 
            if ((ctx as any).roundRect) { ctx.beginPath(); (ctx as any).roundRect(boxX, cursorY, boxW, infoBoxH, 24); ctx.fill(); } else { ctx.fillRect(boxX, cursorY, boxW, infoBoxH); }
            let textY = cursorY + 50; const leftX = boxX + 40; const rightX = boxX + boxW - 40;
            const drawLabelValue = (label: string, value: string, isBoldValue = true) => {
                ctx.textAlign = 'left'; ctx.font = 'normal 24px Arial, sans-serif'; ctx.fillStyle = '#64748B'; ctx.fillText(label, leftX, textY);
                ctx.textAlign = 'right'; ctx.font = isBoldValue ? 'bold 24px Arial, sans-serif' : 'normal 24px Arial, sans-serif'; ctx.fillStyle = '#0F172A';
                const labelW = ctx.measureText(label).width; const valueMaxW = (rightX - leftX) - labelW - 40;
                let displayVal = value;
                if (ctx.measureText(displayVal).width > valueMaxW) { let len = displayVal.length; while (ctx.measureText(displayVal + '...').width > valueMaxW && len > 0) { len--; displayVal = displayVal.substring(0, len); } displayVal += '...'; }
                ctx.fillText(displayVal, rightX, textY); textY += lineHeight;
            };
            drawLabelValue('Mã đơn hàng', `#${order.id}`);
            drawLabelValue('Người nhận', order.customerName);
            textY += 20;
            ctx.beginPath(); ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]); ctx.moveTo(leftX, textY); ctx.lineTo(rightX, textY); ctx.stroke(); ctx.setLineDash([]); textY += 40;
            ctx.textAlign = 'left'; ctx.fillStyle = '#334155'; ctx.font = 'bold 22px Arial, sans-serif'; ctx.fillText('Chi tiết đơn hàng:', leftX, textY); textY += 40;
            order.items.forEach(item => {
                ctx.textAlign = 'right'; ctx.font = 'bold 24px Arial, sans-serif'; ctx.fillStyle = '#0F172A'; const qtyText = `x${item.quantity}`; ctx.fillText(qtyText, rightX, textY); const qtyWidth = ctx.measureText(qtyText).width;
                ctx.textAlign = 'left'; ctx.font = 'normal 24px Arial, sans-serif'; ctx.fillStyle = '#1E293B'; const maxNameWidth = (rightX - leftX) - qtyWidth - 30; let nameToDraw = item.name;
                if (ctx.measureText(nameToDraw).width > maxNameWidth) { let len = nameToDraw.length; while (ctx.measureText(nameToDraw + '...').width > maxNameWidth && len > 0) { len--; nameToDraw = nameToDraw.substring(0, len); } nameToDraw += '...'; }
                ctx.fillText(nameToDraw, leftX, textY); textY += lineHeight;
            });
            cursorY += infoBoxH + 50;
            if (bankConfig) {
                ctx.textAlign = 'center'; ctx.fillStyle = '#64748B'; ctx.font = 'italic 20px Arial, sans-serif';
                const bankLine1 = `Ngân hàng: ${bankConfig.bankId} - ${bankConfig.accountNo}`; const bankLine2 = `Chủ TK: ${bankConfig.accountName}`;
                ctx.fillText(bankLine1, W / 2, cursorY); ctx.fillText(bankLine2, W / 2, cursorY + 30);
            }
            const dataUrl = canvas.toDataURL('image/png');
            const file = dataURLtoFile(dataUrl, `pay-${order.id}.png`);
            if (navigator.share) { await navigator.share({ files: [file], title: `Thanh toán #${order.id}`, text: `Chi tiết thanh toán đơn hàng ${order.customerName}` }); toast.success("Đã mở chia sẻ!"); } 
            else { const a = document.createElement('a'); a.href = dataUrl; a.download = `pay-${order.id}.png`; a.click(); toast.success("Đã tải ảnh xuống"); }
            toast.dismiss(toastId);
        } catch (e: any) { console.error(e); toast.dismiss(toastId); toast.error("Lỗi: " + e.message); }
    };

  const handlePinCurrentLocation = () => {
      if (!detailOrder) return;
      if (!navigator.geolocation) {
          toast.error("Trình duyệt không hỗ trợ định vị");
          return;
      }
      setIsGettingLocation(true);
      navigator.geolocation.getCurrentPosition(async (position) => {
          const { latitude, longitude } = position.coords;
          try {
              // Sử dụng OpenStreetMap Nominatim để lấy địa chỉ (Miễn phí)
              const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}&zoom=18&addressdetails=1`);
              const data = await response.json();
              if (data && data.display_name) {
                  const newAddress = data.display_name;
                  
                  // 1. Cập nhật Khách hàng (Ghim & Xác thực)
                  const customer = customers.find(c => c.id === detailOrder.customerId) || storageService.findMatchingCustomer(detailOrder.customerPhone, detailOrder.address, detailOrder.customerId);
                  if (customer) {
                      await storageService.upsertCustomer({
                          ...customer,
                          address: newAddress,
                          isAddressVerified: true,
                          updatedAt: Date.now()
                      });
                  }

                  // 2. Cập nhật Đơn hàng hiện tại
                  const updatedOrder = { ...detailOrder, address: newAddress };
                  await storageService.updateOrderDetails(updatedOrder);
                  setDetailOrder(updatedOrder); // Cập nhật UI ngay lập tức

                  toast.success("Đã ghim vị trí chính xác!", { icon: '📍' });
              } else {
                  toast.error("Không tìm thấy địa chỉ từ tọa độ này");
              }
          } catch (e) {
              toast.error("Lỗi lấy địa chỉ bản đồ");
          } finally {
              setIsGettingLocation(false);
          }
      }, (error) => {
          console.error(error);
          toast.error("Không thể lấy vị trí. Hãy bật GPS và cấp quyền.");
          setIsGettingLocation(false);
      }, { enableHighAccuracy: true });
  };

  const handleDetailAction = {
      call: () => window.open(`tel:${detailOrder?.customerPhone}`, '_self'),
      sms: async () => { if(detailOrder) { const msg = await generateDeliveryMessage(detailOrder); const ua = navigator.userAgent.toLowerCase(); const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1; const separator = isIOS ? '&' : '?'; window.open(`sms:${detailOrder.customerPhone}${separator}body=${encodeURIComponent(msg)}`, '_self'); } },
      zalo: () => { if(detailOrder) window.open(`https://zalo.me/${detailOrder.customerPhone.replace(/^0/,'84')}`, '_blank'); },
      print: () => { if(detailOrder) { const printWindow = window.open('', '_blank'); if (!printWindow) return; const itemsStr = detailOrder.items.map(i => `<tr><td style="padding:8px;border:1px solid #000;font-weight:bold;">${i.name}</td><td style="padding:8px;border:1px solid #000;text-align:center;">${i.quantity}</td><td style="padding:8px;border:1px solid #000;text-align:right;">${new Intl.NumberFormat('vi-VN').format(i.price)}</td><td style="padding:8px;border:1px solid #000;text-align:right;font-weight:bold;">${new Intl.NumberFormat('vi-VN').format(i.price * i.quantity)}</td></tr>`).join(''); const htmlContent = `<html><head><title>Phiếu #${detailOrder.id}</title><style>body { font-family: 'Helvetica', sans-serif; padding: 20px; font-size: 14px; color: #000; }h2 { text-align:center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }table { width: 100%; border-collapse: collapse; margin-top: 20px; }th { border: 1px solid #000; padding: 10px; background: #fff; text-align: left; font-weight: bold; text-transform: uppercase; }.info { margin-bottom: 5px; font-size: 15px; }.label { display:inline-block; width: 80px; font-weight: bold; }.total-row td { border-top: 2px solid #000; font-size: 16px; font-weight: bold; padding: 15px 5px; }</style></head><body><h2>PHIẾU GIAO HÀNG #${detailOrder.id}</h2><div class="info"><span class="label">Khách:</span> <b>${detailOrder.customerName}</b></div><div class="info"><span class="label">SĐT:</span> ${detailOrder.customerPhone}</div><div class="info"><span class="label">Địa chỉ:</span> ${detailOrder.address}</div>${detailOrder.notes ? `<div class="info" style="margin-top:10px;font-style:italic;">Ghi chú: ${detailOrder.notes}</div>` : ''}<table><thead><tr><th>Sản phẩm</th><th style="width:50px;text-align:center;">SL</th><th style="text-align:right;">Đơn giá</th><th style="text-align:right;">Thành tiền</th></tr></thead><tbody>${itemsStr}<tr class="total-row"><td colspan="3" style="text-align:right;">TỔNG CỘNG:</td><td style="text-align:right;">${new Intl.NumberFormat('vi-VN').format(detailOrder.totalPrice)}đ</td></tr></tbody></table><div style="margin-top: 40px; border-top: 1px dashed #000; padding-top: 10px; text-align: center; font-size: 12px; font-style: italic;">Cảm ơn quý khách!</div></body></html>`; printWindow.document.write(htmlContent); printWindow.document.close(); printWindow.print(); } },
      delete: () => { if(detailOrder) { handleDeleteClick(detailOrder.id); setDetailOrder(null); } },
      edit: () => { if(detailOrder) { setEditingOrder(JSON.parse(JSON.stringify(detailOrder))); setDetailOrder(null); } },
      setStatus: async (status: OrderStatus) => { if(detailOrder) { await storageService.updateStatus(detailOrder.id, status, undefined, {name: detailOrder.customerName, address: detailOrder.address}); setDetailOrder({...detailOrder, status}); } },
      confirmPayment: async ( ) => { if(detailOrder) { await storageService.updatePaymentVerification(detailOrder.id, true, { name: detailOrder.customerName }); setDetailOrder({...detailOrder, paymentVerified: true}); toast.success("Đã xác nhận thanh toán"); } },
      splitBatch: () => { if(detailOrder) { handleSplitBatch(detailOrder); } },
      showQR: () => { if(detailOrder) handleShowQR(detailOrder); }
  };

  const toggleFilter = (type: 'STATUS' | 'BATCH', value: any) => { 
      if (type === 'STATUS') { 
          const statusValue = value as OrderStatus; 
          setFilterStatus(prev => { 
              if (prev.includes(statusValue)) { 
                  return prev.filter(s => s !== statusValue); 
              } 
              return [...prev, statusValue]; 
          }); 
      } 
      if (type === 'BATCH') { 
          const batchValue = String(value); 
          setFilterBatch(prev => { 
              if (prev.includes(batchValue)) { 
                  return prev.filter(b => b !== batchValue); 
              } 
              return [...prev, batchValue]; 
          }); 
      } 
  };

  const getLabel = (type: 'STATUS' | 'BATCH') => { 
      if (type === 'STATUS') return filterStatus.length === 0 ? 'Trạng thái' : (filterStatus.length === 1 ? statusLabels[filterStatus[0]] : `Đã chọn (${filterStatus.length})`); 
      if (type === 'BATCH') return filterBatch.length === 0 ? 'Lô: Tất cả' : (filterBatch.length === 1 ? filterBatch[0] : `Lô (${filterBatch.length})`); 
      return ''; 
  };

  const openDropdown = (type: 'STATUS' | 'BATCH') => { 
      const ref = type === 'STATUS' ? statusDropdownBtnRef : batchDropdownBtnRef; 
      if (ref.current) { 
          const rect = ref.current.getBoundingClientRect(); 
          setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) }); 
          setActiveDropdown(activeDropdown === type ? null : type); 
      } 
  };

  const batches = useMemo(() => {
    const batchActivity = new Map<string, number>();
    orders.forEach(o => { if (o.batchId) batchActivity.set(o.batchId, Math.max(batchActivity.get(o.batchId) || 0, o.createdAt)); });
    return Array.from(batchActivity.entries()).sort((a, b) => b[1] - a[1]).map(entry => entry[0]).slice(0, 50);
  }, [orders]);

  const customerMap = useMemo(() => {
      const map = new Map<string, Customer>();
      customers.forEach(c => map.set(c.id, c));
      return map;
  }, [customers]);

  const findCustomerForOrder = (order: Order): Customer | undefined => {
      if (order.customerId && customerMap.has(order.customerId)) {
          return customerMap.get(order.customerId);
      }
      return storageService.findMatchingCustomer(order.customerPhone, order.address, order.customerId);
  };

  const filteredOrders = useMemo(() => {
    let result = orders.filter(o => {
      const statusMatch = filterStatus.length === 0 || filterStatus.includes(o.status);
      const batchMatch = filterBatch.length === 0 || (o.batchId && filterBatch.includes(o.batchId));
      if (!statusMatch || !batchMatch) return false;
      if (!deferredSearchTerm) return true;
      const term = normalizeString(deferredSearchTerm);
      return normalizeString(o.customerName).includes(term) || 
             normalizePhone(o.customerPhone).includes(term) || 
             normalizeString(o.address).includes(term) ||
             o.items.some(i => normalizeString(i.name).includes(term));
    });
    if (sortBy === 'NEWEST') return result.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    if (sortBy === 'STATUS') return result.sort((a, b) => a.status.localeCompare(b.status));
    if (sortBy === 'ROUTE') return result.sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
    return result;
  }, [orders, filterStatus, filterBatch, deferredSearchTerm, sortBy]);

  const batchStatsData = useMemo(() => {
      const statsMap = new Map<string, { name: string, qtyOrdered: number, productInfo?: Product }>();
      const targetOrders = filterBatch.length > 0 ? orders.filter(o => o.batchId && filterBatch.includes(o.batchId)) : orders;
      targetOrders.filter(o => o.status !== OrderStatus.CANCELLED).forEach(o => {
          o.items.forEach(item => {
              const name = item.name.trim();
              if (name) {
                  const current = statsMap.get(name) || { name, qtyOrdered: 0 };
                  current.qtyOrdered += item.quantity;
                  statsMap.set(name, current);
              }
          });
      });
      const result = Array.from(statsMap.values()).map(item => {
          const normName = normalizeString(item.name);
          const product = products.find(p => normalizeString(p.name) === normName) || products.find(p => normalizeString(p.name).includes(normName));
          return { ...item, productInfo: product };
      });
      return result.sort((a, b) => a.name.localeCompare(b.name));
  }, [orders, products, filterBatch]); 

  const handleOpenStats = () => { setShowStatsModal(true); };
  const handleShareStats = () => {
      const batchTitle = filterBatch.length > 0 ? filterBatch.join(', ') : "TẤT CẢ";
      let text = `📦 TK LÔ: ${batchTitle}\n----------------\n`;
      text += `MẶT HÀNG | ĐẶT | KHO | DƯ\n`;
      batchStatsData.forEach(item => {
          const imported = item.productInfo?.totalImported || 0;
          const balance = imported - item.qtyOrdered;
          text += `${item.name}: ${item.qtyOrdered} | ${imported} | ${balance > 0 ? '+' : ''}${balance}\n`;
      });
      text += `----------------\nEcoGo Logistics`;
      if (navigator.share) { navigator.share({ title: `TK ${batchTitle}`, text }).catch(console.error); } else { navigator.clipboard.writeText(text); toast.success("Đã copy thống kê!"); }
  };
  
  const handleQuickEditProduct = (product: Product) => { setViewingProduct(product); };
  
  const handleSaveProductChange = async (productData: Product, isImport: boolean = false, qty: number = 0) => {
        if (isImport && editingProduct) {
             // Logic nhập hàng (nếu được gọi từ context này)
             await storageService.adjustStockAtomic(editingProduct.id, qty, { price: productData.importPrice || 0, note: 'Nhập hàng từ Tracking' });
             if (productData.name !== editingProduct.name || productData.defaultPrice !== editingProduct.defaultPrice) {
                 await storageService.saveProduct({ ...editingProduct, name: productData.name, defaultPrice: productData.defaultPrice, importPrice: productData.importPrice });
             }
             toast.success("Đã nhập hàng");
             setEditingProduct(null);
        } else {
            // Logic sửa thông tin - hỏi đồng bộ
            await storageService.saveProduct(productData);
            setEditingProduct(null);
            
            // Set state to trigger confirmation
            setPendingProductUpdate(productData);
            setShowSyncConfirm(true);
        }
  };

  const handleConfirmSync = async () => {
        if (pendingProductUpdate) {
            const count = await storageService.syncProductToPendingOrders(pendingProductUpdate);
            if (count > 0) {
                toast.success(`Đã đồng bộ cho ${count} đơn hàng chờ.`);
            } else {
                toast("Không có đơn chờ nào cần cập nhật.");
            }
        }
        setShowSyncConfirm(false);
        setPendingProductUpdate(null);
        
        // Cập nhật lại modal xem chi tiết nếu đang mở
        if (pendingProductUpdate && viewingProduct && viewingProduct.id === pendingProductUpdate.id) {
            setViewingProduct(pendingProductUpdate);
        }
  };

  const handleLoadMore = () => { setVisibleCount(prev => prev + 20); };
  const visibleOrders = filteredOrders.slice(0, visibleCount);

  const handleLongPress = useCallback((id: string) => { setIsSelectionMode(true); setSelectedOrderIds(new Set([id])); if (navigator.vibrate) navigator.vibrate(50); }, []);
  const toggleSelectOrder = useCallback((id: string) => { setSelectedOrderIds(prev => { const newSet = new Set(prev); if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); } if (newSet.size > 0 && !isSelectionMode) { setIsSelectionMode(true); } else if (newSet.size === 0) { setIsSelectionMode(false); } return newSet; }); }, [isSelectionMode]);
  const clearSelection = () => { setIsSelectionMode(false); setSelectedOrderIds(new Set()); };
  
  const executeBulkDelete = async () => { if (selectedOrderIds.size === 0) return; const ids = Array.from(selectedOrderIds) as string[]; const restorationMap = new Map<string, number>(); ids.forEach(id => { const order = orders.find(o => o.id === id); if (order) { order.items.forEach(item => { if (item.productId) { const current = restorationMap.get(item.productId) || 0; restorationMap.set(item.productId, current + (Number(item.quantity) || 0)); } }); } }); for (const [prodId, qty] of restorationMap.entries()) { const product = products.find(p => p.id === prodId); if (product) { const currentStock = Number(product.stockQuantity) || 0; await storageService.saveProduct({ ...product, stockQuantity: currentStock + qty }); } } await storageService.deleteOrdersBatch(ids); toast.success(`Đã xóa ${ids.length} đơn hàng & Hoàn kho`); clearSelection(); setShowBulkDeleteConfirm(false); };
  const executeBulkSplit = async () => { if (selectedOrderIds.size === 0) return; const ordersToSplit = orders.filter(o => selectedOrderIds.has(o.id)); await storageService.splitOrdersBatch(ordersToSplit.map(o => ({ id: o.id, batchId: o.batchId }))); toast.success(`Đã chuyển ${selectedOrderIds.size} đơn sang lô sau`); clearSelection(); };
  const executeBulkPrint = () => { if (selectedOrderIds.size === 0) return; const toPrint = orders.filter(o => selectedOrderIds.has(o.id)); setOrdersToPrint(toPrint); setShowPrintTypeModal(true); };
  const executeBulkStatusUpdate = async (status: OrderStatus) => { if (selectedOrderIds.size === 0) return; const ids = Array.from(selectedOrderIds) as string[]; const promises = ids.map(id => storageService.updateStatus(id, status)); await Promise.all(promises); toast.success(`Đã cập nhật ${ids.length} đơn sang ${statusLabels[status]}`); setShowBulkStatusModal(false); clearSelection(); };
  const handleBulkMoveBatch = () => { if (selectedOrderIds.size === 0) return; setMoveBatchData({ isOpen: true, targetBatch: '' }); };
  const handleSingleMoveBatch = useCallback((order: Order) => { setIsSelectionMode(true); setSelectedOrderIds(new Set([order.id])); setMoveBatchData({ isOpen: true, targetBatch: order.batchId || '' }); }, []);
  const confirmMoveBatch = async () => { if (!moveBatchData.targetBatch.trim()) { toast.error("Vui lòng nhập tên lô hàng"); return; } const ids = Array.from(selectedOrderIds) as string[]; await storageService.moveOrdersBatch(ids, moveBatchData.targetBatch); toast.success(`Đã chuyển ${ids.length} đơn sang lô: ${moveBatchData.targetBatch}`); setMoveBatchData({ isOpen: false, targetBatch: '' }); clearSelection(); };
  
  const handleBulkRefreshProducts = async () => {
      if (selectedOrderIds.size === 0) return;
      const ids = Array.from(selectedOrderIds) as string[];
      try {
          const count = await storageService.refreshOrdersFromInventory(ids);
          toast.success(`Đã cập nhật thông tin SP cho ${count} đơn hàng!`);
          clearSelection();
      } catch (e) {
          toast.error("Lỗi cập nhật sản phẩm");
      }
  };

  const doVoiceSearch = () => {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) { toast.error("Trình duyệt không hỗ trợ"); return; }
      const recognition = new SpeechRecognition();
      recognition.lang = 'vi-VN';
      recognition.onstart = () => setIsListeningSearch(true);
      recognition.onend = () => setIsListeningSearch(false);
      recognition.onresult = (event: any) => { const text = event.results?.[0]?.[0]?.transcript; if (text) { setSearchTerm(text); toast.success(`Đã tìm: "${text}"`); } };
      recognition.start();
  };

  const handleRenameBatch = async () => { if (filterBatch.length !== 1) return; const oldName = String(filterBatch[0]); const newName = prompt(`Nhập tên mới cho lô: ${oldName}`, oldName); if (newName && newName !== oldName) { await storageService.renameBatch(oldName, newName); toast.success(`Đã đổi tên lô thành: ${newName}`); setFilterBatch([newName]); } };

  const confirmDelete = async () => { if (deleteId) { const id = deleteId as string; const orderToDelete = orders.find(o => o.id === id); if (orderToDelete) { for (const item of orderToDelete.items) { if (item.productId) { const product = products.find(p => p.id === item.productId); if (product) { const currentStock = Number(product.stockQuantity) || 0; const restoreQty = Number(item.quantity) || 0; await storageService.saveProduct({ ...product, stockQuantity: currentStock + restoreQty }); } } } await storageService.deleteOrder(id, { name: orderToDelete.customerName, address: orderToDelete.address }); } toast.success('Đã xóa đơn & Hoàn kho'); setShowDeleteConfirm(false); setDeleteId(null); if(detailOrder?.id === id) setDetailOrder(null); } };
  
  const saveEdit = async (e: React.FormEvent) => { e.preventDefault(); if (editingOrder) { await storageService.updateOrderDetails(editingOrder); setEditingOrder(null); toast.success('Đã lưu thay đổi'); } };
  const updateEditItem = (index: number, field: keyof OrderItem, value: any) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems[index] = { ...newItems[index], [field]: value }; if (field === 'name') newItems[index].productId = undefined; const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  
  const selectProductForEditItem = (index: number, product: Product) => { 
      if (!editingOrder) return; 
      const newItems = [...editingOrder.items]; 
      newItems[index] = { 
          ...newItems[index], 
          productId: product.id, 
          name: product.name, 
          price: product.defaultPrice,
          importPrice: product.importPrice 
      }; 
      const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); 
      setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); 
      setActiveEditProductRow(null); 
  };

  const addEditItem = () => { if (!editingOrder) return; const newItems = [...editingOrder.items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]; setEditingOrder({ ...editingOrder, items: newItems }); };
  const removeEditItem = (index: number) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems.splice(index, 1); const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  
  const handleSmartRouteSort = async (sortedOrders: Order[]) => { const reindexed = sortedOrders.map((o, idx) => ({ ...o, orderIndex: idx })); await storageService.saveOrdersList(reindexed); setOrders(prev => { const orderMap = new Map(prev.map(o => [o.id, o])); reindexed.forEach(ro => { if(orderMap.has(ro.id)) { orderMap.set(ro.id, ro); } }); return Array.from(orderMap.values()); }); setSortBy('ROUTE'); };
  const saveReorderedList = async (newSortedList: Order[]) => { const reindexedList = newSortedList.map((o, idx) => ({ ...o, orderIndex: idx })); const newMainOrders = orders.map(o => { const found = reindexedList.find(ro => ro.id === o.id); return found ? found : o; }); setOrders(newMainOrders); await storageService.saveOrdersList(reindexedList); await storageService.learnRoutePriority(reindexedList); toast.success("Đã học lộ trình mới!", { icon: '🧠', duration: 2000 }); };
  
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>, position: number) => { if (sortBy !== 'ROUTE') return; dragItem.current = position; e.currentTarget.closest('.order-row')?.classList.add('opacity-50', 'bg-yellow-50'); }, [sortBy]);
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => { if (sortBy !== 'ROUTE') return; if (dragItem.current === null) return; const touch = e.touches[0]; const element = document.elementFromPoint(touch.clientX, touch.clientY); const row = element?.closest('[data-index]'); if (row) { const newIndex = parseInt(row.getAttribute('data-index') || '-1'); if (newIndex !== -1 && newIndex !== dragItem.current) { const _orders = [...visibleOrders]; const draggedItemContent = _orders[dragItem.current]; _orders.splice(dragItem.current, 1); _orders.splice(newIndex, 0, draggedItemContent); dragItem.current = newIndex; saveReorderedList(_orders); } } }, [sortBy, visibleOrders]);
  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>,) => { dragItem.current = null; document.querySelectorAll('.order-row').forEach(r => r.classList.remove('opacity-50', 'bg-yellow-50')); }, []);
  
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => { 
      dragItem.current = index; 
      e.currentTarget.closest('.order-row')?.classList.add('opacity-40', 'scale-95'); 
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; 
  };
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, index: number) => { 
      dragOverItem.current = index; 
      e.preventDefault(); 
  };
  
  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => { 
      e.currentTarget.closest('.order-row')?.classList.remove('opacity-40', 'scale-95'); 
      if (dragItem.current !== null && dragOverItem.current !== null && sortBy === 'ROUTE') { 
          const _orders = [...visibleOrders]; 
          const draggedItemContent = _orders[dragItem.current]; 
          _orders.splice(dragItem.current, 1); 
          _orders.splice(dragOverItem.current, 0, draggedItemContent); 
          saveReorderedList(_orders); 
      } 
      dragItem.current = null; 
      dragOverItem.current = null; 
  };

  const handleBatchPrintClick = () => { if (filteredOrders.length === 0) { toast.error("Không có đơn hàng nào để in"); return; } setOrdersToPrint(filteredOrders); if (filteredOrders.length > 200) { setShowBatchSplitModal(true); } else { setShowPrintTypeModal(true); } };
  
  // UPDATED: Print Handler with Progress
  const handlePrintConfirm = async (type: 'LIST' | 'INVOICE') => { 
      setShowPrintTypeModal(false); 
      setShowBatchSplitModal(false); 
      setIsPrinting(true); 
      setPrintProgress(0); // Reset progress

      const batchName = filterBatch.length === 1 ? filterBatch[0] : `Batch_${new Date().getTime()}`; 
      
      try { 
          if (type === 'LIST') { 
              await pdfService.generateCompactList(ordersToPrint, batchName, (p) => setPrintProgress(p)); 
          } else { 
              await pdfService.generateInvoiceBatch(ordersToPrint, batchName, (p) => setPrintProgress(p)); 
          } 
          toast.success("Đã tạo file PDF!"); 
          if (isSelectionMode) clearSelection(); 
      } catch (e: any) { 
          console.error(e); 
          const errorMessage = e instanceof Error ? e.message : String(e); 
          toast.error(`Lỗi tạo PDF: ${errorMessage}`); 
      } finally { 
          setIsPrinting(false); 
          setPrintProgress(0);
          setOrdersToPrint([]); 
      } 
  };
  
  const prepareSplitPrint = (subset: Order[]) => { setOrdersToPrint(subset); setShowBatchSplitModal(false); setShowPrintTypeModal(true); };
  
  const handleConfirmQrPayment = async () => { if (qrState.order) { await storageService.updatePaymentVerification(qrState.order.id, true, { name: qrState.order.customerName }); toast.success("Đã xác nhận thanh toán!"); setQrState(prev => ({ ...prev, isOpen: false })); if(detailOrder?.id === qrState.order.id) { setDetailOrder({...detailOrder, paymentVerified: true}); } } };
  
  return (
    <div className="animate-fade-in pb-32">
      {/* PRINT PROGRESS OVERLAY */}
      {isPrinting && (
          <div className="fixed inset-0 z-[9999] bg-black/80 flex flex-col items-center justify-center p-6 animate-fade-in">
              <div className="bg-white rounded-2xl p-6 w-full max-w-sm text-center shadow-2xl">
                  <div className="w-16 h-16 border-4 border-eco-200 border-t-eco-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <h3 className="font-black text-xl text-gray-900 mb-2">Đang xử lý PDF</h3>
                  <p className="text-gray-500 text-sm mb-4">Vui lòng không tắt trình duyệt...</p>
                  
                  {/* Progress Bar */}
                  <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden relative">
                      <div 
                          className="h-full bg-eco-500 transition-all duration-300 ease-out flex items-center justify-end pr-2"
                          style={{ width: `${printProgress}%` }}
                      >
                      </div>
                  </div>
                  <div className="mt-2 font-black text-eco-600">{printProgress}%</div>
              </div>
          </div>
      )}

      <div className="sticky top-16 z-30 bg-gray-50/95 backdrop-blur-sm transition-shadow shadow-sm">
         {/* ... (Existing Toolbar Code) ... */}
         <div className="bg-white border-b border-gray-200 p-2 shadow-sm">
             <div className="flex gap-2 items-center mb-2">
                <div className="relative flex-grow">
                    <i className="fas fa-search absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                    <input 
                        placeholder="Tìm tên, sđt, địa chỉ, hàng hóa..." 
                        value={searchTerm} 
                        onChange={e => setSearchTerm(e.target.value)} 
                        className="w-full pl-9 pr-9 py-2 rounded-lg bg-gray-100 border-transparent focus:bg-white focus:ring-2 focus:ring-eco-100 text-sm font-medium outline-none transition-all text-gray-800" 
                    />
                    <button 
                        onClick={doVoiceSearch}
                        className={`absolute right-2 top-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isListeningSearch ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-eco-600 hover:bg-gray-200'}`}
                        title="Tìm bằng giọng nói"
                    >
                        <i className={`fas ${isListeningSearch ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                    </button>
                </div>
                <button onClick={() => setIsCompactMode(!isCompactMode)} className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg border transition-all ${isCompactMode ? 'bg-eco-100 text-eco-700 border-eco-200' : 'bg-white text-gray-400 border-gray-200'}`} aria-label={isCompactMode ? "Chế độ lưới" : "Chế độ danh sách"}><i className={`fas ${isCompactMode ? 'fa-list' : 'fa-th-large'}`}></i></button>
                <button onClick={handleBatchPrintClick} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-blue-600 border border-gray-200" title="In Lô Hàng" aria-label="In lô hàng"><i className="fas fa-print"></i></button>
                
                {/* NEW: Shipper Summary Button */}
                <button onClick={() => setShowShipperSummary(true)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-green-600 border border-gray-200" title="Tổng kết Shipper" aria-label="Tổng kết"><i className="fas fa-calculator"></i></button>
                
                <button onClick={handleOpenStats} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-purple-600 border border-gray-200" title="Thống kê Lô" aria-label="Thống kê"><i className="fas fa-cubes"></i></button>
             </div>
             <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isHeaderVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                <div className="overflow-hidden">
                    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                        <div className="relative flex-1 min-w-[100px] flex items-center gap-1">
                             <button ref={batchDropdownBtnRef} onClick={() => openDropdown('BATCH')} className="flex-grow pl-2 pr-6 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs font-bold text-gray-700 text-left flex items-center justify-between outline-none truncate" aria-label="Chọn lô hàng">
                                 <span className="truncate">{getLabel('BATCH')}</span>
                                 <i className="fas fa-chevron-down text-gray-400 text-[10px]"></i>
                             </button>
                             {filterBatch.length === 1 && (
                                 <button 
                                     onClick={handleRenameBatch} 
                                     className="w-7 h-7 flex-shrink-0 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-300 flex items-center justify-center transition-colors" 
                                     title="Đổi tên Lô"
                                     aria-label="Đổi tên lô"
                                 >
                                     <i className="fas fa-edit text-xs"></i>
                                 </button>
                             )}
                        </div>
                        <div className="relative flex-1 min-w-[110px]">
                            <button ref={statusDropdownBtnRef} onClick={() => openDropdown('STATUS')} className="w-full pl-2 pr-6 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700 text-left flex items-center justify-between outline-none truncate" aria-label="Chọn trạng thái">
                                <span className="truncate">{getLabel('STATUS')}</span>
                                <i className="fas fa-chevron-down text-gray-400 text-[10px]"></i>
                            </button>
                        </div>
                        <div className="flex bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
                            <button onClick={() => setSortBy('NEWEST')} className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${sortBy === 'NEWEST' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400'}`}>Mới</button>
                            <button 
                                 onClick={() => setShowRoutePlanner(true)}
                                 className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${sortBy === 'ROUTE' ? 'bg-white shadow-sm text-eco-700' : 'text-gray-400'}`}
                                 title="Lập lộ trình thông minh"
                            >
                                <i className="fas fa-map-marked-alt"></i> Lộ trình
                            </button>
                        </div>
                    </div>
                </div>
             </div>
         </div>
      </div>
      
      {/* ... (Existing code for Compact Mode Header and Dropdown) ... */}
      {isCompactMode && (
          <div className={`sticky ${isHeaderVisible ? 'top-[148px]' : 'top-[112px]'} z-20 bg-gray-100 border-b border-gray-200 hidden sm:grid grid-cols-[40px_1.5fr_2fr_3.5fr_100px_110px] gap-2 px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none shadow-sm transition-all duration-300`}>
              <div className="flex items-center justify-center">#</div>
              <div>Khách hàng / SĐT</div>
              <div>Địa chỉ</div>
              <div>Hàng hóa</div>
              <div className="text-right">Tổng tiền</div>
              <div className="text-center">Trạng thái</div>
          </div>
      )}

      {activeDropdown && (<div id="floating-dropdown-portal" className="fixed z-[9999] bg-white border border-gray-100 rounded-lg shadow-xl max-h-60 overflow-y-auto p-1 animate-fade-in" style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width }}>
        <div onClick={() => activeDropdown === 'STATUS' ? setFilterStatus([]) : setFilterBatch([])} className={`px-3 py-2 rounded-md text-xs font-bold cursor-pointer flex items-center gap-2 transition-colors ${(activeDropdown === 'STATUS' ? filterStatus.length : filterBatch.length) === 0 ? 'bg-eco-50 text-eco-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${(activeDropdown === 'STATUS' ? filterStatus.length : filterBatch.length) === 0 ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>Tất cả</div>
        <div className="border-t border-gray-50 my-1"></div>
        {activeDropdown === 'STATUS' ? (Object.entries(statusLabels).map(([key, label]) => { const status = key as OrderStatus; const isSelected = filterStatus.includes(status); return <div key={status} onClick={() => toggleFilter('STATUS', status)} className={`px-3 py-2 rounded-md text-xs font-medium cursor-pointer flex items-center gap-2 transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${isSelected ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>{label}</div>; })) : (batches.map(batch => { const isSelected = filterBatch.includes(batch); return <div key={batch} onClick={() => toggleFilter('BATCH', batch)} className={`px-3 py-2 rounded-md text-xs font-medium cursor-pointer flex items-center gap-2 transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${isSelected ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>{batch}</div>; }))}
      </div>)}
      <div ref={observerTarget} className="h-px w-full opacity-0 pointer-events-none"></div>
      
      {/* ... (Existing code for MoveBatch, OrderList, etc.) ... */}
      
      {moveBatchData.isOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                  <div className="p-5 bg-gray-50 border-b border-gray-100">
                      <h3 className="font-bold text-gray-800">Chuyển {selectedOrderIds.size} đơn hàng</h3>
                      <p className="text-xs text-gray-500 mt-1">Chọn lô hàng mới để chuyển đến</p>
                  </div>
                  <div className="p-4 space-y-4">
                      <div>
                          <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Nhập tên Lô mới</label>
                          <input 
                              value={moveBatchData.targetBatch}
                              onChange={e => setMoveBatchData({...moveBatchData, targetBatch: e.target.value})}
                              placeholder="VD: Lô-Sáng-Mai"
                              className="w-full p-3 bg-white border border-gray-300 focus:border-purple-500 rounded-xl outline-none font-bold text-gray-800"
                              autoFocus
                          />
                      </div>
                      {batches.length > 0 && (
                          <div>
                              <label className="text-xs font-bold text-gray-500 uppercase block mb-1">Hoặc chọn lô có sẵn</label>
                              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                                  {batches.map(b => (
                                      <button key={b} onClick={() => setMoveBatchData({...moveBatchData, targetBatch: b})} className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${moveBatchData.targetBatch === b ? 'bg-purple-100 text-purple-700 border-purple-300' : 'bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100'}`}>{b}</button>
                                  ))}
                              </div>
                          </div>
                      )}
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-3">
                      <button onClick={() => setMoveBatchData({isOpen: false, targetBatch: ''})} className="flex-1 py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl text-sm transition-colors">Hủy</button>
                      <button onClick={confirmMoveBatch} className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-sm shadow-lg transition-transform active:scale-95">Xác nhận</button>
                  </div>
              </div>
          </div>
      )}

      {/* Main Order List */}
      <div className={`grid gap-3 ${isCompactMode ? '' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
          {visibleOrders.map((order, idx) => (
              <div key={order.id} data-index={idx} className="order-row">
                  <OrderCard 
                      order={order} 
                      onUpdate={setEditingOrder}
                      onDelete={handleDeleteClick}
                      onEdit={handleEdit}
                      isSortMode={sortBy === 'ROUTE'}
                      index={idx}
                      isCompactMode={isCompactMode}
                      onTouchStart={(e) => handleTouchStart(e, idx)}
                      onTouchMove={handleTouchMove}
                      onTouchEnd={handleTouchEnd}
                      onRowDragStart={handleDragStart}
                      onRowDragEnter={handleDragEnter}
                      onDragEnd={handleDragEnd}
                      onDragOver={(e) => e.preventDefault()}
                      isNewCustomer={storageService.isNewCustomer(order.customerPhone, order.address, order.customerId)}
                      onSplitBatch={handleSplitBatch}
                      priorityScore={findCustomerForOrder(order)?.priorityScore}
                      customerData={findCustomerForOrder(order)}
                      isSelectionMode={isSelectionMode}
                      isSelected={selectedOrderIds.has(order.id)}
                      onToggleSelect={toggleSelectOrder}
                      onLongPress={handleLongPress}
                      onShowQR={handleShowQR}
                      onMoveBatch={handleSingleMoveBatch}
                      onViewDetail={handleViewDetail}
                  />
              </div>
          ))}
      </div>
      
      {filteredOrders.length > visibleCount && (
          <div className="flex justify-center mt-6">
              <button onClick={handleLoadMore} className="bg-white border border-gray-300 text-gray-600 px-6 py-2 rounded-full text-xs font-bold shadow-sm hover:bg-gray-50 active:scale-95 transition-transform">
                  Xem thêm {filteredOrders.length - visibleCount} đơn nữa <i className="fas fa-chevron-down ml-1"></i>
              </button>
          </div>
      )}

      {/* Floating Action Bar for Bulk Actions */}
      {isSelectionMode && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[95%] max-w-2xl bg-gray-900/95 backdrop-blur text-white p-2 rounded-2xl shadow-2xl animate-slide-up border border-gray-700 flex items-center justify-between overflow-x-auto no-scrollbar">
              <div className="flex items-center gap-3 pl-2 pr-4 border-r border-gray-700 shrink-0">
                  <div className="flex flex-col items-center">
                      <span className="font-black text-xl leading-none text-eco-500">{selectedOrderIds.size}</span>
                      <span className="text-[8px] font-bold text-gray-400 uppercase">Đã chọn</span>
                  </div>
                  <button onClick={clearSelection} className="w-8 h-8 rounded-full bg-gray-800 text-gray-400 hover:text-white flex items-center justify-center transition-colors"><i className="fas fa-times"></i></button>
              </div>
              
              <div className="flex items-center gap-1 p-1">
                  <button onClick={executeBulkPrint} className="flex flex-col items-center justify-center min-w-[50px] p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors group">
                      <i className="fas fa-print text-lg mb-1 group-hover:text-blue-400"></i>
                      <span className="text-[8px] font-bold uppercase leading-none text-gray-400 group-hover:text-white">In đơn</span>
                  </button>
                  <button onClick={() => setShowBulkStatusModal(true)} className="flex flex-col items-center justify-center min-w-[50px] p-2 rounded-lg bg-gray-800 hover:bg-blue-900 transition-colors group">
                      <i className="fas fa-exchange-alt text-lg mb-1 text-blue-500 group-hover:text-white"></i>
                      <span className="text-[8px] font-bold uppercase leading-none text-gray-400 group-hover:text-white">Đổi TT</span>
                  </button>
                  <button onClick={executeBulkSplit} className="flex flex-col items-center justify-center min-w-[50px] p-2 rounded-lg bg-gray-800 hover:bg-orange-900 transition-colors group">
                      <i className="fas fa-history text-lg mb-1 text-orange-500 group-hover:text-white"></i>
                      <span className="text-[8px] font-bold uppercase leading-none text-gray-400 group-hover:text-white">Lô sau</span>
                  </button>
                  <button onClick={handleBulkMoveBatch} className="flex flex-col items-center justify-center min-w-[50px] p-2 rounded-lg bg-gray-800 hover:bg-indigo-900 transition-colors group">
                      <i className="fas fa-truck-moving text-lg mb-1 text-indigo-500 group-hover:text-white"></i>
                      <span className="text-[8px] font-bold uppercase leading-none text-gray-400 group-hover:text-white">Chuyển lô</span>
                  </button>
                  <button onClick={handleBulkRefreshProducts} className="flex flex-col items-center justify-center min-w-[50px] p-2 rounded-lg bg-gray-800 hover:bg-emerald-900 transition-colors group">
                      <i className="fas fa-sync text-lg mb-1 text-emerald-500 group-hover:text-white"></i>
                      <span className="text-[8px] font-bold uppercase leading-none text-gray-400 group-hover:text-white">Cập nhật</span>
                  </button>
                  <button onClick={() => setShowBulkDeleteConfirm(true)} className="flex flex-col items-center justify-center min-w-[50px] p-2 rounded-lg bg-gray-800 hover:bg-red-900 transition-colors group">
                      <i className="fas fa-trash text-lg mb-1 text-red-500 group-hover:text-white"></i>
                      <span className="text-[8px] font-bold uppercase leading-none text-gray-400 group-hover:text-white">Xóa</span>
                  </button>
              </div>
          </div>
      )}

      {/* Editing Modal */}
      {editingOrder && (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setEditingOrder(null)}>
          <div ref={editModalRef} className="bg-white rounded-3xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2"><i className="fas fa-edit text-blue-600"></i> Sửa đơn hàng</h3>
                <button onClick={() => setEditingOrder(null)} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors shadow-sm"><i className="fas fa-times"></i></button>
            </div>
            <form onSubmit={saveEdit} className="overflow-y-auto p-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Tên khách</label>
                        <input value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-bold text-sm focus:border-blue-500 transition-colors text-gray-800" />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Số ĐT</label>
                        <input value={editingOrder.customerPhone} onChange={e => setEditingOrder({...editingOrder, customerPhone: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-bold text-sm focus:border-blue-500 transition-colors text-gray-800" />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Địa chỉ</label>
                    <textarea value={editingOrder.address} onChange={e => setEditingOrder({...editingOrder, address: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none font-bold text-sm focus:border-blue-500 transition-colors resize-none h-20 text-gray-800" />
                </div>
                
                <div className="space-y-2">
                    <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Sản phẩm</label>
                        <button type="button" onClick={addEditItem} className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors">+ Thêm món</button>
                    </div>
                    {editingOrder.items.map((item, idx) => (
                        <div key={idx} className="flex gap-2 items-center product-dropdown-container relative">
                            <div className="flex-grow relative">
                                <input 
                                    value={item.name} 
                                    onChange={e => updateEditItem(idx, 'name', e.target.value)} 
                                    onFocus={() => setActiveEditProductRow(idx)}
                                    placeholder="Tên món..."
                                    className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium outline-none focus:border-blue-500 text-gray-800" 
                                />
                                {activeEditProductRow === idx && (
                                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-gray-100 rounded-lg shadow-xl max-h-48 overflow-y-auto no-scrollbar">
                                        {products.filter(p => !item.name || normalizeString(p.name).includes(normalizeString(item.name))).map(p => (
                                            <div key={p.id} onMouseDown={() => selectProductForEditItem(idx, p)} className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-0">
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold text-gray-800">{p.name}</span>
                                                    <span className="text-[9px] text-gray-400">Tồn: {p.stockQuantity}</span>
                                                </div>
                                                <span className="text-[10px] font-bold text-blue-600">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}đ</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <input type="number" value={item.quantity} onChange={e => updateEditItem(idx, 'quantity', Number(e.target.value))} className="w-14 p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-center outline-none focus:border-blue-500 text-gray-800" />
                            <input type="number" value={item.price} onChange={e => updateEditItem(idx, 'price', Number(e.target.value))} className="w-20 p-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-bold text-right outline-none focus:border-blue-500 text-gray-800" />
                            <button type="button" onClick={() => removeEditItem(idx)} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors"><i className="fas fa-trash-alt"></i></button>
                        </div>
                    ))}
                </div>

                <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Hình thức thanh toán</label>
                    <div className="flex bg-gray-100 p-1 rounded-xl mt-1">
                        <button
                            type="button"
                            onClick={() => setEditingOrder({...editingOrder, paymentMethod: PaymentMethod.CASH})}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${editingOrder.paymentMethod === PaymentMethod.CASH ? 'bg-white shadow-sm text-green-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <i className="fas fa-money-bill-wave mr-1"></i> Tiền mặt
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditingOrder({...editingOrder, paymentMethod: PaymentMethod.TRANSFER, paymentVerified: false})}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${editingOrder.paymentMethod === PaymentMethod.TRANSFER && !editingOrder.paymentVerified ? 'bg-white shadow-sm text-blue-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <i className="fas fa-university mr-1"></i> Chờ CK
                        </button>
                        <button
                            type="button"
                            onClick={() => setEditingOrder({...editingOrder, paymentMethod: PaymentMethod.TRANSFER, paymentVerified: true})}
                            className={`flex-1 py-2.5 rounded-lg text-xs font-bold transition-all ${editingOrder.paymentMethod === PaymentMethod.TRANSFER && editingOrder.paymentVerified ? 'bg-white shadow-sm text-purple-700' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            <i className="fas fa-check-circle mr-1"></i> Đã CK
                        </button>
                    </div>
                </div>

                <div>
                    <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Ghi chú</label>
                    <input value={editingOrder.notes || ''} onChange={e => setEditingOrder({...editingOrder, notes: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none text-sm focus:border-blue-500 transition-colors text-gray-800" />
                </div>

                <div className="pt-4 border-t border-gray-100 flex justify-between items-center">
                    <span className="text-xs font-bold text-gray-500 uppercase">Tổng tiền mới</span>
                    <span className="text-xl font-black text-blue-600">{new Intl.NumberFormat('vi-VN').format(editingOrder.totalPrice)}đ</span>
                </div>

                <button type="submit" className="w-full py-3 bg-black text-white rounded-xl font-bold shadow-lg hover:bg-gray-800 transition-all active:scale-95 uppercase text-xs tracking-widest">Lưu thay đổi</button>
            </form>
          </div>
        </div>
      )}

      {/* DETAIL MODAL (Compact Mode) - REDESIGNED */}
      {detailOrder && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setDetailOrder(null)}>
              <div className="bg-white w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] animate-slide-up" onClick={e => e.stopPropagation()}>
                  
                  {/* Header & Customer Info */}
                  <div className="p-5 bg-gradient-to-br from-white to-gray-50 border-b border-gray-100 relative">
                      <div className="flex justify-between items-start mb-3">
                          <div>
                              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Đơn hàng #{detailOrder.id}</div>
                              <div className="text-xl font-black text-gray-800 uppercase leading-none mt-1">{detailOrder.customerName}</div>
                          </div>
                          <span className={`text-[10px] font-black uppercase px-2 py-1 rounded-lg border ${statusConfig[detailOrder.status].bg} ${statusConfig[detailOrder.status].color} border-transparent`}>
                              {statusLabels[detailOrder.status]}
                          </span>
                      </div>
                      
                      <div className="space-y-2">
                          <a href={`tel:${detailOrder.customerPhone}`} className="flex items-center gap-3 text-sm font-bold text-gray-600 hover:text-blue-600 transition-colors p-2 bg-white rounded-xl border border-gray-100 shadow-sm">
                              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-500 flex items-center justify-center"><i className="fas fa-phone-alt text-xs"></i></div>
                              <span>{detailOrder.customerPhone}</span>
                          </a>
                          <div className="flex items-start gap-3 text-sm font-medium text-gray-500 p-2 bg-white rounded-xl border border-gray-100 shadow-sm relative">
                              <div className="w-8 h-8 rounded-lg bg-gray-100 text-gray-400 flex items-center justify-center shrink-0"><i className="fas fa-map-marker-alt text-xs"></i></div>
                              <div className="flex-grow">
                                  <span className="text-xs leading-snug pt-1 block">{detailOrder.address}</span>
                              </div>
                              <button 
                                onClick={handlePinCurrentLocation} 
                                className={`absolute right-2 top-2 w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isGettingLocation ? 'bg-gray-100 text-gray-400' : 'bg-red-50 text-red-500 hover:bg-red-100'}`}
                                title="Ghim vị trí hiện tại của tôi"
                              >
                                  <i className={`fas ${isGettingLocation ? 'fa-circle-notch fa-spin' : 'fa-map-pin'}`}></i>
                              </button>
                          </div>
                      </div>

                      <button onClick={() => setDetailOrder(null)} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center shadow-sm border border-gray-100"><i className="fas fa-times"></i></button>
                  </div>

                  {/* Body: Items & Payment */}
                  <div className="p-5 overflow-y-auto flex-grow bg-white">
                      <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 mb-4">
                          <div className="space-y-2">
                              {detailOrder.items.map((item, idx) => (
                                  <div key={idx} className="flex justify-between items-start text-sm">
                                      <span className="font-bold text-gray-700 leading-snug">{item.name}</span>
                                      <span className="font-black text-gray-900 whitespace-nowrap ml-4">x{item.quantity}</span>
                                  </div>
                              ))}
                          </div>
                          {detailOrder.notes && (
                              <div className="mt-3 pt-3 border-t border-gray-200 text-xs italic text-orange-600 flex gap-2">
                                  <i className="fas fa-sticky-note mt-0.5"></i> {detailOrder.notes}
                              </div>
                          )}
                      </div>

                      <div className="flex justify-between items-end px-2">
                          <div>
                              <div className="text-[10px] font-black text-gray-400 uppercase mb-1">Tổng thanh toán</div>
                              <div className="text-2xl font-black text-gray-900 tracking-tight leading-none">{new Intl.NumberFormat('vi-VN').format(detailOrder.totalPrice)}<span className="text-sm align-top ml-0.5">đ</span></div>
                          </div>
                          {detailOrder.paymentMethod === PaymentMethod.TRANSFER && (
                              <span className={`text-[10px] font-bold px-3 py-1.5 rounded-full border ${detailOrder.paymentVerified ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>
                                  {detailOrder.paymentVerified ? 'Đã thanh toán' : 'Chờ chuyển khoản'}
                              </span>
                          )}
                      </div>
                  </div>

                  {/* Action Footer */}
                  <div className="p-4 bg-white border-t border-gray-100 space-y-3 pb-6 sm:pb-4">
                      {/* Communication Row */}
                      <div className="grid grid-cols-4 gap-3">
                          <button onClick={handleDetailAction.call} className="aspect-square rounded-2xl bg-green-50 text-green-600 hover:bg-green-100 flex flex-col items-center justify-center gap-1 transition-colors">
                              <i className="fas fa-phone-alt text-lg"></i>
                          </button>
                          <button onClick={handleDetailAction.zalo} className="aspect-square rounded-2xl bg-blue-50 text-blue-600 hover:bg-blue-100 flex flex-col items-center justify-center gap-1 transition-colors font-black text-lg">
                              Z
                          </button>
                          <button onClick={handleDetailAction.sms} className="aspect-square rounded-2xl bg-orange-50 text-orange-600 hover:bg-orange-100 flex flex-col items-center justify-center gap-1 transition-colors">
                              <i className="fas fa-comment-dots text-lg"></i>
                          </button>
                          <button onClick={handleDetailAction.print} className="aspect-square rounded-2xl bg-gray-100 text-gray-600 hover:bg-gray-200 flex flex-col items-center justify-center gap-1 transition-colors">
                              <i className="fas fa-print text-lg"></i>
                          </button>
                      </div>

                      {/* Main Workflow Action */}
                      <div className="flex gap-2">
                          {detailOrder.paymentMethod === PaymentMethod.TRANSFER && !detailOrder.paymentVerified ? (
                              <button 
                                onClick={handleDetailAction.confirmPayment} 
                                className="flex-grow py-3.5 bg-green-600 text-white rounded-xl font-bold text-sm uppercase shadow-lg shadow-green-200 active:scale-95 transition-all flex items-center justify-center gap-2"
                              >
                                  <i className="fas fa-check-circle"></i> Xác nhận đã tiền
                              </button>
                          ) : (
                              detailOrder.status !== OrderStatus.DELIVERED && detailOrder.status !== OrderStatus.CANCELLED && (
                                  <button 
                                    onClick={() => {
                                        const nextMap: Record<string, OrderStatus> = { [OrderStatus.PENDING]: OrderStatus.PICKED_UP, [OrderStatus.PICKED_UP]: OrderStatus.IN_TRANSIT, [OrderStatus.IN_TRANSIT]: OrderStatus.DELIVERED };
                                        if(nextMap[detailOrder.status]) handleDetailAction.setStatus(nextMap[detailOrder.status]);
                                    }} 
                                    className="flex-grow py-3.5 bg-gray-900 text-white rounded-xl font-bold text-sm uppercase shadow-lg active:scale-95 transition-all flex items-center justify-center gap-2"
                                  >
                                      Bước tiếp theo <i className="fas fa-arrow-right"></i>
                                  </button>
                              )
                          )}
                      </div>

                      {/* Secondary Actions */}
                      <div className="grid grid-cols-3 gap-2 pt-1">
                          <button onClick={handleDetailAction.edit} className="py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl font-bold text-xs uppercase hover:bg-gray-50 transition-colors">Sửa</button>
                          <button onClick={handleDetailAction.showQR} className="py-2.5 bg-white border border-gray-200 text-blue-600 rounded-xl font-bold text-xs uppercase hover:bg-blue-50 transition-colors">QR Code</button>
                          <button onClick={handleDetailAction.splitBatch} className="py-2.5 bg-white border border-gray-200 text-orange-600 rounded-xl font-bold text-xs uppercase hover:bg-orange-50 transition-colors">Hoãn giao</button>
                      </div>
                      
                      <button onClick={handleDetailAction.delete} className="w-full text-center text-[10px] font-bold text-red-400 uppercase hover:text-red-600 py-1">Xóa đơn hàng này</button>
                  </div>
              </div>
          </div>
      )}

      {/* Batch Stats Modal */}
      {showStatsModal && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
                  <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <div>
                          <h3 className="font-bold text-lg text-gray-800 uppercase">Thống kê lô hàng</h3>
                          <p className="text-xs text-gray-500 font-medium">{filterBatch.length > 0 ? filterBatch.join(', ') : 'Tất cả các lô'}</p>
                      </div>
                      <div className="flex gap-2">
                          <button onClick={handleShareStats} className="w-8 h-8 rounded-full bg-white border border-gray-200 text-blue-600 hover:bg-blue-50 flex items-center justify-center transition-colors"><i className="fas fa-share-alt"></i></button>
                          <button onClick={() => setShowStatsModal(false)} className="w-8 h-8 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-gray-600 flex items-center justify-center transition-colors"><i className="fas fa-times"></i></button>
                      </div>
                  </div>
                  <div className="flex-grow overflow-y-auto p-0">
                      <table className="w-full text-left border-collapse">
                          <thead className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-wider sticky top-0 z-10 shadow-sm">
                              <tr>
                                  <th className="p-4">Tên hàng</th>
                                  <th className="p-4 text-right">Giá bán</th>
                                  <th className="p-4 text-center">SL Đặt</th>
                                  <th className="p-4 text-center">Tồn kho</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100 text-sm">
                              {batchStatsData.map((item, idx) => {
                                  const stock = item.productInfo?.stockQuantity ?? 0;
                                  const price = item.productInfo?.defaultPrice ?? 0;
                                  const isLow = stock < 5;
                                  const isNegative = stock < 0;
                                  
                                  return (
                                      <tr key={idx} className="hover:bg-gray-50 transition-colors group cursor-pointer" onClick={() => item.productInfo && handleQuickEditProduct(item.productInfo)}>
                                          <td className="p-4 font-bold text-gray-800 group-hover:text-blue-600 transition-colors">{item.name}</td>
                                          <td className="p-4 text-right font-medium text-blue-600">
                                              {new Intl.NumberFormat('vi-VN').format(price)}
                                          </td>
                                          <td className="p-4 text-center font-bold text-gray-900">{item.qtyOrdered}</td>
                                          <td className={`p-4 text-center font-black ${isNegative ? 'text-red-500' : (isLow ? 'text-orange-500' : 'text-green-500')}`}>
                                              {stock}
                                          </td>
                                      </tr>
                                  );
                              })}
                          </tbody>
                      </table>
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100 text-center text-xs text-gray-400 font-medium">
                      Bấm vào tên hàng để nhập thêm/sửa tồn kho
                  </div>
              </div>
          </div>
      )}

      {/* QR Code Modal */}
      {qrState.isOpen && (
          <div className="fixed inset-0 z-[150] bg-black/90 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={() => setQrState({...qrState, isOpen: false})}>
              <div className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl relative" onClick={e => e.stopPropagation()}>
                  <div className="absolute top-4 right-4 z-10">
                      <button onClick={() => setQrState({...qrState, isOpen: false})} className="w-8 h-8 bg-gray-100/50 hover:bg-gray-100 rounded-full flex items-center justify-center text-gray-600 transition-all"><i className="fas fa-times"></i></button>
                  </div>
                  <div className="p-8 pb-4 flex flex-col items-center">
                      <h3 className="font-black text-xl text-gray-800 uppercase tracking-tighter mb-1">Quét mã thanh toán</h3>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-6">VietQR • {shopConfigRef.current?.shopName || 'EcoGo'}</p>
                      <div className="p-4 border-2 border-gray-900 rounded-2xl bg-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] relative group cursor-pointer" onClick={handleShareQR}>
                          {qrState.url ? <img src={qrState.url} alt="QR Code" className="w-48 h-48 object-contain mix-blend-multiply" /> : <div className="w-48 h-48 flex items-center justify-center"><div className="w-8 h-8 border-4 border-gray-200 border-t-gray-800 rounded-full animate-spin"></div></div>}
                          <div className="absolute inset-0 bg-white/80 opacity-0 group-hover:opacity-100 flex items-center justify-center font-black text-gray-900 uppercase text-xs transition-opacity rounded-xl">Bấm để chia sẻ</div>
                      </div>
                      <div className="mt-6 text-center">
                          <div className="text-3xl font-black text-eco-600 tracking-tighter">{new Intl.NumberFormat('vi-VN').format(qrState.order?.totalPrice || 0)}đ</div>
                          <div className="text-xs font-bold text-gray-400 uppercase mt-1">Nội dung: DH {qrState.order?.id}</div>
                      </div>
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100 grid grid-cols-2 gap-3">
                      <button onClick={handleShareQR} className="py-3 bg-white border border-gray-200 rounded-xl font-bold text-gray-700 text-xs uppercase shadow-sm hover:bg-gray-50 transition-all">Chia sẻ ảnh</button>
                      <button onClick={handleConfirmQrPayment} className="py-3 bg-black text-white rounded-xl font-bold text-xs uppercase shadow-lg hover:bg-gray-800 transition-all">Xác nhận đã thu</button>
                  </div>
              </div>
          </div>
      )}

      {/* Product Detail Modal from Tracking */}
      {viewingProduct && <ProductDetailModal isOpen={!!viewingProduct} onClose={() => setViewingProduct(null)} product={viewingProduct} onImport={() => { setEditingProduct(viewingProduct); setEditProductMode('IMPORT'); setViewingProduct(null); }} onAdjust={() => { setEditingProduct(viewingProduct); setEditProductMode('SET'); setViewingProduct(null); }} />}
      <ProductEditModal 
        isOpen={!!editingProduct} 
        onClose={() => setEditingProduct(null)} 
        product={editingProduct} 
        onSave={handleSaveProductChange} 
        initialMode={editProductMode}
        allProducts={products}
        onSwitchToProduct={(p) => { setEditingProduct(p); setEditProductMode('SET'); }}
      />

      <ConfirmModal isOpen={showDeleteConfirm} title="Xóa đơn hàng?" message="Hành động này không thể hoàn tác. Kho hàng sẽ được hoàn lại tự động." onConfirm={confirmDelete} onCancel={() => setShowDeleteConfirm(false)} confirmLabel="Xóa vĩnh viễn" isDanger={true} />
      <ConfirmModal isOpen={showBulkDeleteConfirm} title={`Xóa ${selectedOrderIds.size} đơn hàng?`} message="Các đơn hàng sẽ bị xóa vĩnh viễn. Kho hàng sẽ được hoàn lại tương ứng." onConfirm={executeBulkDelete} onCancel={() => setShowBulkDeleteConfirm(false)} confirmLabel="Xóa tất cả" isDanger={true} />
      
      {showBulkStatusModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                  <div className="p-5 border-b border-gray-100 bg-gray-50">
                      <h3 className="font-bold text-gray-800">Cập nhật {selectedOrderIds.size} đơn</h3>
                  </div>
                  <div className="p-4 space-y-2">
                      {Object.values(OrderStatus).map(status => (
                          <button key={status} onClick={() => executeBulkStatusUpdate(status)} className="w-full py-3 px-4 rounded-xl text-left font-bold text-sm bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 transition-colors flex justify-between items-center group">
                              <span>{statusLabels[status]}</span>
                              <i className="fas fa-check text-gray-300 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all"></i>
                          </button>
                      ))}
                  </div>
                  <div className="p-4 border-t border-gray-100 bg-gray-50">
                      <button onClick={() => setShowBulkStatusModal(false)} className="w-full py-2.5 bg-gray-200 text-gray-700 font-bold rounded-xl text-sm hover:bg-gray-300 transition-colors">Hủy</button>
                  </div>
              </div>
          </div>
      )}

      {showPrintTypeModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                  <div className="p-5 border-b border-gray-100 bg-gray-50">
                      <h3 className="font-bold text-gray-800 text-center uppercase text-sm tracking-widest">Chọn mẫu in ({ordersToPrint.length} đơn)</h3>
                  </div>
                  <div className="p-6 grid grid-cols-1 gap-4">
                      <button onClick={() => handlePrintConfirm('INVOICE')} className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-blue-500 hover:bg-blue-50 transition-all group text-left">
                          <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform"><i className="fas fa-tags"></i></div>
                          <div>
                              <div className="font-black text-gray-800 uppercase text-sm">Tem dán (8 tem/A4)</div>
                              <div className="text-xs text-gray-500 mt-1">Dùng để dán lên gói hàng, có mã QR</div>
                          </div>
                      </button>
                      <button onClick={() => handlePrintConfirm('LIST')} className="flex items-center gap-4 p-4 rounded-2xl border-2 border-gray-100 hover:border-purple-500 hover:bg-purple-50 transition-all group text-left">
                          <div className="w-12 h-12 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center text-xl group-hover:scale-110 transition-transform"><i className="fas fa-list-ol"></i></div>
                          <div>
                              <div className="font-black text-gray-800 uppercase text-sm">Danh sách (Compact)</div>
                              <div className="text-xs text-gray-500 mt-1">Bảng kê chi tiết để shipper ký nhận</div>
                          </div>
                      </button>
                  </div>
                  <div className="p-4 border-t border-gray-100 bg-gray-50">
                      <button onClick={() => setShowPrintTypeModal(false)} className="w-full py-2.5 bg-gray-200 text-gray-700 font-bold rounded-xl text-sm hover:bg-gray-300 transition-colors">Đóng</button>
                  </div>
              </div>
          </div>
      )}

      {showBatchSplitModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
                  <div className="p-5 border-b border-gray-100 bg-red-50">
                      <h3 className="font-bold text-red-600 text-center uppercase text-sm tracking-widest"><i className="fas fa-exclamation-triangle mr-2"></i>Số lượng quá lớn ({ordersToPrint.length})</h3>
                  </div>
                  <div className="p-6 text-center">
                      <p className="text-sm text-gray-600 mb-6 font-medium">Để tránh lỗi trình duyệt, vui lòng chọn in từng phần nhỏ hơn (tối đa 200 đơn/lần).</p>
                      <div className="space-y-3">
                          <button onClick={() => prepareSplitPrint(ordersToPrint.slice(0, 100))} className="w-full py-3 bg-white border-2 border-gray-200 hover:border-gray-800 rounded-xl font-bold text-sm text-gray-800 transition-colors">In 100 đơn đầu tiên</button>
                          <button onClick={() => prepareSplitPrint(ordersToPrint.slice(0, 200))} className="w-full py-3 bg-white border-2 border-gray-200 hover:border-gray-800 rounded-xl font-bold text-sm text-gray-800 transition-colors">In 200 đơn đầu tiên</button>
                          <button onClick={() => setShowBatchSplitModal(false)} className="w-full py-3 bg-gray-100 hover:bg-gray-200 rounded-xl font-bold text-sm text-gray-600 transition-colors">Hủy bỏ</button>
                      </div>
                  </div>
              </div>
          </div>
      )}

      <RoutePlannerModal isOpen={showRoutePlanner} onClose={() => setShowRoutePlanner(false)} orders={filteredOrders} onApplySort={handleSmartRouteSort} />
      <ShipperSummaryModal isOpen={showShipperSummary} onClose={() => setShowShipperSummary(false)} orders={filteredOrders} batchName={filterBatch.length === 1 ? filterBatch[0] : 'TẤT CẢ'} />
      
      {/* Add ConfirmModal for Sync */}
      <ConfirmModal 
          isOpen={showSyncConfirm} 
          title="Đồng bộ đơn hàng?" 
          message="Bạn có muốn cập nhật thông tin mới (Giá/Tên) cho các đơn hàng CHỜ XỬ LÝ không?" 
          onConfirm={handleConfirmSync} 
          onCancel={() => { setShowSyncConfirm(false); setPendingProductUpdate(null); }}
          confirmLabel="Đồng bộ ngay"
          cancelLabel="Chỉ sửa kho"
      />
    </div>
  );
};

const statusConfig: Record<OrderStatus, { color: string; bg: string }> = {
  [OrderStatus.PENDING]: { bg: 'bg-yellow-100', color: 'text-yellow-800' },
  [OrderStatus.PICKED_UP]: { bg: 'bg-blue-100', color: 'text-blue-800' },
  [OrderStatus.IN_TRANSIT]: { bg: 'bg-purple-100', color: 'text-purple-800' },
  [OrderStatus.DELIVERED]: { bg: 'bg-green-100', color: 'text-green-800' },
  [OrderStatus.CANCELLED]: { bg: 'bg-red-100', color: 'text-red-800' },
};

export default TrackingDashboard;
