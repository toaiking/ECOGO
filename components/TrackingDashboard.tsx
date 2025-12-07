import React, { useEffect, useState, useMemo, useRef, useDeferredValue, useCallback } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { Order, OrderStatus, PaymentMethod, OrderItem, Product, Customer } from '../types';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { reconciliationService, ReconciliationResult } from '../services/reconciliationService';
import { OrderCard } from './OrderCard';
import ConfirmModal from './ConfirmModal';
import RoutePlannerModal from './RoutePlannerModal'; 
import { generateDeliveryMessage } from '../services/geminiService';
// Import reusable modals from InventoryManager
import { ProductDetailModal, ProductEditModal } from './InventoryManager';

type SortOption = 'NEWEST' | 'ROUTE' | 'STATUS';

const TrackingDashboard: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]); 
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [filterStatus, setFilterStatus] = useState<OrderStatus[]>([]);
  
  // Persist Batch Filter
  const [filterBatch, setFilterBatch] = useState<string[]>(() => {
      try {
          const saved = localStorage.getItem('ecogo_filter_batch');
          return saved ? JSON.parse(saved) : [];
      } catch {
          return [];
      }
  });

  // Save batch filter changes
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

  // Voice Search State
  const [isListeningSearch, setIsListeningSearch] = useState(false);

  // Bulk Selection State
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  
  // Bulk Status Update Modal
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);

  // Batch Print State
  const [isPrinting, setIsPrinting] = useState(false);
  const [showBatchSplitModal, setShowBatchSplitModal] = useState(false);
  const [showPrintTypeModal, setShowPrintTypeModal] = useState(false);
  const [ordersToPrint, setOrdersToPrint] = useState<Order[]>([]);

  // Reconciliation State
  const [showReconcileModal, setShowReconcileModal] = useState(false);
  const [reconcileResult, setReconcileResult] = useState<ReconciliationResult | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);

  // Stats Modal
  const [showStatsModal, setShowStatsModal] = useState(false);

  // Quick Product Edit State
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editProductMode, setEditProductMode] = useState<'IMPORT' | 'SET'>('SET');

  // Route Planner Modal
  const [showRoutePlanner, setShowRoutePlanner] = useState(false);
  
  // Move Batch Modal (New)
  const [moveBatchData, setMoveBatchData] = useState<{isOpen: boolean, targetBatch: string}>({ isOpen: false, targetBatch: '' });

  // QR Modal State
  const [qrState, setQrState] = useState<{ isOpen: boolean, url: string, order: Order | null }>({ isOpen: false, url: '', order: null });

  // Detail Modal State (NEW)
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);

  // Pagination / Rendering Limit
  const [visibleCount, setVisibleCount] = useState(20);

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

  const batches = useMemo(() => {
    const batchActivity = new Map<string, number>();
    orders.forEach(o => { if (o.batchId) batchActivity.set(o.batchId, Math.max(batchActivity.get(o.batchId) || 0, o.createdAt)); });
    return Array.from(batchActivity.entries()).sort((a, b) => b[1] - a[1]).map(entry => entry[0]).slice(0, 50);
  }, [orders]);

  const newCustomerMap = useMemo(() => {
      const map: Record<string, boolean> = {};
      orders.forEach(o => {
          const key = o.id; 
          map[key] = storageService.isNewCustomer(o.customerPhone, o.address, o.customerId);
      });
      return map;
  }, [orders, customers]);
  
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

  // (batchStatsData logic reused here... hidden for brevity)
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

  // Handlers
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
  const handleSaveProductChange = async (productData: Product) => { await storageService.saveProduct(productData); await storageService.syncProductToPendingOrders(productData); toast.success("Đã cập nhật sản phẩm!"); setEditingProduct(null); setViewingProduct(productData); };
  const handleLoadMore = () => { setVisibleCount(prev => prev + 20); };
  const visibleOrders = filteredOrders.slice(0, visibleCount);

  // Selection & Bulk Actions (Keep existing logic)
  const handleLongPress = useCallback((id: string) => { setIsSelectionMode(true); setSelectedOrderIds(new Set([id])); if (navigator.vibrate) navigator.vibrate(50); }, []);
  const toggleSelectOrder = useCallback((id: string) => { setSelectedOrderIds(prev => { const newSet = new Set(prev); if (newSet.has(id)) { newSet.delete(id); } else { newSet.add(id); } if (newSet.size > 0 && !isSelectionMode) { setIsSelectionMode(true); } else if (newSet.size === 0) { setIsSelectionMode(false); } return newSet; }); }, [isSelectionMode]);
  const clearSelection = () => { setIsSelectionMode(false); setSelectedOrderIds(new Set()); };
  
  // Bulk Execution Handlers (Keep existing logic)
  const executeBulkDelete = async () => { if (selectedOrderIds.size === 0) return; const ids = Array.from(selectedOrderIds) as string[]; const restorationMap = new Map<string, number>(); ids.forEach(id => { const order = orders.find(o => o.id === id); if (order) { order.items.forEach(item => { if (item.productId) { const current = restorationMap.get(item.productId) || 0; restorationMap.set(item.productId, current + (Number(item.quantity) || 0)); } }); } }); for (const [prodId, qty] of restorationMap.entries()) { const product = products.find(p => p.id === prodId); if (product) { const currentStock = Number(product.stockQuantity) || 0; await storageService.saveProduct({ ...product, stockQuantity: currentStock + qty }); } } await storageService.deleteOrdersBatch(ids); toast.success(`Đã xóa ${ids.length} đơn hàng & Hoàn kho`); clearSelection(); setShowBulkDeleteConfirm(false); };
  const executeBulkSplit = async () => { if (selectedOrderIds.size === 0) return; const ordersToSplit = orders.filter(o => selectedOrderIds.has(o.id)); await storageService.splitOrdersBatch(ordersToSplit.map(o => ({ id: o.id, batchId: o.batchId }))); toast.success(`Đã chuyển ${selectedOrderIds.size} đơn sang lô sau`); clearSelection(); };
  const executeBulkPrint = () => { if (selectedOrderIds.size === 0) return; const toPrint = orders.filter(o => selectedOrderIds.has(o.id)); setOrdersToPrint(toPrint); setShowPrintTypeModal(true); };
  const executeBulkStatusUpdate = async (status: OrderStatus) => { if (selectedOrderIds.size === 0) return; const ids = Array.from(selectedOrderIds) as string[]; const promises = ids.map(id => storageService.updateStatus(id, status)); await Promise.all(promises); toast.success(`Đã cập nhật ${ids.length} đơn sang ${statusLabels[status]}`); setShowBulkStatusModal(false); clearSelection(); };
  const handleBulkMoveBatch = () => { if (selectedOrderIds.size === 0) return; setMoveBatchData({ isOpen: true, targetBatch: '' }); };
  const handleSingleMoveBatch = useCallback((order: Order) => { setIsSelectionMode(true); setSelectedOrderIds(new Set([order.id])); setMoveBatchData({ isOpen: true, targetBatch: order.batchId || '' }); }, []);
  const confirmMoveBatch = async () => { if (!moveBatchData.targetBatch.trim()) { toast.error("Vui lòng nhập tên lô hàng"); return; } const ids = Array.from(selectedOrderIds) as string[]; await storageService.moveOrdersBatch(ids, moveBatchData.targetBatch); toast.success(`Đã chuyển ${ids.length} đơn sang lô: ${moveBatchData.targetBatch}`); setMoveBatchData({ isOpen: false, targetBatch: '' }); clearSelection(); };

  // Voice Search (Keep existing)
  const handleVoiceSearch = () => { /* ...existing logic... */ }; // Re-use existing logic, assuming it's correctly placed or imported if complex. 
  // Simplified for this overwrite:
  const doVoiceSearch = () => {
      // @ts-ignore
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) { toast.error("Trình duyệt không hỗ trợ"); return; }
      const recognition = new SpeechRecognition();
      recognition.lang = 'vi-VN';
      recognition.onstart = () => setIsListeningSearch(true);
      recognition.onend = () => setIsListeningSearch(false);
      recognition.onresult = (event: any) => { const text = event.results?.[0]?.[0]?.transcript; if (text) { setSearchTerm(text); toast.success(`Đã tìm: "${text}"`); } };
      recognition.start();
  };

  const handleRenameBatch = async () => { /* ...existing logic... */ if (filterBatch.length !== 1) return; const oldName = String(filterBatch[0]); const newName = prompt(`Nhập tên mới cho lô: ${oldName}`, oldName); if (newName && newName !== oldName) { await storageService.renameBatch(oldName, newName); toast.success(`Đã đổi tên lô thành: ${newName}`); setFilterBatch([newName]); } };

  // Single Order Actions
  const handleUpdate = useCallback((updatedOrder: Order) => {}, []);
  const handleDeleteClick = useCallback((id: string) => { setDeleteId(id); setShowDeleteConfirm(true); }, []);
  const confirmDelete = async () => { if (deleteId) { const id = deleteId as string; const orderToDelete = orders.find(o => o.id === id); if (orderToDelete) { for (const item of orderToDelete.items) { if (item.productId) { const product = products.find(p => p.id === item.productId); if (product) { const currentStock = Number(product.stockQuantity) || 0; const restoreQty = Number(item.quantity) || 0; await storageService.saveProduct({ ...product, stockQuantity: currentStock + restoreQty }); } } } await storageService.deleteOrder(id, { name: orderToDelete.customerName, address: orderToDelete.address }); } toast.success('Đã xóa đơn & Hoàn kho'); setShowDeleteConfirm(false); setDeleteId(null); if(detailOrder?.id === id) setDetailOrder(null); } };
  
  const handleEdit = useCallback((order: Order) => { setEditingOrder(JSON.parse(JSON.stringify(order))); setActiveEditProductRow(null); setDetailOrder(null); }, []);
  const saveEdit = async (e: React.FormEvent) => { e.preventDefault(); if (editingOrder) { await storageService.updateOrderDetails(editingOrder); setEditingOrder(null); toast.success('Đã lưu thay đổi'); } };
  const updateEditItem = (index: number, field: keyof OrderItem, value: any) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems[index] = { ...newItems[index], [field]: value }; if (field === 'name') newItems[index].productId = undefined; const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  const selectProductForEditItem = (index: number, product: Product) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems[index] = { ...newItems[index], productId: product.id, name: product.name, price: product.defaultPrice }; const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); setActiveEditProductRow(null); };
  const addEditItem = () => { if (!editingOrder) return; const newItems = [...editingOrder.items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]; setEditingOrder({ ...editingOrder, items: newItems }); };
  const removeEditItem = (index: number) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems.splice(index, 1); const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  
  const handleSplitBatch = useCallback(async (order: Order) => { await storageService.splitOrderToNextBatch(order.id, order.batchId); toast.success('Đã chuyển đơn sang lô sau!'); if(detailOrder?.id === order.id) setDetailOrder(null); }, [detailOrder]);
  
  const handleSmartRouteSort = async (sortedOrders: Order[]) => { const reindexed = sortedOrders.map((o, idx) => ({ ...o, orderIndex: idx })); await storageService.saveOrdersList(reindexed); setOrders(prev => { const orderMap = new Map(prev.map(o => [o.id, o])); reindexed.forEach(ro => { if(orderMap.has(ro.id)) { orderMap.set(ro.id, ro); } }); return Array.from(orderMap.values()); }); setSortBy('ROUTE'); };
  const saveReorderedList = async (newSortedList: Order[]) => { const reindexedList = newSortedList.map((o, idx) => ({ ...o, orderIndex: idx })); const newMainOrders = orders.map(o => { const found = reindexedList.find(ro => ro.id === o.id); return found ? found : o; }); setOrders(newMainOrders); await storageService.saveOrdersList(reindexedList); await storageService.learnRoutePriority(reindexedList); toast.success("Đã học lộ trình mới!", { icon: '🧠', duration: 2000 }); };
  
  // Drag handlers (Keep existing)
  const handleTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>, position: number) => { if (sortBy !== 'ROUTE') return; dragItem.current = position; e.currentTarget.closest('.order-row')?.classList.add('opacity-50', 'bg-yellow-50'); }, [sortBy]);
  const handleTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => { if (sortBy !== 'ROUTE') return; if (dragItem.current === null) return; const touch = e.touches[0]; const element = document.elementFromPoint(touch.clientX, touch.clientY); const row = element?.closest('[data-index]'); if (row) { const newIndex = parseInt(row.getAttribute('data-index') || '-1'); if (newIndex !== -1 && newIndex !== dragItem.current) { const _orders = [...visibleOrders]; const draggedItemContent = _orders[dragItem.current]; _orders.splice(dragItem.current, 1); _orders.splice(newIndex, 0, draggedItemContent); dragItem.current = newIndex; saveReorderedList(_orders); } } }, [sortBy, visibleOrders]);
  const handleTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>,) => { dragItem.current = null; document.querySelectorAll('.order-row').forEach(r => r.classList.remove('opacity-50', 'bg-yellow-50')); }, []);
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, position: number) => { dragItem.current = position; e.currentTarget.closest('.order-row')?.classList.add('opacity-40', 'scale-95'); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, position: number) => { dragOverItem.current = position; e.preventDefault(); };
  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => { e.currentTarget.closest('.order-row')?.classList.remove('opacity-40', 'scale-95'); if (dragItem.current !== null && dragOverItem.current !== null && sortBy === 'ROUTE') { const _orders = [...visibleOrders]; const draggedItemContent = _orders[dragItem.current]; _orders.splice(dragItem.current, 1); _orders.splice(dragOverItem.current, 0, draggedItemContent); saveReorderedList(_orders); } dragItem.current = null; dragOverItem.current = null; };

  // Printing & Reconciliation (Keep existing)
  const handleBatchPrintClick = () => { if (filteredOrders.length === 0) { toast.error("Không có đơn hàng nào để in"); return; } setOrdersToPrint(filteredOrders); if (filteredOrders.length > 200) { setShowBatchSplitModal(true); } else { setShowPrintTypeModal(true); } };
  const handlePrintConfirm = async (type: 'LIST' | 'INVOICE') => { setShowPrintTypeModal(false); setShowBatchSplitModal(false); setIsPrinting(true); const batchName = filterBatch.length === 1 ? filterBatch[0] : `Batch_${new Date().getTime()}`; try { if (type === 'LIST') { await pdfService.generateCompactList(ordersToPrint, batchName); } else { await pdfService.generateInvoiceBatch(ordersToPrint, batchName); } toast.success("Đã tạo file PDF!"); if (isSelectionMode) clearSelection(); } catch (e: any) { console.error(e); const errorMessage = e instanceof Error ? e.message : String(e); toast.error(`Lỗi tạo PDF: ${errorMessage}`); } finally { setIsPrinting(false); setOrdersToPrint([]); } };
  const prepareSplitPrint = (subset: Order[]) => { setOrdersToPrint(subset); setShowBatchSplitModal(false); setShowPrintTypeModal(true); };
  const handleReconcileFile = async (e: React.ChangeEvent<HTMLInputElement>) => { const files = e.target.files; const file = files && files[0]; if (!file) return; if (file.type !== 'application/pdf') { toast.error("Vui lòng chọn file PDF"); return; } setIsReconciling(true); try { const result = await reconciliationService.reconcileOrders(file, orders); setReconcileResult(result); if (result.matchedOrders.length === 0) { toast('Không tìm thấy giao dịch nào khớp.', { icon: '🔍' }); } else { toast.success(`Tìm thấy ${result.matchedOrders.length} giao dịch khớp!`); } } catch (error: any) { console.error(error); const errorMessage = error instanceof Error ? error.message : String(error); toast.error(`Lỗi đọc file PDF: ${errorMessage}`); } finally { setIsReconciling(false); } };
  const confirmReconciliation = async () => { if (!reconcileResult || reconcileResult.matchedOrders.length === 0) return; const promises = reconcileResult.matchedOrders.map(order => storageService.updatePaymentVerification(order.id, true, { name: order.customerName })); await Promise.all(promises); toast.success(`Đã xác nhận thanh toán cho ${reconcileResult.matchedOrders.length} đơn!`); setShowReconcileModal(false); setReconcileResult(null); };

  // QR Logic
  const handleShowQR = useCallback(async (order: Order) => { const bankConfig = await storageService.getBankConfig(); if (!bankConfig || !bankConfig.accountNo) { toast.error("Vui lòng cài đặt thông tin Ngân hàng trước."); return; } const desc = `DH ${order.id}`; const url = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template || 'compact2'}.png?amount=${order.totalPrice}&addInfo=${encodeURIComponent(desc)}&accountName=${encodeURIComponent(bankConfig.accountName)}`; setQrState({ isOpen: true, url, order }); }, []);
  const handleConfirmQrPayment = async () => { if (qrState.order) { await storageService.updatePaymentVerification(qrState.order.id, true, { name: qrState.order.customerName }); toast.success("Đã xác nhận thanh toán!"); setQrState(prev => ({ ...prev, isOpen: false })); if(detailOrder?.id === qrState.order.id) { /* Update detail view if open */ } } };
  const handleShareQR = async () => { if (!qrState.url || !qrState.order) return; try { const response = await fetch(qrState.url); const blob = await response.blob(); const file = new File([blob], `qr-${qrState.order.id}.png`, { type: "image/png" }); if (navigator.share) { await navigator.share({ title: 'Mã QR', text: `Thanh toán ${new Intl.NumberFormat('vi-VN').format(qrState.order.totalPrice)}đ`, files: [file] }); } else { await navigator.clipboard.writeText(qrState.url); toast.success("Đã copy link QR"); } } catch (e: any) { console.error(e); toast.error("Lỗi chia sẻ QR"); } };

  const toggleFilter = (type: 'STATUS' | 'BATCH', value: any) => { if (type === 'STATUS') { const statusValue = value as OrderStatus; setFilterStatus(prev => { if (prev.includes(statusValue)) { return prev.filter(s => s !== statusValue); } return [...prev, statusValue]; }); } if (type === 'BATCH') { const batchValue = String(value); setFilterBatch(prev => { if (prev.includes(batchValue)) { return prev.filter(b => b !== batchValue); } return [...prev, batchValue]; }); } };
  const getLabel = (type: 'STATUS' | 'BATCH') => { if (type === 'STATUS') return filterStatus.length === 0 ? 'Trạng thái' : (filterStatus.length === 1 ? statusLabels[filterStatus[0]] : `Đã chọn (${filterStatus.length})`); if (type === 'BATCH') return filterBatch.length === 0 ? 'Lô: Tất cả' : (filterBatch.length === 1 ? filterBatch[0] : `Lô (${filterBatch.length})`); return ''; };
  const openDropdown = (type: 'STATUS' | 'BATCH') => { const ref = type === 'STATUS' ? statusDropdownBtnRef : batchDropdownBtnRef; if (ref.current) { const rect = ref.current.getBoundingClientRect(); setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) }); setActiveDropdown(activeDropdown === type ? null : type); } };

  // --- DETAIL MODAL LOGIC ---
  const handleViewDetail = (order: Order) => {
      setDetailOrder(order);
  };

  const handleDetailAction = {
      call: () => window.open(`tel:${detailOrder?.customerPhone}`, '_self'),
      sms: async () => { if(detailOrder) { const msg = await generateDeliveryMessage(detailOrder); const ua = navigator.userAgent.toLowerCase(); const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1; const separator = isIOS ? '&' : '?'; window.open(`sms:${detailOrder.customerPhone}${separator}body=${encodeURIComponent(msg)}`, '_self'); } },
      zalo: () => { if(detailOrder) window.open(`https://zalo.me/${detailOrder.customerPhone.replace(/^0/,'84')}`, '_blank'); },
      print: () => { if(detailOrder) { const printWindow = window.open('', '_blank'); if (!printWindow) return; const itemsStr = detailOrder.items.map(i => `<tr><td style="padding:8px;border:1px solid #000;font-weight:bold;">${i.name}</td><td style="padding:8px;border:1px solid #000;text-align:center;">${i.quantity}</td><td style="padding:8px;border:1px solid #000;text-align:right;">${new Intl.NumberFormat('vi-VN').format(i.price)}</td><td style="padding:8px;border:1px solid #000;text-align:right;font-weight:bold;">${new Intl.NumberFormat('vi-VN').format(i.price * i.quantity)}</td></tr>`).join(''); const htmlContent = `<html><head><title>Phiếu #${detailOrder.id}</title><style>body { font-family: 'Helvetica', sans-serif; padding: 20px; font-size: 14px; color: #000; }h2 { text-align:center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }table { width: 100%; border-collapse: collapse; margin-top: 20px; }th { border: 1px solid #000; padding: 10px; background: #fff; text-align: left; font-weight: bold; text-transform: uppercase; }.info { margin-bottom: 5px; font-size: 15px; }.label { display:inline-block; width: 80px; font-weight: bold; }.total-row td { border-top: 2px solid #000; font-size: 16px; font-weight: bold; padding: 15px 5px; }</style></head><body><h2>PHIẾU GIAO HÀNG #${detailOrder.id}</h2><div class="info"><span class="label">Khách:</span> <b>${detailOrder.customerName}</b></div><div class="info"><span class="label">SĐT:</span> ${detailOrder.customerPhone}</div><div class="info"><span class="label">Địa chỉ:</span> ${detailOrder.address}</div>${detailOrder.notes ? `<div class="info" style="margin-top:10px;font-style:italic;">Ghi chú: ${detailOrder.notes}</div>` : ''}<table><thead><tr><th>Sản phẩm</th><th style="width:50px;text-align:center;">SL</th><th style="text-align:right;">Đơn giá</th><th style="text-align:right;">Thành tiền</th></tr></thead><tbody>${itemsStr}<tr class="total-row"><td colspan="3" style="text-align:right;">TỔNG CỘNG:</td><td style="text-align:right;">${new Intl.NumberFormat('vi-VN').format(detailOrder.totalPrice)}đ</td></tr></tbody></table><div style="margin-top: 40px; border-top: 1px dashed #000; padding-top: 10px; text-align: center; font-size: 12px; font-style: italic;">Cảm ơn quý khách!</div></body></html>`; printWindow.document.write(htmlContent); printWindow.document.close(); printWindow.print(); } },
      delete: () => { if(detailOrder) { handleDeleteClick(detailOrder.id); setDetailOrder(null); } },
      edit: () => { if(detailOrder) { handleEdit(detailOrder); setDetailOrder(null); } },
      setStatus: async (status: OrderStatus) => { if(detailOrder) { await storageService.updateStatus(detailOrder.id, status, undefined, {name: detailOrder.customerName, address: detailOrder.address}); setDetailOrder({...detailOrder, status}); } },
      confirmPayment: async () => { if(detailOrder) { await storageService.updatePaymentVerification(detailOrder.id, true, { name: detailOrder.customerName }); setDetailOrder({...detailOrder, paymentVerified: true}); toast.success("Đã xác nhận thanh toán"); } },
      splitBatch: () => { if(detailOrder) { handleSplitBatch(detailOrder); } },
      showQR: () => { if(detailOrder) handleShowQR(detailOrder); }
  };

  return (
    <div className="animate-fade-in pb-32">
      <div className="sticky top-16 z-30 bg-gray-50/95 backdrop-blur-sm transition-shadow shadow-sm">
         <div className="bg-white border-b border-gray-200 p-2 shadow-sm">
             <div className="flex gap-2 items-center mb-2">
                <div className="relative flex-grow">
                    <i className="fas fa-search absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                    <input 
                        placeholder="Tìm tên, sđt, địa chỉ, hàng hóa..." 
                        value={searchTerm} 
                        onChange={e => setSearchTerm(e.target.value)} 
                        className="w-full pl-9 pr-9 py-2 rounded-lg bg-gray-100 border-transparent focus:bg-white focus:ring-2 focus:ring-eco-100 text-sm font-medium outline-none transition-all" 
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
                <button onClick={handleOpenStats} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-purple-600 border border-gray-200" title="Thống kê Lô" aria-label="Thống kê"><i className="fas fa-cubes"></i></button>
                <button onClick={() => setShowReconcileModal(true)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-green-600 border border-gray-200" title="Đối soát Ngân hàng" aria-label="Đối soát ngân hàng"><i className="fas fa-file-invoice-dollar"></i></button>
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
      
      {/* TABLE HEADER FOR COMPACT MODE (Spreadsheet Look) */}
      {/* UPDATE: Use sm:grid instead of md:grid to show on tablet */}
      {isCompactMode && (
          <div className="sticky top-[148px] z-20 bg-gray-100 border-b border-gray-200 hidden sm:grid grid-cols-[40px_1.5fr_2fr_2fr_100px_110px_50px] gap-2 px-3 py-2 text-[10px] font-bold text-gray-500 uppercase tracking-wider select-none shadow-sm">
              <div className="flex items-center justify-center">#</div>
              <div>Khách hàng / SĐT</div>
              <div>Địa chỉ</div>
              <div>Hàng hóa</div>
              <div className="text-right">Tổng tiền</div>
              <div className="text-center">Trạng thái</div>
              <div className="text-center">Thao tác</div>
          </div>
      )}

      {activeDropdown && (<div id="floating-dropdown-portal" className="fixed z-[9999] bg-white border border-gray-100 rounded-lg shadow-xl max-h-60 overflow-y-auto p-1 animate-fade-in" style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width }}>
        <div onClick={() => activeDropdown === 'STATUS' ? setFilterStatus([]) : setFilterBatch([])} className={`px-3 py-2 rounded-md text-xs font-bold cursor-pointer flex items-center gap-2 transition-colors ${(activeDropdown === 'STATUS' ? filterStatus.length : filterBatch.length) === 0 ? 'bg-eco-50 text-eco-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${(activeDropdown === 'STATUS' ? filterStatus.length : filterBatch.length) === 0 ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>Tất cả</div>
        <div className="border-t border-gray-50 my-1"></div>
        {activeDropdown === 'STATUS' ? (Object.entries(statusLabels).map(([key, label]) => { const status = key as OrderStatus; const isSelected = filterStatus.includes(status); return <div key={status} onClick={() => toggleFilter('STATUS', status)} className={`px-3 py-2 rounded-md text-xs font-medium cursor-pointer flex items-center gap-2 transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${isSelected ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>{label}</div>; })) : (batches.map(batch => { const isSelected = filterBatch.includes(batch); return <div key={batch} onClick={() => toggleFilter('BATCH', batch)} className={`px-3 py-2 rounded-md text-xs font-medium cursor-pointer flex items-center gap-2 transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${isSelected ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>{batch}</div>; }))}
      </div>)}
      <div ref={observerTarget} className="h-px w-full opacity-0 pointer-events-none"></div>
      
      {isPrinting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/70 backdrop-blur-sm">
             <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
                 <div className="w-12 h-12 border-4 border-eco-200 border-t-eco-600 rounded-full animate-spin"></div>
                 <span className="font-bold text-gray-800">Đang tạo PDF...</span>
             </div>
        </div>
      )}
      
      {/* ... (MOVE BATCH, STATS, PRODUCT MODALS - Keeping existing logic, ensuring they render) ... */}
      {/* MOVE BATCH MODAL */}
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
                      <button onClick={confirmMoveBatch} className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl text-sm shadow-lg transition-transform active:scale-95">Chuyển Ngay</button>
                  </div>
              </div>
          </div>
      )}

      {/* DETAIL POPUP (MODAL) */}
      {detailOrder && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={() => setDetailOrder(null)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                  {/* Header */}
                  <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50">
                      <div>
                          <div className="flex items-center gap-2">
                              <h3 className="font-bold text-xl text-gray-800">#{detailOrder.id}</h3>
                              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${detailOrder.status === OrderStatus.DELIVERED ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                  {statusLabels[detailOrder.status]}
                              </span>
                          </div>
                          <div className="text-sm text-gray-500 font-medium mt-1">{detailOrder.customerName}</div>
                      </div>
                      <button onClick={() => setDetailOrder(null)} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center border border-gray-200 shadow-sm"><i className="fas fa-times"></i></button>
                  </div>

                  {/* Body */}
                  <div className="flex-grow overflow-y-auto p-5 space-y-5 bg-white">
                      {/* Customer Info */}
                      <div className="grid grid-cols-2 gap-4">
                          <div className="bg-blue-50 p-3 rounded-xl border border-blue-100">
                              <div className="text-[10px] font-bold text-blue-400 uppercase mb-1">Liên hệ</div>
                              <div className="font-bold text-gray-800 text-sm flex items-center gap-2">
                                  {detailOrder.customerPhone}
                                  <button onClick={handleDetailAction.call} className="text-green-600 bg-white rounded-full p-1 shadow-sm"><i className="fas fa-phone"></i></button>
                              </div>
                          </div>
                          <div className="bg-orange-50 p-3 rounded-xl border border-orange-100">
                              <div className="text-[10px] font-bold text-orange-400 uppercase mb-1">Thanh toán</div>
                              <div className="font-bold text-gray-800 text-sm flex items-center gap-2">
                                  {new Intl.NumberFormat('vi-VN').format(detailOrder.totalPrice)}đ
                                  {detailOrder.paymentVerified ? <i className="fas fa-check-circle text-green-500"></i> : <i className="fas fa-clock text-orange-400"></i>}
                              </div>
                          </div>
                      </div>
                      
                      <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                          <div className="text-[10px] font-bold text-gray-400 uppercase mb-1">Địa chỉ</div>
                          <div className="text-sm font-medium text-gray-800">{detailOrder.address}</div>
                      </div>

                      {detailOrder.notes && (
                          <div className="bg-yellow-50 p-3 rounded-xl border border-yellow-100 text-sm text-yellow-800 italic">
                              <i className="fas fa-sticky-note mr-1"></i> {detailOrder.notes}
                          </div>
                      )}

                      {/* Items */}
                      <div>
                          <div className="text-xs font-bold text-gray-400 uppercase mb-2">Hàng hóa</div>
                          <div className="border border-gray-100 rounded-xl overflow-hidden">
                              {detailOrder.items.map((item, idx) => (
                                  <div key={idx} className="flex justify-between p-3 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                                      <span className="text-sm text-gray-700 font-medium">{item.name}</span>
                                      <div className="text-right">
                                          <div className="font-bold text-gray-900">x{item.quantity}</div>
                                          <div className="text-[10px] text-gray-400">{new Intl.NumberFormat('vi-VN').format(item.price)}</div>
                                      </div>
                                  </div>
                              ))}
                          </div>
                      </div>
                  </div>

                  {/* Footer Actions */}
                  <div className="p-4 bg-gray-50 border-t border-gray-100">
                      <div className="grid grid-cols-4 gap-2 mb-3">
                          <button onClick={handleDetailAction.call} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-green-50 hover:border-green-200 transition-colors">
                              <i className="fas fa-phone text-green-600 mb-1"></i> <span className="text-[9px] font-bold">Gọi</span>
                          </button>
                          <button onClick={handleDetailAction.sms} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-blue-50 hover:border-blue-200 transition-colors">
                              <i className="fas fa-comment text-blue-600 mb-1"></i> <span className="text-[9px] font-bold">SMS</span>
                          </button>
                          <button onClick={handleDetailAction.zalo} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-blue-50 hover:border-blue-200 transition-colors">
                              <span className="font-black text-blue-500 mb-1 text-xs">Z</span> <span className="text-[9px] font-bold">Zalo</span>
                          </button>
                          <button onClick={handleDetailAction.print} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-gray-100 transition-colors">
                              <i className="fas fa-print text-gray-600 mb-1"></i> <span className="text-[9px] font-bold">In</span>
                          </button>
                          
                          <button onClick={handleDetailAction.showQR} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-blue-50 transition-colors">
                              <i className="fas fa-qrcode text-blue-600 mb-1"></i> <span className="text-[9px] font-bold">QR</span>
                          </button>
                          <button onClick={handleDetailAction.splitBatch} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-orange-50 transition-colors">
                              <i className="fas fa-history text-orange-600 mb-1"></i> <span className="text-[9px] font-bold">Tách Lô</span>
                          </button>
                          <button onClick={handleDetailAction.edit} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-gray-100 transition-colors">
                              <i className="fas fa-edit text-gray-600 mb-1"></i> <span className="text-[9px] font-bold">Sửa</span>
                          </button>
                          <button onClick={handleDetailAction.delete} className="flex flex-col items-center justify-center p-2 bg-white rounded-lg border border-gray-200 shadow-sm hover:bg-red-50 hover:border-red-200 transition-colors">
                              <i className="fas fa-trash text-red-600 mb-1"></i> <span className="text-[9px] font-bold">Xóa</span>
                          </button>
                      </div>
                      
                      <div className="flex gap-2">
                          <button onClick={() => handleDetailAction.setStatus(OrderStatus.PICKED_UP)} className={`flex-1 py-3 font-bold rounded-xl text-xs transition-colors ${detailOrder.status === OrderStatus.PICKED_UP ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>Đã Lấy</button>
                          <button onClick={() => handleDetailAction.setStatus(OrderStatus.IN_TRANSIT)} className={`flex-1 py-3 font-bold rounded-xl text-xs transition-colors ${detailOrder.status === OrderStatus.IN_TRANSIT ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>Đang Giao</button>
                          <button onClick={() => handleDetailAction.setStatus(OrderStatus.DELIVERED)} className={`flex-1 py-3 font-bold rounded-xl text-xs transition-colors ${detailOrder.status === OrderStatus.DELIVERED ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-100'}`}>Hoàn Tất</button>
                      </div>
                      
                      {!detailOrder.paymentVerified && (
                          <button onClick={handleDetailAction.confirmPayment} className="w-full mt-2 py-2.5 bg-green-50 text-green-700 font-bold rounded-xl border border-green-200 hover:bg-green-100 transition-colors text-xs flex items-center justify-center gap-2">
                              <i className="fas fa-check-circle"></i> Xác nhận Đã Nhận Tiền
                          </button>
                      )}
                  </div>
              </div>
          </div>
      )}

      {/* STATS MODAL */}
      {showStatsModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[85vh]">
                {/* ... (Existing Stats Content) ... */}
                <div className="p-5 border-b border-gray-100 flex flex-col gap-3 bg-gray-50">
                    <div className="flex justify-between items-center">
                        <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <i className="fas fa-cubes text-purple-600"></i> Thống kê Lô
                        </h3>
                        <button onClick={() => setShowStatsModal(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
                    </div>
                    <div className="text-sm font-bold text-gray-600">
                        {filterBatch.length > 0 ? (
                            <span>Đang xem: <span className="text-purple-600">{filterBatch.join(', ')}</span></span>
                        ) : (
                            <span>Đang xem: <span className="text-green-600">Tất cả đơn hàng (All)</span></span>
                        )}
                    </div>
                </div>
                <div className="flex-grow overflow-y-auto p-0">
                    <table className="w-full text-left text-sm border-collapse">
                        <thead className="bg-gray-100 text-gray-500 text-[10px] font-bold uppercase sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="p-3 pl-4">Sản phẩm</th>
                                <th className="p-3 text-center">SL Đặt</th>
                                <th className="p-3 text-center bg-blue-50/50">Tổng Nhập</th>
                                <th className="p-3 text-center">Tồn Kho</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {batchStatsData.length === 0 ? (
                                <tr><td colSpan={4} className="p-8 text-center text-gray-400">Không có dữ liệu</td></tr>
                            ) : (
                                batchStatsData.map((item, idx) => {
                                    const totalImported = item.productInfo?.totalImported || 0;
                                    const stock = item.productInfo?.stockQuantity || 0;
                                    const estimatedRemaining = totalImported - item.qtyOrdered;
                                    const isOversold = estimatedRemaining < 0;
                                    return (
                                        <tr key={idx} className="hover:bg-gray-50 transition-colors">
                                            <td className="p-3 pl-4">
                                                <div className="flex items-center gap-2">
                                                    <div className="font-bold text-gray-800">{item.name}</div>
                                                    {item.productInfo && (
                                                        <button onClick={() => handleQuickEditProduct(item.productInfo!)} className="text-gray-300 hover:text-purple-600 transition-colors" title="Sửa thông tin hàng"><i className="fas fa-pen text-[10px]"></i></button>
                                                    )}
                                                </div>
                                                {item.productInfo && (
                                                    <div className="text-[10px] text-gray-400 flex items-center gap-1"><i className="fas fa-tag"></i> {new Intl.NumberFormat('vi-VN').format(item.productInfo.defaultPrice)}đ</div>
                                                )}
                                            </td>
                                            <td className="p-3 text-center"><span className="font-black text-gray-800 bg-gray-100 px-2 py-1 rounded-md">{item.qtyOrdered}</span></td>
                                            <td className="p-3 text-center bg-blue-50/30"><div className="font-bold text-blue-600">{totalImported}</div><div className={`text-[10px] font-bold mt-1 ${isOversold ? 'text-red-500' : 'text-green-600'}`}>(Dư: {estimatedRemaining})</div></td>
                                            <td className="p-3 text-center"><span className={`font-bold ${stock < 5 ? 'text-red-500' : 'text-gray-600'}`}>{stock}</span></td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="p-4 border-t border-gray-100 bg-gray-50 flex justify-between items-center">
                    <div className="text-xs text-gray-500 font-medium">Tổng SP: <span className="font-bold text-gray-800">{batchStatsData.length}</span></div>
                    <button onClick={handleShareStats} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-xl font-bold text-xs shadow-lg shadow-purple-200 transition-all active:scale-95 flex items-center gap-2"><i className="fas fa-share-alt"></i> Copy / Chia sẻ</button>
                </div>
            </div>
          </div>
      )}

      {/* ... (Other modals: ProductDetailModal, ProductEditModal, RoutePlannerModal, Reconcile, Bulk Status, Print, Split Batch, Floating Action, Confirm) ... */}
      
      {/* ... (Keep existing ProductDetailModal, ProductEditModal) ... */}
      {viewingProduct && (
          <ProductDetailModal 
            isOpen={!!viewingProduct}
            onClose={() => setViewingProduct(null)}
            product={viewingProduct}
            onImport={() => { setEditingProduct(viewingProduct); setEditProductMode('IMPORT'); setViewingProduct(null); }}
            onAdjust={() => { setEditingProduct(viewingProduct); setEditProductMode('SET'); setViewingProduct(null); }}
          />
      )}
      <ProductEditModal isOpen={!!editingProduct} onClose={() => setEditingProduct(null)} product={editingProduct} onSave={handleSaveProductChange} initialMode={editProductMode} />
      <RoutePlannerModal isOpen={showRoutePlanner} onClose={() => setShowRoutePlanner(false)} orders={filteredOrders} onApplySort={handleSmartRouteSort} />
      
      {/* ... (Confirm Modals) ... */}
      {showBulkStatusModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                  <div className="p-5 bg-gray-50 border-b border-gray-100">
                      <h3 className="font-bold text-gray-800">Cập nhật {selectedOrderIds.size} đơn</h3>
                      <p className="text-xs text-gray-500 mt-1">Chọn trạng thái mới cho các đơn đã chọn</p>
                  </div>
                  <div className="p-4 grid grid-cols-1 gap-3">
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.PENDING)} className="w-full py-3 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 rounded-xl font-bold text-sm transition-all border border-yellow-100 flex items-center justify-center gap-2"><i className="fas fa-clock"></i> Chờ xử lý</button>
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.PICKED_UP)} className="w-full py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl font-bold text-sm transition-all border border-blue-100 flex items-center justify-center gap-2"><i className="fas fa-box-open"></i> Đã lấy hàng</button>
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.IN_TRANSIT)} className="w-full py-3 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl font-bold text-sm transition-all border border-purple-100 flex items-center justify-center gap-2"><i className="fas fa-shipping-fast"></i> Đang giao</button>
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.DELIVERED)} className="w-full py-3 bg-green-50 hover:bg-green-100 text-green-700 rounded-xl font-bold text-sm transition-all border border-green-100 flex items-center justify-center gap-2"><i className="fas fa-check-circle"></i> Đã hoàn tất</button>
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100"><button onClick={() => setShowBulkStatusModal(false)} className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-sm">Hủy</button></div>
              </div>
          </div>
      )}
      
      {/* ... (Print, Split, Bulk Action Bar, Grid/List view renderer) ... */}
      {showPrintTypeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                  <div className="p-5 bg-gray-50 border-b border-gray-100 text-center"><h3 className="font-bold text-gray-800 text-lg">Chọn kiểu in</h3><p className="text-xs text-gray-500 mt-1">{ordersToPrint.length} đơn hàng đã chọn</p></div>
                  <div className="p-4 grid grid-cols-2 gap-4">
                      <button onClick={() => handlePrintConfirm('LIST')} className="flex flex-col items-center justify-center p-4 bg-white border border-gray-200 hover:border-blue-500 hover:bg-blue-50 rounded-xl transition-all group"><i className="fas fa-list-ol text-2xl mb-2 text-gray-400 group-hover:text-blue-600"></i><span className="text-xs font-bold text-gray-700 group-hover:text-blue-700">Danh sách<br/>(Bảng kê)</span></button>
                      <button onClick={() => handlePrintConfirm('INVOICE')} className="flex flex-col items-center justify-center p-4 bg-white border border-gray-200 hover:border-eco-500 hover:bg-eco-50 rounded-xl transition-all group"><i className="fas fa-th text-2xl mb-2 text-gray-400 group-hover:text-eco-600"></i><span className="text-xs font-bold text-gray-700 group-hover:text-eco-700">Hóa đơn<br/>(8 tem/A4)</span></button>
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100"><button onClick={() => setShowPrintTypeModal(false)} className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-sm">Đóng</button></div>
              </div>
          </div>
      )}
      {showBatchSplitModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                  <div className="p-5 bg-gray-50 border-b border-gray-100"><h3 className="font-bold text-gray-800">Số lượng đơn quá lớn ({ordersToPrint.length})</h3><p className="text-xs text-gray-500 mt-1">Để tránh lỗi, vui lòng chọn khoảng in:</p></div>
                  <div className="p-4 space-y-2">
                      <button onClick={() => prepareSplitPrint(ordersToPrint.slice(0, 200))} className="w-full py-3 bg-white border border-gray-200 hover:border-blue-500 hover:text-blue-600 rounded-xl font-bold text-sm transition-all shadow-sm">In 200 đơn đầu (1 - 200)</button>
                      <button onClick={() => prepareSplitPrint(ordersToPrint.slice(200, 400))} className="w-full py-3 bg-white border border-gray-200 hover:border-blue-500 hover:text-blue-600 rounded-xl font-bold text-sm transition-all shadow-sm" disabled={ordersToPrint.length <= 200}>In 200 đơn tiếp (201 - 400)</button>
                      {ordersToPrint.length > 400 && (<button onClick={() => prepareSplitPrint(ordersToPrint.slice(400, 600))} className="w-full py-3 bg-white border border-gray-200 hover:border-blue-500 hover:text-blue-600 rounded-xl font-bold text-sm transition-all shadow-sm">In 200 đơn tiếp (401 - 600)</button>)}
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100"><button onClick={() => setShowBatchSplitModal(false)} className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-sm">Hủy</button></div>
              </div>
          </div>
      )}
      
      {/* Floating Action Bar */}
      <div className={`fixed bottom-6 left-4 right-4 z-[100] transition-transform duration-300 transform ${isSelectionMode ? 'translate-y-0' : 'translate-y-[150%]'}`}>
          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.15)] border border-gray-100 px-3 py-3 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar max-w-3xl mx-auto">
              <div className="flex items-center gap-3 flex-shrink-0"><button onClick={clearSelection} className="w-11 h-11 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 flex items-center justify-center transition-colors"><i className="fas fa-times text-lg"></i></button><div><div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Đã chọn</div><div className="text-xl font-black text-eco-600 leading-none">{selectedOrderIds.size}</div></div></div>
              <div className="h-8 w-px bg-gray-200 flex-shrink-0 mx-1"></div>
              <div className="flex items-center gap-2 flex-grow justify-end">
                  <button onClick={() => setShowBulkStatusModal(true)} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-purple-600 hover:bg-purple-50 transition-colors active:scale-95"><i className="fas fa-exchange-alt mb-0.5 text-lg"></i><span className="text-[9px] font-bold">Status</span></button>
                  <button onClick={handleBulkMoveBatch} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-indigo-600 hover:bg-indigo-50 transition-colors active:scale-95"><i className="fas fa-dolly mb-0.5 text-lg"></i><span className="text-[9px] font-bold">Chuyển Lô</span></button>
                  <button onClick={executeBulkSplit} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-orange-600 hover:bg-orange-50 transition-colors active:scale-95"><i className="fas fa-history mb-0.5 text-lg"></i><span className="text-[9px] font-bold">Giao sau</span></button>
                  <button onClick={executeBulkPrint} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-blue-600 hover:bg-blue-50 transition-colors active:scale-95"><i className="fas fa-print mb-0.5 text-lg"></i><span className="text-[9px] font-bold">In</span></button>
                  <div className="w-px h-8 bg-gray-200 mx-1"></div>
                  <button onClick={() => setShowBulkDeleteConfirm(true)} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-red-500 hover:bg-red-50 transition-colors active:scale-95"><i className="fas fa-trash-alt mb-0.5 text-lg"></i><span className="text-[9px] font-bold">Xóa</span></button>
              </div>
          </div>
      </div>

      <div className={`${isCompactMode ? 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col divide-y divide-gray-100' : (sortBy === 'ROUTE' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4')} mt-1`}>
        {visibleOrders.length === 0 ? (<div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-300"><i className="fas fa-box-open text-6xl mb-4 opacity-50"></i><p className="text-lg font-medium">Không tìm thấy đơn hàng nào</p></div>) : (visibleOrders.map((order, index) => {
            const cust = findCustomerForOrder(order);
            const score = (cust?.priorityScore !== undefined && cust.priorityScore !== null) ? cust.priorityScore : 999999;
            return (
                <div key={order.id} data-index={index} className={`relative transition-all duration-200 order-row ${isCompactMode ? '' : 'flex-grow h-full'}`}>
                    <OrderCard 
                        order={order} 
                        onUpdate={handleUpdate} 
                        onDelete={handleDeleteClick} 
                        onEdit={handleEdit} 
                        isSortMode={sortBy === 'ROUTE'} 
                        index={index} 
                        isCompactMode={isCompactMode} 
                        onTouchStart={(e) => handleTouchStart(e, index)} 
                        onTouchMove={handleTouchMove} 
                        onTouchEnd={handleTouchEnd} 
                        // CHANGED: Use new prop names
                        onRowDragStart={handleDragStart}
                        onRowDragEnter={handleDragEnter}
                        onDragEnd={handleDragEnd}
                        isNewCustomer={newCustomerMap[order.id]} 
                        onSplitBatch={handleSplitBatch}
                        priorityScore={score} 
                        customerData={cust} 
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedOrderIds.has(order.id)}
                        onToggleSelect={toggleSelectOrder}
                        onLongPress={handleLongPress}
                        onShowQR={handleShowQR}
                        onMoveBatch={handleSingleMoveBatch}
                        onViewDetail={handleViewDetail}
                    />
                </div>
            );
        }))}
      </div>

      {visibleCount < filteredOrders.length && (
          <div className="mt-6 text-center">
              <button 
                onClick={handleLoadMore}
                className="bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold py-2 px-6 rounded-xl transition-colors"
              >
                  Xem thêm ({filteredOrders.length - visibleCount})
              </button>
          </div>
      )}

      {/* Editing Modal (Keep same) */}
      {editingOrder && (<div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in"><div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col" ref={editModalRef}><div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50"><div><h3 className="text-xl font-bold text-gray-800">Chỉnh sửa</h3><p className="text-xs text-gray-500">ID: {editingOrder.id}</p></div><button onClick={() => setEditingOrder(null)} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-red-500 hover:text-shadow-md flex items-center justify-center"><i className="fas fa-times"></i></button></div><form onSubmit={saveEdit} className="p-6 space-y-6 flex-grow overflow-y-auto">
          {/* ... (Existing Edit Form Content) ... */}
          <div className="space-y-4"><h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider border-b border-eco-100 pb-1">Khách hàng</h4><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="text-xs font-bold text-gray-500 mb-1 block">Tên khách</label><input value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm font-medium" /></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Số điện thoại</label><input value={editingOrder.customerPhone} onChange={e => setEditingOrder({...editingOrder, customerPhone: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm" /></div></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Địa chỉ</label><textarea value={editingOrder.address} onChange={e => setEditingOrder({...editingOrder, address: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm resize-none" rows={2} /></div></div><div className="space-y-3"><div className="flex justify-between items-center border-b border-eco-100 pb-1"><h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider">Hàng hóa</h4><button type="button" onClick={addEditItem} className="text-xs font-bold text-eco-600 hover:text-eco-700 bg-eco-50 hover:bg-eco-100 px-2 py-1 rounded transition-colors">+ Thêm</button></div><div className="bg-gray-50 rounded-xl p-3 space-y-3">{editingOrder.items.map((item, idx) => { const selectedIds = editingOrder.items.filter((i, iIdx) => iIdx !== idx && i.productId).map(i => i.productId); const availableProducts = products.filter(p => !selectedIds.includes(p.id) && (!item.name || p.name.toLowerCase().includes(item.name.toLowerCase()))); return (<div key={idx} className="flex gap-2 items-start group/editItem relative product-dropdown-container"><div className="flex-grow relative"><input value={item.name} onChange={(e) => updateEditItem(idx, 'name', e.target.value)} onFocus={() => setActiveEditProductRow(idx)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm focus:border-eco-500 outline-none" placeholder="Tên hàng" />{activeEditProductRow === idx && (<div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-xl z-[70] max-h-40 overflow-y-auto">{availableProducts.length === 0 ? (<div className="p-2 text-xs text-gray-400 text-center">{products.length === 0 ? "Kho trống" : "Không tìm thấy"}</div>) : (availableProducts.map(p => (<div key={p.id} onClick={() => selectProductForEditItem(idx, p)} className="px-3 py-2 hover:bg-eco-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-0"><div className="text-sm font-medium text-gray-800">{p.name}</div><div className="text-xs font-bold text-eco-600">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}</div></div>)))}</div>)}</div><div className="w-16"><input type="number" step="any" value={item.quantity === 0 ? '' : item.quantity} onChange={(e) => updateEditItem(idx, 'quantity', e.target.value === '' ? 0 : Number(e.target.value))} className="w-full p-2 text-center bg-white border border-gray-200 rounded-lg text-sm font-bold focus:border-eco-500 outline-none" placeholder="SL" /></div><div className="w-24"><input type="number" step="any" value={item.price === 0 ? '' : item.price} onChange={(e) => updateEditItem(idx, 'price', e.target.value === '' ? 0 : Number(e.target.value))} className="w-full p-2 text-right bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 focus:border-eco-500 outline-none" placeholder="Giá" /></div>{editingOrder.items.length > 1 && (<button type="button" onClick={() => removeEditItem(idx)} className="w-9 h-9 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><i className="fas fa-trash-alt"></i></button>)}</div>); })}</div></div><div className="space-y-4"><h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider border-b border-eco-100 pb-1">Thanh toán & Ghi chú</h4><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-bold text-gray-500 mb-1 block">Tổng tiền</label><input type="number" value={editingOrder.totalPrice} onChange={e => setEditingOrder({...editingOrder, totalPrice: Number(e.target.value)})} className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all font-bold text-gray-800" /></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Hình thức</label><div className="relative"><select value={editingOrder.paymentMethod} onChange={e => setEditingOrder({...editingOrder, paymentMethod: e.target.value as PaymentMethod})} className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all appearance-none font-medium"><option value={PaymentMethod.CASH}>Tiền mặt (COD)</option><option value={PaymentMethod.TRANSFER}>Chuyển khoản</option><option value={PaymentMethod.PAID}>Đã thanh toán</option></select><i className="fas fa-chevron-down absolute right-3 top-3.5 text-gray-400 text-xs pointer-events-none"></i></div></div></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Ghi chú</label><input value={editingOrder.notes} onChange={e => setEditingOrder({...editingOrder, notes: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm" /></div><div className="pt-2"><label className="flex items-center gap-2 cursor-pointer p-3 bg-blue-50 rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors"><input type="checkbox" checked={editingOrder.paymentVerified || false} onChange={e => setEditingOrder({...editingOrder, paymentVerified: e.target.checked})} className="w-5 h-5 text-eco-600 rounded focus:ring-eco-500" /><span className="text-sm font-bold text-blue-800">Đã xác nhận thanh toán (Tiền về)</span></label></div></div><div className="p-5 border-t border-gray-100 flex gap-3"><button type="button" onClick={() => setEditingOrder(null)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded-xl transition-colors">Hủy</button><button type="submit" className="flex-1 py-3 bg-black hover:bg-gray-800 text-white font-bold rounded-xl shadow-lg transition-transform active:scale-95">Lưu Thay Đổi</button></div></form></div></div>)}

      {/* Confirm Modals */}
      <ConfirmModal isOpen={showDeleteConfirm} title="Xóa đơn hàng?" message="Đơn hàng sẽ bị xóa vĩnh viễn và hàng hóa sẽ được hoàn lại kho." onConfirm={confirmDelete} onCancel={() => setShowDeleteConfirm(false)} confirmLabel="Xóa" isDanger={true} />
      <ConfirmModal isOpen={showBulkDeleteConfirm} title={`Xóa ${selectedOrderIds.size} đơn hàng?`} message="Các đơn hàng này sẽ bị xóa vĩnh viễn và hàng hóa sẽ được hoàn lại kho. Hành động này không thể hoàn tác." onConfirm={executeBulkDelete} onCancel={() => setShowBulkDeleteConfirm(false)} confirmLabel="Xóa Vĩnh Viễn" isDanger={true} />
    </div>
  );
};

export default TrackingDashboard;