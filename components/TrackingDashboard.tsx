import React, { useEffect, useState, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { Order, OrderStatus, PaymentMethod, OrderItem, Product } from '../types';
import { storageService } from '../services/storageService';
import { OrderCard } from './OrderCard';
import ConfirmModal from './ConfirmModal';

type SortOption = 'NEWEST' | 'ROUTE' | 'STATUS';

const TrackingDashboard: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]); 
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'ALL'>('ALL');
  const [filterBatch, setFilterBatch] = useState<string>('ALL');
  const [filterUser, setFilterUser] = useState<string>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('NEWEST');
  const [isCompactMode, setIsCompactMode] = useState(false); 
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [activeEditProductRow, setActiveEditProductRow] = useState<number | null>(null); 
  const [showReport, setShowReport] = useState(false);
  
  // Smart Scroll State: Intersection Observer for Zero Lag
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const observerTarget = useRef<HTMLDivElement>(null);

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const dragItem = useRef<number | null>(null);
  const dragOverItem = useRef<number | null>(null);
  const editModalRef = useRef<HTMLDivElement>(null);

  // SCROLL LOGIC - ZERO LAG INTERSECTION OBSERVER
  useEffect(() => {
      const observer = new IntersectionObserver(
          ([entry]) => {
              setIsHeaderVisible(entry.isIntersecting);
          },
          { threshold: 0, rootMargin: "-64px 0px 0px 0px" }
      );

      if (observerTarget.current) {
          observer.observe(observerTarget.current);
      }

      return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const unsubscribeOrders = storageService.subscribeOrders((data) => {
        setOrders(data);
    });
    const unsubscribeProducts = storageService.subscribeProducts((data) => {
        setProducts(data);
    });
    return () => {
        if (typeof unsubscribeOrders === 'function') unsubscribeOrders();
        if (typeof unsubscribeProducts === 'function') unsubscribeProducts();
    };
  }, []);

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (activeEditProductRow !== null && !(event.target as Element).closest('.product-dropdown-container')) {
              setActiveEditProductRow(null);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeEditProductRow]);

  const batches = useMemo(() => {
    const batchActivity = new Map<string, number>();
    orders.forEach(o => {
        if (o.batchId) {
            const lastTime = batchActivity.get(o.batchId) || 0;
            batchActivity.set(o.batchId, Math.max(lastTime, o.createdAt));
        }
    });
    return Array.from(batchActivity.entries()).sort((a, b) => b[1] - a[1]).map(entry => entry[0]).slice(0, 50);
  }, [orders]);

  const users = useMemo(() => {
      const userSet = new Set<string>();
      orders.forEach(o => { if (o.lastUpdatedBy) userSet.add(o.lastUpdatedBy); });
      return Array.from(userSet).sort();
  }, [orders]);
  
  const filteredOrders = useMemo(() => {
    let result = orders.filter(o => {
      const statusMatch = filterStatus === 'ALL' || o.status === filterStatus;
      const batchMatch = filterBatch === 'ALL' || o.batchId === filterBatch;
      const userMatch = filterUser === 'ALL' || o.lastUpdatedBy === filterUser;
      const searchLower = searchTerm.toLowerCase();
      const searchMatch = !searchTerm || 
          o.customerName.toLowerCase().includes(searchLower) ||
          o.customerPhone.includes(searchLower) ||
          o.address.toLowerCase().includes(searchLower);
      return statusMatch && batchMatch && userMatch && searchMatch;
    });

    if (sortBy === 'NEWEST') {
      return result.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    }
    if (sortBy === 'STATUS') return result.sort((a, b) => a.status.localeCompare(b.status));
    if (sortBy === 'ROUTE') {
      return result.sort((a, b) => (Number(a.orderIndex) || 0) - (Number(b.orderIndex) || 0));
    }
    return result;
  }, [orders, filterStatus, filterBatch, filterUser, searchTerm, sortBy]);

  const report = useMemo(() => {
    const stats = { count: 0, totalRevenue: 0, totalCash: 0, cashCollected: 0, totalTransfer: 0, transferReceived: 0, transferPending: 0, totalPrepaid: 0, productQuantities: {} as Record<string, number> };
    return filteredOrders.reduce((acc, order) => {
        if (order.status !== OrderStatus.CANCELLED) {
            const price = Number(order.totalPrice) || 0;
            acc.totalRevenue += price;
            if (order.paymentMethod === PaymentMethod.CASH) {
                acc.totalCash += price;
                if (order.status === OrderStatus.DELIVERED) acc.cashCollected += price;
            } else if (order.paymentMethod === PaymentMethod.TRANSFER) {
                acc.totalTransfer += price;
                if (order.paymentVerified) acc.transferReceived += price; else acc.transferPending += price;
            } else if (order.paymentMethod === PaymentMethod.PAID) {
                acc.totalPrepaid += price;
            }
            order.items.forEach(item => {
                const normalizedName = item.name.trim();
                if (normalizedName) {
                    const qty = Number(item.quantity) || 0;
                    acc.productQuantities[normalizedName] = (acc.productQuantities[normalizedName] || 0) + qty;
                }
            });
        }
        acc.count++;
        return acc;
    }, stats);
  }, [filteredOrders]);

  const productStatsList = useMemo(() => Object.entries(report.productQuantities).sort((a, b) => Number(b[1]) - Number(a[1])), [report.productQuantities]);

  const handleUpdate = (updatedOrder: Order) => {};
  const handleDeleteClick = (id: string) => { setDeleteId(id); setShowDeleteConfirm(true); };
  const confirmDelete = async () => { if (deleteId) { await storageService.deleteOrder(deleteId); toast.success('Đã xóa đơn hàng'); setShowDeleteConfirm(false); setDeleteId(null); } };
  const handleEdit = (order: Order) => { setEditingOrder(JSON.parse(JSON.stringify(order))); setActiveEditProductRow(null); };
  const saveEdit = async (e: React.FormEvent) => { e.preventDefault(); if (editingOrder) { await storageService.updateOrderDetails(editingOrder); setEditingOrder(null); toast.success('Đã lưu thay đổi'); } };
  const updateEditItem = (index: number, field: keyof OrderItem, value: any) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems[index] = { ...newItems[index], [field]: value }; if (field === 'name') newItems[index].productId = undefined; const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  const selectProductForEditItem = (index: number, product: Product) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems[index] = { ...newItems[index], productId: product.id, name: product.name, price: product.defaultPrice }; const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); setActiveEditProductRow(null); };
  const addEditItem = () => { if (!editingOrder) return; const newItems = [...editingOrder.items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]; setEditingOrder({ ...editingOrder, items: newItems }); };
  const removeEditItem = (index: number) => { if (!editingOrder) return; const newItems = [...editingOrder.items]; newItems.splice(index, 1); const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); };
  const saveReorderedList = async (newSortedList: Order[]) => { const reindexedList = newSortedList.map((o, idx) => ({ ...o, orderIndex: idx })); const newMainOrders = orders.map(o => { const found = reindexedList.find(ro => ro.id === o.id); return found ? found : o; }); setOrders(newMainOrders); await storageService.saveOrdersList(reindexedList); };
  
  const moveOrder = (index: number, direction: 'UP' | 'DOWN') => {
      const newIndex = direction === 'UP' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= filteredOrders.length) return;
      const _orders = [...filteredOrders];
      const item = _orders[index];
      _orders.splice(index, 1);
      _orders.splice(newIndex, 0, item);
      saveReorderedList(_orders);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, position: number) => { dragItem.current = position; e.currentTarget.classList.add('opacity-40', 'scale-95'); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>, position: number) => { dragOverItem.current = position; e.preventDefault(); };
  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => { e.currentTarget.classList.remove('opacity-40', 'scale-95'); if (dragItem.current !== null && dragOverItem.current !== null && sortBy === 'ROUTE') { const _orders = [...filteredOrders]; const draggedItemContent = _orders[dragItem.current]; _orders.splice(dragItem.current, 1); _orders.splice(dragOverItem.current, 0, draggedItemContent); saveReorderedList(_orders); } dragItem.current = null; dragOverItem.current = null; };
  const copyRouteToClipboard = () => { const addressList = filteredOrders.filter(o => o.status !== OrderStatus.CANCELLED && o.status !== OrderStatus.DELIVERED).map(o => `- ${o.address} (${o.customerName})`).join('\n'); if (!addressList) { toast('Không có đơn hàng nào cần giao'); return; } navigator.clipboard.writeText(addressList); toast.success('Đã copy danh sách địa chỉ!'); };
  const handlePrintList = () => { 
      const printWindow = window.open('', '_blank'); if (!printWindow) return;
      const title = filterBatch === 'ALL' ? 'Danh sách đơn hàng' : `Danh sách đơn hàng - ${filterBatch}`;
      const totalAmount = filteredOrders.reduce((sum, o) => o.status !== OrderStatus.CANCELLED ? sum + o.totalPrice : sum, 0);
      const rows = filteredOrders.map((o, index) => {
          const itemsStr = o.items.map(i => `${i.name} (x${i.quantity})`).join('<br/>');
          const paymentStr = o.paymentMethod === PaymentMethod.CASH ? 'Tiền mặt' : (o.paymentMethod === PaymentMethod.PAID ? 'Đã thanh toán' : (o.paymentVerified ? 'Đã CK' : 'Chờ CK'));
          const statusMap: Record<string, string> = { 'PENDING': 'Chờ xử lý', 'PICKED_UP': 'Đã lấy', 'IN_TRANSIT': 'Đang giao', 'DELIVERED': 'Đã giao', 'CANCELLED': 'Hủy' };
          return `<tr><td style="text-align: center;">${index + 1}</td><td><b>${o.customerName}</b><br>${o.customerPhone}</td><td>${o.address}</td><td>${itemsStr}</td><td>${o.notes || ''}</td><td style="text-align: right;">${new Intl.NumberFormat('vi-VN').format(o.totalPrice)}</td><td style="text-align: center;">${paymentStr}</td><td style="text-align: center;">${statusMap[o.status]}</td></tr>`;
      }).join('');
      printWindow.document.write(`<html><head><title>${title}</title><style>body{font-family:sans-serif;font-size:11px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:4px 6px}th{background-color:#f2f2f2;text-align:left}h1{font-size:16px;margin-bottom:5px}.header-info{display:flex;justify-content:space-between;margin-bottom:10px;font-size:12px}@media print{.no-print{display:none}tr{page-break-inside:avoid}}</style></head><body><div class="header-info"><div><h1>${title}</h1><div>Ngày in: ${new Date().toLocaleString('vi-VN')}</div></div><div style="text-align:right"><div>Tổng đơn: <b>${filteredOrders.length}</b></div><div>Tổng tiền: <b>${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalAmount)}</b></div></div></div><table><thead><tr><th style="width:25px">#</th><th style="width:110px">Khách hàng</th><th>Địa chỉ</th><th style="width:150px">Hàng hóa</th><th style="width:60px">Ghi chú</th><th style="width:70px;text-align:right">Thu hộ</th><th style="width:60px;text-align:center">TT</th><th style="width:60px;text-align:center">Trạng thái</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
      printWindow.document.close(); printWindow.print();
  };
  const formatCurrency = (amount: number) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
  const statusLabels: Record<OrderStatus, string> = { [OrderStatus.PENDING]: 'Chờ xử lý', [OrderStatus.PICKED_UP]: 'Đã lấy hàng', [OrderStatus.IN_TRANSIT]: 'Đang giao', [OrderStatus.DELIVERED]: 'Đã giao', [OrderStatus.CANCELLED]: 'Đã hủy' };

  return (
    <div className="animate-fade-in pb-20">
      {/* SMART STICKY HEADER with Intersection Observer */}
      <div className="sticky top-16 z-30 bg-gray-50/95 backdrop-blur-sm transition-shadow shadow-sm">
         
         {/* 1. SEARCH BAR (Always Visible) */}
         <div className="bg-white border-b border-gray-100 p-2 flex gap-2 items-center">
            <div className="relative group flex-grow">
                <i className="fas fa-search absolute left-4 top-3 text-gray-400"></i>
                <input placeholder="Tìm tên, sđt, địa chỉ..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 rounded-xl bg-gray-50 border-transparent focus:bg-white focus:border-eco-200 focus:ring-2 focus:ring-eco-50 text-sm font-medium outline-none transition-all" />
            </div>
         </div>

         {/* 2. FILTERS (Collapsible via CSS Grid Transition) */}
         <div 
            className={`grid transition-[grid-template-rows] duration-300 ease-out ${isHeaderVisible ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
         >
             <div className="overflow-hidden">
                 <div className="bg-white border-b border-gray-200 p-2 shadow-sm">
                    <div className="flex flex-col md:flex-row gap-2 items-center justify-between">
                        <div className="flex gap-2 w-full overflow-x-auto no-scrollbar">
                            <div className="relative min-w-[120px] flex-1"><select value={filterBatch} onChange={e => setFilterBatch(e.target.value)} className="w-full pl-3 pr-8 py-2 rounded-lg bg-gray-50 border-transparent focus:bg-white text-xs font-bold text-gray-700 appearance-none cursor-pointer outline-none"><option value="ALL">Tất cả Lô</option>{batches.map(b => <option key={b} value={b}>{b}</option>)}</select><i className="fas fa-chevron-down absolute right-3 top-2.5 text-gray-400 text-xs pointer-events-none"></i></div>
                            {users.length > 0 && (<div className="relative min-w-[110px] flex-1"><select value={filterUser} onChange={e => setFilterUser(e.target.value)} className="w-full pl-3 pr-8 py-2 rounded-lg bg-gray-50 border-transparent focus:bg-white text-xs font-medium text-gray-700 appearance-none cursor-pointer outline-none"><option value="ALL">Người xử lý</option>{users.map(u => <option key={u} value={u}>{u}</option>)}</select><i className="fas fa-user absolute right-3 top-2.5 text-gray-400 text-xs pointer-events-none"></i></div>)}
                            <div className="relative min-w-[130px] flex-1"><select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="w-full pl-3 pr-8 py-2 rounded-lg bg-gray-50 border-transparent focus:bg-white text-xs font-medium appearance-none cursor-pointer outline-none"><option value="ALL">Mọi trạng thái</option>{Object.entries(statusLabels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select><i className="fas fa-filter absolute right-3 top-2.5 text-gray-400 text-xs pointer-events-none"></i></div>
                        </div>
                        <div className="flex gap-2 w-full md:w-auto overflow-x-auto no-scrollbar items-center justify-end">
                            <button onClick={() => setIsCompactMode(!isCompactMode)} className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg border transition-all ${isCompactMode ? 'bg-eco-100 text-eco-700 border-eco-200' : 'bg-gray-50 text-gray-400 border-gray-200'}`} title="Chế độ xem"><i className={`fas ${isCompactMode ? 'fa-list' : 'fa-th-large'}`}></i></button>
                            <button onClick={handlePrintList} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-gray-50 text-gray-500 hover:text-blue-600 border border-gray-200 transition-all"><i className="fas fa-print"></i></button>
                            <button onClick={copyRouteToClipboard} className="w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg bg-gray-50 text-gray-500 hover:text-eco-600 border border-gray-200 transition-all"><i className="fas fa-map-marked-alt"></i></button>
                            <div className="flex p-1 bg-gray-100 rounded-lg flex-shrink-0"><button onClick={() => setSortBy('NEWEST')} className={`px-2 py-1 rounded text-[10px] font-bold transition-all ${sortBy === 'NEWEST' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}>Mới nhất</button><button onClick={() => setSortBy('ROUTE')} className={`px-2 py-1 rounded text-[10px] font-bold transition-all flex items-center gap-1 ${sortBy === 'ROUTE' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500'}`}><i className="fas fa-route"></i> Lộ trình</button></div>
                            <button onClick={() => setShowReport(!showReport)} className={`w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-lg border transition-all ${showReport ? 'bg-black text-white border-black' : 'bg-white text-gray-400 border-gray-200'}`}><i className="fas fa-chart-bar"></i></button>
                        </div>
                    </div>
                 </div>
             </div>
         </div>
      </div>

      {/* SENTINEL FOR SCROLL DETECTION */}
      <div ref={observerTarget} className="h-px w-full opacity-0 pointer-events-none"></div>

      {showReport && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 animate-fade-in-down mt-2">
              <div className="flex justify-between items-end mb-6 border-b border-gray-100 pb-2"><h3 className="text-gray-900 text-lg font-bold">Thống kê</h3><div className="text-xs font-medium text-gray-500 uppercase">{filterBatch === 'ALL' ? 'Tất cả đơn hàng' : `Lô: ${filterBatch}`}</div></div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-100"><div className="text-gray-400 text-xs font-bold uppercase mb-1">Tổng đơn hàng</div><div className="text-2xl font-black text-gray-900">{report.count}</div></div>
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-100"><div className="text-gray-400 text-xs font-bold uppercase mb-1">Tổng tiền mặt</div><div className="text-xl font-bold text-gray-800">{formatCurrency(report.totalCash)}</div><div className="text-[10px] text-green-600 font-bold mt-1">Đã thu: {formatCurrency(report.cashCollected)}</div></div>
                  <div className="p-4 bg-gray-50 rounded-xl border border-gray-100"><div className="text-gray-400 text-xs font-bold uppercase mb-1">Tổng chuyển khoản</div><div className="text-xl font-bold text-gray-800">{formatCurrency(report.totalTransfer)}</div><div className="text-[10px] text-blue-600 font-bold mt-1">Đã nhận: {formatCurrency(report.transferReceived)}</div></div>
                  <div className="p-4 bg-black text-white rounded-xl shadow-lg"><div className="text-gray-400 text-xs font-bold uppercase mb-1">Tổng doanh thu</div><div className="text-2xl font-black">{formatCurrency(report.totalRevenue)}</div></div>
              </div>
              <div>
                  <h4 className="text-sm font-bold text-gray-800 mb-3 uppercase tracking-wider">Số lượng hàng hóa</h4>
                  {productStatsList.length === 0 ? <div className="text-gray-400 text-sm italic">Chưa có dữ liệu.</div> : (<div className="overflow-x-auto"><table className="w-full text-sm text-left"><thead className="bg-gray-100 text-gray-600 uppercase text-xs"><tr><th className="px-4 py-2 rounded-l-lg">Tên sản phẩm</th><th className="px-4 py-2 text-right rounded-r-lg">Số lượng</th></tr></thead><tbody className="divide-y divide-gray-50">{productStatsList.map(([name, qty]) => (<tr key={name} className="hover:bg-gray-50"><td className="px-4 py-2 font-medium text-gray-800">{name}</td><td className="px-4 py-2 text-right font-bold text-eco-600">{qty}</td></tr>))}</tbody></table></div>)}
              </div>
          </div>
      )}

      {sortBy === 'ROUTE' && !isCompactMode && (
        <div className="flex items-center justify-center gap-3 p-3 bg-yellow-50/50 border border-yellow-100 rounded-lg text-yellow-800 text-sm mt-2"><i className="fas fa-hand-paper animate-pulse"></i><span className="font-medium">Kéo thả hoặc dùng mũi tên để sắp xếp lộ trình.</span></div>
      )}

      {/* Grid layout updated to support Tablet (md:grid-cols-2) - Minimized Top Margin (mt-0 or mt-1) */}
      <div className={`${isCompactMode ? 'bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col divide-y divide-gray-100' : 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4'} mt-1`}>
        {filteredOrders.length === 0 ? (<div className="col-span-full flex flex-col items-center justify-center py-20 text-gray-300"><i className="fas fa-box-open text-6xl mb-4 opacity-50"></i><p className="text-lg font-medium">Không tìm thấy đơn hàng nào</p></div>) : (
          filteredOrders.map((order, index) => (
            <div key={order.id} draggable={sortBy === 'ROUTE'} onDragStart={(e) => handleDragStart(e, index)} onDragEnter={(e) => handleDragEnter(e, index)} onDragEnd={handleDragEnd} onDragOver={(e) => e.preventDefault()} className={`relative ${sortBy === 'ROUTE' && !isCompactMode ? 'cursor-grab active:cursor-grabbing' : ''} ${isCompactMode ? '' : 'transition-transform duration-200'}`}>
               <OrderCard order={order} onUpdate={handleUpdate} onDelete={handleDeleteClick} onEdit={handleEdit} isSortMode={sortBy === 'ROUTE' && !isCompactMode} index={index} isCompactMode={isCompactMode} />
                {sortBy === 'ROUTE' && !isCompactMode && (
                    <div className="absolute right-2 top-12 flex flex-col gap-1 z-20 opacity-60 hover:opacity-100">
                        {index > 0 && (<button onClick={(e) => { e.stopPropagation(); moveOrder(index, 'UP'); }} className="w-8 h-8 bg-white shadow-md rounded-full flex items-center justify-center text-gray-600 border border-gray-200"><i className="fas fa-arrow-up"></i></button>)}
                        {index < filteredOrders.length - 1 && (<button onClick={(e) => { e.stopPropagation(); moveOrder(index, 'DOWN'); }} className="w-8 h-8 bg-white shadow-md rounded-full flex items-center justify-center text-gray-600 border border-gray-200"><i className="fas fa-arrow-down"></i></button>)}
                    </div>
                )}
            </div>
          ))
        )}
      </div>

      {editingOrder && (
        <div className="fixed inset-0 bg-gray-900/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 animate-fade-in">
            <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col" ref={editModalRef}>
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50"><div><h3 className="text-xl font-bold text-gray-800">Chỉnh sửa</h3><p className="text-xs text-gray-500">ID: {editingOrder.id}</p></div><button onClick={() => setEditingOrder(null)} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-red-500 hover:shadow-md flex items-center justify-center"><i className="fas fa-times"></i></button></div>
                <form onSubmit={saveEdit} className="p-6 space-y-6 flex-grow overflow-y-auto">
                    <div className="space-y-4">
                         <h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider border-b border-eco-100 pb-1">Khách hàng</h4>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                             <div><label className="text-xs font-bold text-gray-500 mb-1 block">Tên khách</label><input value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm font-medium" /></div>
                             <div><label className="text-xs font-bold text-gray-500 mb-1 block">Số điện thoại</label><input value={editingOrder.customerPhone} onChange={e => setEditingOrder({...editingOrder, customerPhone: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm" /></div>
                         </div>
                         <div><label className="text-xs font-bold text-gray-500 mb-1 block">Địa chỉ</label><textarea value={editingOrder.address} onChange={e => setEditingOrder({...editingOrder, address: e.target.value})} className="w-full p-2.5 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all text-sm resize-none" rows={2} /></div>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center border-b border-eco-100 pb-1"><h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider">Hàng hóa</h4><button type="button" onClick={addEditItem} className="text-xs font-bold text-eco-600 hover:text-eco-700 bg-eco-50 hover:bg-eco-100 px-2 py-1 rounded transition-colors">+ Thêm</button></div>
                        <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                            {editingOrder.items.map((item, idx) => {
                                const selectedIds = editingOrder.items.filter((i, iIdx) => iIdx !== idx && i.productId).map(i => i.productId);
                                const availableProducts = products.filter(p => !selectedIds.includes(p.id) && (!item.name || p.name.toLowerCase().includes(item.name.toLowerCase())));
                                return (
                                <div key={idx} className="flex gap-2 items-start group/editItem relative product-dropdown-container">
                                    <div className="flex-grow relative">
                                        <input value={item.name} onChange={(e) => updateEditItem(idx, 'name', e.target.value)} onFocus={() => setActiveEditProductRow(idx)} className="w-full p-2 bg-white border border-gray-200 rounded-lg text-sm focus:border-eco-500 outline-none" placeholder="Tên hàng" />
                                        {activeEditProductRow === idx && (
                                            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-xl z-[70] max-h-40 overflow-y-auto">
                                                 {availableProducts.length === 0 ? (<div className="p-2 text-xs text-gray-400 text-center">{products.length === 0 ? "Kho trống" : "Không tìm thấy"}</div>) : (availableProducts.map(p => (<div key={p.id} onClick={() => selectProductForEditItem(idx, p)} className="px-3 py-2 hover:bg-eco-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-0"><div className="text-sm font-medium text-gray-800">{p.name}</div><div className="text-xs font-bold text-eco-600">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}</div></div>)))}
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-16"><input type="number" step="any" value={item.quantity === 0 ? '' : item.quantity} onChange={(e) => updateEditItem(idx, 'quantity', e.target.value === '' ? 0 : Number(e.target.value))} className="w-full p-2 text-center bg-white border border-gray-200 rounded-lg text-sm font-bold focus:border-eco-500 outline-none" placeholder="SL" /></div>
                                    <div className="w-24"><input type="number" step="any" value={item.price === 0 ? '' : item.price} onChange={(e) => updateEditItem(idx, 'price', e.target.value === '' ? 0 : Number(e.target.value))} className="w-full p-2 text-right bg-white border border-gray-200 rounded-lg text-sm font-bold text-gray-700 focus:border-eco-500 outline-none" placeholder="Giá" /></div>
                                    {editingOrder.items.length > 1 && (<button type="button" onClick={() => removeEditItem(idx)} className="w-9 h-9 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"><i className="fas fa-trash-alt"></i></button>)}
                                </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="space-y-4">
                        <h4 className="text-sm font-bold text-eco-600 uppercase tracking-wider border-b border-eco-100 pb-1">Thanh toán & Ghi chú</h4>
                        <div className="grid grid-cols-2 gap-4">
                            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Tổng tiền</label><input type="number" value={editingOrder.totalPrice} onChange={e => setEditingOrder({...editingOrder, totalPrice: Number(e.target.value)})} className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all font-bold text-gray-800" /></div>
                            <div><label className="text-xs font-bold text-gray-500 mb-1 block">Hình thức</label><div className="relative"><select value={editingOrder.paymentMethod} onChange={e => setEditingOrder({...editingOrder, paymentMethod: e.target.value as PaymentMethod})} className="w-full p-3 bg-gray-50 border border-gray-200 focus:bg-white focus:border-eco-500 rounded-lg outline-none transition-all appearance-none text-sm font-medium"><option value={PaymentMethod.CASH}>Tiền mặt</option><option value={PaymentMethod.TRANSFER}>Chuyển khoản</option><option value={PaymentMethod.PAID}>Đã thanh toán</option></select><i className="fas fa-chevron-down absolute right-3 top-4 text-gray-400 text-xs pointer-events-none"></i></div></div>
                        </div>
                        <div><label className="text-xs font-bold text-gray-500 mb-1 block">Ghi chú</label><textarea value={editingOrder.notes || ''} onChange={e => setEditingOrder({...editingOrder, notes: e.target.value})} className="w-full p-3 bg-yellow-50/50 border border-yellow-100 focus:bg-white focus:border-yellow-400 rounded-lg outline-none transition-all text-sm text-yellow-900 placeholder-yellow-300 resize-none" placeholder="Ghi chú thêm..." rows={2} /></div>
                    </div>
                </form>
                <div className="p-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl"><button onClick={saveEdit} className="w-full py-3.5 bg-black text-white rounded-xl font-bold hover:bg-gray-800 transition-all shadow-lg shadow-gray-200 active:scale-95">Lưu Thay Đổi</button></div>
            </div>
        </div>
      )}
      <ConfirmModal isOpen={showDeleteConfirm} title="Xóa đơn hàng?" message="Hành động này không thể hoàn tác. Bạn có chắc chắn muốn xóa đơn hàng này?" onConfirm={confirmDelete} onCancel={() => setShowDeleteConfirm(false)} confirmLabel="Xóa" isDanger={true} />
    </div>
  );
};

export default TrackingDashboard;