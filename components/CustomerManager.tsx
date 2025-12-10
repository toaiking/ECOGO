
import React, { useState, useEffect, useRef, useDeferredValue } from 'react';
import toast from 'react-hot-toast';
import { Customer } from '../types';
import { storageService } from '../services/storageService';
import { verifyAddress } from '../services/geminiService';
import ConfirmModal from './ConfirmModal';
import { v4 as uuidv4 } from 'uuid';

const CustomerManager: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  // Defer search term processing to keep input responsive
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const [formData, setFormData] = useState<Partial<Customer>>({ name: '', phone: '', address: '', priorityScore: 999, socialLink: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Import State (Moved from sidebar to Modal)
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0); 
  const [importMode, setImportMode] = useState<'TEXT' | 'JSON'>('TEXT');
  const [isLocalMode, setIsLocalMode] = useState(false); 

  // Voice Search State
  const [isListeningSearch, setIsListeningSearch] = useState(false);
  const [isVerifyingAddr, setIsVerifyingAddr] = useState(false); // Map verification state

  // VIRTUAL SCROLL CONFIGURATION
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  
  // Increased row height to accommodate mobile card layout
  const ROW_HEIGHT = 100; 
  const CONTAINER_HEIGHT = 600; 
  const BUFFER = 5; 

  useEffect(() => { 
      const unsubscribe = storageService.subscribeCustomers(setCustomers); 
      return () => { if (unsubscribe) unsubscribe(); }; 
  }, []);
  
  useEffect(() => { 
      let result = customers;
      if (deferredSearchTerm) { 
          const lower = deferredSearchTerm.toLowerCase(); 
          result = customers.filter(c => c.name.toLowerCase().includes(lower) || (c.phone && c.phone.includes(lower)) || c.address.toLowerCase().includes(lower)); 
      }
      
      // Sort: Priority (ASC) -> Name (ASC)
      result.sort((a, b) => {
          const pA = a.priorityScore || 999;
          const pB = b.priorityScore || 999;
          if (pA !== pB) return pA - pB;
          return a.name.localeCompare(b.name);
      });

      setFilteredCustomers(result); 
  }, [customers, deferredSearchTerm]);

  // Handle Scroll Event for Virtual List
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
      setScrollTop(e.currentTarget.scrollTop);
  };

  const totalContentHeight = filteredCustomers.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(filteredCustomers.length, Math.ceil((scrollTop + CONTAINER_HEIGHT) / ROW_HEIGHT) + BUFFER);
  const visibleCustomers = filteredCustomers.slice(startIndex, endIndex);
  const topPadding = startIndex * ROW_HEIGHT;

  // --- VOICE SEARCH ---
  const handleVoiceSearch = () => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        toast.error("Trình duyệt không hỗ trợ");
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListeningSearch(true);
    recognition.onend = () => setIsListeningSearch(false);
    recognition.onerror = () => setIsListeningSearch(false);

    recognition.onresult = (event: any) => {
        const text = event.results[0][0].transcript;
        setSearchTerm(text);
        toast.success(`Đã tìm: "${text}"`);
    };

    recognition.start();
  };

  // --- ADDRESS VERIFICATION ---
  const handleVerifyAddress = async () => {
      const currentAddr = formData.address;
      if (!currentAddr || currentAddr.trim().length < 5) {
          toast.error("Vui lòng nhập địa chỉ sơ bộ trước.");
          return;
      }
      
      setIsVerifyingAddr(true);
      const toastId = toast.loading("Đang tìm địa chỉ trên Google Maps...");
      
      try {
          const result = await verifyAddress(currentAddr);
          
          setFormData(prev => ({ ...prev, address: result.address }));
          
          toast.success((t) => (
              <div className="flex flex-col gap-1">
                  <span className="font-bold">Đã chuẩn hóa địa chỉ!</span>
                  <div className="text-xs text-gray-500">{result.address}</div>
                  {result.mapLink && (
                      <a href={result.mapLink} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline font-bold flex items-center gap-1 mt-1">
                          <i className="fas fa-map-marked-alt"></i> Xem trên bản đồ
                      </a>
                  )}
              </div>
          ), { duration: 5000, icon: '📍' });
          
      } catch (e: any) {
          toast.error(e.message || "Không tìm thấy địa điểm.");
      } finally {
          setIsVerifyingAddr(false);
          toast.dismiss(toastId);
      }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) { toast.error('Cần nhập Tên khách hàng'); return; }
    
    const cleanPhone = formData.phone ? formData.phone.trim() : '';
    const newId = cleanPhone.length > 5 ? cleanPhone : uuidv4();

    const newCustomer: Customer = { 
        id: newId, 
        name: formData.name, 
        phone: cleanPhone, 
        address: formData.address || '', 
        lastOrderDate: Date.now(), 
        priorityScore: formData.priorityScore || 999,
        socialLink: formData.socialLink || ''
    };
    
    await storageService.upsertCustomer(newCustomer);
    setFormData({ name: '', phone: '', address: '', priorityScore: 999, socialLink: '' });
    toast.success('Đã lưu khách hàng');
  };

  const handleImport = async () => {
      if (!importText.trim()) return;
      setIsImporting(true);
      setImportProgress(5);
      
      setTimeout(async () => {
        try {
            let parsedCustomers: Customer[] = [];

            if (importMode === 'JSON') {
                try {
                    const jsonData = JSON.parse(importText);
                    if (Array.isArray(jsonData)) {
                        parsedCustomers = jsonData.map((c: any) => {
                            const p = c.phone ? c.phone.replace(/[^0-9]/g, '') : '';
                            return {
                              id: p.length > 5 ? p : uuidv4(),
                              name: c.name || '',
                              phone: p,
                              address: c.address || '',
                              lastOrderDate: Date.now(),
                              priorityScore: (c.priorityScore || c.priority) ? Number(c.priorityScore || c.priority) : 999,
                              socialLink: c.socialLink || ''
                            };
                        }).filter(c => c.name);
                    } else {
                        toast.error("Format JSON không đúng. Phải là mảng []");
                        setIsImporting(false); return;
                    }
                } catch (e) {
                    toast.error("Lỗi cú pháp JSON");
                    setIsImporting(false); return;
                }
            } else {
                const lines = importText.split('\n');
                lines.forEach(line => {
                    if (!line.trim()) return;
                    
                    let separator = line.includes('\t') ? '\t' : ',';
                    let parts = line.split(separator);
                    
                    if (parts.length >= 1) {
                        const name = parts[0].trim();
                        if (name.toLowerCase() === 'tên khách hàng' || name.toLowerCase() === 'name') return;

                        let phone = '';
                        let address = '';
                        let priority = 999;

                        if (parts.length > 1) { 
                             phone = parts[1].trim().replace(/[^0-9]/g, ''); 
                        }

                        if (separator === '\t') {
                            address = parts.length > 2 ? parts[2].trim() : '';
                            if (parts.length > 3) {
                                const rawP = parts[3].trim().replace(/[.,]/g, '');
                                const pVal = parseInt(rawP);
                                if (!isNaN(pVal) && pVal > 0) priority = pVal;
                            }
                        } else {
                            const lastColIndex = parts.length - 1;
                            const possiblePriority = parts[lastColIndex].trim().replace(/[.,]/g, '');
                            const pVal = parseInt(possiblePriority);
                            
                            if (parts.length >= 4 && !isNaN(pVal) && pVal > 0) {
                                priority = pVal;
                                address = parts.slice(2, lastColIndex).join(', ').trim();
                            } else {
                                address = parts.slice(2).join(', ').trim();
                            }
                        }
                        address = address.replace(/^"|"$/g, '');

                        if (name) { 
                            const id = phone.length > 5 ? phone : uuidv4();
                            parsedCustomers.push({ 
                                id: id, 
                                name, 
                                phone, 
                                address, 
                                lastOrderDate: Date.now(), 
                                priorityScore: priority 
                            }); 
                        }
                    }
                });
            }

            if (parsedCustomers.length === 0) {
                toast.error("Không tìm thấy dữ liệu hợp lệ.");
                setIsImporting(false);
                return;
            }

            setImportProgress(20);
            await storageService.importCustomersBatch(parsedCustomers, isLocalMode);
            
            setImportProgress(100);
            toast.success(`Đã nhập ${parsedCustomers.length} khách! ${isLocalMode ? '(Chế độ Test)' : ''}`); 
            setImportText(''); 
            setShowImportModal(false); 

        } catch (error) { 
            console.error(error); 
            toast.error("Lỗi: " + (error as any).message); 
        } finally { 
            setIsImporting(false); 
            setImportProgress(0);
        }
      }, 100);
  };

  const handleDeleteClick = (id: string) => { setDeleteId(id); setShowDeleteConfirm(true); };
  const confirmDelete = async () => { if (deleteId) { await storageService.deleteCustomer(deleteId); toast.success('Đã xóa khách hàng'); setShowDeleteConfirm(false); setDeleteId(null); } };
  
  const confirmDeleteAll = async () => { 
      await storageService.clearAllCustomers(isLocalMode); 
      toast.success(`Đã xóa toàn bộ ${isLocalMode ? '(Local)' : '(Full)'}`); 
      setShowDeleteAllConfirm(false); 
  };
  
  const handleInlineUpdate = async (customer: Customer, field: keyof Customer, value: any) => { 
      if (customer[field] === value) return; 
      const updated = { ...customer, [field]: value }; 
      await storageService.upsertCustomer(updated); 
      toast.success('Đã cập nhật', { id: 'inline-edit-success', duration: 1000 }); 
  };

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
      <div className="flex justify-between items-center mb-6 px-2 sm:px-0">
          <h1 className="text-2xl font-black text-gray-800 tracking-tight">Quản Lý Khách Hàng</h1>
          <div className="flex gap-2">
              <button onClick={() => setShowImportModal(true)} className="bg-eco-50 text-eco-700 hover:bg-eco-600 hover:text-white px-3 py-2 rounded-xl font-bold text-xs transition-colors border border-eco-200 shadow-sm flex items-center">
                  <i className="fas fa-file-import mr-2"></i>Import Excel
              </button>
              <button onClick={() => setShowDeleteAllConfirm(true)} className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-3 py-2 rounded-xl font-bold text-xs transition-colors border border-red-200 shadow-sm flex items-center">
                  <i className="fas fa-trash-alt mr-2"></i>Xóa Hết
              </button>
          </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN: ADD CUSTOMER */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-lg font-bold text-gray-900 mb-4 border-b border-gray-100 pb-2">Thêm Khách Mới</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">Tên khách *</label>
                      <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className="w-full p-2.5 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-lg outline-none transition-all text-sm font-bold text-gray-800" placeholder="VD: Anh Nam" />
                  </div>
                  <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">Số điện thoại</label>
                      <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className="w-full p-2.5 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-lg outline-none transition-all text-sm" placeholder="Không bắt buộc" />
                  </div>
                  <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">Link Facebook / Zalo</label>
                      <input value={formData.socialLink} onChange={e => setFormData({ ...formData, socialLink: e.target.value })} className="w-full p-2.5 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-lg outline-none transition-all text-sm text-blue-600" placeholder="https://..." />
                  </div>
                  <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">Địa chỉ</label>
                      <div className="relative">
                          <textarea 
                              value={formData.address} 
                              onChange={e => setFormData({ ...formData, address: e.target.value })} 
                              className="w-full p-2.5 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-lg outline-none transition-all resize-none text-sm pr-8" 
                              rows={2} 
                              placeholder="Số nhà, đường, quận..." 
                          />
                          <button
                              type="button"
                              onClick={handleVerifyAddress}
                              disabled={isVerifyingAddr}
                              className={`absolute right-2 top-2 w-6 h-6 rounded flex items-center justify-center transition-colors ${isVerifyingAddr ? 'text-gray-400' : 'text-red-500 hover:bg-red-50'}`}
                              title="Gim địa chỉ Google Maps"
                          >
                              {isVerifyingAddr ? <i className="fas fa-spinner fa-spin text-xs"></i> : <i className="fas fa-map-marker-alt text-sm"></i>}
                          </button>
                      </div>
                  </div>
                  <div>
                      <label className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1 block">Độ ưu tiên (1-6000)</label>
                      <input type="number" value={formData.priorityScore} onChange={e => setFormData({ ...formData, priorityScore: parseInt(e.target.value) })} className="w-full p-2.5 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-lg outline-none transition-all font-bold text-eco-700 text-sm" placeholder="999" />
                  </div>
                  <button type="submit" className="w-full bg-black text-white py-3 rounded-xl hover:bg-gray-800 font-bold shadow-lg shadow-gray-200 transition-all active:scale-95">Lưu Khách Hàng</button>
              </form>
          </div>
        </div>
        
        {/* RIGHT COLUMN: LIST WITH VIRTUAL SCROLLING */}
        <div className="lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden h-[700px] flex flex-col">
                {/* LIST HEADER */}
                <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50/80 backdrop-blur-sm z-10 sticky top-0">
                    <div className="flex items-center gap-3 w-full sm:w-auto justify-between">
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-gray-800">Danh Sách</h3>
                            <span className="bg-eco-100 text-eco-800 text-xs font-black px-2.5 py-0.5 rounded-full">{filteredCustomers.length}</span>
                        </div>
                    </div>
                    <div className="relative w-full sm:w-64">
                        <i className="fas fa-search absolute left-3 top-2.5 text-gray-400 text-xs"></i>
                        <input 
                            placeholder="Tìm tên, SĐT, địa chỉ..." 
                            value={searchTerm} 
                            onChange={e => setSearchTerm(e.target.value)} 
                            className="w-full pl-8 pr-10 py-2 bg-white border border-gray-200 focus:border-eco-500 rounded-xl text-xs font-medium outline-none transition-all shadow-sm focus:shadow-md" 
                        />
                        <button 
                            onClick={handleVoiceSearch}
                            className={`absolute right-2 top-1.5 w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isListeningSearch ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:text-eco-600 hover:bg-gray-100'}`}
                            title="Tìm bằng giọng nói"
                        >
                            <i className={`fas ${isListeningSearch ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
                        </button>
                    </div>
                </div>
                
                {/* TABLE HEADER (Sticky - Only on Desktop) */}
                <div className="hidden sm:grid bg-gray-100 border-b border-gray-200 grid-cols-[60px_1fr_120px_1fr_40px] gap-4 px-4 py-3 text-gray-500 font-bold uppercase text-[10px] tracking-wider select-none shadow-sm z-10">
                    <div className="text-center" title="Số ưu tiên lộ trình">Ưu tiên</div>
                    <div>Khách hàng</div>
                    <div>Liên hệ</div>
                    <div>Địa chỉ</div>
                    <div></div>
                </div>

                {/* VIRTUAL SCROLL BODY */}
                <div 
                    className="flex-grow overflow-y-auto relative scroll-smooth bg-gray-50/30" 
                    onScroll={handleScroll} 
                    ref={scrollContainerRef}
                    style={{ contain: 'strict' }}
                >
                    {filteredCustomers.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full text-gray-300">
                            <i className="fas fa-search text-4xl mb-3 opacity-20"></i>
                            <p className="text-sm font-medium">Không tìm thấy khách hàng</p>
                        </div>
                    ) : (
                        <div className="relative w-full" style={{ height: totalContentHeight }}>
                            {visibleCustomers.map((c, index) => (
                                <div 
                                    key={c.id} 
                                    className="absolute left-0 right-0 px-4 border-b border-gray-100 hover:bg-blue-50/50 transition-colors group flex flex-col justify-center sm:grid sm:grid-cols-[60px_1fr_120px_1fr_40px] sm:gap-4 sm:items-center bg-white"
                                    style={{ top: topPadding + index * ROW_HEIGHT, height: ROW_HEIGHT }}
                                >
                                    {/* --- MOBILE VIEW: TOP ROW (Name + Priority) --- */}
                                    <div className="flex justify-between items-center mb-1 sm:mb-0 sm:contents">
                                        {/* Priority (Desktop: Col 1) */}
                                        <div className="order-2 sm:order-1 sm:text-center">
                                            <input 
                                                type="number" 
                                                className="w-12 sm:w-full text-right sm:text-center bg-gray-50 sm:bg-transparent border border-gray-200 sm:border-transparent hover:border-gray-300 focus:border-eco-500 focus:bg-white rounded px-1 py-0.5 font-bold text-eco-700 outline-none transition-all text-xs" 
                                                defaultValue={c.priorityScore || 999} 
                                                onBlur={(e) => handleInlineUpdate(c, 'priorityScore', parseInt(e.target.value))} 
                                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} 
                                            />
                                        </div>
                                        
                                        {/* Name (Desktop: Col 2) */}
                                        <div className="order-1 sm:order-2 flex-grow mr-2 sm:mr-0">
                                            <input 
                                                className="w-full bg-transparent border-none p-0 font-bold text-gray-800 outline-none text-sm sm:text-sm truncate focus:ring-0" 
                                                defaultValue={c.name} 
                                                onBlur={(e) => handleInlineUpdate(c, 'name', e.target.value)} 
                                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} 
                                            />
                                        </div>
                                    </div>

                                    {/* --- MOBILE VIEW: MIDDLE ROW (Address) --- */}
                                    <div className="mb-2 sm:mb-0 sm:order-4 sm:col-start-4">
                                        <input 
                                            className="w-full bg-transparent border-none p-0 text-xs text-gray-500 outline-none truncate focus:ring-0 placeholder-gray-300" 
                                            defaultValue={c.address} 
                                            placeholder="Chưa có địa chỉ"
                                            onBlur={(e) => handleInlineUpdate(c, 'address', e.target.value)} 
                                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} 
                                        />
                                    </div>

                                    {/* --- MOBILE VIEW: BOTTOM ROW (Phone Button) --- */}
                                    <div className="sm:order-3 sm:col-start-3 flex items-center gap-2">
                                        {c.phone ? (
                                            <a 
                                                href={`tel:${c.phone}`}
                                                className="inline-flex items-center gap-2 bg-green-50 text-green-700 px-3 py-1.5 rounded-lg border border-green-100 hover:bg-green-100 transition-colors text-xs font-bold sm:bg-gray-50 sm:text-gray-600 sm:border-transparent sm:px-2 sm:py-0.5 sm:font-mono"
                                            >
                                                <i className="fas fa-phone-alt text-[10px] sm:hidden"></i>
                                                {c.phone}
                                            </a>
                                        ) : (
                                            <span className="text-xs text-gray-300 italic">No phone</span>
                                        )}
                                        
                                        {/* Social Link Input */}
                                        <div className="relative flex-grow sm:flex-grow-0 sm:w-8">
                                            <input 
                                                className={`w-full sm:w-8 sm:h-8 rounded-full border border-gray-200 text-xs px-2 sm:px-0 sm:text-center outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-200 transition-all ${c.socialLink ? 'text-blue-600 bg-blue-50 border-blue-200' : 'text-gray-400 bg-gray-50'}`}
                                                placeholder={c.socialLink ? "Link..." : "+Link"}
                                                defaultValue={c.socialLink}
                                                title={c.socialLink || "Dán link Facebook"}
                                                onBlur={(e) => handleInlineUpdate(c, 'socialLink', e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                            />
                                            {c.socialLink && (
                                                <a href={c.socialLink} target="_blank" rel="noopener noreferrer" className="absolute right-2 top-1/2 -translate-y-1/2 sm:hidden text-blue-500">
                                                    <i className="fas fa-external-link-alt"></i>
                                                </a>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Delete Button (Desktop: Col 5) */}
                                    <div className="absolute top-2 right-2 sm:static sm:order-5 sm:text-right">
                                        <button 
                                            onClick={() => handleDeleteClick(c.id)} 
                                            className="w-7 h-7 rounded-full flex items-center justify-center text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all" 
                                            title="Xóa"
                                        >
                                            <i className="fas fa-times text-sm"></i>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>

      {/* IMPORT MODAL */}
      {showImportModal && (
          <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                  <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                      <h3 className="font-bold text-lg text-gray-800">Nhập liệu Khách Hàng (Excel/Text)</h3>
                      <button onClick={() => setShowImportModal(false)} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
                  </div>
                  
                  <div className="p-6 space-y-4 overflow-y-auto">
                      <div className="flex items-center gap-2 bg-yellow-50 p-2 rounded-lg border border-yellow-100">
                          <input 
                              type="checkbox" 
                              id="devMode" 
                              checked={isLocalMode} 
                              onChange={e => setIsLocalMode(e.target.checked)} 
                              className="w-4 h-4 text-eco-600 rounded focus:ring-eco-500 cursor-pointer"
                          />
                          <label htmlFor="devMode" className="text-xs font-bold text-yellow-800 cursor-pointer select-none flex-grow">
                              Chế độ Test (Tắt Cloud Sync)
                          </label>
                      </div>

                      <div className="flex gap-2 p-1 bg-gray-100 rounded-lg">
                          <button onClick={() => setImportMode('TEXT')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${importMode === 'TEXT' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>Excel / Text</button>
                          <button onClick={() => setImportMode('JSON')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${importMode === 'JSON' ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>JSON</button>
                      </div>
                      
                      {importMode === 'TEXT' ? (
                          <>
                            <p className="text-[10px] text-gray-500 leading-relaxed italic bg-blue-50 p-2 rounded border border-blue-100">
                                Copy từ Excel (không cần tiêu đề):<br/>
                                <b>Tên | SĐT | Địa chỉ | Ưu tiên</b><br/>
                                <i>Số điện thoại không bắt buộc.</i>
                            </p>
                            <textarea value={importText} onChange={e => setImportText(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono h-48 focus:border-eco-500 outline-none whitespace-pre scrollbar-thin" placeholder={"Nguyen Van A\t0909123\tQuan 1\t1\nLe Thi B\t\tQuan 3\t2"} disabled={isImporting} />
                          </>
                      ) : (
                          <>
                            <p className="text-xs text-gray-500 leading-relaxed">Dán mảng JSON vào đây (cho dữ liệu lớn)</p>
                            <textarea value={importText} onChange={e => setImportText(e.target.value)} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono h-48 focus:border-eco-500 outline-none scrollbar-thin" placeholder='[ {"name": "A", "phone": "", "priority": 1} ]' disabled={isImporting} />
                          </>
                      )}
                      
                      {isImporting && (
                          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                              <div className="bg-eco-600 h-2 rounded-full transition-all duration-300 animate-pulse" style={{ width: `${importProgress}%` }}></div>
                          </div>
                      )}

                      <button onClick={handleImport} type="button" disabled={isImporting} className={`w-full py-3 rounded-xl text-sm font-bold text-white transition-all shadow-md ${isImporting ? 'bg-gray-400 cursor-not-allowed' : 'bg-eco-600 hover:bg-eco-700'}`}>{isImporting ? `Đang nhập ${importProgress}%` : 'Bắt đầu Nhập'}</button>
                  </div>
              </div>
          </div>
      )}

      <ConfirmModal isOpen={showDeleteConfirm} title="Xóa khách hàng?" message="Hành động này sẽ xóa khách hàng khỏi danh bạ." onConfirm={confirmDelete} onCancel={() => setShowDeleteConfirm(false)} confirmLabel="Xóa" isDanger={true} />
      <ConfirmModal isOpen={showDeleteAllConfirm} title={`CẢNH BÁO: Xóa TẤT CẢ?`} message={`Bạn có chắc chắn muốn xóa toàn bộ danh sách khách hàng? \n\n ${isLocalMode ? 'Chế độ Test: Chỉ xóa trên máy này.' : 'Dữ liệu sẽ bị xóa cả trên Cloud (nếu có mạng).'}`} onConfirm={confirmDeleteAll} onCancel={() => setShowDeleteAllConfirm(false)} confirmLabel="XÓA SẠCH" isDanger={true} />
    </div>
  );
};

export default CustomerManager;
