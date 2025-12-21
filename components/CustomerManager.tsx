
import React, { useState, useEffect, useDeferredValue } from 'react';
import toast from 'react-hot-toast';
import { Customer } from '../types';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';
import { verifyAddress } from '../services/geminiService';
import ConfirmModal from './ConfirmModal';
import { v4 as uuidv4 } from 'uuid';

const CustomerBadge: React.FC<{ count: number, isLegacy?: boolean }> = ({ count, isLegacy }) => {
    if (isLegacy || count === 0) return <span className="bg-blue-50 text-blue-600 text-[9px] font-black px-2 py-0.5 rounded-full border border-blue-100 uppercase tracking-tighter">Mới</span>;
    if (count >= 10) return <span className="bg-red-50 text-red-600 text-[9px] font-black px-2 py-0.5 rounded-full border border-red-100 uppercase tracking-tighter animate-pulse">💎 VIP</span>;
    if (count >= 5) return <span className="bg-eco-50 text-eco-600 text-[9px] font-black px-2 py-0.5 rounded-full border border-eco-100 uppercase tracking-tighter">🌟 Thân thiết</span>;
    return <span className="bg-gray-50 text-gray-500 text-[9px] font-black px-2 py-0.5 rounded-full border border-gray-100 uppercase tracking-tighter">Quen</span>;
};

const CustomerManager: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const deferredSearchTerm = useDeferredValue(searchTerm);

  const [isAdding, setIsAdding] = useState(false);
  const [formData, setFormData] = useState<Partial<Customer>>({ name: '', phone: '', address: '', priorityScore: 999 });
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  const [isListeningSearch, setIsListeningSearch] = useState(false);
  const [isVerifyingAddr, setIsVerifyingAddr] = useState(false);

  useEffect(() => { 
      const unsubscribe = storageService.subscribeCustomers(setCustomers); 
      return () => { if (unsubscribe) unsubscribe(); }; 
  }, []);
  
  const filteredCustomers = customers.filter(c => {
      if (!deferredSearchTerm) return true;
      const lower = deferredSearchTerm.toLowerCase();
      return normalizeString(c.name).includes(normalizeString(lower)) || 
             c.phone.includes(lower) || 
             normalizeString(c.address).includes(normalizeString(lower));
  }).sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0));

  const handleDeleteClick = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
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
      if (!formData.address || formData.address.length < 5) { toast.error("Nhập địa chỉ trước"); return; }
      setIsVerifyingAddr(true);
      try {
          const result = await verifyAddress(formData.address);
          setFormData(prev => ({ ...prev, address: result.address }));
          toast.success("Đã ghim vị trí!");
      } catch (e: any) { toast.error("Không tìm thấy"); } finally { setIsVerifyingAddr(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) { toast.error('Nhập tên khách'); return; }
    const cleanPhone = normalizePhone(formData.phone || '');
    const newId = cleanPhone.length > 8 ? cleanPhone : uuidv4();
    await storageService.upsertCustomer({
        id: newId,
        name: formData.name,
        phone: cleanPhone,
        address: formData.address || '',
        lastOrderDate: Date.now(),
        priorityScore: formData.priorityScore || 999,
        totalOrders: 0,
        updatedAt: Date.now()
    });
    setFormData({ name: '', phone: '', address: '', priorityScore: 999 });
    setIsAdding(false);
    toast.success('Đã thêm khách hàng mới');
  };

  const handleInlineUpdate = async (customer: Customer, field: keyof Customer, value: any) => { 
      if (customer[field] === value) return; 
      await storageService.upsertCustomer({ ...customer, [field]: value, updatedAt: Date.now() }); 
      toast.success("Đã cập nhật", { duration: 1000 });
  };

  const contactActions = {
      call: (phone: string) => window.open(`tel:${phone}`, '_self'),
      zalo: (phone: string) => window.open(`https://zalo.me/${normalizePhone(phone).replace(/^0/, '84')}`, '_blank'),
      sms: (phone: string) => window.open(`sms:${phone}`, '_self'),
      maps: (addr: string) => window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`, '_blank')
  };

  return (
    <div className="max-w-6xl mx-auto pb-32 animate-fade-in px-3">
      
      {/* HEADER SECTION */}
      <div className="flex flex-col gap-4 mb-6 sticky top-16 z-30 bg-gray-50/95 py-3 backdrop-blur-sm">
          <div className="flex items-center justify-between">
              <div>
                  <h1 className="text-2xl font-black text-gray-900 tracking-tighter uppercase italic">Danh bạ <span className="text-eco-600">Thông minh</span></h1>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Quản lý {customers.length} khách hàng</p>
              </div>
              <button 
                  onClick={() => setIsAdding(!isAdding)} 
                  className={`w-12 h-12 rounded-2xl shadow-lg flex items-center justify-center transition-all active:scale-95 ${isAdding ? 'bg-red-500 text-white' : 'bg-black text-white'}`}
              >
                  <i className={`fas ${isAdding ? 'fa-times' : 'fa-user-plus'}`}></i>
              </button>
          </div>

          <div className="relative group">
              <i className="fas fa-search absolute left-4 top-3.5 text-gray-400 group-focus-within:text-eco-600 transition-colors"></i>
              <input 
                  value={searchTerm} 
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Tìm tên, sđt hoặc địa chỉ..." 
                  className="w-full pl-12 pr-12 py-4 bg-white border-2 border-gray-100 rounded-2xl shadow-sm outline-none focus:border-eco-500 focus:ring-4 focus:ring-eco-50 font-bold text-gray-800 transition-all"
              />
              <button 
                  onClick={handleVoiceSearch}
                  className={`absolute right-3 top-2.5 w-9 h-9 rounded-xl flex items-center justify-center transition-all ${isListeningSearch ? 'bg-red-500 text-white animate-pulse' : 'text-gray-400 hover:bg-gray-100'}`}
              >
                  <i className={`fas ${isListeningSearch ? 'fa-microphone-slash' : 'fa-microphone'}`}></i>
              </button>
          </div>
      </div>

      {/* ADD FORM (CONDITIONAL) */}
      {isAdding && (
          <div className="mb-8 bg-white p-6 rounded-[2.5rem] border-4 border-gray-900 shadow-[8px_8px_0px_0px_rgba(0,0,0,1)] animate-scale-in">
              <h3 className="text-xs font-black text-gray-400 uppercase mb-4 tracking-widest flex items-center gap-2">
                  <i className="fas fa-magic text-eco-600"></i> Thêm khách hàng nhanh
              </h3>
              <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="md:col-span-1">
                      <input 
                          value={formData.name} 
                          onChange={e => setFormData({ ...formData, name: e.target.value })}
                          className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-black"
                          placeholder="Họ và Tên khách *"
                      />
                  </div>
                  <div className="md:col-span-1">
                      <input 
                          value={formData.phone} 
                          onChange={e => setFormData({ ...formData, phone: e.target.value })}
                          className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-black"
                          placeholder="Số điện thoại"
                      />
                  </div>
                  <div className="md:col-span-2 relative">
                      <input 
                          value={formData.address} 
                          onChange={e => setFormData({ ...formData, address: e.target.value })}
                          className="w-full p-3 bg-gray-50 border-2 border-gray-200 rounded-xl font-bold outline-none focus:border-black pr-12"
                          placeholder="Địa chỉ giao hàng"
                      />
                      <button type="button" onClick={handleVerifyAddress} className="absolute right-3 top-2.5 w-8 h-8 text-red-500 hover:scale-110 transition-all">
                          <i className={`fas ${isVerifyingAddr ? 'fa-circle-notch fa-spin' : 'fa-map-marker-alt'}`}></i>
                      </button>
                  </div>
                  <button type="submit" className="md:col-span-2 py-4 bg-eco-600 text-white rounded-2xl font-black uppercase tracking-widest shadow-xl shadow-eco-100 active:scale-95 transition-all">
                      Lưu thông tin <i className="fas fa-check-circle ml-2"></i>
                  </button>
              </form>
          </div>
      )}

      {/* CUSTOMER GRID */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCustomers.length === 0 ? (
              <div className="col-span-full py-20 text-center text-gray-300">
                  <i className="fas fa-user-slash text-6xl mb-4 opacity-20"></i>
                  <p className="font-bold uppercase tracking-widest text-xs">Không tìm thấy khách hàng</p>
              </div>
          ) : (
              filteredCustomers.map(customer => (
                  <div 
                    key={customer.id} 
                    className="bg-white rounded-[2rem] border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 overflow-hidden group"
                  >
                      <div className="p-5">
                          <div className="flex justify-between items-start mb-3">
                              <div className="flex gap-3 items-center">
                                  <div className="w-12 h-12 bg-gradient-to-br from-gray-100 to-gray-200 rounded-2xl flex items-center justify-center text-gray-500 font-black text-lg border-2 border-white shadow-inner group-hover:from-eco-500 group-hover:to-eco-600 group-hover:text-white transition-all">
                                      {customer.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div>
                                      <input 
                                          className="font-black text-gray-800 text-sm uppercase bg-transparent border-none p-0 outline-none w-full focus:text-eco-600"
                                          defaultValue={customer.name}
                                          onBlur={(e) => handleInlineUpdate(customer, 'name', e.target.value)}
                                      />
                                      <div className="flex items-center gap-2 mt-1">
                                          <CustomerBadge count={customer.totalOrders || 0} isLegacy={customer.isLegacy} />
                                          <span className="text-[10px] font-bold text-gray-400">{customer.totalOrders || 0} đơn</span>
                                      </div>
                                  </div>
                              </div>
                              <button 
                                onClick={(e) => handleDeleteClick(customer.id, e)}
                                className="w-8 h-8 rounded-full bg-gray-50 text-gray-300 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-all opacity-0 group-hover:opacity-100"
                              >
                                  <i className="fas fa-trash-alt text-xs"></i>
                              </button>
                          </div>

                          <div className="space-y-2 mb-4">
                              <div className="flex items-center gap-3 p-2 bg-gray-50 rounded-xl border border-transparent hover:border-eco-100 transition-colors">
                                  <i className="fas fa-phone-alt text-eco-600 text-xs w-4 text-center"></i>
                                  <input 
                                      className="text-xs font-black text-gray-700 bg-transparent border-none p-0 outline-none flex-grow"
                                      defaultValue={customer.phone}
                                      placeholder="Chưa có SĐT"
                                      onBlur={(e) => handleInlineUpdate(customer, 'phone', e.target.value)}
                                  />
                              </div>
                              <div className="flex items-start gap-3 p-2 bg-gray-50 rounded-xl border border-transparent hover:border-eco-100 transition-colors">
                                  <i className="fas fa-map-marker-alt text-red-500 text-xs w-4 text-center mt-1"></i>
                                  <textarea 
                                      className="text-[11px] font-bold text-gray-500 bg-transparent border-none p-0 outline-none flex-grow resize-none leading-snug"
                                      rows={2}
                                      defaultValue={customer.address}
                                      placeholder="Chưa có địa chỉ"
                                      onBlur={(e) => handleInlineUpdate(customer, 'address', e.target.value)}
                                  />
                              </div>
                          </div>

                          <div className="grid grid-cols-4 gap-2">
                              <button 
                                onClick={() => contactActions.call(customer.phone)}
                                className="h-10 rounded-xl bg-green-50 text-green-600 hover:bg-green-600 hover:text-white transition-all flex items-center justify-center border border-green-100"
                                title="Gọi điện"
                              >
                                  <i className="fas fa-phone-alt"></i>
                              </button>
                              <button 
                                onClick={() => contactActions.zalo(customer.phone)}
                                className="h-10 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center border border-blue-100 font-black text-xs"
                                title="Zalo"
                              >
                                  Z
                              </button>
                              <button 
                                onClick={() => contactActions.sms(customer.phone)}
                                className="h-10 rounded-xl bg-orange-50 text-orange-600 hover:bg-orange-600 hover:text-white transition-all flex items-center justify-center border border-orange-100"
                                title="Gửi SMS"
                              >
                                  <i className="fas fa-comment-dots"></i>
                              </button>
                              <button 
                                onClick={() => contactActions.maps(customer.address)}
                                className="h-10 rounded-xl bg-red-50 text-red-500 hover:bg-red-600 hover:text-white transition-all flex items-center justify-center border border-red-100"
                                title="Chỉ đường"
                              >
                                  <i className="fas fa-directions"></i>
                              </button>
                          </div>
                      </div>
                      <div className="bg-gray-50 px-5 py-2 border-t border-gray-50 flex justify-between items-center group-hover:bg-eco-50 transition-colors">
                          <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Đã học dữ liệu</span>
                          <div className="flex gap-1">
                              {customer.priorityScore && customer.priorityScore < 100 && (
                                  <span className="w-2 h-2 bg-yellow-400 rounded-full"></span>
                              )}
                              <span className="w-2 h-2 bg-eco-400 rounded-full"></span>
                          </div>
                      </div>
                  </div>
              ))
          )}
      </div>

      <ConfirmModal 
        isOpen={showDeleteConfirm} 
        title="Xóa khách hàng?" 
        message="Dữ liệu về khách hàng này sẽ bị gỡ bỏ khỏi danh bạ. Các đơn hàng cũ vẫn sẽ được giữ lại." 
        onConfirm={confirmDelete} 
        onCancel={() => setShowDeleteConfirm(false)} 
        confirmLabel="Xóa vĩnh viễn" 
        isDanger={true} 
      />
    </div>
  );
};

export default CustomerManager;
