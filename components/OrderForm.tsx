
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Order, OrderStatus, Product, Customer, PaymentMethod, OrderItem } from '../types';
import { storageService, generateProductSku, normalizeString } from '../services/storageService';
import { parseOrderText } from '../services/geminiService';
import { differenceInDays } from 'date-fns';
import { ProductEditModal } from './InventoryManager';

const OrderForm: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [orders, setOrders] = useState<Order[]>([]); // Need orders to calc batch stats
  
  // Mobile Tab State
  const [mobileTab, setMobileTab] = useState<'FORM' | 'STATS'>('FORM');

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

  // Quick Add/Edit Product Modal State
  const [showProductModal, setShowProductModal] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editMode, setEditMode] = useState<'IMPORT' | 'SET'>('IMPORT');

  // Added customerId to state
  const [customerInfo, setCustomerInfo] = useState({
    customerId: '', // NEW
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

    // Batch & Orders Logic
    const unsubOrders = storageService.subscribeOrders((loadedOrders) => {
        setOrders(loadedOrders);
        const batchActivity = new Map<string, number>();
        loadedOrders.forEach(o => {
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

  // --- BATCH STATISTICS CALCULATION ---
  const batchStats = useMemo(() => {
      const statsMap = new Map<string, { qty: number }>();
      
      // 1. Calculate sold quantity for the current batch
      orders.forEach(o => {
          if (o.batchId === batchId && o.status !== OrderStatus.CANCELLED) {
              o.items.forEach(item => {
                  const normName = normalizeString(item.name);
                  const current = statsMap.get(normName) || { qty: 0 };
                  current.qty += item.quantity;
                  statsMap.set(normName, current);
              });
          }
      });

      // 2. Map to products to get stock info
      const result = products.map(p => {
          const normName = normalizeString(p.name);
          const soldInBatch = statsMap.get(normName)?.qty || 0;
          
          const stock = p.stockQuantity || 0;
          const totalImported = p.totalImported || 0;
          
          return {
              product: p,
              soldInBatch,
              stock,
              totalImported
          };
      });

      // Filter: Only show products sold in this batch OR low stock products
      // Sort: Most sold in batch -> Least sold
      return result
          .filter(item => item.soldInBatch > 0)
          .sort((a, b) => b.soldInBatch - a.soldInBatch);

  }, [orders, products, batchId]);

  // --- HANDLERS ---

  const handleEditProduct = (product: Product) => {
      setEditingProduct(product);
      setEditMode('IMPORT'); // Default to import/add more
      setShowProductModal(true);
  };

  const handleSaveProduct = async (productData: Product) => {
      await storageService.saveProduct(productData);
      toast.success("Đã cập nhật hàng hóa");
      setEditingProduct(null); // Close modal triggers re-render via state update
  };

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
        if (event.error === 'not-allowed') {
            toast.error("Quyền truy cập Micro bị chặn. Vui lòng cho phép trong cài đặt trình duyệt.");
        } else if (event.error === 'no-speech') {
            toast('Không nghe thấy gì...', { icon: '🔇' });
        } else {
            toast.error("Lỗi giọng nói: " + event.error);
        }
    };

    recognition.onresult = async (event: any) => {
        const transcript = event.results[0][0].transcript;
        toast.success(`Đã nhận: "${transcript}"`);
        await processOrderText(transcript);
    };

    recognition.start();
  };

  const handlePasteFromMessenger = async () => {
      try {
          const text = await navigator.clipboard.readText();
          if (!text || text.trim().length === 0) {
              toast.error("Clipboard trống! Hãy copy đoạn chat trước.");
              return;
          }
          toast.success("Đã lấy nội dung từ Clipboard");
          await processOrderText(text);
      } catch (err) {
          toast.error("Không thể đọc Clipboard. Vui lòng cấp quyền.");
      }
  };

  const processOrderText = async (text: string) => {
      setIsProcessingAI(true);
      const loadingToast = toast.loading("AI đang đọc đoạn chat...");
      
      try {
          // Pass products and customers to Gemini for context-aware parsing
          const result = await parseOrderText(text, products, customers);
          
          // Auto detect returning customer logic if possible
          if (result.customerName) {
             const matched = customers.find(c => c.name.toLowerCase() === result.customerName.toLowerCase());
             if (matched) handleCustomerSelect(matched);
          }

          setCustomerInfo(prev => ({
              ...prev,
              customerName: result.customerName || prev.customerName,
              customerPhone: result.customerPhone || prev.customerPhone,
              address: result.address || prev.address,
              notes: result.notes || prev.notes
          }));

          // Handle Items with Fuzzy Match (Client Side Optimization)
          if (result.parsedItems && result.parsedItems.length > 0) {
              const newItems = result.parsedItems.map(pi => {
                  // Fuzzy Match Logic
                  let matchedProduct: Product | undefined;
                  const searchName = pi.productName.toLowerCase();
                  
                  // 1. Exact match
                  matchedProduct = products.find(p => p.name.toLowerCase() === searchName);
                  
                  // 2. Contains match
                  if (!matchedProduct) {
                      matchedProduct = products.find(p => p.name.toLowerCase().includes(searchName));
                  }

                  // 3. Reverse Contains match (Product name inside Search name)
                  if (!matchedProduct) {
                      matchedProduct = products.find(p => searchName.includes(p.name.toLowerCase()));
                  }

                  return {
                      id: uuidv4(),
                      name: matchedProduct ? matchedProduct.name : pi.productName,
                      quantity: pi.quantity || 1,
                      price: matchedProduct ? matchedProduct.defaultPrice : 0,
                      productId: matchedProduct ? matchedProduct.id : undefined,
                      importPrice: matchedProduct ? matchedProduct.importPrice : undefined // Capture import price
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
        importPrice: product.importPrice // Copy current import price for profit calculation
      };
      setItems(newItems);
      setActiveProductRow(null);
  };

  const handleCustomerSelect = (customer: Customer) => {
    setCustomerInfo({
      customerId: customer.id, // Explicitly set ID
      customerName: customer.name,
      customerPhone: customer.phone,
      address: customer.address,
      notes: customerInfo.notes
    });
    setShowCustomerSuggestions(false);
    
    // RETURNING CUSTOMER CHECK
    if (customer.lastOrderDate) {
        const daysDiff = differenceInDays(Date.now(), customer.lastOrderDate);
        if (daysDiff > 30) {
            toast((t) => (
                <div className="flex items-center gap-2">
                    <span className="text-xl">🎉</span>
                    <div>
                        <div className="font-bold">Khách quay lại!</div>
                        <div className="text-xs">Đã {daysDiff} ngày chưa đặt hàng.</div>
                    </div>
                </div>
            ), { duration: 4000, style: { background: '#ecfdf5', color: '#047857' } });
        }
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomerInfo(prev => ({ ...prev, customerName: e.target.value, customerId: '' })); // Clear ID on name change to force re-match if new
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
      setCustomerInfo({ customerId: '', customerName: '', customerPhone: '', address: '', notes: '' });
      setItems([{ id: uuidv4(), name: '', quantity: 1, price: 0 }]);
      if (nameInputRef.current) nameInputRef.current.focus();
  };

  const handleQuickCreateProduct = () => {
      setEditingProduct(null); // Create new
      setEditMode('IMPORT');
      setShowProductModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validItems = items.filter(i => i.name && i.name.trim() !== '') as OrderItem[];

    if (!customerInfo.customerName || !customerInfo.address || validItems.length === 0) {
      toast.error('Thiếu tên, địa chỉ hoặc hàng hóa');
      return;
    }

    // 1. DEDUCT STOCK
    for (const item of validItems) {
        if (item.productId) {
            const product = products.find(p => p.id === item.productId);
            if (product) {
                const currentStock = Number(product.stockQuantity) || 0;
                // If totalImported is missing (old data), assume it matches stock to initialize it properly
                const currentTotalImported = Number(product.totalImported) || currentStock; 
                
                const deductQty = Number(item.quantity) || 0;
                const newStock = Math.max(0, currentStock - deductQty);
                
                // Update product in storage
                await storageService.saveProduct({
                    ...product,
                    stockQuantity: newStock,
                    totalImported: currentTotalImported
                });
            }
        }
    }

    // 2. CREATE ORDER
    const newOrder: Order = {
      id: uuidv4().slice(0, 8).toUpperCase(),
      customerId: customerInfo.customerId, // Pass ID
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
    
    toast.success('Lên đơn thành công & Đã trừ kho!');
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

  const inputClass = "w-full px-2 py-2 bg-gray-50 focus:bg-white border border-gray-200 focus:border-eco-500 rounded-lg outline-none transition-all text-sm font-medium placeholder-gray-400";
  const labelClass = "block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-0.5 ml-1";

  // Total Quantity in current batch
  const totalSoldInBatch = batchStats.reduce((sum, item) => sum + item.soldInBatch, 0);

  return (
    <div className="flex flex-col h-[calc(100vh-6rem)] bg-white rounded-2xl shadow-xl border border-gray-100 overflow-hidden relative">
        
        {/* LOADING OVERLAY */}
        {isProcessingAI && (
            <div className="absolute inset-0 z-50 bg-white/60 backdrop-blur-sm flex items-center justify-center">
                <div className="flex flex-col items-center">
                    <div className="w-12 h-12 border-4 border-eco-200 border-t-eco-600 rounded-full animate-spin"></div>
                    <span className="mt-3 text-sm font-bold text-eco-800 animate-pulse">AI đang đọc đoạn chat...</span>
                </div>
            </div>
        )}

        {/* --- MOBILE TAB HEADER --- */}
        <div className="md:hidden flex border-b border-gray-200 bg-white shrink-0">
            <button 
                onClick={() => setMobileTab('FORM')}
                className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${mobileTab === 'FORM' ? 'border-eco-600 text-eco-700' : 'border-transparent text-gray-400'}`}
            >
                Nhập Đơn
            </button>
            <button 
                onClick={() => setMobileTab('STATS')}
                className={`flex-1 py-3 text-sm font-bold border-b-2 transition-colors ${mobileTab === 'STATS' ? 'border-purple-600 text-purple-700' : 'border-transparent text-gray-400'}`}
            >
                Thống Kê Lô ({batchStats.length})
            </button>
        </div>

        <div className="flex flex-col md:flex-row h-full overflow-hidden">
            
            {/* --- LEFT SIDE: FORM INPUT (70%) --- */}
            {/* Logic: Hidden on Mobile if Stats Tab active. Always Flex on Desktop */}
            <div className={`${mobileTab === 'FORM' ? 'flex' : 'hidden'} md:flex md:w-[70%] flex-col h-full overflow-hidden relative`}>
                {/* 1. HEADER */}
                <div className="px-4 py-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-eco-100 text-eco-600 flex items-center justify-center shadow-sm">
                            <i className="fas fa-plus-circle"></i>
                        </div>
                        <h2 className="text-base font-black text-gray-800 hidden sm:block">Tạo Đơn Hàng</h2>
                    </div>
                    
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                        {/* BATCH SELECTOR */}
                        <div className="relative" ref={batchWrapperRef}>
                            <div className="flex items-center bg-white border border-gray-200 rounded-lg px-2 py-1.5 shadow-sm hover:border-eco-400 transition-colors cursor-pointer" onClick={() => setShowBatchSuggestions(!showBatchSuggestions)}>
                                <span className="text-[9px] font-bold text-gray-400 uppercase mr-1 hidden sm:inline">Lô:</span>
                                <input 
                                    value={batchId}
                                    onChange={(e) => setBatchId(e.target.value)}
                                    className="w-24 text-xs font-bold text-eco-700 outline-none bg-transparent"
                                    placeholder="LÔ-HÔM-NAY"
                                />
                                <i className="fas fa-chevron-down text-[10px] text-gray-400 ml-1"></i>
                            </div>
                            {showBatchSuggestions && existingBatches.length > 0 && (
                                <div className="absolute top-full right-0 mt-1 w-48 bg-white border border-gray-100 rounded-lg shadow-xl z-50 overflow-hidden">
                                    {existingBatches.map(b => (
                                        <div key={b} onClick={() => selectBatch(b)} className="px-3 py-2 hover:bg-eco-50 cursor-pointer text-xs font-medium text-gray-700 border-b border-gray-50 last:border-0 flex justify-between">
                                            {b} {batchId === b && <i className="fas fa-check text-eco-600"></i>}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <button onClick={handlePasteFromMessenger} className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors" title="Dán từ Messenger">
                            <i className="fab fa-facebook-messenger"></i>
                        </button>
                        <button onClick={handleVoiceInput} disabled={isListening} className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                            <i className={`fas ${isListening ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                        </button>
                    </div>
                </div>

                {/* 2. SCROLLABLE FORM AREA */}
                <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto p-3 space-y-3">
                    
                    {/* A. CUSTOMER INFO (Compact Grid) */}
                    <div className="bg-gray-50/50 p-3 rounded-xl border border-gray-100">
                        <div className="grid grid-cols-12 gap-2 mb-2">
                            <div className="col-span-7 relative" ref={customerWrapperRef}>
                                <label className={labelClass}>Tên khách <span className="text-red-500">*</span></label>
                                <input
                                    ref={nameInputRef}
                                    value={customerInfo.customerName}
                                    onChange={handleNameChange}
                                    required
                                    className={`${inputClass} font-bold text-gray-800`}
                                    placeholder="Nhập tên..."
                                    autoComplete="off"
                                />
                                {showCustomerSuggestions && customerSuggestions.length > 0 && (
                                    <ul className="absolute z-30 w-full bg-white border border-gray-100 rounded-lg shadow-xl mt-1 overflow-hidden">
                                        {customerSuggestions.map(s => (
                                            <li key={s.id} onClick={() => handleCustomerSelect(s)} className="px-3 py-2 hover:bg-blue-50 cursor-pointer border-b border-gray-50 last:border-0 text-xs">
                                                <div className="font-bold text-gray-800">{s.name} <span className="font-normal text-gray-400"> - {s.phone}</span></div>
                                                <div className="text-gray-500 truncate">{s.address}</div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="col-span-5">
                                <label className={labelClass}>Điện thoại</label>
                                <input
                                    value={customerInfo.customerPhone}
                                    onChange={(e) => setCustomerInfo({...customerInfo, customerPhone: e.target.value})}
                                    className={inputClass}
                                    placeholder="SĐT..."
                                />
                            </div>
                        </div>
                        
                        <div className="mb-2">
                            <input
                                value={customerInfo.address}
                                onChange={(e) => setCustomerInfo({...customerInfo, address: e.target.value})}
                                required
                                className={`${inputClass} font-medium text-gray-700`}
                                placeholder="Địa chỉ giao hàng (Số nhà, đường, phường...)"
                            />
                        </div>

                        <div className="flex gap-2 items-center">
                            <div className="flex-grow">
                                <input
                                    value={customerInfo.notes}
                                    onChange={(e) => setCustomerInfo({...customerInfo, notes: e.target.value})}
                                    className={`${inputClass} text-xs`}
                                    placeholder="Ghi chú đơn hàng..."
                                />
                            </div>
                            {/* Quick Tags Inline */}
                            <div className="flex gap-1 overflow-x-auto no-scrollbar max-w-[40%]">
                                {quickTags.slice(0, 3).map(tag => (
                                    <button
                                        key={tag}
                                        type="button"
                                        onClick={() => toggleQuickTag(tag)}
                                        className={`whitespace-nowrap px-2 py-1.5 rounded text-[9px] font-bold border transition-colors ${customerInfo.notes.includes(tag) ? 'bg-eco-100 text-eco-700 border-eco-200' : 'bg-white text-gray-500 border-gray-200'}`}
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* B. ITEMS LIST */}
                    <div className="space-y-2 pb-2" ref={productWrapperRef}>
                        <div className="flex justify-between items-center px-1">
                            <h3 className="text-xs font-bold text-gray-500 uppercase">Chi tiết đơn hàng</h3>
                            <button type="button" onClick={addItemRow} className="text-[10px] font-bold text-white bg-eco-600 hover:bg-eco-700 px-2 py-1 rounded transition-colors shadow-sm">
                                + Thêm dòng
                            </button>
                        </div>

                        {items.map((item, idx) => {
                        const selectedIds = getSelectedProductIds(idx);
                        const availableProducts = products.filter(p => 
                            !selectedIds.includes(p.id) && 
                            (!item.name || p.name.toLowerCase().includes(item.name.toLowerCase()))
                        );

                        return (
                        <div key={item.id} className={`flex items-center gap-2 bg-white p-2 rounded-lg border border-gray-200 shadow-sm relative ${activeProductRow === idx ? 'ring-1 ring-blue-200 z-20' : ''}`}>
                            <div className="flex-grow relative">
                                <input 
                                    placeholder="Tên sản phẩm..."
                                    value={item.name}
                                    onChange={(e) => handleItemChange(idx, 'name', e.target.value)}
                                    onFocus={() => setActiveProductRow(idx)}
                                    className="w-full p-1.5 bg-gray-50 border border-gray-100 rounded text-sm font-bold text-gray-800 outline-none focus:bg-white focus:border-blue-300 transition-all"
                                />
                                {/* Dropdown */}
                                {activeProductRow === idx && (
                                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 max-h-48 overflow-y-auto flex flex-col">
                                        <div className="flex-grow overflow-y-auto">
                                            {availableProducts.length === 0 ? (
                                                <div className="p-2 text-xs text-gray-400 text-center italic">Không tìm thấy</div>
                                            ) : (
                                                availableProducts.map(p => (
                                                    <div 
                                                        key={p.id} 
                                                        onMouseDown={() => selectProductForItem(idx, p)}
                                                        className="px-3 py-2 hover:bg-blue-50 cursor-pointer flex justify-between items-center border-b border-gray-50 last:border-0 group/opt"
                                                    >
                                                        <div>
                                                            <div className="text-sm font-bold text-gray-800">{p.name}</div>
                                                            <div className="text-[9px] text-gray-400">Tồn: <span className={p.stockQuantity < 5 ? 'text-red-500 font-bold' : ''}>{p.stockQuantity}</span></div>
                                                        </div>
                                                        <div className="text-xs font-bold text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                                                            {new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}
                                                        </div>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                        <div onMouseDown={handleQuickCreateProduct} className="p-2 bg-gray-50 border-t border-gray-100 text-center text-xs font-bold text-blue-600 hover:bg-blue-100 cursor-pointer">
                                            + Tạo nhanh SP mới
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="w-12">
                                <input 
                                    type="number" min="0.1" step="any"
                                    value={item.quantity === 0 ? '' : item.quantity}
                                    onChange={(e) => handleItemChange(idx, 'quantity', e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="w-full p-1.5 text-center bg-gray-50 border border-gray-100 rounded text-sm font-bold outline-none focus:bg-white focus:border-blue-300"
                                    placeholder="SL"
                                />
                            </div>
                            <div className="w-20 hidden sm:block">
                                <input 
                                    type="number" step="any"
                                    value={item.price === 0 ? '' : item.price}
                                    onChange={(e) => handleItemChange(idx, 'price', e.target.value === '' ? 0 : Number(e.target.value))}
                                    className="w-full p-1.5 text-right bg-gray-50 border border-gray-100 rounded text-sm font-bold outline-none focus:bg-white focus:border-blue-300"
                                    placeholder="Giá"
                                />
                            </div>
                            <button type="button" onClick={() => removeItemRow(idx)} className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-red-500 rounded hover:bg-red-50 transition-colors">
                                <i className="fas fa-times"></i>
                            </button>
                        </div>
                        );
                        })}
                    </div>
                </form>

                {/* 3. FOOTER (TOTAL & ACTION) */}
                <div className="p-3 bg-white border-t border-gray-200 shrink-0">
                    <div className="flex justify-between items-end mb-3">
                        <div className="text-xs text-gray-400 font-medium">{items.length} mặt hàng</div>
                        <div className="text-2xl font-black text-gray-900 leading-none">
                            {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalPrice)}
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button type="button" onClick={resetForm} className="px-4 py-3 rounded-xl bg-gray-100 text-gray-600 font-bold text-xs hover:bg-gray-200 transition-colors">Hủy</button>
                        <button onClick={handleSubmit} className="flex-grow bg-black text-white py-3 rounded-xl font-bold text-sm shadow-lg hover:bg-gray-800 transition-transform active:scale-95 flex items-center justify-center gap-2">
                            <span>Lên Đơn & Trừ Kho</span>
                            <i className="fas fa-paper-plane text-xs"></i>
                        </button>
                    </div>
                </div>
            </div>

            {/* --- RIGHT SIDE: BATCH STATS TABLE (30% or Mobile Tab) --- */}
            {/* Logic: Hidden on Mobile if Form Tab active. Always Flex on Desktop */}
            <div className={`${mobileTab === 'STATS' ? 'flex' : 'hidden'} md:flex md:w-[30%] flex-col border-l border-gray-200 bg-gray-50/30 h-full overflow-hidden`}>
                <div className="p-3 border-b border-gray-200 bg-white">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                        <i className="fas fa-cubes text-purple-500"></i> Thống kê Lô {batchId}
                    </h3>
                </div>
                
                <div className="flex-grow overflow-y-auto relative">
                    {batchStats.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-300 space-y-2">
                            <i className="fas fa-clipboard-list text-3xl opacity-20"></i>
                            <p className="text-xs">Chưa có hàng trong lô này</p>
                        </div>
                    ) : (
                        <table className="w-full text-left border-collapse">
                            <thead className="bg-gray-100 text-gray-500 text-[10px] font-bold uppercase sticky top-0 z-10 shadow-sm">
                                <tr>
                                    <th className="py-2 pl-3">Sản phẩm</th>
                                    <th className="py-2 text-center w-12">Đã bán</th>
                                    <th className="py-2 pr-3 text-right w-14">Tồn</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 bg-white">
                                {batchStats.map((stat, idx) => {
                                    const stockPercent = Math.min(100, (stat.stock / (stat.totalImported || 1)) * 100);
                                    const isLow = stat.stock < 5;
                                    
                                    return (
                                        <tr key={idx} className="hover:bg-purple-50/50 transition-colors group">
                                            <td className="py-2 pl-3 align-middle">
                                                <div className="flex items-center gap-1">
                                                    <div className="text-xs font-bold text-gray-800 leading-tight group-hover:text-purple-700 transition-colors truncate max-w-[120px]" title={stat.product.name}>
                                                        {stat.product.name}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingProduct(stat.product);
                                                            setEditMode('SET');
                                                            setShowProductModal(true);
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 transition-opacity p-1"
                                                        title="Sửa hàng hóa"
                                                    >
                                                        <i className="fas fa-pen text-[10px]"></i>
                                                    </button>
                                                </div>
                                                {/* Mini Progress Bar */}
                                                <div className="w-full bg-gray-100 rounded-full h-1 mt-1 overflow-hidden opacity-50 group-hover:opacity-100">
                                                    <div className={`h-full rounded-full ${isLow ? 'bg-red-500' : 'bg-green-500'}`} style={{ width: `${stockPercent}%` }}></div>
                                                </div>
                                            </td>
                                            <td className="py-2 text-center align-middle">
                                                <span className="bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded text-[10px] font-black">
                                                    {stat.soldInBatch}
                                                </span>
                                            </td>
                                            <td className="py-2 pr-3 text-right align-middle">
                                                <span className={`text-[10px] font-bold ${isLow ? 'text-red-500' : 'text-gray-400'}`}>
                                                    {stat.stock}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>
                
                <div className="p-3 border-t border-gray-200 bg-white text-[10px] text-gray-500 flex justify-between shrink-0">
                    <span>Tổng SP bán trong lô:</span>
                    <span className="font-bold text-gray-800 text-xs">{totalSoldInBatch}</span>
                </div>
            </div>
        </div>

      {/* QUICK ADD/EDIT PRODUCT MODAL (Reused from InventoryManager) */}
      <ProductEditModal 
          isOpen={showProductModal}
          onClose={() => setShowProductModal(false)}
          product={editingProduct}
          onSave={handleSaveProduct}
          initialMode={editMode}
      />
    </div>
  );
};

export default OrderForm;
