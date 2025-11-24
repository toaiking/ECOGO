
import React, { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Product } from '../types';
import { storageService } from '../services/storageService';
import ConfirmModal from './ConfirmModal';

const InventoryManager: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState('');

  const [formData, setFormData] = useState<Partial<Product>>({
    name: '',
    defaultPrice: 0,
    stockQuantity: 0,
  });

  // Delete Modal State
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = storageService.subscribeProducts((data) => {
        setProducts(data);
    });
    return () => {
        if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  useEffect(() => {
    let result = products;
    
    // Filter by name
    if (searchTerm) {
      result = result.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }

    // Filter by Import Date
    if (filterDate) {
      const selectedTime = new Date(filterDate).setHours(0,0,0,0);
      result = result.filter(p => {
        const prodTime = new Date(p.lastImportDate).setHours(0,0,0,0);
        return prodTime === selectedTime;
      });
    }

    setFilteredProducts(result);
  }, [products, searchTerm, filterDate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    const qty = Number(formData.stockQuantity) || 0;
    const newProduct: Product = {
      id: uuidv4(),
      name: formData.name,
      defaultPrice: Number(formData.defaultPrice) || 0,
      defaultWeight: 1, 
      stockQuantity: qty,
      totalImported: qty, 
      lastImportDate: Date.now(),
    };

    await storageService.saveProduct(newProduct);
    setFormData({ name: '', defaultPrice: 0, stockQuantity: 0 });
    toast.success('Đã nhập kho thành công');
  };

  const handleDeleteClick = (id: string) => {
    setDeleteId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (deleteId) {
      await storageService.deleteProduct(deleteId);
      toast.success('Đã xóa sản phẩm');
      setShowDeleteConfirm(false);
      setDeleteId(null);
    }
  };

  const handleQuickUpdateStock = async (product: Product, change: number) => {
      const currentStock = product.stockQuantity || 0;
      const currentImported = product.totalImported || currentStock; 

      const newStock = Math.max(0, currentStock + change);
      const newImported = change > 0 ? currentImported + change : currentImported;

      const updatedProduct = { 
        ...product, 
        stockQuantity: newStock, 
        totalImported: newImported,
        lastImportDate: change > 0 ? Date.now() : product.lastImportDate 
      };
      
      await storageService.saveProduct(updatedProduct);
  };

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Add Product Form - Sticky Sidebar on Desktop */}
        <div className="lg:col-span-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 sticky top-24">
            <h3 className="text-xl font-bold text-gray-900 mb-6">
              Nhập Hàng
            </h3>
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="group">
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Tên sản phẩm</label>
                <input
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 focus:ring-4 focus:ring-eco-50 border rounded-xl outline-none transition-all"
                  placeholder="VD: Gạo ST25"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Giá bán</label>
                    <input
                      type="number"
                      value={formData.defaultPrice}
                      onChange={e => setFormData({ ...formData, defaultPrice: Number(e.target.value) })}
                      className="w-full p-3 bg-gray-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-eco-600 uppercase tracking-wider mb-2">Số lượng</label>
                    <input
                      type="number"
                      value={formData.stockQuantity}
                      onChange={e => setFormData({ ...formData, stockQuantity: Number(e.target.value) })}
                      className="w-full p-3 bg-eco-50 border-transparent focus:bg-white focus:border-eco-500 border rounded-xl outline-none transition-all font-bold text-eco-800"
                      placeholder="0"
                    />
                  </div>
              </div>
              
              <button
                type="submit"
                className="w-full bg-black text-white py-3.5 rounded-xl hover:bg-gray-800 font-bold shadow-lg shadow-gray-200 transition-transform active:scale-95"
              >
                + Thêm Vào Kho
              </button>
            </form>
          </div>
        </div>

        {/* Product List */}
        <div className="lg:col-span-8">
           <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[500px]">
             {/* Header & Filter */}
             <div className="p-5 border-b border-gray-100 flex flex-col sm:flex-row gap-4 justify-between items-center">
                <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-gray-900">Danh sách</h3>
                    <span className="bg-gray-100 text-gray-600 text-xs font-bold px-2 py-1 rounded-md">{filteredProducts.length}</span>
                </div>
                
                <div className="flex gap-2 w-full sm:w-auto">
                    <div className="relative flex-grow">
                        <i className="fas fa-search absolute left-3 top-3 text-gray-400"></i>
                        <input 
                            placeholder="Tìm nhanh..." 
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            className="w-full sm:w-60 pl-9 pr-3 py-2 bg-gray-50 border-transparent focus:bg-white focus:ring-2 focus:ring-eco-100 rounded-lg text-sm outline-none transition-all"
                        />
                    </div>
                </div>
             </div>

             {filteredProducts.length === 0 ? (
               <div className="flex flex-col items-center justify-center h-64 text-gray-300">
                 <i className="fas fa-inbox text-4xl mb-3"></i>
                 <p>Chưa có dữ liệu</p>
               </div>
             ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50/50 text-gray-400 font-bold uppercase text-[10px] tracking-wider">
                        <tr>
                        <th className="p-4 rounded-tl-lg">Sản phẩm</th>
                        <th className="p-4 text-center">Tình trạng kho</th>
                        <th className="p-4 text-right rounded-tr-lg"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {filteredProducts.map(p => {
                          const totalImported = p.totalImported || p.stockQuantity || 1;
                          const percent = Math.min(100, (p.stockQuantity / totalImported) * 100);
                          const isLowStock = p.stockQuantity < 5;
                          
                          return (
                            <tr key={p.id} className="group hover:bg-gray-50/80 transition-colors">
                                <td className="p-4 align-top">
                                    <div className="font-bold text-gray-800 text-sm mb-1">{p.name}</div>
                                    <div className="flex items-center gap-2 text-xs text-gray-500">
                                        <span className="font-mono">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}đ</span>
                                        <span className="w-1 h-1 rounded-full bg-gray-300"></span>
                                        <span>{new Date(p.lastImportDate).toLocaleDateString('vi-VN')}</span>
                                    </div>
                                </td>
                                <td className="p-4 align-middle">
                                    <div className="max-w-[180px] mx-auto">
                                        <div className="flex justify-between items-end mb-1">
                                            <span className="text-[10px] font-bold text-gray-400 uppercase">Còn lại</span>
                                            <span className={`text-sm font-bold ${isLowStock ? 'text-red-500' : 'text-gray-900'}`}>{p.stockQuantity}/{totalImported}</span>
                                        </div>
                                        
                                        {/* Minimalist Progress Bar */}
                                        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden mb-3">
                                            <div 
                                                className={`h-full rounded-full transition-all duration-500 ${isLowStock ? 'bg-red-500' : 'bg-eco-500'}`} 
                                                style={{ width: `${percent}%` }}
                                            ></div>
                                        </div>
                                        
                                        {/* Subtle Controls */}
                                        <div className="flex items-center justify-between opacity-40 group-hover:opacity-100 transition-opacity duration-200">
                                            <button onClick={() => handleQuickUpdateStock(p, -1)} className="w-6 h-6 rounded hover:bg-red-50 hover:text-red-600 flex items-center justify-center transition-colors">
                                                <i className="fas fa-minus text-[10px]"></i>
                                            </button>
                                            <button onClick={() => handleQuickUpdateStock(p, 1)} className="w-6 h-6 rounded hover:bg-green-50 hover:text-green-600 flex items-center justify-center transition-colors">
                                                <i className="fas fa-plus text-[10px]"></i>
                                            </button>
                                        </div>
                                    </div>
                                </td>
                                <td className="p-4 text-right align-middle">
                                    <button 
                                        onClick={() => handleDeleteClick(p.id)}
                                        className="w-8 h-8 rounded-full flex items-center justify-center text-gray-300 hover:bg-red-50 hover:text-red-500 transition-all"
                                    >
                                        <i className="fas fa-times"></i>
                                    </button>
                                </td>
                            </tr>
                          );
                        })}
                    </tbody>
                    </table>
                </div>
             )}
           </div>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      <ConfirmModal 
        isOpen={showDeleteConfirm}
        title="Xóa sản phẩm?"
        message="Sản phẩm này sẽ bị xóa khỏi kho hàng. Hành động không thể hoàn tác."
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        confirmLabel="Xóa ngay"
        isDanger={true}
      />
    </div>
  );
};

export default InventoryManager;
