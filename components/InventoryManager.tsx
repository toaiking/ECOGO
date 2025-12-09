
import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Product, Order, ImportRecord } from '../types';
import { storageService, generateProductSku } from '../services/storageService';
import ConfirmModal from './ConfirmModal';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

interface ProductDetailModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product;
    onImport: () => void;
    onAdjust: () => void;
    onDelete?: () => void;
}

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({ isOpen, onClose, product, onImport, onAdjust, onDelete }) => {
    const [history, setHistory] = useState<{order: Order, quantity: number}[]>([]);
    const [activeTab, setActiveTab] = useState<'EXPORT' | 'IMPORT'>('EXPORT');
    
    useEffect(() => {
        if(isOpen && product) {
            setHistory(storageService.getProductOrderHistory(product.id));
        }
    }, [isOpen, product]);

    // Group history by Batch ID (Export)
    const batchExportHistory = useMemo(() => {
        const groups = new Map<string, { batchId: string, quantity: number, date: number, orderCount: number }>();
        history.forEach(item => {
            const batchId = item.order.batchId || 'Chưa phân lô';
            if (!groups.has(batchId)) {
                groups.set(batchId, { batchId, quantity: 0, date: item.order.createdAt, orderCount: 0 });
            }
            const group = groups.get(batchId)!;
            group.quantity += Number(item.quantity) || 0;
            group.orderCount += 1;
            group.date = Math.max(group.date, item.order.createdAt);
        });
        return Array.from(groups.values()).sort((a, b) => b.date - a.date);
    }, [history]);

    // Import History logic
    const importHistory = useMemo(() => {
        const records = product.importHistory || [];
        return [...records].sort((a, b) => b.date - a.date);
    }, [product]);

    if (!isOpen) return null;

    // --- MATH ---
    const totalSold = batchExportHistory.reduce((sum, b) => sum + b.quantity, 0);
    const currentStock = product.stockQuantity || 0;
    
    // Determine Total Imported Source
    const historyImportTotal = importHistory.reduce((sum, r) => sum + r.quantity, 0);
    const hasHistory = historyImportTotal > 0;
    
    // If we have history, that is the Truth. Else fallback to current snapshot.
    const calculatedTotalImported = hasHistory ? historyImportTotal : (product.totalImported || (currentStock + totalSold));
    
    const profitPerUnit = product.defaultPrice - (product.importPrice || 0);
    const totalProfit = totalSold * profitPerUnit;
    
    const percent = Math.min(100, (currentStock / (calculatedTotalImported || 1)) * 100);
    const isLow = currentStock < 5;

    return (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-bold text-xl text-gray-800">{product.name}</h3>
                            <button 
                                onClick={onAdjust} 
                                className="w-6 h-6 rounded-full bg-white border border-gray-200 text-gray-400 hover:text-blue-600 hover:border-blue-200 flex items-center justify-center transition-colors shadow-sm"
                                title="Sửa tên/giá"
                            >
                                <i className="fas fa-pen text-[10px]"></i>
                            </button>
                        </div>
                        <div className="text-xs text-gray-400 font-mono mt-1">ID: {product.id}</div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center"><i className="fas fa-times"></i></button>
                </div>
                
                <div className="flex-grow overflow-y-auto p-6 space-y-6">
                    {/* Status Card */}
                    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 relative group">
                        <button 
                            onClick={onAdjust}
                            className="absolute top-3 right-3 text-gray-300 hover:text-orange-500 transition-colors p-1"
                            title="Điều chỉnh số liệu tồn kho"
                        >
                            <i className="fas fa-cog"></i>
                        </button>

                        <div className="flex justify-between items-end mb-2 pr-6">
                            <span className="text-xs font-bold text-gray-400 uppercase">Tồn kho</span>
                            <div className="text-right">
                                <span className={`text-2xl font-black ${isLow ? 'text-red-500' : 'text-gray-800'}`}>{currentStock}</span>
                                <span className="text-sm text-gray-400 font-medium"> / {calculatedTotalImported} (Tổng nhập)</span>
                            </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2 mb-4 overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-500 ${isLow ? 'bg-red-500' : 'bg-eco-500'}`} style={{ width: `${percent}%` }}></div>
                        </div>
                        
                        <div className="grid grid-cols-3 gap-2 text-center divide-x divide-gray-100">
                             <div><div className="text-[10px] text-gray-400 uppercase font-bold">Giá Nhập</div><div className="text-sm font-bold text-gray-600">{new Intl.NumberFormat('vi-VN').format(product.importPrice || 0)}</div></div>
                             <div><div className="text-[10px] text-gray-400 uppercase font-bold">Giá Bán</div><div className="text-sm font-bold text-blue-600">{new Intl.NumberFormat('vi-VN').format(product.defaultPrice)}</div></div>
                             <div><div className="text-[10px] text-gray-400 uppercase font-bold">Lãi/SP</div><div className="text-sm font-bold text-green-600">{new Intl.NumberFormat('vi-VN').format(profitPerUnit)}</div></div>
                        </div>
                    </div>

                    {/* Analytics Row */}
                    <div className="grid grid-cols-2 gap-4">
                         <div className="bg-orange-50 p-3 rounded-xl border border-orange-100">
                             <div className="text-xs font-bold text-orange-400 uppercase">Đã Bán</div>
                             <div className="text-lg font-black text-orange-700">{totalSold} <span className="text-xs font-normal">sp</span></div>
                         </div>
                         <div className="bg-green-50 p-3 rounded-xl border border-green-100">
                             <div className="text-xs font-bold text-green-400 uppercase">Lãi Đã Thu</div>
                             <div className="text-lg font-black text-green-700">{new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(totalProfit)}</div>
                         </div>
                    </div>

                    {/* HISTORY SECTION WITH TABS */}
                    <div>
                        <div className="flex border-b border-gray-100 mb-3">
                            <button 
                                onClick={() => setActiveTab('EXPORT')} 
                                className={`flex-1 pb-2 text-xs font-bold transition-colors ${activeTab === 'EXPORT' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                Lịch sử Xuất
                            </button>
                            <button 
                                onClick={() => setActiveTab('IMPORT')} 
                                className={`flex-1 pb-2 text-xs font-bold transition-colors ${activeTab === 'IMPORT' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                                Lịch sử Nhập
                            </button>
                        </div>

                        <div className="bg-gray-50 rounded-xl border border-gray-100 overflow-hidden max-h-48 overflow-y-auto">
                            {activeTab === 'EXPORT' ? (
                                batchExportHistory.length === 0 ? (
                                    <div className="p-4 text-center text-xs text-gray-400 italic">Chưa có xuất hàng</div>
                                ) : (
                                    <table className="w-full text-left text-xs">
                                        <thead className="bg-gray-100 text-gray-500 font-bold sticky top-0"><tr><th className="p-2 pl-3">Lô hàng</th><th className="p-2 text-center">Số đơn</th><th className="p-2 text-right pr-3">Xuất</th></tr></thead>
                                        <tbody className="divide-y divide-gray-100">
                                            {batchExportHistory.map((h, idx) => (
                                                <tr key={idx} className="hover:bg-white">
                                                    <td className="p-2 pl-3"><div className="font-bold text-gray-700">{h.batchId}</div><div className="text-[9px] text-gray-400">{formatDistanceToNow(h.date, { addSuffix: true, locale: vi })}</div></td>
                                                    <td className="p-2 text-center text-gray-500">{h.orderCount}</td>
                                                    <td className="p-2 pr-3 text-right font-bold text-red-500">-{h.quantity}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )
                            ) : (
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-gray-100 text-gray-500 font-bold sticky top-0"><tr><th className="p-2 pl-3">Ngày nhập</th><th className="p-2 text-right">Giá vốn</th><th className="p-2 text-right pr-3">SL</th></tr></thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {importHistory.map((h, idx) => (
                                            <tr key={h.id || idx} className="hover:bg-white">
                                                <td className="p-2 pl-3"><div className="font-bold text-gray-700">{new Date(h.date).toLocaleDateString('vi-VN')}</div><div className="text-[9px] text-gray-400">{formatDistanceToNow(h.date, { addSuffix: true, locale: vi })}</div></td>
                                                <td className="p-2 text-right text-gray-500">{new Intl.NumberFormat('vi-VN').format(h.price)}</td>
                                                <td className="p-2 pr-3 text-right font-bold text-green-600">+{h.quantity}</td>
                                            </tr>
                                        ))}
                                        {!hasHistory && (
                                            <tr className="bg-yellow-50">
                                                <td className="p-2 pl-3 text-yellow-700 font-bold italic" colSpan={3}>
                                                    Dữ liệu cũ (Chưa có lịch sử nhập)<br/>
                                                    <span className="text-[9px] font-normal">Hệ thống đang dùng Tồn kho hiện tại làm chuẩn.</span>
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        {/* Math Summary Line */}
                        <div className="mt-2 text-[10px] text-center text-gray-400 font-medium">
                            Tổng Nhập ({calculatedTotalImported}) = Đã Bán ({totalSold}) + Tồn Kho ({currentStock})
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="p-4 bg-gray-50 border-t border-gray-100 flex gap-2">
                    <button onClick={onImport} className="flex-1 py-3 bg-eco-600 hover:bg-eco-700 text-white font-bold rounded-xl transition-colors shadow-sm shadow-green-200">
                        <i className="fas fa-plus mr-2"></i> Nhập Hàng
                    </button>
                    <button onClick={onAdjust} className="flex-1 py-3 bg-white border border-gray-300 hover:border-gray-400 text-gray-700 font-bold rounded-xl transition-colors shadow-sm">
                        <i className="fas fa-pen mr-2"></i> Sửa / Ghi đè
                    </button>
                    {onDelete && (
                        <button onClick={onDelete} className="w-12 flex items-center justify-center rounded-xl bg-red-50 text-red-500 hover:bg-red-100 border border-red-100 transition-colors">
                            <i className="fas fa-trash-alt"></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export interface ProductEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    onSave: (productData: Product, isImportMode?: boolean, importQty?: number) => Promise<void>;
    initialMode?: 'IMPORT' | 'SET';
}

export const ProductEditModal: React.FC<ProductEditModalProps> = ({ isOpen, onClose, product, onSave, initialMode = 'IMPORT' }) => {
    const [editTab, setEditTab] = useState<'IMPORT' | 'SET'>(initialMode);
    const [importAmount, setImportAmount] = useState<string>('');
    const [formData, setFormData] = useState<Partial<Product>>({
        name: '',
        defaultPrice: 0,
        importPrice: 0,
        stockQuantity: 0,
        totalImported: 0,
    });
    
    // Store Sold Quantity as a frozen snapshot to calculate stock accurately
    const [frozenSold, setFrozenSold] = useState(0);

    useEffect(() => {
        if (isOpen) {
            setEditTab(initialMode);
            setImportAmount('');
            if (product) {
                setFormData({
                    name: product.name,
                    defaultPrice: product.defaultPrice,
                    importPrice: product.importPrice,
                    stockQuantity: product.stockQuantity,
                    totalImported: product.totalImported || product.stockQuantity
                });
                // Calculate and freeze Sold Quantity: Sold = TotalImported - Stock
                const sold = (product.totalImported || 0) - (product.stockQuantity || 0);
                setFrozenSold(Math.max(0, sold));
            } else {
                setFormData({ name: '', defaultPrice: 0, importPrice: 0, stockQuantity: 0, totalImported: 0 });
                setFrozenSold(0);
                setEditTab('SET');
            }
        }
    }, [isOpen, product, initialMode]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name) return;

        const now = Date.now();
        let targetId = product?.id || generateProductSku(formData.name);
        
        // --- ATOMIC HANDLER FOR IMPORT ---
        if (editTab === 'IMPORT' && product) {
            const qtyToAdd = Number(importAmount) || 0;
            if (qtyToAdd > 0) {
                // Create a transient product object for basic info update (name/price)
                // BUT we pass flag to use atomic update for Stock
                const basicInfoUpdate: Product = {
                    ...product,
                    name: formData.name || product.name,
                    defaultPrice: Number(formData.defaultPrice) || 0,
                    importPrice: Number(formData.importPrice) || 0,
                };
                
                await onSave(basicInfoUpdate, true, qtyToAdd);
                onClose();
                return;
            }
        }

        // --- STANDARD SAVE (SET/OVERWRITE) ---
        let finalStock = 0;
        let finalTotalImported = Number(formData.totalImported) || 0;
        let currentHistory: ImportRecord[] = product?.importHistory ? [...product.importHistory] : [];

        // Logic: Stock = New Total Imported - Frozen Sold
        finalStock = Math.max(0, finalTotalImported - frozenSold);
        
        // Record difference in history
        const prevTotal = product?.totalImported || 0;
        const diff = finalTotalImported - prevTotal;
        
        if (diff > 0) {
                currentHistory.push({
                id: uuidv4(),
                date: now,
                quantity: diff,
                price: Number(formData.importPrice) || 0,
                note: product ? 'Điều chỉnh số liệu' : 'Khởi tạo'
            });
        }

        const productData: Product = {
            id: targetId,
            name: formData.name || '',
            defaultPrice: Number(formData.defaultPrice) || 0,
            importPrice: Number(formData.importPrice) || 0,
            defaultWeight: 1, 
            stockQuantity: finalStock,
            totalImported: finalTotalImported, 
            lastImportDate: now,
            importHistory: currentHistory
        };

        await onSave(productData, false, 0);
        onClose();
    };

    if (!isOpen) return null;

    // Live preview of stock for SET mode
    const previewStock = Math.max(0, (Number(formData.totalImported) || 0) - frozenSold);

    return (
        <div className="fixed inset-0 z-[110] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-lg text-gray-800">{product ? 'Cập Nhật Sản Phẩm' : 'Tạo Sản Phẩm Mới'}</h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center"><i className="fas fa-times"></i></button>
                </div>
                
                <form onSubmit={handleSubmit} className="flex-grow overflow-y-auto p-6 space-y-5">
                    {/* Name */}
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Tên sản phẩm</label>
                        <input 
                            value={formData.name}
                            onChange={e => setFormData({...formData, name: e.target.value})}
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-eco-500 outline-none font-bold text-gray-800"
                            placeholder="VD: Gạo ST25"
                            autoFocus={!product}
                        />
                    </div>

                    {/* Prices */}
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Giá bán</label>
                            <input 
                                type="number"
                                value={formData.defaultPrice}
                                onChange={e => setFormData({...formData, defaultPrice: Number(e.target.value)})}
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-eco-500 outline-none font-bold"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">Giá nhập (Vốn)</label>
                            <input 
                                type="number"
                                value={formData.importPrice}
                                onChange={e => setFormData({...formData, importPrice: Number(e.target.value)})}
                                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:bg-white focus:border-eco-500 outline-none font-medium text-gray-600"
                            />
                        </div>
                    </div>

                    <hr className="border-gray-100" />

                    {/* STOCK MANAGEMENT TABS */}
                    {product && (
                        <div className="flex bg-gray-100 p-1 rounded-xl">
                            <button 
                                type="button"
                                onClick={() => { setEditTab('IMPORT'); setImportAmount(''); }}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${editTab === 'IMPORT' ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Nhập Hàng Về
                            </button>
                            <button 
                                type="button"
                                onClick={() => setEditTab('SET')}
                                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${editTab === 'SET' ? 'bg-white text-orange-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                            >
                                Điều Chỉnh Số Liệu
                            </button>
                        </div>
                    )}

                    {/* STOCK INPUT FIELDS */}
                    <div className={`p-4 rounded-xl border ${editTab === 'IMPORT' ? 'bg-blue-50 border-blue-100' : 'bg-orange-50 border-orange-100'}`}>
                        {editTab === 'IMPORT' && product ? (
                            <>
                                <label className="block text-xs font-bold text-blue-700 uppercase mb-1">Số lượng hàng về (+)</label>
                                <div className="flex items-center gap-3">
                                    <input 
                                        type="number"
                                        value={importAmount}
                                        onChange={e => setImportAmount(e.target.value)}
                                        placeholder="0"
                                        className="w-full p-3 bg-white border border-blue-200 rounded-xl focus:border-blue-500 outline-none font-black text-xl text-blue-700 text-center placeholder-blue-200"
                                        autoFocus
                                    />
                                </div>
                                <div className="mt-2 text-xs text-blue-600 font-medium flex justify-between">
                                    <span>Hiện tại: {product.stockQuantity}</span>
                                    <span>Dự kiến: {(product.stockQuantity || 0) + (Number(importAmount) || 0)}</span>
                                </div>
                            </>
                        ) : (
                            <div className="space-y-3">
                                <div>
                                    <label className="block text-xs font-bold text-orange-600 uppercase mb-1">Tổng nhập (Total Imported)</label>
                                    <input 
                                        type="number"
                                        value={formData.totalImported}
                                        onChange={e => setFormData({...formData, totalImported: Number(e.target.value)})}
                                        className="w-full p-2 bg-white border border-orange-200 rounded-lg focus:border-orange-500 outline-none font-bold text-gray-700 text-center"
                                    />
                                </div>
                                
                                {/* READ ONLY FIELDS FOR DATA INTEGRITY */}
                                <div className="flex justify-between items-center bg-white p-2 rounded-lg border border-gray-200">
                                    <span className="text-xs font-medium text-gray-500">Đã bán (Cố định):</span>
                                    <span className="font-bold text-gray-700">{frozenSold}</span>
                                </div>
                                <div className="flex justify-between items-center bg-orange-100 p-2 rounded-lg border border-orange-200">
                                    <span className="text-xs font-bold text-orange-800">Tồn kho (Tự tính):</span>
                                    <span className="font-black text-orange-800 text-lg">{previewStock}</span>
                                </div>
                                
                                <div className="text-[10px] text-orange-600 italic text-center">
                                    * Tồn kho = Tổng nhập - Đã bán
                                </div>
                            </div>
                        )}
                    </div>

                    <button type="submit" className="w-full py-3.5 bg-black text-white rounded-xl font-bold shadow-lg hover:bg-gray-800 transition-transform active:scale-95">
                        {product ? 'Lưu Thay Đổi' : 'Xác Nhận Tạo Mới'}
                    </button>
                </form>
            </div>
        </div>
    );
};

const InventoryManager: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  // Modals & Forms
  const [showProductModal, setShowProductModal] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null); // Detail Modal State
  const [editingProduct, setEditingProduct] = useState<Product | null>(null); // Edit Form State
  const [editMode, setEditMode] = useState<'IMPORT' | 'SET'>('IMPORT');

  // Tools
  const [isProcessing, setIsProcessing] = useState(false);

  // Action Modals
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [pendingProductUpdate, setPendingProductUpdate] = useState<Product | null>(null);

  useEffect(() => {
    const unsubProducts = storageService.subscribeProducts(setProducts);
    return () => { if (unsubProducts) unsubProducts(); };
  }, []);

  useEffect(() => {
    let result = products;
    if (searchTerm) {
      result = result.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
    }
    // Sort: Low stock first, then Name
    result.sort((a,b) => {
        if (a.stockQuantity < 5 && b.stockQuantity >= 5) return -1;
        if (a.stockQuantity >= 5 && b.stockQuantity < 5) return 1;
        return a.name.localeCompare(b.name);
    });
    setFilteredProducts(result);
  }, [products, searchTerm]);

  // --- STATS ---
  const stats = useMemo(() => {
      let totalStockValue = 0; // Vốn
      let totalSalesValue = 0; // Giá bán
      let lowStock = 0;
      products.forEach(p => {
          totalStockValue += (p.importPrice || 0) * p.stockQuantity;
          totalSalesValue += p.defaultPrice * p.stockQuantity;
          if (p.stockQuantity < 5) lowStock++;
      });
      return { totalStockValue, totalSalesValue, lowStock, totalCount: products.length };
  }, [products]);

  // --- HANDLERS ---
  const handleViewDetail = (product: Product) => {
      setViewingProduct(product);
  };
  
  const handleDeleteFromDetail = () => {
      if (viewingProduct) {
          handleDelete(viewingProduct.id);
          setViewingProduct(null);
      }
  };

  // Mode: IMPORT (Add Stock)
  const handleEdit = (product: Product) => {
      setEditingProduct(product);
      setEditMode('IMPORT');
      setShowProductModal(true);
  };

  // Mode: SET (Overwrite / Adjust Stock)
  const handleAdjust = (product: Product) => {
      setEditingProduct(product);
      setEditMode('SET');
      setShowProductModal(true);
  };

  const handleCreate = () => {
      setEditingProduct(null);
      setEditMode('SET');
      setShowProductModal(true);
  };

  const handleSaveProduct = async (productData: Product, isImportMode: boolean = false, importQty: number = 0) => {
      // 1. ATOMIC IMPORT (Concurrency Safe)
      if (isImportMode && editingProduct) {
          await storageService.adjustStockAtomic(editingProduct.id, importQty, {
              price: productData.importPrice || 0,
              note: 'Nhập hàng thêm'
          });
          
          // Also update basic info if changed (Name/Price), but keep stock as processed by atomic op
          if (productData.name !== editingProduct.name || productData.defaultPrice !== editingProduct.defaultPrice) {
               await storageService.saveProduct({
                   ...editingProduct, // Keep original ID/Stock refs
                   name: productData.name,
                   defaultPrice: productData.defaultPrice,
                   importPrice: productData.importPrice
               });
          }
          toast.success(`Đã nhập thêm ${importQty} sản phẩm`);
          setPendingProductUpdate(null); // No sync confirmation for stock only updates
      } else {
          // 2. STANDARD SAVE / OVERWRITE
          let isMerge = false;
          const existing = storageService.getProductBySku(productData.id);
          
          if (!editingProduct && existing) {
              if (!window.confirm(`Sản phẩm "${existing.name}" đã tồn tại. Bạn có muốn cập nhật và cộng dồn kho?`)) return;
              isMerge = true;
          }

          await storageService.saveProduct(productData);
          
          if (editingProduct && !isMerge) {
              setPendingProductUpdate(productData);
              setShowSyncConfirm(true);
          } else {
              toast.success('Đã lưu sản phẩm');
          }
      }
  };

  const handleConfirmSync = async () => {
      if (pendingProductUpdate) {
          const count = await storageService.syncProductToPendingOrders(pendingProductUpdate);
          toast.success(count > 0 ? `Đã cập nhật ${count} đơn hàng!` : 'Đã lưu (Không có đơn ảnh hưởng)');
      }
      setShowSyncConfirm(false);
      setShowProductModal(false);
  };

  const handleDelete = (id: string) => {
    setDeleteId(id);
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (deleteId) {
      await storageService.deleteProduct(deleteId);
      toast.success('Đã xóa sản phẩm');
      setShowDeleteConfirm(false);
    }
  };
  
  const handleCleanup = async () => {
      if (!window.confirm("Hệ thống sẽ quét toàn bộ kho, tìm các sản phẩm trùng tên và gộp chúng lại làm một. Đồng thời cập nhật lại lịch sử đơn hàng.\n\nHành động này giúp kho gọn gàng và chính xác hơn.\n\nTiếp tục?")) return;
      
      setIsProcessing(true);
      const toastId = toast.loading("Đang dọn dẹp kho...");
      try {
          const result = await storageService.cleanAndMergeDuplicateProducts();
          toast.success(`Xong! Gộp ${result.mergedCount} sản phẩm trùng. Sửa ${result.fixedOrders} đơn hàng.`, { duration: 5000 });
      } catch (e: any) {
          toast.error("Lỗi: " + e.message);
      } finally {
          setIsProcessing(false);
          toast.dismiss(toastId);
      }
  };

  const handleRecalculate = async () => {
      if (!window.confirm("Hệ thống sẽ quét toàn bộ Đơn hàng để tính toán lượng ĐÃ BÁN.\n\nSau đó:\nTồn kho = Tổng Nhập - Đã Bán\n\nBạn có muốn đồng bộ lại không?")) return;
      
      setIsProcessing(true);
      const toastId = toast.loading("Đang tính toán lại...");
      try {
          const count = await storageService.recalculateInventoryFromOrders();
          toast.success(`Đã cập nhật số liệu tồn kho cho ${count} sản phẩm!`, { duration: 5000 });
      } catch (e: any) {
          console.error(e);
          toast.error("Lỗi: " + e.message);
      } finally {
          setIsProcessing(false);
          toast.dismiss(toastId);
      }
  };

  const handleQuickStock = async (e: React.MouseEvent, p: Product, amount: number) => {
      e.stopPropagation();
      // Use Atomic Adjustment for safety
      await storageService.adjustStockAtomic(p.id, amount, { 
          price: p.importPrice || 0, 
          note: 'Quick Add' 
      });
      toast.success(`Đã thêm ${amount} ${p.name}`);
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in px-2 sm:px-4">
      {/* 1. HEADER & STATS BAR */}
      <div className="flex flex-col md:flex-row gap-4 mb-6">
          <div className="flex-1 bg-gradient-to-r from-gray-900 to-gray-800 rounded-2xl p-5 text-white shadow-lg flex items-center justify-between">
              <div>
                  <h2 className="text-2xl font-black">Kho Hàng</h2>
                  <p className="text-gray-400 text-xs mt-1">Quản lý nhập xuất tồn</p>
              </div>
              <div className="text-right">
                  <div className="text-3xl font-black text-eco-400">{stats.totalCount}</div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Sản phẩm</div>
              </div>
          </div>
          
          <div className="flex-1 bg-white rounded-2xl p-4 border border-gray-100 shadow-sm grid grid-cols-2 gap-4">
               <div>
                   <div className="text-xs font-bold text-gray-400 uppercase">Tổng vốn tồn</div>
                   <div className="text-lg font-black text-gray-800">{new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(stats.totalStockValue)}</div>
               </div>
               <div>
                   <div className="text-xs font-bold text-gray-400 uppercase">Sắp hết hàng</div>
                   <div className={`text-lg font-black ${stats.lowStock > 0 ? 'text-red-500' : 'text-green-500'}`}>{stats.lowStock}</div>
               </div>
               <div className="col-span-2 pt-2 border-t border-gray-50 flex gap-2">
                   <button onClick={handleCreate} className="flex-1 bg-black text-white py-2 rounded-lg font-bold text-xs hover:bg-gray-800 transition-colors shadow-lg">
                       <i className="fas fa-plus mr-1"></i> Nhập Hàng
                   </button>
                   
                   {/* Tool Group */}
                   <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                        <button 
                            onClick={handleCleanup} 
                            disabled={isProcessing} 
                            className="px-3 py-1 bg-white text-purple-700 hover:bg-purple-50 rounded border border-gray-200 font-bold text-[10px] transition-colors shadow-sm"
                            title="Rà soát & Gộp trùng"
                        >
                            {isProcessing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-broom"></i>}
                        </button>
                        <button 
                            onClick={handleRecalculate} 
                            disabled={isProcessing} 
                            className="px-3 py-1 bg-white text-blue-700 hover:bg-blue-50 rounded border border-gray-200 font-bold text-[10px] transition-colors shadow-sm"
                            title="Tính lại từ đơn hàng"
                        >
                            {isProcessing ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-sync-alt"></i>}
                        </button>
                   </div>
               </div>
          </div>
      </div>

      {/* 2. MAIN CONTENT (LIST) */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[500px] flex flex-col">
          {/* Toolbar */}
          <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row justify-between items-center gap-4 bg-gray-50/50">
              <div className="relative w-full sm:w-80">
                  <i className="fas fa-search absolute left-3 top-3 text-gray-400 text-xs"></i>
                  <input 
                      value={searchTerm} 
                      onChange={e => setSearchTerm(e.target.value)} 
                      placeholder="Tìm tên sản phẩm..."
                      className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium outline-none focus:border-eco-500 transition-all shadow-sm"
                  />
              </div>
          </div>

          {/* Table Header (Desktop) */}
          <div className="hidden sm:grid grid-cols-[2fr_1fr_1.5fr_100px] gap-4 px-6 py-3 bg-gray-100 text-gray-500 font-bold uppercase text-[10px] tracking-wider border-b border-gray-200">
              <div>Sản phẩm / Giá</div>
              <div className="text-center">Vốn / Lãi dự kiến</div>
              <div>Tình trạng kho</div>
              <div className="text-right">Hành động</div>
          </div>

          {/* List Body */}
          <div className="flex-grow overflow-y-auto">
              {filteredProducts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-64 text-gray-300">
                      <i className="fas fa-box-open text-4xl mb-3 opacity-20"></i>
                      <p className="text-sm font-medium">Kho hàng trống</p>
                  </div>
              ) : (
                  <div className="divide-y divide-gray-50">
                      {filteredProducts.map(p => {
                          const total = p.totalImported || p.stockQuantity || 1;
                          const percent = Math.min(100, (p.stockQuantity / total) * 100);
                          const isLow = p.stockQuantity < 5;
                          const profit = p.defaultPrice - (p.importPrice || 0);

                          return (
                              <div key={p.id} onClick={() => handleViewDetail(p)} className="group sm:grid sm:grid-cols-[2fr_1fr_1.5fr_100px] sm:gap-4 p-4 sm:px-6 hover:bg-blue-50/30 transition-colors cursor-pointer relative">
                                  {/* Col 1: Name & Price */}
                                  <div className="mb-2 sm:mb-0">
                                      <div className="font-bold text-gray-800 text-sm mb-1 group-hover:text-blue-600 transition-colors">{p.name}</div>
                                      <div className="flex items-center gap-2">
                                          <span className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded text-[10px] font-bold border border-green-100">
                                              {new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}đ
                                          </span>
                                          <span className="text-[10px] text-gray-400">
                                              Cập nhật: {new Date(p.lastImportDate).toLocaleDateString('vi-VN')}
                                          </span>
                                      </div>
                                  </div>

                                  {/* Col 2: Cost & Profit (Desktop Only) */}
                                  <div className="hidden sm:flex flex-col items-center justify-center">
                                      <div className="text-xs font-mono text-gray-500">{new Intl.NumberFormat('vi-VN').format(p.importPrice || 0)}</div>
                                      <div className="text-[10px] text-green-600 font-bold">+{new Intl.NumberFormat('vi-VN').format(profit)}</div>
                                  </div>

                                  {/* Col 3: Stock Bar */}
                                  <div className="mb-2 sm:mb-0 flex flex-col justify-center">
                                      <div className="flex justify-between items-end mb-1">
                                          <span className="text-[10px] font-bold text-gray-400 uppercase">Tồn kho</span>
                                          <span className={`text-sm font-bold ${isLow ? 'text-red-600' : 'text-gray-900'}`}>{p.stockQuantity} <span className="text-gray-400 text-[10px] font-normal">/ {p.totalImported}</span></span>
                                      </div>
                                      <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                                          <div className={`h-full rounded-full transition-all duration-500 ${isLow ? 'bg-red-500' : 'bg-eco-500'}`} style={{ width: `${percent}%` }}></div>
                                      </div>
                                  </div>

                                  {/* Col 4: Actions */}
                                  <div className="flex items-center justify-end gap-2">
                                      <button onClick={(e) => handleQuickStock(e, p, 1)} className="w-8 h-8 rounded-lg bg-white border border-gray-200 hover:bg-green-50 hover:border-green-200 hover:text-green-600 shadow-sm transition-all flex items-center justify-center">
                                          <i className="fas fa-plus text-xs"></i>
                                      </button>
                                  </div>
                              </div>
                          );
                      })}
                  </div>
              )}
          </div>
      </div>

      {/* DETAIL MODAL */}
      {viewingProduct && (
          <ProductDetailModal 
            isOpen={!!viewingProduct}
            onClose={() => setViewingProduct(null)}
            product={viewingProduct}
            onImport={() => {
                handleEdit(viewingProduct);
                setViewingProduct(null);
            }}
            onAdjust={() => {
                handleAdjust(viewingProduct);
                setViewingProduct(null);
            }}
            onDelete={handleDeleteFromDetail}
          />
      )}

      {/* ADD/EDIT FORM MODAL */}
      <ProductEditModal 
          isOpen={showProductModal}
          onClose={() => setShowProductModal(false)}
          product={editingProduct}
          onSave={handleSaveProduct}
          initialMode={editMode}
      />

      <ConfirmModal 
        isOpen={showDeleteConfirm}
        title="Xóa sản phẩm?"
        message="Sản phẩm sẽ bị xóa vĩnh viễn khỏi kho."
        onConfirm={confirmDelete}
        onCancel={() => setShowDeleteConfirm(false)}
        confirmLabel="Xóa"
        isDanger={true}
      />
      <ConfirmModal 
        isOpen={showSyncConfirm}
        title="Đồng bộ giá?"
        message="Bạn có muốn cập nhật tên & giá mới cho các đơn hàng ĐANG XỬ LÝ không?"
        onConfirm={handleConfirmSync}
        onCancel={() => { setShowSyncConfirm(false); setShowProductModal(false); }}
        confirmLabel="Đồng bộ ngay"
        cancelLabel="Không, chỉ lưu kho"
        isDanger={false}
      />
    </div>
  );
};

export default InventoryManager;
