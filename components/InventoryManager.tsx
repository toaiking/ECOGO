
import React, { useState, useEffect, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import toast from 'react-hot-toast';
import { Product, Order, ImportRecord } from '../types';
import { storageService, generateProductSku, normalizeString } from '../services/storageService';
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

    const batchExportHistory = useMemo(() => {
        const groups = new Map<string, { batchId: string, quantity: number, date: number, orderCount: number }>();
        history.forEach(item => {
            const batchId = item.order.batchId || 'Chưa phân lô';
            if (!groups.has(batchId)) { groups.set(batchId, { batchId, quantity: 0, date: item.order.createdAt, orderCount: 0 }); }
            const group = groups.get(batchId)!;
            group.quantity += Number(item.quantity) || 0;
            group.orderCount += 1;
            group.date = Math.max(group.date, item.order.createdAt);
        });
        return Array.from(groups.values()).sort((a, b) => b.date - a.date);
    }, [history]);

    const importHistory = useMemo(() => {
        const records = product.importHistory || [];
        return [...records].sort((a, b) => b.date - a.date);
    }, [product]);

    if (!isOpen) return null;

    const totalSold = batchExportHistory.reduce((sum, b) => sum + b.quantity, 0);
    const currentStock = product.stockQuantity || 0;
    const historyImportTotal = importHistory.reduce((sum, r) => sum + r.quantity, 0);
    const hasHistory = historyImportTotal > 0;
    const calculatedTotalImported = hasHistory ? historyImportTotal : (product.totalImported || (currentStock + totalSold));
    const profitPerUnit = product.defaultPrice - (product.importPrice || 0);
    const totalProfit = totalSold * profitPerUnit;
    const percent = calculatedTotalImported > 0 ? Math.min(100, (currentStock / calculatedTotalImported) * 100) : 0;
    const isLow = currentStock < 5;

    return (
        <div className="fixed inset-0 z-[100] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-gray-100 flex justify-between items-start bg-gray-50">
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="font-black text-xl text-gray-800 uppercase tracking-tighter">{product.name}</h3>
                            <button onClick={onAdjust} className="w-6 h-6 rounded-full bg-white border-2 border-gray-800 text-gray-800 hover:bg-gray-100 flex items-center justify-center transition-all shadow-sm"><i className="fas fa-pen text-[10px]"></i></button>
                        </div>
                        <div className="text-[10px] text-gray-400 font-black mt-1 uppercase tracking-widest">Mã hàng: {product.id}</div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center"><i className="fas fa-times"></i></button>
                </div>
                
                <div className="flex-grow overflow-y-auto p-6 space-y-6">
                    <div className="bg-white rounded-2xl border-2 border-gray-800 shadow-sm p-4 relative overflow-hidden">
                        <div className="flex justify-between items-end mb-2">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Tồn kho hiện tại</span>
                            <div className="text-right">
                                <span className={`text-4xl font-black tracking-tighter ${isLow ? 'text-red-600' : 'text-gray-800'}`}>{currentStock}</span>
                                <span className="text-xs text-gray-400 font-bold uppercase ml-1">/ {calculatedTotalImported}</span>
                            </div>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-3 mb-4 overflow-hidden border border-gray-200">
                            <div className={`h-full rounded-full transition-all duration-500 ${isLow ? 'bg-red-500' : 'bg-eco-500'}`} style={{ width: `${percent}%` }}></div>
                        </div>
                        <div className="grid grid-cols-3 gap-2 text-center pt-2">
                             <div><div className="text-[9px] text-gray-400 uppercase font-black">Giá Nhập</div><div className="text-xs font-black text-gray-600">{new Intl.NumberFormat('vi-VN').format(product.importPrice || 0)}đ</div></div>
                             <div><div className="text-[9px] text-gray-400 uppercase font-black">Giá Bán</div><div className="text-xs font-black text-blue-600">{new Intl.NumberFormat('vi-VN').format(product.defaultPrice)}đ</div></div>
                             <div><div className="text-[9px] text-gray-400 uppercase font-black">Lợi nhuận</div><div className="text-xs font-black text-green-600">{new Intl.NumberFormat('vi-VN').format(profitPerUnit)}đ</div></div>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                         <div className="bg-orange-50 p-3 rounded-2xl border border-orange-200">
                             <div className="text-[9px] font-black text-orange-400 uppercase tracking-widest">Đã xuất bán</div>
                             <div className="text-xl font-black text-orange-700 leading-none mt-1">{totalSold} <span className="text-[10px]">sp</span></div>
                         </div>
                         <div className="bg-green-50 p-3 rounded-2xl border border-green-200">
                             <div className="text-[9px] font-black text-green-400 uppercase tracking-widest">Lãi dự thu</div>
                             <div className="text-xl font-black text-green-700 leading-none mt-1">{new Intl.NumberFormat('vi-VN').format(totalProfit)}<span className="text-[10px]">đ</span></div>
                         </div>
                    </div>

                    <div className="space-y-3">
                        <div className="flex border-b-2 border-gray-100">
                            <button onClick={() => setActiveTab('EXPORT')} className={`flex-1 pb-2 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'EXPORT' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-400'}`}>Lịch sử Xuất</button>
                            <button onClick={() => setActiveTab('IMPORT')} className={`flex-1 pb-2 text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'IMPORT' ? 'text-purple-600 border-b-2 border-purple-600' : 'text-gray-400'}`}>Lịch sử Nhập</button>
                        </div>
                        <div className="bg-gray-50 rounded-xl border-2 border-gray-200 overflow-hidden max-h-48 overflow-y-auto">
                            <table className="w-full text-left text-xs">
                                <thead className="bg-gray-100 text-[9px] font-black text-gray-500 uppercase sticky top-0"><tr><th className="p-2">Thời gian</th><th className="p-2 text-center">{activeTab === 'EXPORT' ? 'Mã Lô' : 'Giá Vốn'}</th><th className="p-2 text-right">SL</th></tr></thead>
                                <tbody className="divide-y divide-gray-100">
                                    {(activeTab === 'EXPORT' ? batchExportHistory : importHistory).map((h: any, idx) => (
                                        <tr key={idx} className="hover:bg-white transition-colors">
                                            <td className="p-2 font-bold text-gray-600">{new Date(h.date).toLocaleDateString('vi-VN')}</td>
                                            <td className="p-2 text-center font-black text-gray-800">{activeTab === 'EXPORT' ? h.batchId : new Intl.NumberFormat('vi-VN').format(h.price)}</td>
                                            <td className={`p-2 text-right font-black ${activeTab === 'EXPORT' ? 'text-red-500' : 'text-green-600'}`}>{activeTab === 'EXPORT' ? '-' : '+'}{h.quantity}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-white border-t-2 border-gray-100 flex gap-2">
                    <button onClick={onImport} className="flex-1 py-4 bg-black text-white font-black text-xs rounded-2xl shadow-xl hover:bg-gray-800 uppercase tracking-widest">Nhập thêm <i className="fas fa-plus-circle ml-1"></i></button>
                    <button onClick={onAdjust} className="flex-1 py-4 bg-white border-2 border-gray-800 text-gray-800 font-black text-xs rounded-2xl shadow-sm hover:bg-gray-50 uppercase tracking-widest">Sửa số liệu <i className="fas fa-cog ml-1"></i></button>
                    <button onClick={onDelete} className="w-14 flex items-center justify-center rounded-2xl bg-red-50 text-red-500 hover:bg-red-100 border border-red-100"><i className="fas fa-trash-alt"></i></button>
                </div>
            </div>
        </div>
    );
};

interface ProductEditModalProps {
    isOpen: boolean;
    onClose: () => void;
    product: Product | null;
    onSave: (data: Product, isImport?: boolean, qty?: number) => Promise<void>;
    initialMode?: 'IMPORT' | 'SET';
    allProducts?: Product[]; // Optional: for duplicate checking
    onSwitchToProduct?: (p: Product) => void; // Optional: callback when duplicate found
}

export const ProductEditModal: React.FC<ProductEditModalProps> = ({ isOpen, onClose, product, onSave, initialMode = 'IMPORT', allProducts, onSwitchToProduct }) => {
    const [editTab, setEditTab] = useState<'IMPORT' | 'SET'>(initialMode);
    const [importAmount, setImportAmount] = useState<string>('');
    const [importPriceInput, setImportPriceInput] = useState<string>('');
    
    // State cơ bản
    const [formData, setFormData] = useState<Partial<Product>>({ name: '', defaultPrice: 0, importPrice: 0 });
    
    // State quản lý lịch sử nhập (Dành cho tab SET)
    const [historyList, setHistoryList] = useState<ImportRecord[]>([]);
    
    const [realSold, setRealSold] = useState(0);
    const [detectedDuplicate, setDetectedDuplicate] = useState<Product | null>(null);

    useEffect(() => {
        if (isOpen) {
            setEditTab(initialMode); 
            setImportAmount('');
            setDetectedDuplicate(null);
            if (product) {
                setFormData({ name: product.name, defaultPrice: product.defaultPrice, importPrice: product.importPrice });
                setImportPriceInput(product.importPrice?.toString() || '0');
                
                // Load history sorted by date desc
                const loadedHistory = product.importHistory ? [...product.importHistory].sort((a,b) => b.date - a.date) : [];
                
                // Nếu sản phẩm cũ chưa có history, tạo 1 record giả từ totalImported
                if (loadedHistory.length === 0 && (product.totalImported || 0) > 0) {
                    loadedHistory.push({
                        id: uuidv4(),
                        date: product.lastImportDate || Date.now(),
                        quantity: product.totalImported || 0,
                        price: product.importPrice || 0,
                        note: 'Nhập ban đầu'
                    });
                }
                setHistoryList(loadedHistory);

                const sold = storageService.getRealSalesCount(product.id);
                setRealSold(sold);
            } else {
                setFormData({ name: '', defaultPrice: 0, importPrice: 0 }); 
                setImportPriceInput('');
                setHistoryList([]);
                setRealSold(0); 
                setEditTab('SET');
            }
        }
    }, [isOpen, product, initialMode]);

    // NEW: Duplicate Checking Effect
    useEffect(() => {
        // Chỉ kiểm tra khi đang ở chế độ Tạo mới (product === null) và có nhập tên
        if (!product && formData.name && allProducts && allProducts.length > 0) {
            const inputName = normalizeString(formData.name);
            if (inputName.length > 2) {
                const found = allProducts.find(p => normalizeString(p.name) === inputName);
                setDetectedDuplicate(found || null);
            } else {
                setDetectedDuplicate(null);
            }
        } else {
            setDetectedDuplicate(null);
        }
    }, [formData.name, product, allProducts]);

    // Tính lại tổng nhập từ danh sách lịch sử đang sửa
    const calculatedTotalImported = useMemo(() => {
        return historyList.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    }, [historyList]);

    const handleHistoryChange = (id: string, field: keyof ImportRecord, value: any) => {
        setHistoryList(prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
    };

    const handleDeleteHistoryItem = (id: string) => {
        if (confirm("Xóa lần nhập này?")) {
            setHistoryList(prev => prev.filter(item => item.id !== id));
        }
    };

    const handleAddHistoryItem = () => {
        setHistoryList(prev => [{
            id: uuidv4(),
            date: Date.now(),
            quantity: 0,
            price: Number(formData.importPrice) || 0,
            note: 'Bổ sung'
        }, ...prev]);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.name) return;
        
        // Prevent saving if duplicate is detected in create mode
        if (detectedDuplicate && !product) {
            toast.error("Tên sản phẩm bị trùng! Vui lòng kiểm tra lại.");
            return;
        }
        
        // TAB NHẬP HÀNG MỚI
        if (editTab === 'IMPORT' && product) {
            const qty = Number(importAmount) || 0;
            const price = Number(importPriceInput) || 0;
            if (qty > 0) { 
                await onSave({ 
                    ...product, 
                    name: formData.name || product.name, 
                    defaultPrice: Number(formData.defaultPrice) || 0, 
                    importPrice: price 
                }, true, qty); 
                onClose(); 
                return; 
            }
        }
        
        // TAB SỬA SỐ LIỆU (Lưu lại toàn bộ lịch sử)
        const finalStock = calculatedTotalImported - realSold;
        const lastImport = historyList.length > 0 ? historyList[0].date : Date.now();
        const importPrice = Number(formData.importPrice) || 0;

        await onSave({ 
            id: product?.id || generateProductSku(formData.name!), 
            name: formData.name!, 
            defaultPrice: Number(formData.defaultPrice) || 0, 
            importPrice: importPrice, 
            defaultWeight: 1, 
            stockQuantity: finalStock, 
            totalImported: calculatedTotalImported, 
            lastImportDate: lastImport, 
            importHistory: historyList // Lưu danh sách lịch sử mới
        }, false, 0);
        onClose();
    };

    if (!isOpen) return null;
    const vInputClass = "w-full p-3 bg-white border-2 border-gray-800 rounded-2xl outline-none focus:ring-4 focus:ring-eco-50 font-black text-black text-sm transition-all";

    return (
        <div className="fixed inset-0 z-[110] bg-gray-900/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-black text-gray-800 uppercase text-sm tracking-widest">{product ? 'Cập nhật hàng hóa' : 'Tạo hàng mới'}</h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center"><i className="fas fa-times"></i></button>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto">
                    <div>
                        <label className="text-[10px] font-black text-gray-400 uppercase mb-1 ml-1 block">Tên sản phẩm *</label>
                        <input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className={vInputClass} placeholder="VD: Gạo ST25..." />
                        
                        {/* Duplicate Warning UI */}
                        {detectedDuplicate && (
                            <div className="mt-3 p-3 bg-yellow-50 border-2 border-yellow-200 rounded-xl flex items-center justify-between animate-fade-in">
                                <div>
                                    <div className="text-[10px] font-black text-yellow-700 uppercase tracking-wide flex items-center gap-1">
                                        <i className="fas fa-exclamation-triangle"></i> Đã có trong kho
                                    </div>
                                    <div className="text-xs font-bold text-gray-700 mt-0.5">{detectedDuplicate.name}</div>
                                </div>
                                <button 
                                    type="button"
                                    onClick={() => onSwitchToProduct && onSwitchToProduct(detectedDuplicate)}
                                    className="bg-yellow-400 text-yellow-900 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase shadow-sm hover:bg-yellow-500 transition-colors"
                                >
                                    Sửa cái này <i className="fas fa-arrow-right ml-1"></i>
                                </button>
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase mb-1 ml-1 block">Giá bán</label>
                            <input type="number" value={formData.defaultPrice} onChange={e => setFormData({...formData, defaultPrice: Number(e.target.value)})} className={`${vInputClass} text-blue-600`} />
                        </div>
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase mb-1 ml-1 block">Giá nhập (Vốn)</label>
                            <input type="number" value={formData.importPrice} onChange={e => setFormData({...formData, importPrice: Number(e.target.value)})} className={vInputClass} />
                        </div>
                    </div>
                    {product && (
                        <div className="flex bg-gray-100 p-1 rounded-2xl">
                            <button type="button" onClick={() => setEditTab('IMPORT')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-xl transition-all ${editTab === 'IMPORT' ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}>Nhập thêm hàng</button>
                            <button type="button" onClick={() => setEditTab('SET')} className={`flex-1 py-2 text-[10px] font-black uppercase rounded-xl transition-all ${editTab === 'SET' ? 'bg-white text-black shadow-sm' : 'text-gray-500'}`}>Sửa Lịch Sử Nhập</button>
                        </div>
                    )}
                    <div className={`p-4 rounded-2xl border-2 ${editTab === 'IMPORT' ? 'bg-blue-50 border-blue-200' : 'bg-orange-50 border-orange-200'}`}>
                        {editTab === 'IMPORT' && product ? (
                            <div className="space-y-3">
                                <div>
                                    <label className="text-[10px] font-black text-blue-600 uppercase mb-1 block">Số lượng nhập về (+)</label>
                                    <input type="number" value={importAmount} onChange={e => setImportAmount(e.target.value)} className={`${vInputClass} text-center text-xl`} placeholder="0" />
                                </div>
                                <div>
                                    <label className="text-[10px] font-black text-gray-400 uppercase mb-1 block">Giá nhập đợt này</label>
                                    <input type="number" value={importPriceInput} onChange={e => setImportPriceInput(e.target.value)} className={`${vInputClass} text-center`} />
                                </div>
                                <div className="mt-2 flex justify-between text-[10px] font-bold text-blue-400 px-2">
                                    <span>Tồn hiện tại: {product.stockQuantity}</span>
                                    <span>Sau khi nhập: {(product.stockQuantity || 0) + (Number(importAmount) || 0)}</span>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                <div className="flex justify-between items-center mb-2">
                                    <label className="text-[10px] font-black text-orange-600 uppercase">Chi tiết các lần nhập</label>
                                    <button type="button" onClick={handleAddHistoryItem} className="text-[9px] bg-orange-100 text-orange-700 px-2 py-1 rounded font-bold hover:bg-orange-200">+ Thêm dòng</button>
                                </div>
                                
                                <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                                    {historyList.map((item, idx) => (
                                        <div key={item.id} className="flex items-center gap-2 bg-white p-2 rounded-xl border border-gray-200">
                                            <div className="w-16 text-[9px] font-bold text-gray-400 text-center">
                                                {new Date(item.date).toLocaleDateString('vi-VN')}
                                            </div>
                                            <div className="flex-grow">
                                                <input 
                                                    type="number" 
                                                    value={item.quantity} 
                                                    onChange={e => handleHistoryChange(item.id, 'quantity', Number(e.target.value))}
                                                    className="w-full p-1 bg-gray-50 border border-gray-200 rounded text-center text-xs font-black text-gray-800 outline-none focus:border-orange-400"
                                                    placeholder="SL"
                                                />
                                            </div>
                                            <div className="w-20">
                                                <input 
                                                    type="number" 
                                                    value={item.price} 
                                                    onChange={e => handleHistoryChange(item.id, 'price', Number(e.target.value))}
                                                    className="w-full p-1 bg-gray-50 border border-gray-200 rounded text-right text-xs font-medium text-gray-600 outline-none"
                                                    placeholder="Giá"
                                                />
                                            </div>
                                            <button type="button" onClick={() => handleDeleteHistoryItem(item.id)} className="w-6 h-6 flex items-center justify-center text-gray-300 hover:text-red-500"><i className="fas fa-times"></i></button>
                                        </div>
                                    ))}
                                    {historyList.length === 0 && <div className="text-center text-xs text-gray-400 italic py-2">Chưa có lịch sử nhập</div>}
                                </div>

                                <div className="bg-white/60 p-3 rounded-xl border border-orange-100 space-y-1">
                                    <div className="flex justify-between items-center font-bold text-xs text-gray-500">
                                        <span>Tổng nhập (tự cộng):</span>
                                        <span className="text-black">{calculatedTotalImported}</span>
                                    </div>
                                    <div className="flex justify-between items-center font-bold text-xs text-gray-500">
                                        <span>Đã bán (theo đơn):</span>
                                        <span>-{realSold}</span>
                                    </div>
                                    <div className="border-t border-dashed border-orange-200 my-1"></div>
                                    <div className="flex justify-between items-center font-black text-xs text-orange-800">
                                        <span>Tồn kho thực tế:</span>
                                        <span className="text-lg">{calculatedTotalImported - realSold}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    <button 
                        type="submit" 
                        disabled={!!detectedDuplicate && !product} // Disable if duplicate found in create mode
                        className={`w-full py-4 rounded-2xl font-black text-sm uppercase shadow-xl transition-all mt-2 tracking-widest ${
                            detectedDuplicate && !product 
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                            : 'bg-black text-white hover:bg-gray-800 active:scale-95'
                        }`}
                    >
                        Lưu thay đổi <i className="fas fa-check-circle ml-1"></i>
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
  const [showProductModal, setShowProductModal] = useState(false);
  const [viewingProduct, setViewingProduct] = useState<Product | null>(null); 
  const [editingProduct, setEditingProduct] = useState<Product | null>(null); 
  const [editMode, setEditMode] = useState<'IMPORT' | 'SET'>('IMPORT');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [pendingProductUpdate, setPendingProductUpdate] = useState<Product | null>(null);

  useEffect(() => { const unsub = storageService.subscribeProducts(setProducts); return () => unsub(); }, []);
  useEffect(() => {
    let result = products;
    if (searchTerm) { result = result.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase())); }
    result.sort((a,b) => { if (a.stockQuantity < 5 && b.stockQuantity >= 5) return -1; if (a.stockQuantity >= 5 && b.stockQuantity < 5) return 1; return a.name.localeCompare(b.name); });
    setFilteredProducts(result);
  }, [products, searchTerm]);

  const stats = useMemo(() => {
      let capital = 0, profit = 0, low = 0;
      products.forEach(p => {
          const s = p.stockQuantity || 0;
          capital += (p.importPrice || 0) * s;
          profit += (p.defaultPrice - (p.importPrice || 0)) * s;
          if (s < 5) low++;
      });
      return { capital, profit, low, total: products.length };
  }, [products]);

  const handleSaveProduct = async (data: Product, isImport: boolean = false, qty: number = 0) => {
      if (isImport && editingProduct) {
          await storageService.adjustStockAtomic(editingProduct.id, qty, { price: data.importPrice || 0, note: 'Nhập hàng' });
          if (data.name !== editingProduct.name || data.defaultPrice !== editingProduct.defaultPrice) { await storageService.saveProduct({ ...editingProduct, name: data.name, defaultPrice: data.defaultPrice, importPrice: data.importPrice }); }
          toast.success("Đã nhập hàng");
      } else {
          await storageService.saveProduct(data);
          if (editingProduct) { 
              setPendingProductUpdate(data); 
              setShowSyncConfirm(true); 
          } else { 
              toast.success('Đã tạo hàng mới'); 
          }
      }
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

  const confirmDelete = async () => { if (deleteId) { await storageService.deleteProduct(deleteId); toast.success('Đã xóa'); setShowDeleteConfirm(false); } };

  // Handler to switch to editing an existing product found via duplicate check
  const handleSwitchToEdit = (existingProduct: Product) => {
      setEditingProduct(existingProduct);
      setEditMode('SET'); // Switch to SET mode so user can see/edit details
      // No need to set showProductModal true because it's already open, but editingProduct change will trigger effect
  };

  return (
    <div className="max-w-7xl mx-auto pb-24 animate-fade-in relative">
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md shadow-sm border-b border-gray-200 p-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <h2 className="text-2xl font-black tracking-tighter text-gray-800 uppercase shrink-0">Kho Hàng <span className="text-eco-600">Vivid</span></h2>
              <div className="flex items-center gap-3">
                  <div className="relative flex-grow md:w-64">
                      <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Tìm tên hàng..." className="w-full pl-8 pr-3 py-2.5 bg-white border-2 border-gray-800 rounded-xl text-xs font-black outline-none text-gray-800" />
                      <i className="fas fa-search absolute left-3 top-3.5 text-gray-400 text-xs"></i>
                  </div>
                  <button onClick={() => { setEditingProduct(null); setEditMode('SET'); setShowProductModal(true); }} className="bg-black text-white px-5 py-3 rounded-2xl font-black text-xs shadow-xl hover:bg-gray-800 transition-all active:scale-95 uppercase tracking-widest shrink-0">+ Tạo mặt hàng</button>
              </div>
          </div>
          <div className="flex gap-2 overflow-x-auto no-scrollbar mt-3 pb-1">
              <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full text-[10px] font-black uppercase"><span className="text-gray-400">Vốn tồn:</span><span className="text-blue-600">{new Intl.NumberFormat('vi-VN').format(stats.capital)}đ</span></div>
              <div className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 px-3 py-1.5 rounded-full text-[10px] font-black uppercase"><span className="text-gray-400">Lãi dự kiến:</span><span className="text-green-600">{new Intl.NumberFormat('vi-VN').format(stats.profit)}đ</span></div>
              <div className="flex items-center gap-1.5 bg-red-50 border border-red-100 px-3 py-1.5 rounded-full text-[10px] font-black uppercase"><span className="text-red-400">Sắp hết:</span><span className="text-red-600">{stats.low} sp</span></div>
          </div>
      </div>

      <div className="px-3 sm:px-4 py-6">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredProducts.map(p => {
                  const current = p.stockQuantity || 0; const isLow = current < 5;
                  return (
                      <div key={p.id} onClick={() => setViewingProduct(p)} className="bg-white rounded-3xl border-2 border-gray-100 shadow-sm hover:border-gray-800 hover:shadow-xl hover:-translate-y-1 cursor-pointer transition-all duration-300 overflow-hidden flex flex-col group relative">
                          <div className="p-4 flex-grow">
                              <h3 className="text-xs font-black text-gray-800 uppercase leading-snug line-clamp-2 h-8 group-hover:text-blue-600 transition-colors" title={p.name}>{p.name}</h3>
                              <div className="mt-4 flex justify-between items-end">
                                  <span className={`text-4xl font-black tracking-tighter ${isLow ? 'text-red-600' : 'text-gray-900'}`}>{current}</span>
                                  <div className="text-right"><span className="text-[8px] font-black text-gray-400 uppercase block leading-none mb-1">Giá Bán</span><span className="text-sm font-black text-blue-600 leading-none">{new Intl.NumberFormat('vi-VN').format(p.defaultPrice)}đ</span></div>
                              </div>
                          </div>
                          <div className="bg-gray-50 border-t-2 border-gray-100 px-4 py-3 flex justify-between items-center group-hover:bg-gray-100 transition-colors">
                              <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Chi tiết <i className="fas fa-arrow-right ml-1"></i></span>
                              <div className={`w-2 h-2 rounded-full ${isLow ? 'bg-red-500 animate-pulse' : 'bg-green-500'}`}></div>
                          </div>
                      </div>
                  );
              })}
          </div>
      </div>

      {viewingProduct && <ProductDetailModal isOpen={!!viewingProduct} onClose={() => setViewingProduct(null)} product={viewingProduct} onImport={() => { setEditingProduct(viewingProduct); setEditMode('IMPORT'); setViewingProduct(null); setShowProductModal(true); }} onAdjust={() => { setEditingProduct(viewingProduct); setEditMode('SET'); setViewingProduct(null); setShowProductModal(true); }} onDelete={() => { setDeleteId(viewingProduct.id); setShowDeleteConfirm(true); setViewingProduct(null); }} />}
      
      <ProductEditModal 
        isOpen={showProductModal} 
        onClose={() => setShowProductModal(false)} 
        product={editingProduct} 
        onSave={handleSaveProduct} 
        initialMode={editMode} 
        allProducts={products}
        onSwitchToProduct={handleSwitchToEdit}
      />
      
      <ConfirmModal isOpen={showDeleteConfirm} title="Xóa mặt hàng?" message="Sản phẩm sẽ bị xóa vĩnh viễn khỏi kho." onConfirm={confirmDelete} onCancel={() => setShowDeleteConfirm(false)} confirmLabel="Xóa" isDanger={true} />
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

export default InventoryManager;
