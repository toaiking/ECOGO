
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Order, OrderStatus, Product, Customer, PaymentMethod, OrderItem } from '../types';
import { storageService, normalizeString } from '../services/storageService';
import { parseOrderText } from '../services/geminiService';
import { ProductEditModal } from './InventoryManager';

type SidebarTab = 'ACTIVE' | 'WARNING' | 'SEARCH';

const OrderForm: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]); 
  const [quickTags, setQuickTags] = useState<string[]>([]);
  
  const [mobileTab, setMobileTab] = useState<'FORM' | 'STATS'>('FORM');
  const [sidebarTab, setSidebarTab] = useState<'ACTIVE' | 'WARNING' | 'SEARCH'>('ACTIVE');
  const [sidebarSearch, setSidebarSearch] = useState('');
  
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false);
  const [activeProductRow, setActiveProductRow] = useState<number | null>(null);
  
  const [batchId, setBatchId] = useState('');
  const [existingBatches, setExistingBatches] = useState<string[]>([]);
  const [showBatchSuggestions, setShowBatchSuggestions] = useState(false);
  
  const [isListening, setIsListening] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);

  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editMode, setEditMode] = useState<'IMPORT' | 'SET'>('IMPORT');

  const [customerInfo, setCustomerInfo] = useState({ customerId: '', customerName: '', customerPhone: '', address: '', notes: '' });
  const [items, setItems] = useState<Partial<OrderItem>[]>([ { id: uuidv4(), name: '', quantity: 1, price: 0 } ]);

  const customerWrapperRef = useRef<HTMLDivElement>(null);
  const productWrapperRef = useRef<HTMLDivElement>(null);
  const batchWrapperRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubProducts = storageService.subscribeProducts(setProducts);
    const unsubCustomers = storageService.subscribeCustomers(setCustomers);
    setQuickTags(storageService.getQuickTags());
    const unsubOrders = storageService.subscribeOrders((loadedOrders) => {
        setOrders(loadedOrders);
        const batchActivity = new Map<string, number>();
        loadedOrders.forEach(o => { if (o.batchId) { batchActivity.set(o.batchId, Math.max(batchActivity.get(o.batchId) || 0, o.createdAt)); } });
        const sorted = Array.from(batchActivity.entries()).sort((a, b) => b[1] - a[1]).map(e => e[0]).slice(0, 15);
        setExistingBatches(sorted);
        setBatchId(prev => { if (prev) return prev; const today = new Date().toISOString().slice(0, 10); return sorted.find(b => b.includes(today)) || `LÔ-${today}`; });
    });
    const handleClickOutside = (e: MouseEvent) => {
      if (customerWrapperRef.current && !customerWrapperRef.current.contains(e.target as Node)) setShowCustomerSuggestions(false);
      if (productWrapperRef.current && !productWrapperRef.current.contains(e.target as Node)) setActiveProductRow(null);
      if (batchWrapperRef.current && !batchWrapperRef.current.contains(e.target as Node)) setShowBatchSuggestions(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    if (nameInputRef.current) nameInputRef.current.focus();
    return () => { document.removeEventListener("mousedown", handleClickOutside); if (unsubProducts) unsubProducts(); if (unsubCustomers) unsubCustomers(); if (unsubOrders) unsubOrders(); };
  }, []);

  const totalPrice = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);

  const filteredSidebarProducts = useMemo(() => {
      const soldMap = new Map<string, { name: string, qty: number, productId?: string }>();
      const currentBatch = batchId?.trim();
      orders.forEach(o => { if (o.batchId?.trim() === currentBatch && o.status !== OrderStatus.CANCELLED) { o.items.forEach(item => { const normName = normalizeString(item.name); const existing = soldMap.get(normName) || { name: item.name, qty: 0, productId: item.productId }; existing.qty += (Number(item.quantity) || 0); soldMap.set(normName, existing); }); } });
      const inventoryItems = products.map(p => { const normName = normalizeString(p.name); const soldData = soldMap.get(normName); if (soldData) soldMap.delete(normName); return { product: p, soldInBatch: soldData?.qty || 0, stock: p.stockQuantity || 0, isExternal: false }; });
      const externalItems = Array.from(soldMap.values()).map(ext => ({ product: { id: ext.productId || 'EXT', name: ext.name, defaultPrice: 0, stockQuantity: 0 } as Product, soldInBatch: ext.qty, stock: 0, isExternal: true }));
      const allItems = [...inventoryItems, ...externalItems];
      return allItems.filter(item => { if (sidebarTab === 'ACTIVE') return item.soldInBatch > 0; if (sidebarTab === 'WARNING') return !item.isExternal && item.stock < 10; if (sidebarTab === 'SEARCH') { if (!sidebarSearch) return true; return normalizeString(item.product.name).includes(normalizeString(sidebarSearch)); } return false; }).sort((a, b) => b.soldInBatch - a.soldInBatch);
  }, [orders, products, batchId, sidebarTab, sidebarSearch]);

  const handleVoiceInput = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitRecognition;
    if (!SpeechRecognition) { toast.error("Trình duyệt không hỗ trợ"); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = async (event: any) => {
        setIsProcessingAI(true);
        try {
            const transcript = event.results[0][0].transcript;
            const res = await parseOrderText(transcript, products, customers);
            setCustomerInfo(prev => ({ ...prev, customerName: res.customerName || prev.customerName, customerPhone: res.customerPhone || prev.customerPhone, address: res.address || prev.address, notes: res.notes || prev.notes }));
            if (res.parsedItems?.length) { setItems(res.parsedItems.map(pi => { const matched = products.find(p => normalizeString(p.name) === normalizeString(pi.productName)); return { id: uuidv4(), name: matched ? matched.name : pi.productName, quantity: pi.quantity || 1, price: matched ? matched.defaultPrice : 0, productId: matched?.id }; })); }
        } catch (error) { toast.error("Lỗi AI"); } finally { setIsProcessingAI(false); }
    };
    recognition.start();
  };

  const addItemRow = () => setItems([...items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]);
  const removeItemRow = (index: number) => { if (items.length === 1) { setItems([{ id: uuidv4(), name: '', quantity: 1, price: 0 }]); return; } const newItems = [...items]; newItems.splice(index, 1); setItems(newItems); };
  const handleItemChange = (index: number, field: keyof OrderItem, value: any) => { const newItems = [...items]; newItems[index] = { ...newItems[index], [field]: value }; if (field === 'name') newItems[index].productId = undefined; setItems(newItems); };
  const selectProductForItem = (index: number, product: Product) => { const newItems = [...items]; newItems[index] = { ...newItems[index], productId: product.id, name: product.name, price: product.defaultPrice }; setItems(newItems); setActiveProductRow(null); };
  const addTagToNotes = (tag: string) => { setCustomerInfo(prev => ({ ...prev, notes: prev.notes ? `${prev.notes}, ${tag}` : tag })); };

  const handleQuickInsert = (product: Product) => {
    const existingIdx = items.findIndex(i => i.productId === product.id);
    if (existingIdx >= 0) {
      const newItems = [...items];
      newItems[existingIdx].quantity = (Number(newItems[existingIdx].quantity) || 0) + 1;
      setItems(newItems);
    } else {
      const emptyIdx = items.findIndex(i => !i.name && !i.productId);
      if (emptyIdx >= 0) {
        const newItems = [...items];
        newItems[emptyIdx] = { ...newItems[emptyIdx], productId: product.id, name: product.name, price: product.defaultPrice, quantity: 1 };
        setItems(newItems);
      } else {
        setItems([...items, { id: uuidv4(), productId: product.id, name: product.name, price: product.defaultPrice, quantity: 1 }]);
      }
    }
    toast.success(`Đã thêm ${product.name}`);
  };

  const handleSaveProduct = async (data: Product, isImport: boolean = false, qty: number = 0) => {
    if (isImport && editingProduct) {
      await storageService.adjustStockAtomic(editingProduct.id, qty, { price: data.importPrice || 0, note: 'Nhập hàng' });
      if (data.name !== editingProduct.name || data.defaultPrice !== editingProduct.defaultPrice) {
        await storageService.saveProduct({ ...editingProduct, name: data.name, defaultPrice: data.defaultPrice, importPrice: data.importPrice });
      }
      toast.success("Đã nhập hàng");
    } else {
      await storageService.saveProduct(data);
      toast.success(editingProduct ? 'Đã cập nhật' : 'Đã tạo hàng mới');
    }
    setShowProductModal(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(i => i.name && i.name.trim() !== '') as OrderItem[];
    if (!customerInfo.customerName || !customerInfo.address || validItems.length === 0) { toast.error('Thiếu thông tin'); return; }
    const newOrder: Order = { id: uuidv4().slice(0, 8).toUpperCase(), customerId: customerInfo.customerId, batchId: batchId, customerName: customerInfo.customerName, customerPhone: customerInfo.customerPhone, address: customerInfo.address, items: validItems, notes: customerInfo.notes, totalPrice: totalPrice, paymentMethod: PaymentMethod.CASH, status: OrderStatus.PENDING, createdAt: Date.now(), updatedAt: Date.now(), orderIndex: Date.now() };
    await storageService.saveOrder(newOrder);
    toast.success('Đã lưu đơn thành công!');
    setCustomerInfo({ customerId: '', customerName: '', customerPhone: '', address: '', notes: '' });
    setItems([{ id: uuidv4(), name: '', quantity: 1, price: 0 }]);
    if (nameInputRef.current) nameInputRef.current.focus();
  };

  const inputBaseClass = "w-full p-3 bg-white border border-gray-200 rounded-xl outline-none text-sm font-semibold text-gray-800 placeholder-gray-300 focus:border-eco-500 focus:ring-4 focus:ring-eco-50/50 transition-all uppercase";

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden relative">
        {isProcessingAI && (
            <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-md flex items-center justify-center">
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-eco-100 border-t-eco-600 rounded-full animate-spin"></div>
                    <span className="mt-4 text-xs font-bold text-eco-800 tracking-widest uppercase italic">AI Đang phân tích đơn...</span>
                </div>
            </div>
        )}

        <div className="sm:hidden flex border-b border-gray-100 bg-white shrink-0">
            <button onClick={() => setMobileTab('FORM')} className={`flex-1 py-4 text-[10px] font-black transition-all ${mobileTab === 'FORM' ? 'bg-eco-50 text-eco-700' : 'text-gray-400'}`}>TẠO ĐƠN</button>
            <button onClick={() => setMobileTab('STATS')} className={`flex-1 py-4 text-[10px] font-black transition-all ${mobileTab === 'STATS' ? 'bg-eco-50 text-eco-700' : 'text-gray-400'}`}>THỐNG KÊ LÔ</button>
        </div>

        <div className="flex flex-col sm:flex-row h-full overflow-hidden">
            {/* Form Column */}
            <div className={`${mobileTab === 'FORM' ? 'flex' : 'hidden'} sm:flex sm:w-[65%] flex-col h-full overflow-hidden relative border-r border-gray-50`}>
                <div className="flex flex-col shrink-0 bg-white z-20 border-b border-gray-100">
                    <div className="px-5 py-3 flex justify-between items-center bg-gray-50/50">
                       <div ref={batchWrapperRef} className="relative">
                            <div className="flex items-center bg-white border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm cursor-pointer hover:border-eco-300 transition-colors" onClick={() => setShowBatchSuggestions(!showBatchSuggestions)}>
                                {/* Width increased by 30%: w-32 -> w-44 */}
                                <input value={batchId} onChange={(e) => setBatchId(e.target.value)} className="w-44 text-[11px] font-black text-gray-700 outline-none bg-transparent uppercase" placeholder="LÔ HÀNG..." />
                                <i className="fas fa-chevron-down text-[10px] ml-2 text-gray-400"></i>
                            </div>
                            {showBatchSuggestions && (
                                <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-gray-100 rounded-2xl shadow-xl z-[100] overflow-hidden animate-scale-in">
                                    <div className="p-2 max-h-60 overflow-y-auto no-scrollbar">
                                        {existingBatches.map(b => <div key={b} onClick={() => { setBatchId(b); setShowBatchSuggestions(false); }} className="px-4 py-2.5 hover:bg-eco-50 rounded-xl cursor-pointer text-xs font-bold text-gray-700 transition-colors">{b}</div>)}
                                    </div>
                                </div>
                            )}
                       </div>
                       <button onClick={handleVoiceInput} disabled={isListening} className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white shadow-lg shadow-red-200 animate-pulse' : 'bg-white border border-gray-200 text-gray-500 hover:text-eco-600 hover:border-eco-200 shadow-sm'}`} title="Nhập liệu bằng giọng nói"><i className={`fas ${isListening ? 'fa-microphone-slash' : 'fa-microphone'}`}></i></button>
                    </div>
                    <div className="px-5 py-4 flex gap-5 items-center bg-white">
                        <div className="flex-col min-w-[120px]">
                            <div className="text-[10px] text-gray-400 font-bold uppercase tracking-widest mb-1">Tổng tiền:</div>
                            {/* Font size and styling matched to Dashboard stat values */}
                            <div className="text-2xl font-black text-eco-700 tracking-tighter leading-none italic">{new Intl.NumberFormat('vi-VN').format(totalPrice)}<span className="text-[10px] text-gray-300 ml-1 font-bold not-italic">đ</span></div>
                        </div>
                        {/* Save Button: Increased font size (text-sm) and more prominent py-5 for reasonable size */}
                        <button onClick={handleSubmit} className="flex-grow bg-gray-900 hover:bg-black text-white rounded-2xl py-5 px-8 font-black text-sm shadow-lg shadow-gray-200 active:scale-[0.98] transition-all uppercase tracking-[0.1em] italic">LƯU ĐƠN HÀNG <i className="fas fa-check-circle ml-2"></i></button>
                    </div>
                </div>

                <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto p-5 space-y-6 pb-24 bg-gray-50/20">
                    {/* Customer Info Card */}
                    <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm space-y-5">
                        <div className="grid grid-cols-12 gap-5" ref={customerWrapperRef}>
                            <div className="col-span-7 relative">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 ml-1 tracking-widest">Khách nhận hàng</label>
                                <input ref={nameInputRef} value={customerInfo.customerName} onChange={(e) => { setCustomerInfo({...customerInfo, customerName: e.target.value}); setShowCustomerSuggestions(true); }} required className={inputBaseClass} placeholder="Tên khách..." />
                                {showCustomerSuggestions && customerInfo.customerName && (
                                    <ul className="absolute z-30 w-full bg-white border border-gray-100 rounded-2xl shadow-xl mt-2 max-h-56 overflow-y-auto no-scrollbar animate-fade-in">
                                        {customers.filter(c => c.name.toLowerCase().includes(customerInfo.customerName.toLowerCase())).slice(0, 5).map(s => <li key={s.id} onClick={() => { setCustomerInfo({ customerId: s.id, customerName: s.name, customerPhone: s.phone, address: s.address, notes: customerInfo.notes }); setShowCustomerSuggestions(false); }} className="px-4 py-3.5 hover:bg-eco-50 cursor-pointer border-b border-gray-50 flex flex-col transition-colors"><span className="text-sm font-bold text-gray-800 uppercase tracking-tight">{s.name}</span><span className="text-[10px] text-gray-400 font-bold uppercase mt-1">{s.phone} • {s.address}</span></li>)}
                                    </ul>
                                )}
                            </div>
                            <div className="col-span-5">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 ml-1 tracking-widest">Số điện thoại</label>
                                <input value={customerInfo.customerPhone} onChange={(e) => setCustomerInfo({...customerInfo, customerPhone: e.target.value})} className={inputBaseClass} placeholder="09xxxx" />
                            </div>
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 ml-1 tracking-widest">Địa chỉ giao</label>
                            <input value={customerInfo.address} onChange={(e) => setCustomerInfo({...customerInfo, address: e.target.value})} required className={inputBaseClass} placeholder="Số nhà, tên đường, khu vực..." />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-gray-400 uppercase mb-2 ml-1 tracking-widest">Ghi chú vận chuyển</label>
                            <input value={customerInfo.notes} onChange={(e) => setCustomerInfo({...customerInfo, notes: e.target.value})} className={inputBaseClass} placeholder="Giao hẻm, gọi trước khi đi..." />
                            <div className="flex flex-wrap gap-2 mt-3">
                                {quickTags.map(tag => <button key={tag} type="button" onClick={() => addTagToNotes(tag)} className="px-3 py-1.5 bg-gray-50 hover:bg-eco-600 hover:text-white text-gray-500 rounded-xl text-[10px] font-bold border border-gray-100 uppercase transition-all active:scale-95">{tag}</button>)}
                            </div>
                        </div>
                    </div>

                    {/* Items List */}
                    <div className="space-y-4" ref={productWrapperRef}>
                        <div className="flex justify-between items-center px-1">
                            <h3 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] flex items-center gap-2 italic"><i className="fas fa-shopping-basket text-eco-600"></i> Danh sách hàng hóa</h3>
                            <button type="button" onClick={addItemRow} className="text-[10px] font-black text-eco-700 bg-eco-50 px-4 py-2 rounded-xl border border-eco-200 uppercase hover:bg-eco-100 shadow-sm transition-all active:scale-95">+ Dòng mới</button>
                        </div>
                        <div className="space-y-3">
                            {items.map((item, idx) => (
                                <div key={item.id} className="flex items-center gap-3 bg-white p-4 rounded-[1.5rem] border border-gray-100 shadow-sm relative group animate-fade-in">
                                    <div className="flex-grow relative">
                                        <input value={item.name} onChange={(e) => handleItemChange(idx, 'name', e.target.value)} onFocus={() => setActiveProductRow(idx)} className="w-full p-2.5 bg-gray-50 border border-transparent rounded-xl text-sm font-bold text-gray-800 outline-none focus:bg-white focus:border-eco-200 uppercase placeholder-gray-300 transition-all" placeholder="Tên hàng..." />
                                        {activeProductRow === idx && (
                                            <div className="absolute top-full left-0 right-0 mt-2 bg-white border border-gray-100 rounded-2xl shadow-xl z-50 max-h-56 overflow-y-auto no-scrollbar animate-scale-in">
                                                {products.filter(p => !item.name || normalizeString(p.name).includes(normalizeString(item.name))).map(p => <div key={p.id} onMouseDown={() => selectProductForItem(idx, p)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer flex justify-between items-center border-b border-gray-50 transition-colors"><div className="flex flex-col"><span className="text-sm font-bold text-gray-700 uppercase">{p.name}</span><span className="text-[10px] text-gray-400 font-bold uppercase mt-0.5">Tồn: {p.stockQuantity} sp</span></div><span className="text-xs font-black text-blue-600">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}đ</span></div>)}
                                                <div onMouseDown={() => { setEditingProduct(null); setEditMode('SET'); setShowProductModal(true); }} className="p-3.5 bg-gray-50 text-center text-[10px] font-black text-eco-600 hover:bg-eco-100 border-t border-gray-100 uppercase italic cursor-pointer">+ Tạo mới vào kho</div>
                                            </div>
                                        )}
                                    </div>
                                    <div className="w-20">
                                        <input type="number" step="any" value={item.quantity === 0 ? '' : item.quantity} onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))} className="w-full p-2.5 text-center bg-gray-50 border border-transparent rounded-xl text-sm font-black text-eco-700 outline-none focus:bg-white focus:border-eco-200 transition-all" placeholder="SL" />
                                    </div>
                                    <div className="w-28">
                                        <input type="number" value={item.price === 0 ? '' : item.price} onChange={(e) => handleItemChange(idx, 'price', Number(e.target.value))} className="w-full p-2.5 text-right bg-gray-50 border border-transparent rounded-xl text-sm font-black text-gray-800 outline-none focus:bg-white focus:border-eco-200 transition-all" placeholder="GIÁ" />
                                    </div>
                                    <button type="button" onClick={() => removeItemRow(idx)} className="text-gray-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"><i className="fas fa-times-circle text-2xl"></i></button>
                                </div>
                            ))}
                        </div>
                    </div>
                </form>
            </div>

            {/* Sidebar Column */}
            <div className={`${mobileTab === 'STATS' ? 'flex' : 'hidden'} sm:flex sm:w-[35%] flex-col bg-gray-50 h-full overflow-hidden`}>
                <div className="p-4 bg-white border-b border-gray-100">
                    <div className="flex gap-1.5 p-1 bg-gray-100 rounded-2xl mb-3">
                        {(['ACTIVE', 'WARNING', 'SEARCH'] as SidebarTab[]).map(tab => <button key={tab} onClick={() => setSidebarTab(tab)} className={`flex-1 py-2 text-[10px] font-black rounded-xl transition-all ${sidebarTab === tab ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-400 hover:text-gray-500'}`}>{tab === 'ACTIVE' ? 'ĐANG BÁN' : tab === 'WARNING' ? 'SẮP HẾT' : 'TÌM KHO'}</button>)}
                    </div>
                    {sidebarTab === 'SEARCH' && (
                        <div className="relative animate-fade-in">
                            <input value={sidebarSearch} onChange={e => setSidebarSearch(e.target.value)} className="w-full pl-9 pr-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[10px] font-bold outline-none focus:bg-white focus:border-eco-400 uppercase transition-all" placeholder="TÌM TÊN HOẶC SKU..." />
                            <i className="fas fa-search absolute left-3 top-3.5 text-gray-300 text-[10px]"></i>
                        </div>
                    )}
                </div>
                <div className="flex-grow overflow-y-auto p-3 space-y-2 no-scrollbar">
                    {filteredSidebarProducts.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-gray-300 opacity-40 italic">
                            <i className="fas fa-layer-group text-4xl mb-3"></i>
                            <p className="text-[10px] font-black uppercase tracking-widest text-center leading-relaxed">Chưa có giao dịch<br/>trong lô này</p>
                        </div>
                    ) : filteredSidebarProducts.map((item) => (
                        <div key={item.product.id + (item.isExternal ? '-ext' : '')} className={`flex items-center gap-3 p-3 hover:bg-white rounded-2xl transition-all border border-transparent hover:border-gray-200 hover:shadow-sm group ${item.isExternal ? 'bg-orange-50/50' : 'bg-white/50'}`}>
                            <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-black shrink-0 shadow-sm ${item.isExternal ? 'bg-orange-600 text-white' : item.soldInBatch > 0 ? 'bg-eco-600 text-white' : 'bg-gray-200 text-gray-400'}`}>{item.soldInBatch > 0 ? item.soldInBatch : '0'}</div>
                            <div className="flex-grow min-w-0 flex items-center justify-between gap-2">
                                <div onClick={() => handleQuickInsert(item.product)} className={`text-[11px] font-bold truncate cursor-pointer hover:text-eco-600 uppercase tracking-tight italic transition-colors ${item.isExternal ? 'text-orange-700' : 'text-gray-700'}`}>{item.product.name}</div>
                                <div className="flex items-center gap-2 shrink-0">
                                    {!item.isExternal && <div className={`text-[10px] font-bold uppercase ${item.stock < 5 ? 'text-red-500' : 'text-gray-400'}`}>T:{item.stock}</div>}
                                    <button onClick={() => { setEditingProduct(item.product); setEditMode('IMPORT'); setShowProductModal(true); }} className="opacity-0 group-hover:opacity-100 text-[9px] text-blue-600 font-black uppercase tracking-widest transition-opacity hover:underline">Sửa</button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      <ProductEditModal isOpen={showProductModal} onClose={() => setShowProductModal(false)} product={editingProduct} onSave={handleSaveProduct} initialMode={editMode} />
    </div>
  );
};

export default OrderForm;
