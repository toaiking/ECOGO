
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
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const [formData, setFormData] = useState<Partial<Customer>>({ name: '', phone: '', address: '', priorityScore: 999, socialLink: '' });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0); 
  const [importMode, setImportMode] = useState<'TEXT' | 'JSON'>('TEXT');
  const [isLocalMode, setIsLocalMode] = useState(false); 

  const [isListeningSearch, setIsListeningSearch] = useState(false);
  const [isVerifyingAddr, setIsVerifyingAddr] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  
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
      result.sort((a, b) => {
          const pA = a.priorityScore || 999;
          const pB = b.priorityScore || 999;
          if (pA !== pB) return pA - pB;
          return a.name.localeCompare(b.name);
      });
      setFilteredCustomers(result); 
  }, [customers, deferredSearchTerm]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => { setScrollTop(e.currentTarget.scrollTop); };

  /* FIX: Add missing handleDeleteClick and confirmDelete handlers */
  const handleDeleteClick = (id: string) => {
    setDeleteId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (deleteId) {
      await storageService.deleteCustomer(deleteId);
      toast.success('Đã xóa khách hàng');
      setShowDeleteConfirm(false);
      setDeleteId(null);
    }
  };

  const totalContentHeight = filteredCustomers.length * ROW_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const endIndex = Math.min(filteredCustomers.length, Math.ceil((scrollTop + CONTAINER_HEIGHT) / ROW_HEIGHT) + BUFFER);
  const visibleCustomers = filteredCustomers.slice(startIndex, endIndex);
  const topPadding = startIndex * ROW_HEIGHT;

  const handleVoiceSearch = () => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { toast.error("Trình duyệt không hỗ trợ"); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'vi-VN';
    recognition.onstart = () => setIsListeningSearch(true);
    recognition.onend = () => setIsListeningSearch(false);
    recognition.onresult = (event: any) => { setSearchTerm(event.results[0][0].transcript); };
    recognition.start();
  };

  const handleVerifyAddress = async () => {
      const currentAddr = formData.address;
      if (!currentAddr || currentAddr.trim().length < 5) { toast.error("Nhập địa chỉ sơ bộ trước"); return; }
      setIsVerifyingAddr(true);
      const toastId = toast.loading("Đang ghim bản đồ...");
      try {
          const result = await verifyAddress(currentAddr);
          setFormData(prev => ({ ...prev, address: result.address }));
          toast.success("Đã chuẩn hóa địa chỉ!");
      } catch (e: any) { toast.error("Không tìm thấy"); } finally { setIsVerifyingAddr(false); toast.dismiss(toastId); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) { toast.error('Cần nhập Tên khách hàng'); return; }
    const cleanPhone = formData.phone ? formData.phone.trim() : '';
    const newId = cleanPhone.length > 5 ? cleanPhone : uuidv4();
    const newCustomer: Customer = { id: newId, name: formData.name, phone: cleanPhone, address: formData.address || '', lastOrderDate: Date.now(), priorityScore: formData.priorityScore || 999, socialLink: formData.socialLink || '' };
    await storageService.upsertCustomer(newCustomer);
    setFormData({ name: '', phone: '', address: '', priorityScore: 999, socialLink: '' });
    toast.success('Đã lưu khách hàng');
  };

  const handleImport = async () => {
      if (!importText.trim()) return;
      setIsImporting(true);
      setTimeout(async () => {
        try {
            let parsedCustomers: Customer[] = [];
            if (importMode === 'JSON') {
                const jsonData = JSON.parse(importText);
                parsedCustomers = jsonData.map((c: any) => ({
                    id: c.phone ? c.phone.replace(/[^0-9]/g, '') : uuidv4(),
                    name: c.name || '',
                    phone: c.phone || '',
                    address: c.address || '',
                    lastOrderDate: Date.now(),
                    priorityScore: Number(c.priorityScore || 999),
                    socialLink: c.socialLink || ''
                })).filter((c: any) => c.name);
            } else {
                const lines = importText.split('\n');
                lines.forEach(line => {
                    const parts = line.split(line.includes('\t') ? '\t' : ',');
                    if (parts[0]) parsedCustomers.push({ id: uuidv4(), name: parts[0].trim(), phone: parts[1]?.trim() || '', address: parts[2]?.trim() || '', lastOrderDate: Date.now(), priorityScore: 999 });
                });
            }
            await storageService.importCustomersBatch(parsedCustomers, isLocalMode);
            toast.success(`Đã nhập ${parsedCustomers.length} khách!`); 
            setImportText(''); setShowImportModal(false); 
        } catch (e) { toast.error("Lỗi dữ liệu"); } finally { setIsImporting(false); }
      }, 100);
  };

  const handleInlineUpdate = async (customer: Customer, field: keyof Customer, value: any) => { 
      if (customer[field] === value) return; 
      const updated = { ...customer, [field]: value }; 
      await storageService.upsertCustomer(updated); 
  };

  const vInputClass = "w-full p-2.5 bg-white border-2 border-gray-800 rounded-xl outline-none focus:ring-4 focus:ring-eco-50 font-black text-black text-sm transition-all";

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
      <div className="flex justify-between items-center mb-6 px-2">
          <h1 className="text-2xl font-black text-gray-800 tracking-tight">Quản Lý Khách Hàng</h1>
          <div className="flex gap-2">
              <button onClick={() => setShowImportModal(true)} className="bg-white text-gray-800 hover:bg-gray-100 px-4 py-2 rounded-xl font-black text-[10px] border-2 border-gray-800 shadow-sm uppercase">Import</button>
              <button onClick={() => setShowDeleteAllConfirm(true)} className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-4 py-2 rounded-xl font-black text-[10px] border border-red-200 uppercase">Xóa hết</button>
          </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest">Thêm Khách Mới</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block ml-1">Tên khách hàng *</label>
                      <input value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} className={vInputClass} placeholder="VD: Chị Lan" />
                  </div>
                  <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block ml-1">Số điện thoại</label>
                      <input value={formData.phone} onChange={e => setFormData({ ...formData, phone: e.target.value })} className={vInputClass} placeholder="09xxxx" />
                  </div>
                  <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block ml-1">Địa chỉ giao hàng</label>
                      <div className="relative">
                          <textarea value={formData.address} onChange={e => setFormData({ ...formData, address: e.target.value })} className={`${vInputClass} resize-none min-h-[80px]`} placeholder="Số nhà, đường..." />
                          <button type="button" onClick={handleVerifyAddress} className="absolute right-3 top-3 text-red-500 hover:scale-110 transition-transform"><i className="fas fa-map-marker-alt"></i></button>
                      </div>
                  </div>
                  <div>
                      <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block ml-1">Ưu tiên (1=Đầu tiên)</label>
                      <input type="number" value={formData.priorityScore} onChange={e => setFormData({ ...formData, priorityScore: parseInt(e.target.value) })} className={`${vInputClass} text-eco-700`} />
                  </div>
                  <button type="submit" className="w-full bg-black text-white py-4 rounded-2xl font-black text-sm shadow-xl hover:bg-gray-800 transition-all uppercase tracking-widest mt-2">Lưu thông tin <i className="fas fa-user-plus ml-2"></i></button>
              </form>
          </div>
        </div>
        
        <div className="lg:col-span-8">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden h-[700px] flex flex-col">
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <div className="flex items-center gap-2">
                        <h3 className="font-black text-gray-800 uppercase text-xs">Danh sách khách hàng</h3>
                        <span className="bg-black text-white text-[10px] font-black px-2 py-0.5 rounded-full">{filteredCustomers.length}</span>
                    </div>
                    <div className="relative w-64">
                        <input placeholder="Tìm nhanh..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-8 pr-10 py-2.5 bg-white border-2 border-gray-800 rounded-xl text-xs font-black outline-none" />
                        <i className="fas fa-search absolute left-3 top-3.5 text-gray-400 text-xs"></i>
                        <button onClick={handleVoiceSearch} className="absolute right-2 top-2 w-7 h-7 flex items-center justify-center text-gray-400 hover:text-eco-600"><i className="fas fa-microphone"></i></button>
                    </div>
                </div>
                
                <div className="hidden sm:grid bg-gray-100 border-b border-gray-200 grid-cols-[60px_1fr_120px_1fr_40px] gap-4 px-4 py-3 text-[10px] font-black text-gray-500 uppercase tracking-widest">
                    <div className="text-center">Tuyến</div>
                    <div>Khách hàng</div>
                    <div>Số điện thoại</div>
                    <div>Địa chỉ</div>
                    <div></div>
                </div>

                <div className="flex-grow overflow-y-auto relative bg-gray-50/20" onScroll={handleScroll} ref={scrollContainerRef}>
                    <div className="relative w-full" style={{ height: totalContentHeight }}>
                        {visibleCustomers.map((c, index) => (
                            <div key={c.id} className="absolute left-0 right-0 px-4 border-b border-gray-100 hover:bg-white transition-colors flex flex-col justify-center sm:grid sm:grid-cols-[60px_1fr_120px_1fr_40px] sm:gap-4 sm:items-center bg-white" style={{ top: topPadding + index * ROW_HEIGHT, height: ROW_HEIGHT }}>
                                <div className="order-2 sm:order-1 sm:text-center">
                                    <input type="number" className="w-12 text-center bg-gray-100 border-2 border-transparent hover:border-gray-800 focus:border-gray-800 rounded px-1 py-1 font-black text-eco-700 outline-none text-xs transition-all" defaultValue={c.priorityScore || 999} onBlur={(e) => handleInlineUpdate(c, 'priorityScore', parseInt(e.target.value))} />
                                </div>
                                <div className="order-1 sm:order-2 flex-grow">
                                    <input className="w-full bg-transparent border-none p-0 font-black text-gray-800 outline-none text-sm focus:ring-0 uppercase" defaultValue={c.name} onBlur={(e) => handleInlineUpdate(c, 'name', e.target.value)} />
                                </div>
                                <div className="sm:order-3 sm:col-start-3">
                                    <input className="w-full bg-transparent border-none p-0 text-xs font-black text-gray-500 outline-none focus:ring-0" defaultValue={c.phone} onBlur={(e) => handleInlineUpdate(c, 'phone', e.target.value)} />
                                </div>
                                <div className="mb-2 sm:mb-0 sm:order-4 sm:col-start-4">
                                    <input className="w-full bg-transparent border-none p-0 text-[11px] font-bold text-gray-400 outline-none focus:ring-0" defaultValue={c.address} placeholder="Chưa có địa chỉ" onBlur={(e) => handleInlineUpdate(c, 'address', e.target.value)} />
                                </div>
                                <div className="absolute top-4 right-4 sm:static sm:order-5">
                                    <button onClick={() => handleDeleteClick(c.id)} className="w-8 h-8 rounded-full flex items-center justify-center text-gray-300 hover:text-red-500 transition-all"><i className="fas fa-trash-alt text-xs"></i></button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
      </div>
      <ConfirmModal isOpen={showDeleteConfirm} title="Xóa khách hàng?" message="Hành động này sẽ xóa khách hàng khỏi danh bạ." onConfirm={confirmDelete} onCancel={() => setShowDeleteConfirm(false)} confirmLabel="Xóa" isDanger={true} />
    </div>
  );
};

export default CustomerManager;
