
import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Order, OrderStatus, Product, Customer, PaymentMethod, OrderItem } from '../types';
import { storageService } from '../services/storageService';
import { parseOrderText } from '../services/geminiService';

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
  
  // Custom Tags
  const [quickTags, setQuickTags] = useState<string[]>([]);

  // AI & Voice State
  const [isListening, setIsListening] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);

  const [customerInfo, setCustomerInfo] = useState({
    customerName: '',
    customerPhone: '',
    address: '',
    notes: '',
  });

  const [items, setItems] = useState<Partial<OrderItem>[]>([
    { id: uuidv4(), name: '', quantity: 1, price: 0 },
  ]);

  const customerWrapperRef = useRef<HTMLDivElement>(null);
  const productWrapperRef = useRef<HTMLDivElement>(null);
  const batchWrapperRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Subscribe to Data
    const unsubProducts = storageService.subscribeProducts(setProducts);
    const unsubCustomers = storageService.subscribeCustomers(setCustomers);
    
    // Load Tags
    const loadTags = () => setQuickTags(storageService.getQuickTags());
    loadTags();
    window.addEventListener('local_tags_updated', loadTags);

    // Batch Logic
    const unsubOrders = storageService.subscribeOrders((orders) => {
        const batchActivity = new Map<string, number>();
        orders.forEach(o => {
            if (o.batchId) {
                const lastTime = batchActivity.get(o.batchId) || 0;
                batchActivity.set(o.batchId, Math.max(lastTime, o.createdAt));
            }
        });
        const sortedBatches = Array.from(batchActivity.entries())
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0])
            .slice(0, 10); // Top 10 recent batches

        setExistingBatches(sortedBatches);
        
        setBatchId(prev => {
           if (prev) return prev;
           const today = new Date();
           const dateStr = today.toISOString().slice(0, 10);
           const todayBatch = sortedBatches.find(b => b.includes(dateStr));
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
    
    // Focus Name input on load
    if (nameInputRef.current) {
        nameInputRef.current.focus();
    }

    return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        window.removeEventListener('local_tags_updated', loadTags);
        if (unsubProducts) unsubProducts();
        if (unsubCustomers) unsubCustomers();
        if (unsubOrders) unsubOrders();
    };
  }, []);

  const totalPrice = items.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);

  // --- VOICE & AI LOGIC ---
  const handleVoiceInput = () => {
    if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        toast.error("Trình duyệt không hỗ trợ nhập giọng nói.");
        return;
    }

    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();

    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        setIsListening(true);
        toast('Đang nghe... Hãy nói thông tin đơn hàng', { icon: '🎙️' });
    };

    recognition.onend = () => {
        setIsListening(false);
    };

    recognition.onerror = (event: any) => {
        console.error("Speech error", event.error);
        setIsListening(false);
        toast.error("Không nghe rõ, vui lòng thử lại.");
    };

    recognition.onresult = async (event: any) => {
        const transcript = event.results[0][0].transcript;
        toast.success(`Đã nhận: "${transcript}"`);
        await processOrderText(transcript);
    };

    recognition.start();
  };

  const processOrderText = async (text: string) => {
      setIsProcessingAI(true);
      const loadingToast = toast.loading("AI đang tra cứu kho & khách...");
      
      try {
          // Pass products and customers to Gemini for context-aware parsing
          const result = await parseOrderText(text, products, customers);
          
          setCustomerInfo(prev => ({
              ...prev,
              customerName: result.customerName || prev.customerName,
              customerPhone: result.customerPhone || prev.customerPhone,
              address: result.address || prev.address,
              notes: result.notes || prev.notes
          }));

          // Handle Items
          if (result.parsedItems && result.parsedItems.length > 0) {
              const newItems = result.parsedItems.map(pi => {
                  // Attempt to find exact match in inventory to get Price and ID
                  // The AI has already tried to match names, so we just check for exact string match now
                  const matchedProduct = products.find(p => p.name.toLowerCase() === pi.productName.toLowerCase());
                  
                  return {
                      id: uuidv4(),
                      name: matchedProduct ? matchedProduct.name : pi.productName,
                      quantity: pi.quantity || 1,
                      price: matchedProduct ? matchedProduct.defaultPrice : 0,
                      productId: matchedProduct ? matchedProduct.id : undefined
                  };
              });
              setItems(newItems);
          } else if (result.itemsString) {
               // Fallback if AI didn't return array structure
               setItems([{ 
                   id: uuidv4(), 
                   name: result.itemsString, 
                   quantity: 1, 
                   price: result.price || 0 
               }]);
          } else if (result.price && result.price > 0) {
               setItems(prev => {
                   const newItems = [...prev];
                   if(newItems.length > 0) newItems[0].price = result.price;
                   return newItems;
               });
          }

          toast.success("Đã điền thông tin!");
      } catch (error) {
          console.error(error);
          toast.error("Không thể phân tích nội dung.");
      } finally {
          setIsProcessingAI(false);
          toast.dismiss(loadingToast);
      }
  };

  // --- END VOICE LOGIC ---

  const addItemRow = () => {
    setItems([...items, { id: uuidv4(), name: '', quantity: 1, price: 0 }]);
  };

  const removeItemRow = (index: number) => {
    if (items.length === 1) {
        setItems([{ id: uuidv4(), name: '', quantity: 1, price: 0 }]); // Reset if it's the last one
        return;
    }
    const newItems = [...items];
    newItems.splice(index, 1);
    setItems(newItems);
  };

  const handleItemChange = (index: number, field: keyof OrderItem, value: any) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'name') newItems[index].productId = undefined; 
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

  const toggleQuickTag = (tag: string) => {
      setCustomerInfo(prev => {
          const parts = prev.notes ? prev.notes.split(',').map(s => s.trim()) : [];
          if (parts.includes(tag)) {
              return { ...prev, notes: parts.filter(p => p !== tag).join(', ') };
          } else {
              return { ...prev, notes: prev.notes ? `${prev.notes}, ${tag}` : tag };
          }
      });
  };

  const resetForm = () => {
      setCustomerInfo({ customerName: '', customerPhone: '', address: '', notes: '' });
      setItems([{ id: uuidv4(), name: '', quantity: 1, price: 0 }]);
      if (nameInputRef.current) nameInputRef.current.focus();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(i => i.name && i.name.trim() !== '') as OrderItem[];

    if (!customerInfo.customerName || !customerInfo.address || validItems.length === 0) {
      toast.error('Thiếu tên, địa chỉ hoặc hàng hóa');
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
    
    toast.success('Lên đơn thành công!');
    resetForm();
  };

  const customerSuggestions = customers.filter(c => 
    c.name.toLowerCase().includes((customerInfo.customerName || '').toLowerCase()) &&
    customerInfo.customerName && customerInfo.customerName !== c.name
  ).slice(0, 5);

  const getSelectedProductIds = (currentIndex: number) => {
      return items
          .filter((item, idx) => idx !== currentIndex && item.productId)
          .map(item => item.productId);
  };

  const inputClass = "w-full px-3 py-2.5 bg-gray-50 focus:bg-white border border-gray-200 focus:border-eco-500 rounded-xl outline-none transition-all text-sm font-medium placeholder-gray-400";
  const labelClass = "block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1";

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in">
      <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden relative">
        
        {/* LOADING OVERLAY */}
        {isProcessingAI && (
            <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-eco-200 border-t-eco-600 rounded-full animate-spin"></div>
                    <span className="mt-3 text-sm font-bold text-eco-800 animate-pulse">AI đang phân tích & tra cứu...</span>
                </div>
            </div>
        )}

        {/* HEADER BAR */}
        <div className="px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 flex flex-wrap justify-between items-center gap-4">
          <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-eco-100 text-eco-600 flex items-center justify-center shadow-sm">
                <i className="fas fa-plus-circle text-xl"></i>
             </div>
             <div>
                <h2 className="text-lg font-black text-gray-800 leading-tight">Tạo Đơn Hàng</h2>
                <p className="text-xs text-gray-500 font-medium">Nhập thông tin hoặc dùng giọng nói</p>
             </div>
          </div>
          
          <div className="flex items-center gap-3">
              {/* VOICE INPUT BUTTON */}
              <button 
                onClick={handleVoiceInput}
                disabled={isListening}
                className={`flex items-center gap-2 px-4 py-1.5 rounded-xl border transition-all ${
                    isListening 
                    ? 'bg-red-500 text-white border-red-500 animate-pulse' 
                    : 'bg-white text-gray-600 border-gray-200 hover:border-eco-400 hover:text-eco-600'
                }`}
                title="Nhập bằng giọng nói (AI)"
              >
                  <i className={`fas ${isListening ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                  <span className="text-xs font-bold hidden sm:inline">{isListening ? 'Đang nghe...' : 'Nhập Voice'}</span>
              </button>

              {/* BATCH SELECTOR */}
              <div className="relative" ref={batchWrapperRef}>
                 <div className="flex items-center bg-white border border-gray-200 rounded-xl px-3 py-1.5 shadow-sm hover:border-eco-400 transition-colors cursor-pointer" onClick={() => setShowBatchSuggestions(!showBatchSuggestions)}>
                    <span className="text-[10px] font-bold text-gray-400 uppercase mr-2 hidden sm:inline">Lô hàng</span>
                    <input 
                      value={batchId}
                      onChange={(e) => setBatchId(e.target.value)}
                      className="w-24 sm:w-28 text-sm font-bold text-eco-700 outline-none bg-transparent"
                      placeholder="LÔ-HÔM-NAY"
                    />
                    <i className={`fas fa-chevron-down text-xs text-gray-400 ml-2 transition-transform ${showBatchSuggestions ? 'rotate-180' : ''}`}></i>
                 </div>
                 
                 {showBatchSuggestions && existingBatches.length > 0 && (
                    <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-gray-100 rounded-xl shadow-2xl z-50 overflow-hidden animate-fade-in">
                        <div className="px-3 py-2 bg-gray-50 text-[10px] font-bold text-gray-500 uppercase">Gần đây</div>
                        <div className="max-h-60 overflow-y-auto">
                            {existingBatches.map(b => (
                                <div key={b} onClick={() => selectBatch(b)} className="px-4 py-2.5 hover:bg-eco-50 cursor-pointer text-sm font-medium text-gray-700 border-b border-gray-50 last:border-0 flex items-center justify-between">
                                    {b}
                                    {batchId === b && <i className="fas fa-check text-eco-600 text-xs"></i>}
                                </div>
                            ))}
                        </div>
                    </div>
                 )}
              </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-gray-100">
          
          {/* LEFT COLUMN: CUSTOMER INFO */}
          <div className="lg:w-[40%] p-6 lg:p-8 bg-white/50 space-y-5">
            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2 mb-4">
                <i className="fas fa-user-circle text-eco-500"></i> Thông tin khách hàng
            </h3>
            
            <div className="space-y-4">
                {/* Name */}
                <div className="relative" ref={customerWrapperRef}>
                    <label className={labelClass}>Tên khách hàng <span className="text-red-500">*</span></label>
                    <input
                        ref={nameInputRef}
                        value={customerInfo.customerName}
                        onChange={handleNameChange}
                        required
                        className={`${inputClass} font-bold text-gray-800`}
                        placeholder="Nhập tên khách..."
                        autoComplete="off"
                    />
                    {showCustomerSuggestions && customerSuggestions.length > 0 && (
                        <ul className="absolute z-30 w-full bg-white border border-gray-100 rounded-xl shadow-2xl mt-1 overflow-hidden animate-fade-in">
                            {customerSuggestions.map(s => (
                                <li key={s.id} onClick={() => handleCustomerSelect(s)} className="px-4 py-3 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0 transition-colors group">
                                    <div className="flex justify-between items-center">
                                        <span className="font-bold text-gray-800 group-hover:text-blue-700">{s.name}</span>
                                        <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md group-hover:bg-white">{s.phone}</span>
                                    </div>
                                    <div className="text-xs text-gray-500 truncate mt-1 group-hover:text-blue-500">{s.address}</div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* Phone */}
                <div>
                    <label className={labelClass}>Số điện thoại</label>
                    <div className="relative">
                        <input
                            value={customerInfo.customerPhone}
                            onChange={(e) => setCustomerInfo({...customerInfo, customerPhone: e.target.value})}
                            className={inputClass}
                            placeholder="09..."
                        />
                        <i className="fas fa-phone absolute right-3 top-3 text-gray-300"></i>
                    </div>
                </div>
                
                {/* Address */}
                <div>
                    <label className={labelClass}>Địa chỉ giao hàng <span className="text-red-500">*</span></label>
                    <textarea
                        value={customerInfo.address}
                        onChange={(e) => setCustomerInfo({...customerInfo, address: e.target.value})}
                        required
                        className={`${inputClass} resize-none h-24`}
                        placeholder="Số nhà, đường, phường, quận..."
                    />
                </div>
                
                {/* Notes & Tags */}
                <div>
                    <label className={labelClass}>Ghi chú</label>
                    <input
                        value={customerInfo.notes}
                        onChange={(e) => setCustomerInfo({...customerInfo, notes: e.target.value})}
                        className={`${inputClass} mb-3`}
                        placeholder="Ghi chú thêm..."
                    />
                    <div className="flex flex-wrap gap-2">
                        {quickTags.map(tag => {
                            const isActive = customerInfo.notes.includes(tag);
                            return (
                                <button
                                    key={tag}
                                    type="button"
                                    onClick={() => toggleQuickTag(tag)}
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-all active:scale-95 ${
                                        isActive 
                                        ? 'bg-eco-100 text-eco-700 border-eco-200 shadow-sm' 
                                        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                                    }`}
                                >
                                    {isActive && <i className="fas fa-check mr-1"></i>}
                                    {tag}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>
          </div>

          {/* RIGHT COLUMN: ITEMS & CALCULATIONS */}
          <div className="lg:w-[60%] flex flex-col h-full bg-gray-50/30">
             <div className="p-6 lg:p-8 flex-grow" ref={productWrapperRef}>
                 <div className="flex justify-between items-center mb-4">
                     <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
                        <i className="fas fa-box-open text-eco-500"></i> Chi tiết đơn hàng
                     </h3>
                     <button type="button" onClick={addItemRow} className="text-xs font-bold text-white bg-eco-600 hover:bg-eco-700 px-3 py-1.5 rounded-lg transition-colors shadow-sm active:scale-95">
                        <i className="fas fa-plus mr-1"></i>Thêm dòng
                     </button>
                 </div>
                 
                 <div className="space-y-3">
                    {items.map((item, idx) => {
                      const selectedIds = getSelectedProductIds(idx);
                      const availableProducts = products.filter(p => 
                        !selectedIds.includes(p.id) && 
                        (!item.name || p.name.toLowerCase().includes(item.name.toLowerCase()))
                      );

                      return (
                      <div key={item.id} className={`bg-white p-3 rounded-2xl shadow-sm border border-gray-200 group transition-all hover:shadow-md relative ${activeProductRow === idx ? 'z-20 ring-2 ring-eco-100' : 'z-0'}`}>
                         <div className="flex items-start gap-3">
                             {/* Index */}
                             <div className="w-6 h-6 rounded-full bg-gray-100 text-gray-400 text-xs font-bold flex items-center justify-center mt-2">
                                {idx + 1}
                             </div>

                             <div className="flex-grow grid grid-cols-12 gap-3">
                                 {/* Product Name Input */}
                                 <div className="col-span-12 md:col-span-6 relative">
                                    <label className="text-[9px] font-bold text-gray-400 uppercase mb-1 block">Tên sản phẩm</label>
                                    <input 
                                        placeholder="Nhập tên..."
                                        value={item.name}
                                        onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                        onFocus={() => setActiveProductRow(idx)}
                                        className="w-full p-2 bg-gray-50 focus:bg-white border border-gray-200 focus:border-eco-500 rounded-lg text-sm font-bold text-gray-800 outline-none transition-all"
                                    />
                                    
                                    {/* Dropdown */}
                                    {activeProductRow === idx && (
                                        <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl z-50 max-h-56 overflow-y-auto animate-fade-in">
                                            {availableProducts.length === 0 ? (
                                                 <div className="p-3 text-xs text-gray-400 text-center italic">
                                                    Kho không có sản phẩm này
                                                 </div>
                                            ) : (
                                                availableProducts.map(p => (
                                                    <div 
                                                        key={p.id} 
                                                        onMouseDown={() => selectProductForItem(idx, p)} // Use onMouseDown to trigger before blur
                                                        className="px-3 py-2.5 hover:bg-eco-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-0 group/opt"
                                                    >
                                                        <div>
                                                            <div className="text-sm font-bold text-gray-800 group-hover/opt:text-eco-700">{p.name}</div>
                                                            <div className="text-[10px] text-gray-400">Tồn kho: <span className={p.stockQuantity < 5 ? 'text-red-500 font-bold' : ''}>{p.stockQuantity}</span></div>
                                                        </div>
                                                        <div className="text-xs font-bold text-eco-600 bg-eco-50 px-2 py-1 rounded-md">
                                                            {new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    )}
                                 </div>
                                 
                                 {/* Quantity */}
                                 <div className="col-span-4 md:col-span-2">
                                    <label className="text-[9px] font-bold text-gray-400 uppercase mb-1 block text-center">SL</label>
                                    <input 
                                        type="number" 
                                        min="0.1" step="any"
                                        value={item.quantity === 0 ? '' : item.quantity}
                                        onChange={(e) => handleItemChange(idx, 'quantity', e.target.value === '' ? 0 : Number(e.target.value))}
                                        className="w-full p-2 text-center bg-gray-50 focus:bg-white border border-gray-200 focus:border-eco-500 rounded-lg text-sm font-bold outline-none transition-all"
                                    />
                                 </div>

                                 {/* Price */}
                                 <div className="col-span-6 md:col-span-3">
                                    <label className="text-[9px] font-bold text-gray-400 uppercase mb-1 block text-right">Đơn giá</label>
                                    <input 
                                        type="number" step="any"
                                        value={item.price === 0 ? '' : item.price}
                                        onChange={(e) => handleItemChange(idx, 'price', e.target.value === '' ? 0 : Number(e.target.value))}
                                        className="w-full p-2 text-right bg-gray-50 focus:bg-white border border-gray-200 focus:border-eco-500 rounded-lg text-sm font-bold text-gray-800 outline-none transition-all"
                                    />
                                 </div>
                                 
                                 {/* Delete */}
                                 <div className="col-span-2 md:col-span-1 flex items-end justify-center pb-1">
                                    <button type="button" onClick={() => removeItemRow(idx)} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                                        <i className="fas fa-trash-alt"></i>
                                    </button>
                                 </div>
                             </div>
                         </div>
                      </div>
                      );
                    })}
                 </div>
             </div>

             {/* FOOTER TOTAL */}
             <div className="p-6 bg-white border-t border-gray-100 rounded-br-3xl">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <span className="text-xs font-bold text-gray-400 uppercase block mb-1">Tổng thanh toán</span>
                        <div className="text-xs text-gray-400">{items.length} mặt hàng</div>
                    </div>
                    <span className="text-3xl font-black text-gray-900 tracking-tighter">
                        {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalPrice)}
                    </span>
                </div>

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={resetForm}
                        className="px-6 py-3.5 rounded-xl text-gray-500 font-bold bg-gray-100 hover:bg-gray-200 transition-colors"
                    >
                        Hủy
                    </button>
                    <button
                        type="submit"
                        className="flex-grow bg-black text-white py-3.5 rounded-xl hover:bg-gray-800 font-bold text-lg shadow-xl shadow-gray-200 transition-all active:scale-95 flex items-center justify-center gap-2"
                    >
                        <span>Hoàn Tất Đơn Hàng</span>
                        <i className="fas fa-arrow-right text-sm"></i>
                    </button>
                </div>
             </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OrderForm;