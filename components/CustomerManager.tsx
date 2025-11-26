
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Customer } from '../types';
import { storageService } from '../services/storageService';
import ConfirmModal from './ConfirmModal';

const CustomerManager: React.FC = () => {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filteredCustomers, setFilteredCustomers] = useState<Customer[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  const [formData, setFormData] = useState<Partial<Customer>>({
    name: '',
    phone: '',
    address: '',
    priorityScore: 999
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showDeleteAllConfirm, setShowDeleteAllConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  
  // Import State
  const [importText, setImportText] = useState('');
  const [showImport, setShowImport] = useState(false);

  useEffect(() => {
    const unsubscribe = storageService.subscribeCustomers((data) => {
        setCustomers(data);
    });
    return () => {
        if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      setFilteredCustomers(customers.filter(c => 
        c.name.toLowerCase().includes(lower) || 
        c.phone.includes(lower) ||
        c.address.toLowerCase().includes(lower)
      ));
    } else {
      setFilteredCustomers(customers);
    }
  }, [customers, searchTerm]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.phone) {
        toast.error('Cần nhập Tên và SĐT');
        return;
    }

    const newCustomer: Customer = {
      id: formData.phone, // Use phone as ID for uniqueness
      name: formData.name,
      phone: formData.phone,
      address: formData.address || '',
      lastOrderDate: Date.now(),
      priorityScore: formData.priorityScore || 999
    };

    await storageService.upsertCustomer(newCustomer);
    setFormData({ name: '', phone: '', address: '', priorityScore: 999 });
    toast.success('Đã lưu khách hàng');
  };

  const handleImport = async () => {
      if (!importText.trim()) return;

      const lines = importText.split('\n');
      const newCustomers: Customer[] = [];
      let errorCount = 0;

      lines.forEach(line => {
          // Format: Name, Phone, Address, Priority (Optional)
          let parts = line.split(',');
          if (parts.length < 2) parts = line.split('\t');
          
          if (parts.length >= 2) {
              const name = parts[0].trim();
              const phone = parts[1].trim().replace(/[^0-9]/g, '');
              const address = parts.length > 2 ? parts[2].trim() : '';
              const priority = parts.length > 3 ? parseInt(parts[3].trim()) : 999;

              if (name && phone) {
                  newCustomers.push({
                      id: phone,
                      name, 
                      phone,
                      address,
                      lastOrderDate: Date.now(),
                      priorityScore: isNaN(priority) ? 999 : priority
                  });
              } else {
                  errorCount++;
              }
          }
      });

      if (newCustomers.length > 0) {
          await storageService.importCustomersBatch(newCustomers);
          toast.success(`Đã nhập thành công ${newCustomers.length} khách hàng!`);
          setImportText('');
          setShowImport(false);
      } else {
          toast.error("Không tìm thấy dữ liệu hợp lệ.");
      }
  };

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

  const confirmDeleteAll = async () => {
      await storageService.clearAllCustomers();
      toast.success('Đã xóa toàn bộ danh sách khách hàng');
      setShowDeleteAllConfirm(false);
  };

  // Inline Edit Handler
  const handleInlineUpdate = async (customer: Customer, field: keyof Customer, value: any) => {
      if (customer[field] === value) return; // No change
      const updated = { ...customer, [field]: value };
      await storageService.upsertCustomer(updated);
      toast.success('Đã cập nhật', { id: 'inline-edit-success', duration: 1000 });
  };

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
      <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-black text-gray-800">Quản Lý Khách Hàng</h1>
          <button 
            onClick={() => setShowDeleteAllConfirm(true)}
            className="bg-red-50 text-red-600 hover:bg-red-600 hover:text-white px-4 py-2 rounded-lg font-bold text-sm transition-colors border border-red-200"
          >
            <i className="fas fa-trash-alt mr-2"></i>Xóa Tất Cả
          </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Sidebar: Add & Import */}
        <div className="lg:col-span-4 space-y-6">
          {/* Manual Add Form */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Thêm Mới</h3>
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase">Tên khách *</label>
                    <input
                        value={formData.name}
                        onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all"
                        placeholder="Nguyễn Văn A"
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase">Số điện thoại *</label>
                    <input
                        value={formData.phone}
                        onChange={e => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all"
                        placeholder="0912345678"
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase">Địa chỉ</label>
                    <textarea
                        value={formData.address}
                        onChange={e => setFormData({ ...formData, address: e.target.value })}
                        className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all resize-none"
                        rows={2}
                        placeholder="Số nhà, đường, quận..."
                    />
                </div>
                <div>
                    <label className="text-xs font-bold text-gray-400 uppercase">Độ ưu tiên (1=Cao nhất)</label>
                    <input
                        type="number"
                        value={formData.priorityScore}
                        onChange={e => setFormData({ ...formData, priorityScore: parseInt(e.target.value) })}
                        className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all font-bold text-eco-700"
                        placeholder="999"
                    />
                </div>
                <button
                    type="submit"
                    className="w-full bg-eco-600 text-white py-3 rounded-xl hover:bg-eco-700 font-bold shadow-lg shadow-eco-200 transition-all"
                >
                    Lưu Khách Hàng
                </button>
            </form>
          </div>

          {/* Import Tool */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
             <div className="flex justify-between items-center mb-4 cursor-pointer" onClick={() => setShowImport(!showImport)}>
                 <h3 className="text-lg font-bold text-gray-800">Nhập từ Excel</h3>
                 <i className={`fas fa-chevron-down transition-transform ${showImport ? 'rotate-180' : ''}`}></i>
             </div>
             
             {showImport && (
                 <div className="space-y-3 animate-fade-in">
                     <p className="text-xs text-gray-500 leading-relaxed">
                         Copy danh sách từ Excel và dán vào đây.<br/>
                         Định dạng: <b>Tên, SĐT, Địa chỉ, Ưu tiên (Số)</b>
                     </p>
                     <textarea 
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono h-48 focus:border-eco-500 outline-none whitespace-pre"
                        placeholder={"Nguyen Van A, 0909123123, Quan 1, 1\nTran Thi B, 0987654321, Quan 3, 2"}
                     />
                     <button 
                        onClick={handleImport}
                        type="button"
                        className="w-full bg-gray-800 text-white py-2 rounded-lg hover:bg-black text-sm font-bold"
                     >
                        Nhập Danh Sách
                     </button>
                 </div>
             )}
          </div>
        </div>

        {/* Right Column: List with Inline Edit */}
        <div className="lg:col-span-8">
           <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px] flex flex-col">
             {/* Header & Search */}
             <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center bg-gray-50/50">
                <div className="flex items-center gap-3">
                    <span className="bg-white border border-gray-200 text-gray-700 text-xs font-bold px-3 py-1 rounded-full shadow-sm">Tổng: {filteredCustomers.length}</span>
                </div>
                <div className="relative w-full sm:w-64">
                    <i className="fas fa-search absolute left-3 top-3 text-gray-400"></i>
                    <input 
                        placeholder="Tìm tên, SĐT, địa chỉ..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 focus:border-eco-500 rounded-lg text-sm outline-none transition-all shadow-sm"
                    />
                </div>
             </div>

             {/* Table */}
             <div className="overflow-x-auto flex-grow">
                {filteredCustomers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-300">
                        <i className="fas fa-address-book text-4xl mb-3 opacity-50"></i>
                        <p>Chưa có dữ liệu</p>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-100 text-gray-600 font-bold uppercase text-[10px] tracking-wider sticky top-0 z-10">
                            <tr>
                                <th className="p-4 w-16 text-center">Ưu tiên</th>
                                <th className="p-4 min-w-[150px]">Khách hàng</th>
                                <th className="p-4 w-32">SĐT</th>
                                <th className="p-4">Địa chỉ</th>
                                <th className="p-4 w-10"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredCustomers.map(c => (
                                <tr key={c.id} className="group hover:bg-blue-50/30 transition-colors">
                                    {/* Priority Edit */}
                                    <td className="p-2 text-center">
                                        <input 
                                            type="number"
                                            className="w-12 p-1 text-center border border-transparent hover:border-gray-300 focus:border-eco-500 focus:bg-white rounded bg-transparent font-bold text-eco-700 outline-none transition-all"
                                            defaultValue={c.priorityScore || 999}
                                            onBlur={(e) => handleInlineUpdate(c, 'priorityScore', parseInt(e.target.value))}
                                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                        />
                                    </td>
                                    
                                    {/* Name Edit */}
                                    <td className="p-2">
                                        <input 
                                            className="w-full p-1 border border-transparent hover:border-gray-300 focus:border-eco-500 focus:bg-white rounded bg-transparent font-medium text-gray-900 outline-none transition-all"
                                            defaultValue={c.name}
                                            onBlur={(e) => handleInlineUpdate(c, 'name', e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                        />
                                    </td>

                                    {/* Phone (ReadOnly ID) */}
                                    <td className="p-2">
                                        <span className="font-mono text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded select-all">
                                            {c.phone}
                                        </span>
                                    </td>

                                    {/* Address Edit */}
                                    <td className="p-2">
                                        <input 
                                            className="w-full p-1 border border-transparent hover:border-gray-300 focus:border-eco-500 focus:bg-white rounded bg-transparent text-sm text-gray-600 outline-none transition-all"
                                            defaultValue={c.address}
                                            onBlur={(e) => handleInlineUpdate(c, 'address', e.target.value)}
                                            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
                                        />
                                    </td>

                                    {/* Delete Action */}
                                    <td className="p-2 text-right">
                                        <button 
                                            onClick={() => handleDeleteClick(c.id)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                                            title="Xóa khách hàng"
                                        >
                                            <i className="fas fa-times"></i>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
             </div>
           </div>
        </div>
      </div>

      {/* Delete Single Modal */}
      <ConfirmModal 
        isOpen={showDeleteConfirm}
        title="Xóa khách hàng?"
        message="Hành động này sẽ xóa khách hàng khỏi danh bạ. Lịch sử đơn hàng cũ vẫn giữ nguyên."
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        confirmLabel="Xóa"
        isDanger={true}
      />

      {/* Delete ALL Modal */}
      <ConfirmModal 
        isOpen={showDeleteAllConfirm}
        title="CẢNH BÁO: Xóa TẤT CẢ?"
        message="Bạn có chắc chắn muốn xóa toàn bộ danh sách khách hàng? Hành động này KHÔNG THỂ hoàn tác!"
        onConfirm={confirmDeleteAll}
        onCancel={() => setShowDeleteAllConfirm(false)}
        confirmLabel="XÓA SẠCH"
        isDanger={true}
      />
    </div>
  );
};

export default CustomerManager;