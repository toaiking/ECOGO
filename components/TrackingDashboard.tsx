
import React, { useEffect, useState, useMemo, useRef, useDeferredValue } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { Order, OrderStatus, PaymentMethod, OrderItem, Product, Customer } from '../types';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';
import { pdfService } from '../services/pdfService';
import { reconciliationService, ReconciliationResult } from '../services/reconciliationService';
import { OrderCard } from './OrderCard';
import ConfirmModal from './ConfirmModal';

type SortOption = 'NEWEST' | 'ROUTE' | 'STATUS';

const TrackingDashboard: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]); 
  const [customers, setCustomers] = useState<Customer[]>([]);

  const [filterStatus, setFilterStatus] = useState<OrderStatus[]>([]);
  const [filterBatch, setFilterBatch] = useState<string[]>([]); 
  const [filterUser, setFilterUser] = useState<string>('ALL');
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
  const [isSorting, setIsSorting] = useState(false); 

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

  // Pagination / Rendering Limit
  const [visibleCount, setVisibleCount] = useState(20);

  const statusLabels: Record<OrderStatus, string> = { [OrderStatus.PENDING]: 'Chờ xử lý', [OrderStatus.PICKED_UP]: 'Đã lấy hàng', [OrderStatus.IN_TRANSIT]: 'Đang giao', [OrderStatus.DELIVERED]: 'Đã giao', [OrderStatus.CANCELLED]: 'Đã hủy' };

  useEffect(() => {
      const observer = new IntersectionObserver(
          ([entry]) => { setIsHeaderVisible(entry.isIntersecting); setActiveDropdown(null); },
          { threshold: 0, rootMargin: "-64px 0px 0px 0px" }
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

  const users = useMemo(() => {
      const userSet = new Set<string>();
      orders.forEach(o => { if (o.lastUpdatedBy) userSet.add(o.lastUpdatedBy); });
      return Array.from(userSet).sort();
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
      const userMatch = filterUser === 'ALL' || o.lastUpdatedBy === filterUser;
      const searchLower = deferredSearchTerm.toLowerCase();
      const searchMatch = !deferredSearchTerm || o.customerName.toLowerCase().includes(searchLower) || o.customerPhone.includes(searchLower) || o.address.toLowerCase().includes(searchLower);
      return statusMatch && batchMatch && userMatch && searchMatch;
    });
    if (sortBy === 'NEWEST') return result.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    if (sortBy === 'STATUS') return result.sort((a, b) => a.status.localeCompare(b.status));
    if (sortBy === 'ROUTE') return result.sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
    return result;
  }, [orders, filterStatus, filterBatch, filterUser, deferredSearchTerm, sortBy]);

  const handleLoadMore = () => {
      setVisibleCount(prev => prev + 20);
  };
  const visibleOrders = filteredOrders.slice(0, visibleCount);

  // --- SELECTION LOGIC ---
  const handleLongPress = (id: string) => {
      setIsSelectionMode(true);
      setSelectedOrderIds(new Set([id]));
      if (navigator.vibrate) navigator.vibrate(50);
  };

  const toggleSelectOrder = (id: string) => {
      const newSet = new Set(selectedOrderIds);
      if (newSet.has(id)) {
          newSet.delete(id);
      } else {
          newSet.add(id);
      }
      setSelectedOrderIds(newSet);
      
      // Auto toggle mode based on selection count
      if (newSet.size > 0 && !isSelectionMode) {
          setIsSelectionMode(true);
      } else if (newSet.size === 0) {
          setIsSelectionMode(false);
      }
  };

  const clearSelection = () => {
      setIsSelectionMode(false);
      setSelectedOrderIds(new Set());
  };

  const executeBulkDelete = async () => {
      if (selectedOrderIds.size === 0) return;
      await storageService.deleteOrdersBatch(Array.from(selectedOrderIds));
      toast.success(`Đã xóa ${selectedOrderIds.size} đơn hàng`);
      clearSelection();
      setShowBulkDeleteConfirm(false);
  };

  const executeBulkSplit = async () => {
      if (selectedOrderIds.size === 0) return;
      const ordersToSplit = orders.filter(o => selectedOrderIds.has(o.id));
      await storageService.splitOrdersBatch(ordersToSplit.map(o => ({ id: o.id, batchId: o.batchId })));
      toast.success(`Đã chuyển ${selectedOrderIds.size} đơn sang lô sau`);
      clearSelection();
  };

  const executeBulkPrint = () => {
      if (selectedOrderIds.size === 0) return;
      const toPrint = orders.filter(o => selectedOrderIds.has(o.id));
      setOrdersToPrint(toPrint);
      setShowPrintTypeModal(true);
  };

  const executeBulkStatusUpdate = async (status: OrderStatus) => {
      if (selectedOrderIds.size === 0) return;
      
      const ids = Array.from(selectedOrderIds);
      const promises = ids.map(id => storageService.updateStatus(id, status));
      
      await Promise.all(promises);
      toast.success(`Đã cập nhật ${ids.length} đơn sang ${statusLabels[status]}`);
      setShowBulkStatusModal(false);
      clearSelection();
  };

  const handleUpdate = (updatedOrder: Order) => {};
  const handleDeleteClick = (id: string) => { setDeleteId(id); setShowDeleteConfirm(true); };
  const confirmDelete = async () => { 
      if (deleteId) { 
          const orderToDelete = orders.find(o => o.id === deleteId);
          await storageService.deleteOrder(deleteId, orderToDelete ? { name: orderToDelete.customerName, address: orderToDelete.address } : undefined); 
          toast.success('Đã xóa đơn hàng'); 
          setShowDeleteConfirm(false); setDeleteId(null); 
      } 
  };
  const handleEdit = (order: Order) => { setEditingOrder(JSON.parse(JSON.stringify(order))); setActiveEditProductRow(null); };
  const saveEdit = async (e: React.FormEvent) => { e.preventDefault(); if (editingOrder) { await storageService.updateOrderDetails(editingOrder); setEditingOrder(null); toast.success('Đã lưu thay đổi'); } };
  const updateEditItem = (index: number, field: keyof OrderItem, value: any) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems[index] = { ...newItems[index], [field]: value }; if (field === 'name') newItems[index].productId = undefined; const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  const selectProductForEditItem = (index: number, product: Product) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems[index] = { ...newItems[index], productId: product.id, name: product.name, price: product.defaultPrice }; const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); setActiveEditProductRow(null); };
  const addEditItem = () => { if (!editingOrder) return; const newItems = [...editingOrder.items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]; setEditingOrder({ ...editingOrder, items: newItems }); };
  const removeEditItem = (index: number) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems.splice(index, 1); const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  const handleSplitBatch = async (order: Order) => { await storageService.splitOrderToNextBatch(order.id, order.batchId); toast.success('Đã chuyển đơn sang lô sau!'); };
  
  const handleAutoSort = async () => { 
      setIsSorting(true);
      setTimeout(async () => {
          try {
              const count = await storageService.autoSortOrders(filteredOrders); 
              setSortBy('ROUTE'); 
              toast.success(`Đã sắp xếp ${count} đơn theo ưu tiên!`); 
          } catch (e: any) {
              console.error(e);
              const errorMessage = e instanceof Error ? e.message : String(e);
              toast.error("Lỗi sắp xếp: " + errorMessage);
          } finally {
              setIsSorting(false);
          }
      }, 50);
  };
  
  const saveReorderedList = async (newSortedList: Order[]) => { 
      const reindexedList = newSortedList.map((o, idx) => ({ ...o, orderIndex: idx })); 
      const newMainOrders = orders.map(o => { 
          const found = reindexedList.find(ro => ro.id === o.id); 
          return found ? found : o; 
      }); 
      setOrders(newMainOrders); 
      await storageService.saveOrdersList(reindexedList);
      await storageService.learnRoutePriority(reindexedList);
      toast.success("Đã học lộ trình mới!", { icon: '🧠', duration: 2000 });
  };
  
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>, position: number) => { dragItem.current = position; e.currentTarget.closest('.order-row')?.classList.add('opacity-50', 'bg-yellow-50'); };
  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => { if (dragItem.current === null) return; const touch = e.touches[0]; const element = document.elementFromPoint(touch.clientX, touch.clientY); const row = element?.closest('[data-index]'); if (row) { const newIndex = parseInt(row.getAttribute('data-index') || '-1'); if (newIndex !== -1 && newIndex !== dragItem.current) { const _orders = [...visibleOrders]; const draggedItemContent = _orders[dragItem.current]; _orders.splice(dragItem.current, 1); _orders.splice(newIndex, 0, draggedItemContent); dragItem.current = newIndex; saveReorderedList(_orders); } } };
  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => { dragItem.current = null; document.querySelectorAll('.order-row').forEach(r => r.classList.remove('opacity-50', 'bg-yellow-50')); };
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, position: number) => { dragItem.current = position; e.currentTarget.classList.add('opacity-40', 'scale-95'); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, position: number) => { dragOverItem.current = position; e.preventDefault(); };
  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => { e.currentTarget.classList.remove('opacity-40', 'scale-95'); if (dragItem.current !== null && dragOverItem.current !== null && sortBy === 'ROUTE') { const _orders = [...visibleOrders]; const draggedItemContent = _orders[dragItem.current]; _orders.splice(dragItem.current, 1); _orders.splice(dragOverItem.current, 0, draggedItemContent); saveReorderedList(_orders); } dragItem.current = null; dragOverItem.current = null; };

  const copyRouteToClipboard = () => { const addressList = filteredOrders.filter(o => o.status !== OrderStatus.CANCELLED && o.status !== OrderStatus.DELIVERED).map(o => `- ${o.address} (${o.customerName})`).join('\n'); if (!addressList) { toast('Không có đơn hàng nào cần giao'); return; } navigator.clipboard.writeText(addressList); toast.success('Đã copy danh sách địa chỉ!'); };
  
  const handleBatchPrintClick = () => {
      if (filteredOrders.length === 0) { toast.error("Không có đơn hàng nào để in"); return; }
      setOrdersToPrint(filteredOrders);
      if (filteredOrders.length > 200) { setShowBatchSplitModal(true); } else { setShowPrintTypeModal(true); }
  };

  const handlePrintConfirm = async (type: 'LIST' | 'INVOICE') => {
      setShowPrintTypeModal(false);
      setShowBatchSplitModal(false);
      setIsPrinting(true);
      const batchName = filterBatch.length === 1 ? filterBatch[0] : `Batch_${new Date().getTime()}`;
      try {
          if (type === 'LIST') { await pdfService.generateCompactList(ordersToPrint, batchName); } 
          else { await pdfService.generateInvoiceBatch(ordersToPrint, batchName); }
          toast.success("Đã tạo file PDF!");
          if (isSelectionMode) clearSelection();
      } catch (e: any) {
          console.error(e);
          const errorMessage = e instanceof Error ? e.message : String(e);
          toast.error("Lỗi tạo PDF: " + errorMessage);
      } finally { setIsPrinting(false); setOrdersToPrint([]); }
  };

  const prepareSplitPrint = (subset: Order[]) => { setOrdersToPrint(subset); setShowBatchSplitModal(false); setShowPrintTypeModal(true); };

  const handleReconcileFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.type !== 'application/pdf') { toast.error("Vui lòng chọn file PDF"); return; }
      setIsReconciling(true);
      try {
          const result = await reconciliationService.reconcileOrders(file, orders);
          setReconcileResult(result);
          if (result.matchedOrders.length === 0) { toast('Không tìm thấy giao dịch nào khớp.', { icon: '🔍' }); } else { toast.success(`Tìm thấy ${result.matchedOrders.length} giao dịch khớp!`); }
      } catch (error: any) {
          console.error(error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          toast.error(`Lỗi đọc file PDF: ${errorMessage}`);
      } finally { setIsReconciling(false); }
  };

  const confirmReconciliation = async () => {
      if (!reconcileResult || reconcileResult.matchedOrders.length === 0) return;
      const promises = reconcileResult.matchedOrders.map(order => storageService.updatePaymentVerification(order.id, true, { name: order.customerName }));
      await Promise.all(promises);
      toast.success(`Đã xác nhận thanh toán cho ${reconcileResult.matchedOrders.length} đơn!`);
      setShowReconcileModal(false);
      setReconcileResult(null);
  };

  const toggleFilter = (type: 'STATUS' | 'BATCH', value: any) => { if (type === 'STATUS') setFilterStatus(prev => prev.includes(value) ? prev.filter(s => s !== value) : [...prev, value]); if (type === 'BATCH') setFilterBatch(prev => prev.includes(value) ? prev.filter(b => b !== value) : [...prev, value]); };
  const getLabel = (type: 'STATUS' | 'BATCH') => { if (type === 'STATUS') return filterStatus.length === 0 ? 'Trạng thái' : (filterStatus.length === 1 ? statusLabels[filterStatus[0]] : `Đã chọn (${filterStatus.length})`); if (type === 'BATCH') return filterBatch.length === 0 ? 'Lô: Tất cả' : (filterBatch.length === 1 ? filterBatch[0] : `Lô (${filterBatch.length})`); return ''; };
  const openDropdown = (type: 'STATUS' | 'BATCH') => { const ref = type === 'STATUS' ? statusDropdownBtnRef : batchDropdownBtnRef; if (ref.current) { const rect = ref.current.getBoundingClientRect(); setDropdownPos({ top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 160) }); setActiveDropdown(activeDropdown === type ? null : type); } };

  return (
    <div className="animate-fade-in pb-32">
      <div className="sticky top-16 z-30 bg-gray-50/95 backdrop-blur-sm transition-shadow shadow-sm">
         <div className="bg-white border-b border-gray-200 p-2 shadow-sm">
             <div className="flex gap-2 items-center mb-2">
                <div className="relative flex-grow">
                    <i className="fas fa-search absolute left-3 top-2.5 text-gray-400 text-sm"></i>
                    <input placeholder="Tìm tên, sđt, địa chỉ..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-100 border-transparent focus:bg-white focus:ring-2 focus:ring-eco-100 text-sm font-medium outline-none transition-all" />
                </div>
                <button onClick={() => setIsCompactMode(!isCompactMode)} className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg border transition-all ${isCompactMode ? 'bg-eco-100 text-eco-700 border-eco-200' : 'bg-white text-gray-400 border-gray-200'}`}><i className={`fas ${isCompactMode ? 'fa-list' : 'fa-th-large'}`}></i></button>
                <button onClick={handleBatchPrintClick} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-blue-600 border border-gray-200" title="In Lô Hàng"><i className="fas fa-print"></i></button>
                <button onClick={() => setShowReconcileModal(true)} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-green-600 border border-gray-200" title="Đối soát Ngân hàng"><i className="fas fa-file-invoice-dollar"></i></button>
                <button onClick={copyRouteToClipboard} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-white text-gray-500 hover:text-eco-600 border border-gray-200"><i className="fas fa-map-marked-alt"></i></button>
             </div>
             <div className={`grid transition-[grid-template-rows] duration-300 ease-out ${isHeaderVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}><div className="overflow-hidden"><div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                <div className="relative flex-1 min-w-[100px]"><button ref={batchDropdownBtnRef} onClick={() => openDropdown('BATCH')} className="w-full pl-2 pr-6 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs font-bold text-gray-700 text-left flex items-center justify-between outline-none truncate"><span className="truncate">{getLabel('BATCH')}</span><i className="fas fa-chevron-down text-gray-400 text-[10px]"></i></button></div>
                {users.length > 0 && (<div className="relative flex-1 min-w-[90px]"><select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="w-full pl-2 pr-6 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700 appearance-none outline-none"><option value="ALL">User: All</option>{users.map(u => <option key={u} value={u}>{u}</option>)}</select><i className="fas fa-user absolute right-2 top-2 text-gray-400 text-[10px] pointer-events-none"></i></div>)}
                <div className="relative flex-1 min-w-[110px]"><button ref={statusDropdownBtnRef} onClick={() => openDropdown('STATUS')} className="w-full pl-2 pr-6 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs font-medium text-gray-700 text-left flex items-center justify-between outline-none truncate"><span className="truncate">{getLabel('STATUS')}</span><i className="fas fa-chevron-down text-gray-400 text-[10px]"></i></button></div>
                <div className="flex bg-gray-100 rounded-lg p-0.5 flex-shrink-0">
                    <button onClick={() => setSortBy('NEWEST')} className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all ${sortBy === 'NEWEST' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-400'}`}>Mới</button>
                    <button 
                        onClick={() => { if(sortBy !== 'ROUTE') handleAutoSort(); }} 
                        className={`px-2 py-1 rounded-md text-[10px] font-bold transition-all flex items-center gap-1 ${sortBy === 'ROUTE' ? 'bg-white shadow-sm text-eco-700' : 'text-gray-400'}`}
                        disabled={isSorting}
                    >
                        {isSorting ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-route"></i>} 
                        Auto Sort
                    </button>
                </div>
             </div></div></div>
         </div>
      </div>
      {activeDropdown && (<div id="floating-dropdown-portal" className="fixed z-[9999] bg-white border border-gray-100 rounded-lg shadow-xl max-h-60 overflow-y-auto p-1 animate-fade-in" style={{ top: dropdownPos.top, left: dropdownPos.left, minWidth: dropdownPos.width }}>
        <div onClick={() => activeDropdown === 'STATUS' ? setFilterStatus([]) : setFilterBatch([])} className={`px-3 py-2 rounded-md text-xs font-bold cursor-pointer flex items-center gap-2 transition-colors ${(activeDropdown === 'STATUS' ? filterStatus.length : filterBatch.length) === 0 ? 'bg-eco-50 text-eco-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${(activeDropdown === 'STATUS' ? filterStatus.length : filterBatch.length) === 0 ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>Tất cả</div>
        <div className="border-t border-gray-50 my-1"></div>
        {activeDropdown === 'STATUS' ? (Object.entries(statusLabels).map(([key, label]) => { const status = key as OrderStatus; const isSelected = filterStatus.includes(status); return <div key={status} onClick={() => toggleFilter('STATUS', status)} className={`px-3 py-2 rounded-md text-xs font-medium cursor-pointer flex items-center gap-2 transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${isSelected ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>{label}</div>; })) : (batches.map(batch => { const isSelected = filterBatch.includes(batch); return <div key={batch} onClick={() => toggleFilter('BATCH', batch)} className={`px-3 py-2 rounded-md text-xs font-medium cursor-pointer flex items-center gap-2 transition-colors ${isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50 text-gray-700'}`}><i className={`fas ${isSelected ? 'fa-check-square' : 'fa-square text-gray-300'}`}></i>{batch}</div>; }))}
      </div>)}
      <div ref={observerTarget} className="h-px w-full opacity-0 pointer-events-none"></div>
      
      {isSorting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/50 backdrop-blur-[1px]">
             <div className="bg-black/80 text-white px-6 py-3 rounded-2xl flex items-center gap-3 shadow-xl">
                 <i className="fas fa-sync fa-spin"></i>
                 <span className="font-bold text-sm">Đang tính toán lộ trình...</span>
             </div>
        </div>
      )}
      
      {isPrinting && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/70 backdrop-blur-sm">
             <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-2xl flex flex-col items-center gap-4">
                 <div className="w-12 h-12 border-4 border-eco-200 border-t-eco-600 rounded-full animate-spin"></div>
                 <span className="font-bold text-gray-800">Đang tạo PDF...</span>
             </div>
        </div>
      )}

      {/* RECONCILIATION MODAL */}
      {showReconcileModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-5 bg-gray-50 border-b border-gray-100 flex justify-between items-center">
                      <div>
                          <h3 className="font-bold text-gray-800 text-lg">Đối soát Ngân hàng</h3>
                          <p className="text-xs text-gray-500">Tải lên sao kê PDF để tìm đơn đã thanh toán</p>
                      </div>
                      <button onClick={() => { setShowReconcileModal(false); setReconcileResult(null); }} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
                  </div>
                  
                  <div className="p-6 overflow-y-auto space-y-4">
                      {!reconcileResult && (
                          <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:bg-gray-50 transition-colors relative">
                              <input 
                                  type="file" 
                                  accept="application/pdf" 
                                  onChange={handleReconcileFile} 
                                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  disabled={isReconciling}
                              />
                              {isReconciling ? (
                                  <div className="flex flex-col items-center text-eco-600">
                                      <i className="fas fa-spinner fa-spin text-3xl mb-3"></i>
                                      <span className="font-bold text-sm">Đang đọc PDF...</span>
                                  </div>
                              ) : (
                                  <div className="flex flex-col items-center text-gray-400">
                                      <i className="fas fa-file-pdf text-4xl mb-3"></i>
                                      <span className="font-bold text-gray-600">Chọn file Sao kê (PDF)</span>
                                      <span className="text-xs mt-1">Hệ thống sẽ tìm mã đơn "DH..."</span>
                                  </div>
                              )}
                          </div>
                      )}

                      {reconcileResult && (
                          <div className="space-y-4">
                              <div className="flex justify-between items-center bg-green-50 p-3 rounded-xl border border-green-100">
                                  <div className="flex items-center gap-3">
                                      <div className="w-10 h-10 rounded-full bg-green-100 text-green-600 flex items-center justify-center font-bold">
                                          {reconcileResult.matchedOrders.length}
                                      </div>
                                      <div>
                                          <div className="text-sm font-bold text-gray-800">Đơn khớp lệnh</div>
                                          <div className="text-xs text-gray-500">Tìm thấy trong sao kê</div>
                                      </div>
                                  </div>
                                  <div className="text-right">
                                      <div className="text-lg font-black text-green-700">
                                          {new Intl.NumberFormat('vi-VN').format(reconcileResult.totalMatchedAmount)}đ
                                      </div>
                                  </div>
                              </div>

                              <div className="max-h-60 overflow-y-auto border border-gray-100 rounded-xl divide-y divide-gray-50">
                                  {reconcileResult.matchedOrders.length === 0 ? (
                                      <div className="p-4 text-center text-gray-400 text-sm">Không tìm thấy mã đơn nào trong file.</div>
                                  ) : (
                                      reconcileResult.matchedOrders.map(o => (
                                          <div key={o.id} className="p-3 flex justify-between items-center hover:bg-gray-50">
                                              <div>
                                                  <div className="font-bold text-sm text-gray-800">{o.customerName}</div>
                                                  <div className="text-xs text-gray-400">#{o.id}</div>
                                              </div>
                                              <div className="text-sm font-bold text-gray-700">
                                                  {new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ
                                              </div>
                                          </div>
                                      ))
                                  )}
                              </div>
                              
                              <div className="text-[10px] text-gray-400 bg-gray-50 p-2 rounded border border-gray-100 font-mono h-20 overflow-hidden relative group">
                                  <div className="absolute top-1 right-2 text-[8px] uppercase font-bold text-gray-300">Preview Text</div>
                                  {reconcileResult.rawTextPreview}
                              </div>
                          </div>
                      )}
                  </div>

                  {reconcileResult && reconcileResult.matchedOrders.length > 0 && (
                      <div className="p-4 bg-gray-50 border-t border-gray-100">
                          <button 
                              onClick={confirmReconciliation}
                              className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl shadow-lg shadow-green-100 transition-all active:scale-95 flex items-center justify-center gap-2"
                          >
                              <i className="fas fa-check-circle"></i> Xác nhận Đã Thanh Toán
                          </button>
                      </div>
                  )}
                  {reconcileResult && reconcileResult.matchedOrders.length === 0 && (
                       <div className="p-4 bg-gray-50 border-t border-gray-100">
                          <button 
                              onClick={() => setReconcileResult(null)}
                              className="w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-xl transition-all"
                          >
                              Thử lại file khác
                          </button>
                      </div>
                  )}
              </div>
          </div>
      )}
      
      {/* BULK STATUS UPDATE MODAL */}
      {showBulkStatusModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                  <div className="p-5 bg-gray-50 border-b border-gray-100">
                      <h3 className="font-bold text-gray-800">Cập nhật {selectedOrderIds.size} đơn</h3>
                      <p className="text-xs text-gray-500 mt-1">Chọn trạng thái mới cho các đơn đã chọn</p>
                  </div>
                  <div className="p-4 grid grid-cols-1 gap-3">
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.PENDING)} className="w-full py-3 bg-yellow-50 hover:bg-yellow-100 text-yellow-700 rounded-xl font-bold text-sm transition-all border border-yellow-100 flex items-center justify-center gap-2">
                          <i className="fas fa-clock"></i> Chờ xử lý
                      </button>
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.PICKED_UP)} className="w-full py-3 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-xl font-bold text-sm transition-all border border-blue-100 flex items-center justify-center gap-2">
                          <i className="fas fa-box-open"></i> Đã lấy hàng
                      </button>
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.IN_TRANSIT)} className="w-full py-3 bg-purple-50 hover:bg-purple-100 text-purple-700 rounded-xl font-bold text-sm transition-all border border-purple-100 flex items-center justify-center gap-2">
                          <i className="fas fa-shipping-fast"></i> Đang giao
                      </button>
                      <button onClick={() => executeBulkStatusUpdate(OrderStatus.DELIVERED)} className="w-full py-3 bg-green-50 hover:bg-green-100 text-green-700 rounded-xl font-bold text-sm transition-all border border-green-100 flex items-center justify-center gap-2">
                          <i className="fas fa-check-circle"></i> Đã hoàn tất
                      </button>
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100">
                      <button onClick={() => setShowBulkStatusModal(false)} className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-sm">Hủy</button>
                  </div>
              </div>
          </div>
      )}
      
      {/* PRINT TYPE MODAL */}
      {showPrintTypeModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                  <div className="p-5 bg-gray-50 border-b border-gray-100 text-center">
                      <h3 className="font-bold text-gray-800 text-lg">Chọn kiểu in</h3>
                      <p className="text-xs text-gray-500 mt-1">{ordersToPrint.length} đơn hàng đã chọn</p>
                  </div>
                  <div className="p-4 grid grid-cols-2 gap-4">
                      <button onClick={() => handlePrintConfirm('LIST')} className="flex flex-col items-center justify-center p-4 bg-white border border-gray-200 hover:border-blue-500 hover:bg-blue-50 rounded-xl transition-all group">
                          <i className="fas fa-list-ol text-2xl mb-2 text-gray-400 group-hover:text-blue-600"></i>
                          <span className="text-xs font-bold text-gray-700 group-hover:text-blue-700">Danh sách<br/>(Bảng kê)</span>
                      </button>
                      <button onClick={() => handlePrintConfirm('INVOICE')} className="flex flex-col items-center justify-center p-4 bg-white border border-gray-200 hover:border-eco-500 hover:bg-eco-50 rounded-xl transition-all group">
                          <i className="fas fa-th text-2xl mb-2 text-gray-400 group-hover:text-eco-600"></i>
                          <span className="text-xs font-bold text-gray-700 group-hover:text-eco-700">Hóa đơn<br/>(8 tem/A4)</span>
                      </button>
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100">
                      <button onClick={() => setShowPrintTypeModal(false)} className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-sm">Đóng</button>
                  </div>
              </div>
          </div>
      )}

      {/* SPLIT BATCH MODAL */}
      {showBatchSplitModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
                  <div className="p-5 bg-gray-50 border-b border-gray-100">
                      <h3 className="font-bold text-gray-800">Số lượng đơn quá lớn ({ordersToPrint.length})</h3>
                      <p className="text-xs text-gray-500 mt-1">Để tránh lỗi, vui lòng chọn khoảng in:</p>
                  </div>
                  <div className="p-4 space-y-2">
                      <button onClick={() => prepareSplitPrint(ordersToPrint.slice(0, 200))} className="w-full py-3 bg-white border border-gray-200 hover:border-blue-500 hover:text-blue-600 rounded-xl font-bold text-sm transition-all shadow-sm">
                          In 200 đơn đầu (1 - 200)
                      </button>
                      <button onClick={() => prepareSplitPrint(ordersToPrint.slice(200, 400))} className="w-full py-3 bg-white border border-gray-200 hover:border-blue-500 hover:text-blue-600 rounded-xl font-bold text-sm transition-all shadow-sm" disabled={ordersToPrint.length <= 200}>
                          In 200 đơn tiếp (201 - 400)
                      </button>
                      {ordersToPrint.length > 400 && (
                          <button onClick={() => prepareSplitPrint(ordersToPrint.slice(400, 600))} className="w-full py-3 bg-white border border-gray-200 hover:border-blue-500 hover:text-blue-600 rounded-xl font-bold text-sm transition-all shadow-sm">
                              In 200 đơn tiếp (401 - 600)
                          </button>
                      )}
                  </div>
                  <div className="p-4 bg-gray-50 border-t border-gray-100">
                      <button onClick={() => setShowBatchSplitModal(false)} className="w-full py-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg text-sm">Hủy</button>
                  </div>
              </div>
          </div>
      )}
      
      {/* FLOATING ACTION BAR (BULK ACTIONS) */}
      <div 
        className={`fixed bottom-6 left-4 right-4 z-[100] transition-transform duration-300 transform ${isSelectionMode ? 'translate-y-0' : 'translate-y-[150%]'}`}
      >
          <div className="bg-white rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.15)] border border-gray-100 px-3 py-3 flex items-center justify-between gap-3 overflow-x-auto no-scrollbar max-w-3xl mx-auto">
              <div className="flex items-center gap-3 flex-shrink-0">
                  <button onClick={clearSelection} className="w-11 h-11 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700 flex items-center justify-center transition-colors">
                      <i className="fas fa-times text-lg"></i>
                  </button>
                  <div>
                      <div className="text-xs font-bold text-gray-500 uppercase tracking-wide">Đã chọn</div>
                      <div className="text-xl font-black text-eco-600 leading-none">{selectedOrderIds.size}</div>
                  </div>
              </div>
              
              <div className="h-8 w-px bg-gray-200 flex-shrink-0 mx-1"></div>
              
              <div className="flex items-center gap-2 flex-grow justify-end">
                  <button onClick={() => setShowBulkStatusModal(true)} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-purple-600 hover:bg-purple-50 transition-colors active:scale-95">
                      <i className="fas fa-exchange-alt mb-0.5 text-lg"></i>
                      <span className="text-[9px] font-bold">Status</span>
                  </button>
                  <button onClick={executeBulkSplit} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-orange-600 hover:bg-orange-50 transition-colors active:scale-95">
                      <i className="fas fa-history mb-0.5 text-lg"></i>
                      <span className="text-[9px] font-bold">Giao sau</span>
                  </button>
                  <button onClick={executeBulkPrint} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-blue-600 hover:bg-blue-50 transition-colors active:scale-95">
                      <i className="fas fa-print mb-0.5 text-lg"></i>
                      <span className="text-[9px] font-bold">In</span>
                  </button>
                  <div className="w-px h-8 bg-gray-200 mx-1"></div>
                  <button onClick={() => setShowBulkDeleteConfirm(true)} className="flex flex-col items-center justify-center w-14 h-12 rounded-xl text-red-500 hover:bg-red-50 transition-colors active:scale-95">
                      <i className="fas fa-trash-alt mb-0.5 text-lg"></i>
                      <span className="text-[9px] font-bold">Xóa</span>
                  </button>
              </div>
          </div>
      </div>

      <div className={`${isCompactMode ? 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col divide-y divide-gray-100' : (sortBy === 'ROUTE' ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4')} mt-1`}>
        {visibleOrders.length === 0 ? (<div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-300"><i className="fas fa-box-open text-6xl mb-4 opacity-50"></i><p className="text-lg font-medium">Không tìm thấy đơn hàng nào</p></div>) : (visibleOrders.map((order, index) => {
            const cust = findCustomerForOrder(order);
            const score = (cust?.priorityScore !== undefined && cust.priorityScore !== null) ? cust.priorityScore : 999999;
            return (
                <div key={order.id} data-index={index} draggable={sortBy === 'ROUTE'} onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()} className={`relative transition-all duration-200 order-row`}><div className="flex-grow h-full">
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
                        isNewCustomer={newCustomerMap[order.id]} 
                        onSplitBatch={handleSplitBatch}
                        priorityScore={score} 
                        customerData={cust} 
                        isSelectionMode={isSelectionMode}
                        isSelected={selectedOrderIds.has(order.id)}
                        onToggleSelect={toggleSelectOrder}
                        onLongPress={handleLongPress}
                    /></div></div>
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

      {editingOrder && (<div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in"><div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col" ref={editModalRef}><div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50"><div><h3 className="text-xl font-bold text-gray-800">Chỉnh sửa</h3><p className="text-xs text-gray-500">ID: {editingOrder.id}</p></div><button onClick={() => setEditingOrder(null)} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-red-500 hover:shadow-md flex items-center justify-center"><i className="fas fa-times"></i></button></div><form onSubmit={saveEdit} className="p-6 space-y-6 flex-grow overflow-y-auto"><div className="space-y-4"><h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider border-b border-eco-100 pb-1">Khách hàng</h4><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="text-xs font-bold text-gray-500 mb-1 block">Tên khách</label><input value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm font-medium" /></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Số điện thoại</label><input value={editingOrder.customerPhone} onChange={e => setEditingOrder({...editingOrder, customerPhone: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm" /></div></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Địa chỉ</label><textarea value={editingOrder.address} onChange={e => setEditingOrder({...editingOrder, address: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm resize-none" rows={2} /></div></div><div className="space-y-3"><div className="flex justify-between items-center border-b border-eco-100 pb-1"><h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider">Hàng hóa</h4><button type="button" onClick={addEditItem} className="text-xs font-bold text-eco-600 hover:text-eco-700 bg-eco-50 hover:bg-eco-100 px-2 py-1 rounded transition-colors">+ Thêm</button></div><div className="bg-gray-50 rounded-xl p-3 space-y-3">{editingOrder.items.map((item, idx) => { const selectedIds = editingOrder.items.filter((i, iIdx) => iIdx !== idx && i.productId).map(i => i.productId); const availableProducts = products.filter(p => !selectedIds.includes(p.id) && (!item.name || p.name.toLowerCase().includes(item.name.toLowerCase()))); return (<div key={idx} className="flex gap-2 items-start group/editItem relative product-dropdown-container"><div className="flex-grow relative"><input value={item.name} onChange={(e) => updateEditItem(idx, 'name', e.target.value)} onFocus={() => setActiveEditProductRow(idx)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm focus:border-eco-500 outline-none" placeholder="Tên hàng" />{activeEditProductRow === idx && (<div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-xl z-[70] max-h-40 overflow-y-auto">{availableProducts.length === 0 ? (<div className="p-2 text-xs text-gray-400 text-center">{products.length === 0 ? "Kho trống" : "Không tìm thấy"}</div>) : (availableProducts.map(p => (<div key={p.id} onClick={() => selectProductForEditItem(idx, p)} className="px-3 py-2 hover:bg-eco-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-0"><div className="text-sm font-medium text-gray-800">{p.name}</div><div className="text-xs font-bold text-eco-600">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}</div></div>)))}</div>)}</div><div className="w-16"><input type="number" step="any" value={item.quantity === 0 ? '' : item.quantity} onChange={(e) => updateEditItem(idx, 'quantity', e.target.value === '' ? 0 : Number(e.target.value))} className="w-full p-2 text-center bg-white border border-gray-200 rounded-lg text-sm font-bold focus:border-eco-500 outline-none" placeholder="SL" /></div><div className="w-24"><input type="number" step="any" value={item.price === 0 ? '' : item.price} onChange={(e) => updateEditItem(idx, 'price', e.target.value === '' ? 0 : Number(e.target.value))} className="w-full p-2 text-right bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 focus:border-eco-500 outline-none" placeholder="Giá" /></div>{editingOrder.items.length > 1 && (<button type="button" onClick={() => removeEditItem(idx)} className="w-9 h-9 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><i className="fas fa-trash-alt"></i></button>)}</div>); })}</div></div><div className="space-y-4"><h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider border-b border-eco-100 pb-1">Thanh toán & Ghi chú</h4><div className="grid grid-cols-2 gap-4"><div><label className="text-xs font-bold text-gray-500 mb-1 block">Tổng tiền</label><input type="number" value={editingOrder.totalPrice} onChange={e => setEditingOrder({...editingOrder, totalPrice: Number(e.target.value)})} className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all font-bold text-gray-800" /></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Hình thức</label><div className="relative"><select value={editingOrder.paymentMethod} onChange={e => setEditingOrder({...editingOrder, paymentMethod: e.target.value as PaymentMethod})} className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all appearance-none text-sm font-medium"><option value={PaymentMethod.CASH}>Tiền mặt</option><option value={PaymentMethod.TRANSFER}>Chuyển khoản</option><option value={PaymentMethod.PAID}>Đã thanh toán</option></select><i className="fas fa-chevron-down absolute right-3 top-4 text-gray-400 text-xs pointer-events-none"></i></div></div></div><div><label className="text-xs font-bold text-gray-500 mb-1 block">Ghi chú</label><textarea value={editingOrder.notes || ''} onChange={e => setEditingOrder({...editingOrder, notes: e.target.value})} className="w-full p-3 bg-yellow-50/50 border border-yellow-100 focus:bg-white focus:border-yellow-400 rounded-lg outline-none transition-all text-sm text-yellow-900 placeholder-yellow-300 resize-none" placeholder="Ghi chú thêm..." rows={2} /></div></div></form><div className="p-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl"><button onClick={saveEdit} className="w-full py-3.5 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg shadow-gray-200 active:scale-95">Lưu Thay Đổi</button></div></div></div>)}
      <ConfirmModal isOpen={showDeleteConfirm} title="Xóa đơn hàng?" message="Hành động này không thể hoàn tác. Bạn có chắc chắn muốn xóa đơn hàng này?" onConfirm={confirmDelete} onCancel={() => setShowDeleteConfirm(false)} confirmLabel="Xóa" isDanger={true} />
      
      {/* BULK DELETE CONFIRM */}
      <ConfirmModal 
        isOpen={showBulkDeleteConfirm} 
        title={`Xóa ${selectedOrderIds.size} đơn hàng?`} 
        message="Bạn có chắc chắn muốn xóa các đơn hàng đã chọn? Hành động này không thể hoàn tác." 
        onConfirm={executeBulkDelete} 
        onCancel={() => setShowBulkDeleteConfirm(false)} 
        confirmLabel="Xóa Tất Cả" 
        isDanger={true} 
      />
    </div>
  );
};

export default TrackingDashboard;
