import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Order, OrderStatus, Product, Customer, PaymentMethod, OrderItem } from '../types';
import { storageService } from '../services/storageService';

const OrderForm: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  
  // Suggestions State
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [activeProductRow, setActiveProductRow] = useState<number | null>(null);
  
  // Batch State
  const [batchId, setBatchId] = useState('');
  const [existingBatches, setExistingBatches] = useState<string[]>([]);
  const [showBatchSuggestions, setShowBatchSuggestions] = useState(false);
  
  const [customerInfo, setCustomerInfo] = useState({
    customerName: '',
    customerPhone: '',
    address: '',
    notes: '',
  });

  const [items, setItems] = useState<Partial<OrderItem>[]>([
    { id: uuidv4(), name: '', quantity: 1, price: 0 },
    { id: uuidv4(), name: '', quantity: 1, price: 0 }
  ]);

  const customerWrapperRef = useRef<HTMLDivElement>(null);
  const productWrapperRef = useRef<HTMLDivElement>(null);
  const batchWrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Subscribe to Data
    const unsubProducts = storageService.subscribeProducts(setProducts);
    const unsubCustomers = storageService.subscribeCustomers(setCustomers);
    
    // For batches, we need to fetch orders. Since we don't have a direct "get batches" API,
    // we subscribe to orders and extract batches.
    const unsubOrders = storageService.subscribeOrders((orders) => {
        const uniqueBatches = Array.from(new Set(orders.map(o => o.batchId).filter(Boolean))).sort().reverse();
        setExistingBatches(uniqueBatches);
        
        // Only set default batch if it hasn't been set yet
        setBatchId(prev => {
           if (prev) return prev;
           const today = new Date();
           const dateStr = today.toISOString().slice(0, 10);
           const todayBatch = uniqueBatches.find(b => b.includes(dateStr));
           return todayBatch || `LÔ-${dateStr}`;
        });
    });

    const handleClickOutside = (event: MouseEvent) => {
      if (customerWrapperRef.current && !customerWrapperRef.current.contains(event.target as Node)) {
        setShowCustomerSuggestions(false);
      }
      if (productWrapperRef.current && !productWrapperRef.current.contains(event.target as Node)) {
        setActiveProductRow(null);
      }
      if (batchWrapperRef.current && !batchWrapperRef.current.contains(event.target as Node)) {
        setShowBatchSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        if (unsubProducts) unsubProducts();
        if (unsubCustomers) unsubCustomers();
        if (unsubOrders) unsubOrders();
    };
  }, []);

  const totalPrice = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);

  const addItemRow = () => {
    setItems([...items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]);
  };

  const removeItemRow = (index: number) => {
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleItemChange = (index: number, field: keyof OrderItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    
    // Logic auto-detect product by name typing
    if (field === 'name') {
       // Clear ID if name changes manually to avoid mismatch, unless we re-match it below
       newItems[index].productId = undefined; 
    }

    setItems(newItems);
  };

  const selectProductForItem = (index: number, product: Product) => {
      const newItems = [...items];
      newItems[index] = {
        ...newItems[index],
        productId: product.id,
        name: product.name,
        price: product.defaultPrice,
      };
      setItems(newItems);
      setActiveProductRow(null);
  };

  const handleCustomerSelect = (customer: Customer) => {
    setCustomerInfo({
      customerName: customer.name,
      customerPhone: customer.phone,
      address: customer.address,
      notes: customerInfo.notes
    });
    setShowCustomerSuggestions(false);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomerInfo(prev => ({ ...prev, customerName: e.target.value }));
    setShowCustomerSuggestions(true);
  };

  const selectBatch = (b: string) => {
      setBatchId(b);
      setShowBatchSuggestions(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(i => i.name && i.name.trim() !== '') as OrderItem[];

    if (!customerInfo.customerName || !customerInfo.address || validItems.length === 0) {
      toast.error('Thiếu thông tin bắt buộc (Tên, Địa chỉ, Hàng hóa)');
      return;
    }

    const newOrder: Order = {
      id: uuidv4().slice(0, 8).toUpperCase(),
      batchId: batchId,
      customerName: customerInfo.customerName,
      customerPhone: customerInfo.customerPhone,
      address: customerInfo.address,
      items: validItems,
      notes: customerInfo.notes,
      totalPrice: totalPrice,
      paymentMethod: PaymentMethod.CASH, 
      status: OrderStatus.PENDING,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      orderIndex: Date.now(), 
      paymentVerified: false
    };

    await storageService.saveOrder(newOrder);
    
    // Customers and Products update automatically via subscription, no need to manually fetch.
    
    toast.success('Tạo đơn thành công!');
    
    setCustomerInfo({ customerName: '', customerPhone: '', address: '', notes: '' });
    setItems([
        { id: uuidv4(), name: '', quantity: 1, price: 0 },
        { id: uuidv4(), name: '', quantity: 1, price: 0 }
    ]);
  };

  const customerSuggestions = customers.filter(c => 
    c.name.toLowerCase().includes((customerInfo.customerName || '').toLowerCase()) &&
    customerInfo.customerName && customerInfo.customerName !== c.name
  );

  // Get list of currently selected product IDs to exclude from droplist
  const getSelectedProductIds = (currentIndex: number) => {
      return items
          .filter((item, idx) => idx !== currentIndex && item.productId)
          .map(item => item.productId);
  };

  return (
    <div className="max-w-4xl mx-auto pb-20 animate-fade-in">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
          <h2 className="text-xl font-black text-gray-800 tracking-tight">
            Tạo Đơn Hàng
          </h2>
          <div className="flex items-center gap-2 relative" ref={batchWrapperRef}>
             <span className="text-xs font-bold text-gray-400 uppercase">Lô hàng</span>
             <div className="relative">
                <input 
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  onFocus={() => setShowBatchSuggestions(true)}
                  className="bg-white border border-gray-200 rounded-lg pl-3 pr-8 py-1 text-sm font-bold text-gray-700 w-36 outline-none focus:border-eco-500 transition-colors"
                  placeholder="Nhập hoặc chọn..."
                />
                <button 
                  type="button"
                  onClick={() => setShowBatchSuggestions(!showBatchSuggestions)}
                  className="absolute right-0 top-0 bottom-0 px-2 text-gray-400 hover:text-eco-600 transition-colors"
                >
                    <i className={`fas fa-chevron-down text-xs transition-transform ${showBatchSuggestions ? 'rotate-180' : ''}`}></i>
                </button>

                {/* Batch Dropdown */}
                {showBatchSuggestions && existingBatches.length > 0 && (
                    <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-100 rounded-lg shadow-xl z-50 max-h-56 overflow-y-auto">
                        {existingBatches.map(b => (
                            <div 
                                key={b} 
                                onClick={() => selectBatch(b)}
                                className="px-3 py-2 hover:bg-eco-50 cursor-pointer text-sm font-medium text-gray-700 border-b border-gray-50 last:border-0"
                            >
                                {b}
                            </div>
                        ))}
                    </div>
                )}
             </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 grid grid-cols-1 md:grid-cols-12 gap-8">
          
          {/* Customer Info Column */}
          <div className="md:col-span-5 space-y-5">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Thông tin khách hàng</h3>
            
            <div className="space-y-4">
                <div className="relative" ref={customerWrapperRef}>
                <input
                    value={customerInfo.customerName}
                    onChange={handleNameChange}
                    required
                    placeholder="Họ tên khách *"
                    className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all font-medium"
                    autoComplete="off"
                />
                {showCustomerSuggestions && customerSuggestions.length > 0 && (
                    <ul className="absolute z-20 w-full bg-white border border-gray-100 rounded-xl shadow-xl max-h-48 overflow-y-auto mt-2 p-1">
                    {customerSuggestions.map(s => (
                        <li key={s.id} onClick={() => handleCustomerSelect(s)} className="px-3 py-2 hover:bg-gray-50 rounded-lg cursor-pointer text-sm transition-colors">
                        <span className="font-bold text-gray-800">{s.name}</span>
                        <div className="text-xs text-gray-500">{s.phone}</div>
                        </li>
                    ))}
                    </ul>
                )}
                </div>

                <input
                value={customerInfo.customerPhone}
                onChange={(e) => setCustomerInfo({...customerInfo, customerPhone: e.target.value})}
                placeholder="Số điện thoại"
                className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all"
                />
                
                <textarea
                value={customerInfo.address}
                onChange={(e) => setCustomerInfo({...customerInfo, address: e.target.value})}
                required
                placeholder="Địa chỉ giao hàng *"
                rows={3}
                className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all resize-none"
                />
                
                <input
                    value={customerInfo.notes}
                    onChange={(e) => setCustomerInfo({...customerInfo, notes: e.target.value})}
                    placeholder="Ghi chú đơn hàng..."
                    className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all text-sm"
                />
            </div>
          </div>

          {/* Order Items Column */}
          <div className="md:col-span-7 flex flex-col h-full" ref={productWrapperRef}>
             <div className="flex justify-between items-end mb-3">
                 <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Chi tiết đơn hàng</h3>
                 <button type="button" onClick={addItemRow} className="text-eco-600 text-xs font-bold hover:text-eco-700 bg-eco-50 px-2 py-1 rounded transition-colors">
                    + Thêm dòng
                 </button>
             </div>
             
             <div className="flex-grow bg-gray-50 rounded-xl p-4 border border-gray-100 space-y-3 max-h-[400px] overflow-y-auto">
                {items.map((item, idx) => {
                  const selectedIds = getSelectedProductIds(idx);
                  const availableProducts = products.filter(p => 
                    !selectedIds.includes(p.id) && 
                    (!item.name || p.name.toLowerCase().includes(item.name.toLowerCase()))
                  );

                  return (
                  <div key={item.id} className={`bg-white p-3 rounded-xl shadow-sm border border-gray-100 group transition-shadow hover:shadow-md relative ${activeProductRow === idx ? 'z-20' : 'z-0'}`}>
                     {/* Mobile: Stacked / Desktop: Flex Row */}
                     <div className="flex flex-col md:flex-row gap-3 items-start md:items-center">
                         
                         {/* Product Name Input + Custom Dropdown */}
                         <div className="flex-grow w-full relative">
                            <div className="relative">
                                <input 
                                    placeholder="Tên sản phẩm..."
                                    value={item.name}
                                    onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                    onFocus={() => setActiveProductRow(idx)}
                                    className="w-full p-2 pl-3 pr-8 bg-gray-50 focus:bg-white border border-transparent focus:border-eco-500 rounded-lg text-sm font-medium outline-none transition-all"
                                />
                                <button 
                                    type="button"
                                    onClick={() => setActiveProductRow(activeProductRow === idx ? null : idx)}
                                    className="absolute right-0 top-0 bottom-0 px-2 text-gray-400 hover:text-eco-600"
                                >
                                    <i className={`fas fa-chevron-down text-xs transition-transform ${activeProductRow === idx ? 'rotate-180' : ''}`}></i>
                                </button>
                            </div>

                            {/* Custom Product Dropdown */}
                            {activeProductRow === idx && (
                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto">
                                    {availableProducts.length === 0 ? (
                                         <div className="p-3 text-xs text-gray-400 text-center">
                                            {products.length === 0 ? "Kho trống" : "Không tìm thấy hoặc đã chọn"}
                                         </div>
                                    ) : (
                                        availableProducts.map(p => (
                                            <div 
                                                key={p.id} 
                                                onClick={() => selectProductForItem(idx, p)}
                                                className="px-3 py-2 hover:bg-eco-50 cursor-pointer flex justify-between items-center group/opt border-b border-gray-50 last:border-0"
                                            >
                                                <div>
                                                    <div className="text-sm font-medium text-gray-800 group-hover/opt:text-eco-700">{p.name}</div>
                                                    <div className="text-[10px] text-gray-400">Tồn: {p.stockQuantity}</div>
                                                </div>
                                                <div className="text-xs font-bold text-eco-600">
                                                    {new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                         </div>
                         
                         {/* Qty and Price */}
                         <div className="flex gap-2 w-full md:w-auto">
                            <div className="w-20">
                                <input 
                                    type="number" 
                                    min="1"
                                    value={item.quantity}
                                    onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))}
                                    className="w-full p-2 text-center bg-gray-50 focus:bg-white border border-transparent focus:border-eco-500 rounded-lg text-sm font-bold outline-none"
                                    placeholder="SL"
                                />
                            </div>
                            <div className="flex-grow md:w-32">
                                <input 
                                    type="number"
                                    value={item.price}
                                    onChange={(e) => handleItemChange(idx, 'price', Number(e.target.value))}
                                    className="w-full p-2 text-right bg-gray-50 focus:bg-white border border-transparent focus:border-eco-500 rounded-lg text-sm font-bold text-gray-800 outline-none"
                                    placeholder="Giá"
                                />
                            </div>
                            {items.length > 1 && (
                                <button type="button" onClick={() => removeItemRow(idx)} className="w-9 flex items-center justify-center text-gray-300 hover:text-red-500 transition-colors">
                                <i className="fas fa-trash-alt"></i>
                                </button>
                            )}
                         </div>
                     </div>
                  </div>
                  );
                })}
             </div>

             <div className="mt-5 pt-4 border-t border-gray-100">
                <div className="flex justify-between items-center mb-4">
                    <span className="text-sm font-medium text-gray-500">Tổng thanh toán</span>
                    <span className="text-2xl font-black text-gray-900 tracking-tight">
                        {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalPrice)}
                    </span>
                </div>

                <button
                type="submit"
                className="w-full bg-black text-white py-4 rounded-xl hover:bg-gray-800 font-bold text-lg shadow-xl shadow-gray-200 transition-all active:scale-95"
                >
                Hoàn Tất Đơn Hàng
                </button>
             </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OrderForm;