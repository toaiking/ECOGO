
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
    address: ''
  });

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
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
    };

    await storageService.upsertCustomer(newCustomer);
    setFormData({ name: '', phone: '', address: '' });
    toast.success('Đã lưu khách hàng');
  };

  const handleImport = async () => {
      if (!importText.trim()) return;

      const lines = importText.split('\n');
      const newCustomers: Customer[] = [];
      let errorCount = 0;

      lines.forEach(line => {
          // Format: Name, Phone, Address (Tab or Comma separated)
          // Try generic split first
          let parts = line.split(',');
          if (parts.length < 2) parts = line.split('\t');
          
          if (parts.length >= 2) {
              const name = parts[0].trim();
              const phone = parts[1].trim().replace(/[^0-9]/g, '');
              const address = parts.slice(2).join(' ').trim();

              if (name && phone) {
                  newCustomers.push({
                      id: phone,
                      name, 
                      phone,
                      address,
                      lastOrderDate: Date.now()
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
          toast.error("Không tìm thấy dữ liệu hợp lệ. Định dạng: Tên, SĐT, Địa chỉ");
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

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Sidebar: Add & Import */}
        <div className="lg:col-span-4 space-y-6">
          {/* Manual Add Form */}
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
            <h3 className="text-xl font-bold text-gray-900 mb-6">
              Thêm Khách Hàng
            </h3>
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
                        rows={3}
                        placeholder="Số nhà, đường, quận..."
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
                 <h3 className="text-lg font-bold text-gray-800">Nhập nhanh (Excel/CSV)</h3>
                 <i className={`fas fa-chevron-down transition-transform ${showImport ? 'rotate-180' : ''}`}></i>
             </div>
             
             {showImport && (
                 <div className="space-y-3 animate-fade-in">
                     <p className="text-xs text-gray-500">
                         Copy danh sách từ Excel và dán vào đây. <br/>
                         Định dạng: <b>Tên, Số điện thoại, Địa chỉ</b> (mỗi khách 1 dòng).
                     </p>
                     <textarea 
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-xs font-mono h-32 focus:border-eco-500 outline-none"
                        placeholder={"Nguyen Van A, 0909123123, Quan 1\nTran Thi B, 0987654321, Quan 3"}
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

        {/* Right Column: List */}
        <div className="lg:col-span-8">
           <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[600px]">
             {/* Header & Search */}
             <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center">
                <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-gray-900">Danh bạ</h3>
                    <span className="bg-eco-100 text-eco-700 text-xs font-bold px-2 py-1 rounded-md">{filteredCustomers.length}</span>
                </div>
                <div className="relative w-full sm:w-64">
                    <i className="fas fa-search absolute left-3 top-3 text-gray-400"></i>
                    <input 
                        placeholder="Tìm tên hoặc SĐT..." 
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-eco-100 rounded-lg text-sm outline-none transition-all"
                    />
                </div>
             </div>

             {/* Table */}
             <div className="overflow-x-auto">
                {filteredCustomers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 text-gray-300">
                        <i className="fas fa-address-book text-4xl mb-3"></i>
                        <p>Chưa có dữ liệu khách hàng</p>
                    </div>
                ) : (
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50/50 text-gray-400 font-bold uppercase text-[10px] tracking-wider">
                            <tr>
                                <th className="p-4 rounded-tl-lg">Khách hàng</th>
                                <th className="p-4">Liên hệ</th>
                                <th className="p-4">Địa chỉ</th>
                                <th className="p-4 text-right rounded-tr-lg"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                            {filteredCustomers.map(c => (
                                <tr key={c.id} className="group hover:bg-gray-50 transition-colors">
                                    <td className="p-4">
                                        <div className="font-bold text-gray-800 text-sm">{c.name}</div>
                                        <div className="text-[10px] text-gray-400">ID: {c.id}</div>
                                    </td>
                                    <td className="p-4">
                                        <span className="font-mono text-sm text-eco-700 font-medium bg-eco-50 px-2 py-1 rounded">
                                            {c.phone}
                                        </span>
                                    </td>
                                    <td className="p-4 text-sm text-gray-600 max-w-xs truncate" title={c.address}>
                                        {c.address}
                                    </td>
                                    <td className="p-4 text-right">
                                        <button 
                                            onClick={() => handleDeleteClick(c.id)}
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all opacity-0 group-hover:opacity-100"
                                            title="Xóa"
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

      <ConfirmModal 
        isOpen={showDeleteConfirm}
        title="Xóa khách hàng?"
        message="Dữ liệu khách hàng này sẽ bị xóa. Lịch sử đơn hàng cũ vẫn được giữ nguyên."
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        confirmLabel="Xóa"
        isDanger={true}
      />
    </div>
  );
};

export default CustomerManager;
