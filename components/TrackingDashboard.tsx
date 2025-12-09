import React, { useState, useEffect, useCallback } from 'react';
import { Order, OrderItem, OrderStatus, Product } from '../types';
import { storageService } from '../services/storageService';
import { OrderCard } from './OrderCard';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import RoutePlannerModal from './RoutePlannerModal';
import { pdfService } from '../services/pdfService';

const TrackingDashboard: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filteredOrders, setFilteredOrders] = useState<Order[]>([]);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [activeEditProductRow, setActiveEditProductRow] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  
  // State for filters, sort, etc
  const [statusFilter, setStatusFilter] = useState<OrderStatus | 'ALL'>('ALL');
  const [searchTerm, setSearchTerm] = useState('');
  
  // Route Planner
  const [showRoutePlanner, setShowRoutePlanner] = useState(false);

  useEffect(() => {
    const unsub = storageService.subscribeOrders(setOrders);
    const unsubP = storageService.subscribeProducts(setProducts);
    return () => { if (unsub) unsub(); if (unsubP) unsubP(); };
  }, []);

  useEffect(() => {
    let res = orders;
    if (statusFilter !== 'ALL') {
      res = res.filter(o => o.status === statusFilter);
    }
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      res = res.filter(o => o.customerName.toLowerCase().includes(lower) || o.customerPhone.includes(lower) || o.id.toLowerCase().includes(lower));
    }
    setFilteredOrders(res);
  }, [orders, statusFilter, searchTerm]);

  // Methods from the snippet
  const handleEdit = useCallback((order: Order) => { 
      setEditingOrder(JSON.parse(JSON.stringify(order))); 
      setActiveEditProductRow(null); 
      setDetailOrder(null); 
  }, []);

  const saveEdit = async (e: React.FormEvent) => { 
      e.preventDefault(); 
      if (editingOrder) { 
          await storageService.updateOrderDetails(editingOrder); 
          setEditingOrder(null); 
          toast.success('Đã lưu thay đổi'); 
      } 
  };

  const updateEditItem = (index: number, field: keyof OrderItem, value: any) => { 
      if (!editingOrder) return; 
      const newItems = [...editingOrder.items]; 
      newItems[index] = { ...newItems[index], [field]: value }; 
      if (field === 'name') newItems[index].productId = undefined; 
      const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); 
      setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); 
  };
  
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
  
  const addEditItem = () => { 
      if (!editingOrder) return; 
      const newItems = [...editingOrder.items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]; 
      setEditingOrder({ ...editingOrder, items: newItems }); 
  };

  const removeEditItem = (index: number) => { 
      if (!editingOrder) return; 
      const newItems = [...editingOrder.items]; 
      newItems.splice(index, 1); 
      const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0); 
      setEditingOrder({ ...editingOrder, items: newItems, totalPrice: newTotal }); 
  };

  const handleUpdate = (order: Order) => {
      // Stub for OrderCard prop
  };
  const handleDelete = (id: string) => {
      // Stub for OrderCard prop
  };

  const handleApplySort = (sorted: Order[]) => {
      // In a real app we might update order index, here just update local state or log
      setFilteredOrders(sorted);
  };

  return (
    <div className="max-w-6xl mx-auto pb-20 px-2 sm:px-4 animate-fade-in">
        <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
             <h1 className="text-2xl font-black text-gray-800">Theo Dõi Đơn Hàng</h1>
             <div className="flex gap-2">
                 <button onClick={() => setShowRoutePlanner(true)} className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-md hover:bg-blue-700 transition-colors">
                    <i className="fas fa-route mr-2"></i> Lộ Trình
                 </button>
                 <button onClick={() => pdfService.generateCompactList(filteredOrders, 'Export')} className="bg-gray-800 text-white px-4 py-2 rounded-xl font-bold text-sm shadow-md hover:bg-black transition-colors">
                    <i className="fas fa-print mr-2"></i> In DS
                 </button>
             </div>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-col sm:flex-row gap-2">
            <input 
                placeholder="Tìm kiếm..." 
                value={searchTerm} 
                onChange={e => setSearchTerm(e.target.value)}
                className="p-2 border rounded-lg flex-grow"
            />
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="p-2 border rounded-lg">
                <option value="ALL">Tất cả trạng thái</option>
                <option value={OrderStatus.PENDING}>Chờ xử lý</option>
                <option value={OrderStatus.PICKED_UP}>Đã lấy</option>
                <option value={OrderStatus.IN_TRANSIT}>Đang giao</option>
                <option value={OrderStatus.DELIVERED}>Đã giao</option>
                <option value={OrderStatus.CANCELLED}>Đã hủy</option>
            </select>
        </div>

        {/* Order List */}
        <div className="space-y-4">
            {filteredOrders.map((order, idx) => (
                <OrderCard 
                    key={order.id} 
                    order={order} 
                    onUpdate={handleUpdate} 
                    onDelete={handleDelete} 
                    onEdit={handleEdit}
                    index={idx}
                />
            ))}
        </div>

        {/* Edit Modal */}
        {editingOrder && (
            <div className="fixed inset-0 z-50 bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
                     <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                         <h3 className="font-bold">Sửa Đơn #{editingOrder.id}</h3>
                         <button onClick={() => setEditingOrder(null)}><i className="fas fa-times"></i></button>
                     </div>
                     <form onSubmit={saveEdit} className="p-4 overflow-y-auto space-y-4">
                         {/* Customer Info */}
                         <div className="grid grid-cols-2 gap-4">
                             <div>
                                 <label className="text-xs font-bold text-gray-500">Tên khách</label>
                                 <input value={editingOrder.customerName} onChange={e => setEditingOrder({...editingOrder, customerName: e.target.value})} className="w-full p-2 border rounded-lg" />
                             </div>
                             <div>
                                 <label className="text-xs font-bold text-gray-500">SĐT</label>
                                 <input value={editingOrder.customerPhone} onChange={e => setEditingOrder({...editingOrder, customerPhone: e.target.value})} className="w-full p-2 border rounded-lg" />
                             </div>
                             <div className="col-span-2">
                                 <label className="text-xs font-bold text-gray-500">Địa chỉ</label>
                                 <input value={editingOrder.address} onChange={e => setEditingOrder({...editingOrder, address: e.target.value})} className="w-full p-2 border rounded-lg" />
                             </div>
                         </div>
                         
                         {/* Items */}
                         <div>
                             <label className="text-xs font-bold text-gray-500 mb-2 block">Hàng hóa</label>
                             {editingOrder.items.map((item, idx) => (
                                 <div key={idx} className="flex gap-2 mb-2 relative">
                                     <div className="flex-grow">
                                        <input 
                                            value={item.name} 
                                            onChange={e => updateEditItem(idx, 'name', e.target.value)} 
                                            className="w-full p-2 border rounded-lg" 
                                            placeholder="Tên SP"
                                            onFocus={() => setActiveEditProductRow(idx)}
                                        />
                                        {activeEditProductRow === idx && (
                                            <div className="absolute top-full left-0 w-full bg-white shadow-xl border rounded-lg z-10 max-h-40 overflow-y-auto">
                                                {products.map(p => (
                                                    <div key={p.id} onClick={() => selectProductForEditItem(idx, p)} className="p-2 hover:bg-blue-50 cursor-pointer text-sm">
                                                        {p.name} - {p.stockQuantity} tồn
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                     </div>
                                     <input type="number" value={item.quantity} onChange={e => updateEditItem(idx, 'quantity', Number(e.target.value))} className="w-16 p-2 border rounded-lg" placeholder="SL" />
                                     <input type="number" value={item.price} onChange={e => updateEditItem(idx, 'price', Number(e.target.value))} className="w-24 p-2 border rounded-lg" placeholder="Giá" />
                                     <button type="button" onClick={() => removeEditItem(idx)} className="text-red-500 px-2"><i className="fas fa-trash"></i></button>
                                 </div>
                             ))}
                             <button type="button" onClick={addEditItem} className="text-sm font-bold text-blue-600">+ Thêm hàng</button>
                         </div>

                         <div className="pt-4 border-t flex justify-end gap-2">
                             <button type="button" onClick={() => setEditingOrder(null)} className="px-4 py-2 rounded-lg bg-gray-100 font-bold">Hủy</button>
                             <button type="submit" className="px-4 py-2 rounded-lg bg-black text-white font-bold">Lưu Thay Đổi</button>
                         </div>
                     </form>
                </div>
            </div>
        )}

        <RoutePlannerModal 
            isOpen={showRoutePlanner} 
            onClose={() => setShowRoutePlanner(false)} 
            orders={filteredOrders} 
            onApplySort={handleApplySort} 
        />
    </div>
  );
};

export default TrackingDashboard;
