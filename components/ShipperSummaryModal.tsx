
import React, { useMemo, useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { storageService, normalizePhone, normalizeString } from '../services/storageService';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    orders: Order[];
    batchName: string;
}

interface Expense {
    id: string;
    name: string;
    amount: number;
}

const ShipperSummaryModal: React.FC<Props> = ({ isOpen, onClose, orders, batchName }) => {
    // Expense State
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [newExpenseName, setNewExpenseName] = useState('');
    const [newExpenseAmount, setNewExpenseAmount] = useState('');
    // Auto-fill with current logged-in user
    const [shipperName, setShipperName] = useState(() => storageService.getCurrentUser() || '');
    const [shopHotline, setShopHotline] = useState('');

    // Storage Key for persisting expenses per batch
    const storageKey = useMemo(() => `ecogo_expenses_${normalizeString(batchName)}`, [batchName]);

    useEffect(() => {
        if (isOpen) {
            storageService.getShopConfig().then(config => {
                if (config?.hotline) {
                    setShopHotline(config.hotline);
                }
            });

            // Load saved expenses for this batch
            try {
                const saved = localStorage.getItem(storageKey);
                if (saved) {
                    setExpenses(JSON.parse(saved));
                } else {
                    setExpenses([]);
                }
            } catch (e) {
                console.error("Error loading expenses", e);
            }
        }
    }, [isOpen, storageKey]);

    // Save expenses whenever they change
    useEffect(() => {
        if (isOpen) {
            localStorage.setItem(storageKey, JSON.stringify(expenses));
        }
    }, [expenses, isOpen, storageKey]);

    const stats = useMemo(() => {
        let totalCashCollected = 0; // Tiền mặt thực thu (Đã giao)
        let totalTransferDelivered = 0; // CK Đã giao
        let pendingCash = 0; // Tiền mặt dự kiến thu (Chưa giao)
        
        let countDelivered = 0;
        let countPending = 0;
        let countCancelled = 0;

        const cashOrders: Order[] = []; // List đơn thu tiền mặt đã giao

        orders.forEach(o => {
            if (o.status === OrderStatus.CANCELLED) {
                countCancelled++;
                return;
            }

            if (o.status === OrderStatus.DELIVERED) {
                countDelivered++;
                if (o.paymentMethod === PaymentMethod.CASH) {
                    totalCashCollected += o.totalPrice;
                    cashOrders.push(o);
                } else {
                    totalTransferDelivered += o.totalPrice;
                }
            } else {
                // Pending, Picked_up, In_transit
                countPending++;
                if (o.paymentMethod === PaymentMethod.CASH) {
                    pendingCash += o.totalPrice;
                }
            }
        });

        return {
            totalOrders: orders.length,
            countDelivered,
            countPending,
            countCancelled,
            totalCashCollected,
            totalTransferDelivered,
            pendingCash,
            cashOrders
        };
    }, [orders]);

    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const finalRemitAmount = stats.totalCashCollected - totalExpenses;

    const handleAddExpense = () => {
        if (!newExpenseName || !newExpenseAmount) return;
        const amount = parseFloat(newExpenseAmount.replace(/[^0-9]/g, ''));
        if (amount > 0) {
            setExpenses(prev => [...prev, { id: uuidv4(), name: newExpenseName, amount }]);
            setNewExpenseName('');
            setNewExpenseAmount('');
            toast.success('Đã thêm khoản chi');
        }
    };

    const handleRemoveExpense = (id: string) => {
        setExpenses(prev => prev.filter(e => e.id !== id));
    };

    const getReportText = () => {
        const date = new Date().toLocaleDateString('vi-VN');
        let text = `📅 TỔNG KẾT CA: ${batchName} (${date})\n`;
        if (shipperName.trim()) {
            text += `👤 Shipper: ${shipperName.toUpperCase()}\n`;
        }
        text += `--------------------------------\n`;
        text += `✅ Đã giao: ${stats.countDelivered}/${stats.totalOrders} đơn\n`;
        text += `⚠️ Còn lại: ${stats.countPending} đơn\n`;
        text += `--------------------------------\n`;
        text += `💵 TIỀN MẶT THU: ${new Intl.NumberFormat('vi-VN').format(stats.totalCashCollected)}đ\n`;
        
        if (totalExpenses > 0) {
            text += `🔻 TRỪ CHI PHÍ: -${new Intl.NumberFormat('vi-VN').format(totalExpenses)}đ\n`;
            expenses.forEach(e => {
                text += `   - ${e.name}: ${new Intl.NumberFormat('vi-VN').format(e.amount)}\n`;
            });
            text += `--------------------------------\n`;
            text += `💰 THỰC NỘP VỀ: ${new Intl.NumberFormat('vi-VN').format(finalRemitAmount)}đ\n`;
        }

        if (stats.totalTransferDelivered > 0) {
            text += `💳 Chuyển khoản (Đã giao): ${new Intl.NumberFormat('vi-VN').format(stats.totalTransferDelivered)}đ\n`;
        }
        
        if (stats.pendingCash > 0) {
            text += `⏳ Dự thu còn lại: ${new Intl.NumberFormat('vi-VN').format(stats.pendingCash)}đ\n`;
        }
        
        text += `--------------------------------\n`;
        text += `Chi tiết thu tiền mặt (${stats.cashOrders.length} đơn):\n`;
        stats.cashOrders.forEach(o => {
            text += `- ${o.customerName}: ${new Intl.NumberFormat('vi-VN').format(o.totalPrice)}\n`;
        });
        return text;
    };

    const handleCopyReport = () => {
        const text = getReportText();
        navigator.clipboard.writeText(text);
        toast.success("Đã copy báo cáo!");
    };

    const handleSendZalo = async () => {
        if (!shopHotline) {
            toast.error("Chưa cấu hình Hotline Shop trong Cài đặt");
            return;
        }

        const text = getReportText();
        
        try {
            await navigator.clipboard.writeText(text);
            
            // Zalo URL scheme
            const cleanPhone = normalizePhone(shopHotline).replace(/^0/, '84');
            const url = `https://zalo.me/${cleanPhone}`;
            
            toast.success("Đã copy! Mở Zalo và chọn 'Dán' nhé.", { 
                duration: 4000, 
                icon: '📋',
                style: { borderRadius: '12px', background: '#333', color: '#fff', fontWeight: 'bold' } 
            });
            
            setTimeout(() => {
                window.open(url, '_blank');
            }, 800);
        } catch (err) {
            toast.error("Không thể copy tự động. Hãy dùng nút Copy thủ công.");
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-gray-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-[2rem] shadow-2xl w-full max-w-md overflow-hidden border-4 border-gray-900 flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="p-5 bg-gray-50 border-b border-gray-200 flex justify-between items-center shrink-0">
                    <div>
                        <h2 className="text-xl font-black text-gray-900 uppercase italic tracking-tighter">Tổng kết cuối ngày</h2>
                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">{batchName}</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-xl bg-white border-2 border-gray-900 text-gray-400 hover:text-red-500 flex items-center justify-center transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:shadow-none active:translate-x-[2px] active:translate-y-[2px]">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="flex-grow overflow-y-auto p-5 space-y-5 bg-white">
                    
                    {/* Shipper Name Input */}
                    <div>
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1 mb-1 block">Tên Shipper phụ trách</label>
                        <input
                            value={shipperName}
                            onChange={(e) => setShipperName(e.target.value)}
                            placeholder="Nhập tên shipper..."
                            className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 text-sm outline-none focus:border-gray-900 transition-colors uppercase"
                        />
                    </div>

                    {/* Big Numbers Card (Net Return) */}
                    <div className="bg-emerald-600 text-white rounded-2xl p-5 border-2 border-emerald-700 shadow-lg relative overflow-hidden">
                        <div className="relative z-10 text-center">
                            <div className="text-[10px] font-black uppercase tracking-widest opacity-80 mb-1">
                                {totalExpenses > 0 ? 'Thực nộp về Shop (Sau khi trừ phí)' : 'Tổng tiền mặt đang giữ'}
                            </div>
                            <div className="text-4xl font-black tracking-tighter leading-none mb-2">
                                {new Intl.NumberFormat('vi-VN').format(finalRemitAmount)}<span className="text-lg align-top ml-1">đ</span>
                            </div>
                            <div className="text-xs font-bold opacity-90 flex justify-center items-center gap-1">
                                <span>Thu: {new Intl.NumberFormat('vi-VN').format(stats.totalCashCollected)}</span>
                                {totalExpenses > 0 && <span> - Chi: {new Intl.NumberFormat('vi-VN').format(totalExpenses)}</span>}
                            </div>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-tr from-emerald-800/50 to-transparent"></div>
                        <i className="fas fa-wallet absolute -bottom-4 -left-4 text-8xl text-white opacity-10 rotate-12"></i>
                    </div>

                    {/* Progress Stats */}
                    <div className="grid grid-cols-3 gap-3">
                        <div className="bg-blue-50 p-3 rounded-2xl border border-blue-100 text-center">
                            <div className="text-2xl font-black text-blue-600">{stats.countDelivered}</div>
                            <div className="text-[9px] font-bold text-blue-400 uppercase">Đã giao</div>
                        </div>
                        <div className="bg-orange-50 p-3 rounded-2xl border border-orange-100 text-center">
                            <div className="text-2xl font-black text-orange-600">{stats.countPending}</div>
                            <div className="text-[9px] font-bold text-orange-400 uppercase">Còn lại</div>
                        </div>
                        <div className="bg-gray-100 p-3 rounded-2xl border border-gray-200 text-center">
                            <div className="text-2xl font-black text-gray-600">{stats.totalOrders}</div>
                            <div className="text-[9px] font-bold text-gray-400 uppercase">Tổng đơn</div>
                        </div>
                    </div>

                    {/* Expenses Section (New Feature) */}
                    <div className="bg-red-50/50 rounded-2xl border-2 border-red-100 p-4">
                        <h3 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                            <i className="fas fa-gas-pump"></i> Chi phí phát sinh (Trừ lương)
                        </h3>
                        
                        {/* Expense List */}
                        {expenses.length > 0 && (
                            <div className="space-y-2 mb-3">
                                {expenses.map(e => (
                                    <div key={e.id} className="flex justify-between items-center bg-white p-2 rounded-lg border border-red-50 shadow-sm">
                                        <span className="text-xs font-bold text-gray-700">{e.name}</span>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-black text-red-600">-{new Intl.NumberFormat('vi-VN').format(e.amount)}</span>
                                            <button onClick={() => handleRemoveExpense(e.id)} className="text-gray-400 hover:text-red-500"><i className="fas fa-times-circle"></i></button>
                                        </div>
                                    </div>
                                ))}
                                <div className="border-t border-red-200 my-2"></div>
                            </div>
                        )}

                        {/* Add Expense Form */}
                        <div className="flex gap-2">
                            <input 
                                value={newExpenseName}
                                onChange={e => setNewExpenseName(e.target.value)}
                                placeholder="Tên khoản chi (VD: Xăng)"
                                className="flex-grow w-full p-2 bg-white border border-red-100 rounded-lg text-xs font-bold outline-none focus:border-red-400 placeholder-red-200 text-red-900"
                            />
                            <input 
                                type="number"
                                value={newExpenseAmount}
                                onChange={e => setNewExpenseAmount(e.target.value)}
                                placeholder="Số tiền"
                                className="w-24 p-2 bg-white border border-red-100 rounded-lg text-xs font-bold outline-none focus:border-red-400 text-right placeholder-red-200 text-red-900"
                            />
                            <button 
                                onClick={handleAddExpense}
                                disabled={!newExpenseName || !newExpenseAmount}
                                className="w-8 h-8 flex items-center justify-center bg-red-500 text-white rounded-lg shadow-sm hover:bg-red-600 disabled:bg-gray-300 transition-colors"
                            >
                                <i className="fas fa-plus"></i>
                            </button>
                        </div>
                    </div>

                    {/* Additional Financials */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center p-3 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center"><i className="fas fa-university"></i></div>
                                <span className="text-xs font-bold text-gray-600 uppercase">Đã chuyển khoản</span>
                            </div>
                            <span className="font-black text-gray-900">{new Intl.NumberFormat('vi-VN').format(stats.totalTransferDelivered)}đ</span>
                        </div>
                        
                        {stats.pendingCash > 0 && (
                            <div className="flex justify-between items-center p-3 bg-orange-50/50 rounded-xl border border-orange-100 border-dashed">
                                <div className="flex items-center gap-3">
                                    <div className="w-8 h-8 rounded-lg bg-orange-100 text-orange-600 flex items-center justify-center"><i className="fas fa-hourglass-half"></i></div>
                                    <span className="text-xs font-bold text-gray-600 uppercase">Dự thu còn lại</span>
                                </div>
                                <span className="font-black text-orange-600">{new Intl.NumberFormat('vi-VN').format(stats.pendingCash)}đ</span>
                            </div>
                        )}
                    </div>

                    {/* Cash Order List */}
                    {stats.cashOrders.length > 0 && (
                        <div>
                            <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 ml-1">Chi tiết thu tiền mặt</h3>
                            <div className="max-h-40 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/50 p-2 space-y-1">
                                {stats.cashOrders.map(o => (
                                    <div key={o.id} className="flex justify-between text-xs p-2 bg-white rounded-lg shadow-sm">
                                        <span className="font-bold text-gray-700 truncate mr-2">{o.customerName}</span>
                                        <span className="font-black text-emerald-600 whitespace-nowrap">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Action */}
                <div className="p-4 bg-white border-t-2 border-gray-100 shrink-0 flex gap-3">
                    {shopHotline && (
                        <button 
                            onClick={handleSendZalo}
                            className="w-16 rounded-2xl bg-blue-600 text-white font-black text-xl shadow-lg shadow-blue-200 active:scale-95 transition-all flex items-center justify-center border-2 border-blue-700 hover:bg-blue-700"
                            title={`Gửi qua Zalo: ${shopHotline}`}
                        >
                            <span className="font-sans">Z</span>
                        </button>
                    )}
                    <button 
                        onClick={handleCopyReport}
                        className="flex-grow py-4 bg-gray-900 text-white rounded-2xl font-black uppercase tracking-widest shadow-lg shadow-gray-200 active:bg-black active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                        <i className="fas fa-copy"></i> Copy Báo Cáo
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShipperSummaryModal;
