
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Order, OrderStatus, Product, Customer, PaymentMethod, OrderItem } from '../types';
import { storageService, normalizeString, calculateProductPrice } from '../services/storageService';
import { parseOrderText } from '../services/geminiService';
import { ProductEditModal } from './InventoryManager';
import ConfirmModal from './ConfirmModal';

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
  
  // Sync Confirmation State
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [pendingProductUpdate, setPendingProductUpdate] = useState<Product | null>(null);

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
      return allItems.filter(item => { 
          if (sidebarTab === 'ACTIVE') return item.soldInBatch > 0; 
          if (sidebarTab === 'WARNING') return !item.isExternal && item.stock < 10; 
          if (sidebarTab === 'SEARCH') { 
              if (!sidebarSearch) return true; 
              return normalizeString(item.product.name).includes(normalizeString(sidebarSearch)); 
          } 
          return false; 
      }).sort((a, b) => b.soldInBatch - a.soldInBatch);
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
            if (res.parsedItems?.length) { 
                setItems(res.parsedItems.map(pi => { 
                    const matched = products.find(p => normalizeString(p.name) === normalizeString(pi.productName)); 
                    // Calculate price based on tier if matched
                    let finalPrice = matched ? matched.defaultPrice : 0;
                    if (matched) {
                        const { price } = calculateProductPrice(matched, pi.quantity || 1);
                        finalPrice = price;
                    }
                    return { 
                        id: uuidv4(), 
                        name: matched ? matched.name : pi.productName, 
                        quantity: pi.quantity || 1, 
                        price: finalPrice, 
                        productId: matched?.id 
                    }; 
                })); 
            }
        } catch (error) { toast.error("Lỗi AI"); } finally { setIsProcessingAI(false); }
    };
    recognition.start();
  };

  const addItemRow = () => setItems([...items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]);
  const removeItemRow = (index: number) => { if (items.length === 1) { setItems([{ id: uuidv4(), name: '', quantity: 1, price: 0 }]); return; } const newItems = [...items]; newItems.splice(index, 1); setItems(newItems); };
  
  const handleItemChange = (index: number, field: keyof OrderItem, value: any) => { 
      const newItems = [...items]; 
      newItems[index] = { ...newItems[index], [field]: value }; 
      
      if (field === 'name') newItems[index].productId = undefined; 
      
      // AUTO-PRICE LOGIC: Recalculate price if quantity changes and productId exists
      if (field === 'quantity' && newItems[index].productId) {
          const product = products.find(p => p.id === newItems[index].productId);
          if (product) {
              const { price } = calculateProductPrice(product, Number(value));
              newItems[index].price = price;
          }
      }

      setItems(newItems); 
  };
  
  const selectProductForItem = (index: number, product: Product) => { 
      const quantity = Number(items[index].quantity) || 1;
      const { price } = calculateProductPrice(product, quantity);
      
      const newItems = [...items]; 
      newItems[index] = { 
          ...newItems[index], 
          productId: product.id, 
          name: product.name, 
          price: price 
      }; 
      setItems(newItems); 
      setActiveProductRow(null); 
  };
  
  const addTagToNotes = (tag: string) => { setCustomerInfo(prev => ({ ...prev, notes: prev.notes ? `${prev.notes}, ${tag}` : tag })); };

  const handleSelectCustomer = (s: Customer) => {
      setCustomerInfo({ customerId: s.id, customerName: s.name, customerPhone: s.phone, address: s.address, notes: customerInfo.notes });
      setShowCustomerSuggestions(false);
      const icon = s.isAddressVerified ? '📍' : '🧠';
      toast.success(`Đã tự động điền: ${s.name}`, { icon: icon, duration: 1000 });
  };

  const handleQuickInsert = (product: Product) => {
    const existingIdx = items.findIndex(i => i.productId === product.id);
    if (existingIdx >= 0) {
      const newItems = [...items];
      const newQty = (Number(newItems[existingIdx].quantity) || 0) + 1;
      const { price } = calculateProductPrice(product, newQty); // Recalc price
      
      newItems[existingIdx].quantity = newQty;
      newItems[existingIdx].price = price;
      setItems(newItems);
    } else {
      const emptyIdx = items.findIndex(i => !i.name && !i.productId);
      const { price } = calculateProductPrice(product, 1);
      if (emptyIdx >= 0) {
        const newItems = [...items];
        newItems[emptyIdx] = { ...newItems[emptyIdx], productId: product.id, name: product.name, price: price, quantity: 1 };
        setItems(newItems);
      } else {
        setItems([...items, { id: uuidv4(), productId: product.id, name: product.name, price: price, quantity: 1 }]);
      }
    }
    toast.success(`Thêm ${product.name}`, { duration: 800 });
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
      if (editingProduct) {
          // If editing existing product, ask for sync
          setPendingProductUpdate(data);
          setShowSyncConfirm(true);
      } else {
          toast.success('Đã tạo hàng mới');
      }
    }
    setShowProductModal(false);
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
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const validItems = items.filter(i => i.name && i.name.trim() !== '') as OrderItem[];
    if (!customerInfo.customerName || !customerInfo.address || validItems.length === 0) { toast.error('Vui lòng điền đủ thông tin'); return; }
    const newOrder: Order = { id: uuidv4().slice(0, 8).toUpperCase(), customerId: customerInfo.customerId, batchId: batchId, customerName: customerInfo.customerName, customerPhone: customerInfo.customerPhone, address: customerInfo.address, items: validItems, notes: customerInfo.notes, totalPrice: totalPrice, paymentMethod: PaymentMethod.CASH, status: OrderStatus.PENDING, createdAt: Date.now(), updatedAt: Date.now(), orderIndex: Date.now() };
    await storageService.saveOrder(newOrder);
    toast.success('Đã lưu đơn!', { icon: '✅' });
    setCustomerInfo({ customerId: '', customerName: '', customerPhone: '', address: '', notes: '' });
    setItems([{ id: uuidv4(), name: '', quantity: 1, price: 0 }]);
    if (nameInputRef.current) nameInputRef.current.focus();
  };

  const inputClass = "w-full p-2 bg-white border border-gray-200 rounded-lg outline-none text-sm font-bold text-gray-800 placeholder-gray-300 focus:border-eco-500 uppercase transition-all";

  return (
    <div className="flex flex-col h-[calc(100vh-4.5rem)] sm:h-[calc(100vh-6rem)] bg-white rounded-xl sm:rounded-3xl shadow-sm border border-gray-100 overflow-hidden relative">
        {isProcessingAI && (
            <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-md flex items-center justify-center">
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-eco-100 border-t-eco-600 rounded-full animate-spin"></div>
                    <span className="mt-4 text-[10px] font-black text-eco-800 uppercase tracking-widest italic">AI Đang phân tích...</span>
                </div>
            </div>
        )}

        {/* Top Header - Merged Toolbar */}
        <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100 shrink-0">
            <div ref={batchWrapperRef} className="relative">
                <div className="flex items-center bg-white border border-gray-200 rounded-lg px-2 py-1 cursor-pointer" onClick={() => setShowBatchSuggestions(!showBatchSuggestions)}>
                    <input value={batchId} onChange={(e) => setBatchId(e.target.value)} className="w-28 text-[10px] font-black text-gray-700 outline-none uppercase bg-transparent" placeholder="LÔ HÀNG..." />
                    <i className="fas fa-chevron-down text-[8px] ml-1 text-gray-400"></i>
                </div>
                {showBatchSuggestions && (
                    <div className="absolute top-full left-0 mt-1 w-48 bg-white border border-gray-100 rounded-lg shadow-xl z-[60] max-h-48 overflow-y-auto no-scrollbar animate-scale-in">
                        {existingBatches.map(b => <div key={b} onClick={() => { setBatchId(b); setShowBatchSuggestions(false); }} className="px-3 py-2 hover:bg-eco-50 text-[10px] font-bold text-gray-700 border-b border-gray-50">{b}</div>)}
                    </div>
                )}
            </div>
            
            <div className="flex gap-2">
                <div className="sm:hidden flex bg-gray-200 p-0.5 rounded-lg">
                    <button onClick={() => setMobileTab('FORM')} className={`px-3 py-1 text-[9px] font-black rounded-md transition-all ${mobileTab === 'FORM' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500'}`}>ĐƠN</button>
                    <button onClick={() => setMobileTab('STATS')} className={`px-3 py-1 text-[9px] font-black rounded-md transition-all ${mobileTab === 'STATS' ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-500'}`}>KHO</button>
                </div>
                <button onClick={handleVoiceInput} disabled={isListening} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-white border border-gray-200 text-gray-400'}`}><i className={`fas ${isListening ? 'fa-microphone-slash' : 'fa-microphone'} text-xs`}></i></button>
            </div>
        </div>

        <div className="flex flex-col sm:flex-row h-full overflow-hidden relative">
            {/* Form Column */}
            <div className={`${mobileTab === 'FORM' ? 'flex' : 'hidden'} sm:flex sm:w-[60%] flex-col h-full overflow-hidden relative`}>
                
                <form className="flex-grow overflow-y-auto p-3 space-y-3 pb-24 bg-gray-50/20">
                    {/* Customer Info Section - More compact */}
                    <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm space-y-2">
                        <div className="flex gap-2" ref={customerWrapperRef}>
                            <div className="flex-grow relative">
                                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Người nhận</label>
                                <input ref={nameInputRef} value={customerInfo.customerName} onChange={(e) => { setCustomerInfo({...customerInfo, customerName: e.target.value}); setShowCustomerSuggestions(true); }} required className={inputClass} placeholder="TÊN KHÁCH..." />
                                {showCustomerSuggestions && customerInfo.customerName && (
                                    <ul className="absolute z-40 w-full bg-white border border-gray-200 rounded-lg shadow-2xl mt-1 max-h-48 overflow-y-auto no-scrollbar">
                                        {customers.filter(c => c.name.toLowerCase().includes(customerInfo.customerName.toLowerCase())).sort((a,b) => (b.totalOrders || 0) - (a.totalOrders || 0)).slice(0, 5).map(s => (
                                            <li key={s.id} onClick={() => handleSelectCustomer(s)} className="px-3 py-2 hover:bg-eco-50 border-b border-gray-50 flex flex-col">
                                                <div className="flex items-center gap-1">
                                                    <span className="text-xs font-black text-gray-800 uppercase">{s.name}</span>
                                                    {(s.totalOrders || 0) > 5 && <span title="Khách quen">⭐</span>}
                                                    {s.isAddressVerified && <i className="fas fa-check-circle text-green-500 text-[10px]" title="Địa chỉ đã ghim chính xác"></i>}
                                                </div>
                                                <span className="text-[9px] text-gray-400 truncate">{s.phone} • {s.address}</span>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="w-[40%]">
                                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Số ĐT</label>
                                <input value={customerInfo.customerPhone} onChange={(e) => setCustomerInfo({...customerInfo, customerPhone: e.target.value})} className={inputClass} placeholder="09XXX..." />
                            </div>
                        </div>
                        <div>
                            <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Địa chỉ giao</label>
                            <input value={customerInfo.address} onChange={(e) => setCustomerInfo({...customerInfo, address: e.target.value})} required className={inputClass} placeholder="SỐ NHÀ, TÊN ĐƯỜNG..." />
                        </div>
                        <div className="relative">
                            <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Ghi chú</label>
                            <input value={customerInfo.notes} onChange={(e) => setCustomerInfo({...customerInfo, notes: e.target.value})} className={inputClass} placeholder="GHI CHÚ GIAO HÀNG..." />
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {quickTags.slice(0, 4).map(tag => <button key={tag} type="button" onClick={() => addTagToNotes(tag)} className="px-2 py-1 bg-gray-100 text-gray-500 rounded-md text-[8px] font-black uppercase">{tag}</button>)}
                            </div>
                        </div>
                    </div>

                    {/* Items Section - Slimmer rows */}
                    <div className="space-y-2" ref={productWrapperRef}>
                        <div className="flex justify-between items-center px-1">
                            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest italic">Hàng hóa</span>
                            <button type="button" onClick={addItemRow} className="text-[9px] font-black text-eco-600 bg-white border border-eco-200 px-3 py-1 rounded-lg shadow-sm">+ Thêm món</button>
                        </div>
                        <div className="space-y-1.5">
                            {items.map((item, idx) => {
                                // Calculate pricing info for display
                                const product = products.find(p => p.id === item.productId);
                                let badge: 'LE' | 'SI' | null = null;
                                if (product) {
                                    const calc = calculateProductPrice(product, Number(item.quantity) || 1);
                                    badge = calc.badge;
                                }

                                return (
                                <div key={item.id} className="bg-white p-2 rounded-lg border border-gray-100 shadow-sm relative group flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5">
                                        <div className="flex-grow relative">
                                            <input value={item.name} onChange={(e) => handleItemChange(idx, 'name', e.target.value)} onFocus={() => setActiveProductRow(idx)} className="w-full p-1.5 bg-gray-50 border-none rounded-md text-xs font-bold text-gray-800 outline-none uppercase placeholder-gray-300" placeholder="TÊN MÓN..." />
                                            {activeProductRow === idx && (
                                                <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-lg shadow-2xl z-50 max-h-48 overflow-y-auto no-scrollbar">
                                                    {products.filter(p => !item.name || normalizeString(p.name).includes(normalizeString(item.name))).map(p => <div key={p.id} onMouseDown={() => selectProductForItem(idx, p)} className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center border-b border-gray-50"><div className="flex flex-col"><span className="text-[11px] font-bold text-gray-700 uppercase">{p.name}</span><span className="text-[9px] text-gray-400 uppercase">Tồn: {p.stockQuantity}</span></div><span className="text-[10px] font-black text-blue-600">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}đ</span></div>)}
                                                    <div onMouseDown={() => { setEditingProduct(null); setEditMode('SET'); setShowProductModal(true); }} className="p-2 bg-gray-50 text-center text-[9px] font-black text-eco-600 uppercase italic cursor-pointer">+ Tạo mới hàng</div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="w-12">
                                            <input type="number" step="any" value={item.quantity === 0 ? '' : item.quantity} onChange={(e) => handleItemChange(idx, 'quantity', Number(e.target.value))} className="w-full p-1.5 text-center bg-gray-50 border-none rounded-md text-xs font-black text-eco-700 outline-none" placeholder="SL" />
                                        </div>
                                        <div className="w-20 relative">
                                            <input 
                                                type="number" 
                                                value={item.price === 0 ? '' : item.price} 
                                                onChange={(e) => handleItemChange(idx, 'price', Number(e.target.value))} 
                                                className={`w-full p-1.5 text-right bg-gray-50 border-none rounded-md text-xs font-black outline-none ${badge === 'SI' ? 'text-purple-600 font-black' : (badge === 'LE' ? 'text-orange-600 font-black' : 'text-gray-800')}`} 
                                                placeholder="GIÁ" 
                                            />
                                            {badge === 'SI' && <div className="absolute -top-1.5 -right-1 text-[8px] bg-purple-100 text-purple-700 px-1 rounded-sm shadow-sm font-bold">GIÁ SỈ</div>}
                                            {badge === 'LE' && <div className="absolute -top-1.5 -right-1 text-[8px] bg-orange-100 text-orange-700 px-1 rounded-sm shadow-sm font-bold">GIÁ LẺ</div>}
                                        </div>
                                        <button type="button" onClick={() => removeItemRow(idx)} className="text-gray-300 hover:text-red-500 w-6 h-6 flex items-center justify-center"><i className="fas fa-times-circle"></i></button>
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    </div>
                </form>

                {/* Sticky Bottom Action Bar */}
                <div className="absolute bottom-0 left-0 right-0 bg-white border-t border-gray-100 p-3 flex gap-3 items-center shadow-[0_-4px_10px_rgba(0,0,0,0.05)] z-20">
                    <div className="shrink-0">
                        <div className="text-[8px] text-gray-400 font-black uppercase tracking-widest">TỔNG TIỀN</div>
                        <div className="text-xl font-black text-eco-700 italic leading-none">{new Intl.NumberFormat('vi-VN').format(totalPrice)}<span className="text-[9px] font-bold not-italic ml-0.5">đ</span></div>
                    </div>
                    <button onClick={() => handleSubmit()} className="flex-grow bg-gray-900 text-white rounded-xl py-3.5 px-4 font-black text-[11px] shadow-lg active:scale-[0.98] transition-all uppercase tracking-widest italic">LƯU ĐƠN HÀNG <i className="fas fa-check-circle ml-1"></i></button>
                </div>
            </div>

            {/* Sidebar Column - Tighter on Mobile */}
            <div className={`${mobileTab === 'STATS' ? 'flex' : 'hidden'} sm:flex sm:w-[40%] flex-col bg-gray-50 h-full overflow-hidden border-l border-gray-100`}>
                <div className="p-2 bg-white border-b border-gray-100 space-y-2">
                    <div className="flex gap-1 p-0.5 bg-gray-100 rounded-lg">
                        {(['ACTIVE', 'WARNING', 'SEARCH'] as SidebarTab[]).map(tab => (
                            <button 
                                key={tab} 
                                onClick={() => { setSidebarTab(tab); if (tab !== 'SEARCH') setSidebarSearch(''); }} 
                                className={`flex-1 py-1.5 text-[9px] font-black rounded-md transition-all ${sidebarTab === tab ? 'bg-white text-eco-700 shadow-sm' : 'text-gray-400'}`}
                            >
                                {tab === 'ACTIVE' ? 'ĐANG BÁN' : tab === 'WARNING' ? 'SẮP HẾT' : 'TÌM KHO'}
                            </button>
                        ))}
                    </div>
                    {/* Hidden Search Input - Animated appearance */}
                    {sidebarTab === 'SEARCH' && (
                        <div className="relative animate-scale-in">
                            <input 
                                value={sidebarSearch}
                                onChange={e => setSidebarSearch(e.target.value)}
                                className="w-full p-2 pl-7 bg-gray-50 border border-gray-200 rounded-lg outline-none text-[10px] font-bold text-gray-700 placeholder-gray-400 focus:border-eco-500 uppercase"
                                placeholder="Gõ tên hàng cần tìm..."
                                autoFocus
                            />
                            <i className="fas fa-search absolute left-2.5 top-2.5 text-[9px] text-gray-300"></i>
                            {sidebarSearch && (
                                <button onClick={() => setSidebarSearch('')} className="absolute right-2 top-2 text-gray-300 hover:text-gray-500">
                                    <i className="fas fa-times-circle text-[10px]"></i>
                                </button>
                            )}
                        </div>
                    )}
                </div>
                <div className="flex-grow overflow-y-auto p-2 no-scrollbar">
                    {filteredSidebarProducts.length === 0 ? (
                        <div className="py-12 flex flex-col items-center justify-center text-gray-300 opacity-60">
                            <i className="fas fa-box-open text-3xl mb-2"></i>
                            <span className="text-[10px] uppercase font-black tracking-widest italic">{sidebarSearch ? 'Không tìm thấy' : 'Chưa có dữ liệu'}</span>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-2">
                            {filteredSidebarProducts.map((item) => (
                                <div 
                                    key={item.product.id + (item.isExternal ? '-ext' : '')} 
                                    className="group relative bg-white p-2.5 rounded-2xl border border-slate-100 shadow-[0_2px_4px_rgba(0,0,0,0.02)] hover:shadow-lg hover:-translate-y-0.5 hover:border-eco-200 transition-all duration-300 cursor-pointer flex flex-col justify-between"
                                    onClick={() => handleQuickInsert(item.product)}
                                >
                                    {/* Header: Icon + Name */}
                                    <div className="flex items-start gap-2 mb-2">
                                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-all shadow-inner border ${
                                            item.isExternal 
                                                ? 'bg-orange-50 border-orange-100 text-orange-600' 
                                                : item.soldInBatch > 0 
                                                    ? 'bg-eco-50 border-eco-100 text-eco-700' 
                                                    : 'bg-slate-50 border-slate-100 text-slate-400 group-hover:bg-eco-50 group-hover:text-eco-600'
                                        }`}>
                                            {item.soldInBatch > 0 ? (
                                                <span className="text-[10px] font-black">{item.soldInBatch}</span>
                                            ) : (
                                                <i className={`fas ${item.isExternal ? 'fa-external-link-alt' : 'fa-box'} text-[10px]`}></i>
                                            )}
                                        </div>
                                        <h4 className={`text-xs font-bold leading-tight line-clamp-2 ${item.isExternal ? 'text-orange-800' : 'text-slate-700 group-hover:text-eco-700'} transition-colors`} title={item.product.name}>
                                            {item.product.name}
                                        </h4>
                                    </div>
                                    
                                    {/* Footer: Price & Stock */}
                                    <div className="flex items-center justify-between mt-auto pt-2 border-t border-dashed border-gray-100">
                                        <span className="text-[10px] font-black text-blue-600">
                                            {new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(item.product.defaultPrice)}
                                        </span>

                                        {!item.isExternal && (
                                            <div className={`flex items-center gap-1 ${
                                                item.stock < 5 ? 'text-red-500 animate-pulse' : 'text-gray-400'
                                            }`}>
                                                <span className="text-[9px] font-bold">SL: {item.stock}</span>
                                            </div>
                                        )}
                                    </div>

                                    {/* Edit Button (Absolute) */}
                                    <button 
                                        onClick={(e) => { 
                                            e.stopPropagation(); 
                                            setEditingProduct(item.product); 
                                            setEditMode('IMPORT'); 
                                            setShowProductModal(true); 
                                        }}
                                        className="absolute top-1 right-1 w-6 h-6 rounded-full bg-white/90 backdrop-blur border border-slate-100 text-slate-300 hover:text-blue-500 hover:border-blue-200 hover:shadow-sm flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                                        title="Sửa hàng hóa"
                                    >
                                        <i className="fas fa-pen text-[8px]"></i>
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
      <ProductEditModal 
        isOpen={showProductModal} 
        onClose={() => setShowProductModal(false)} 
        product={editingProduct} 
        onSave={handleSaveProduct} 
        initialMode={editMode}
        allProducts={products}
        onSwitchToProduct={(p) => { setEditingProduct(p); setEditMode('SET'); }}
      />
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

export default OrderForm;
