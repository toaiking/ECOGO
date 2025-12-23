
import React, { useEffect, useState, useMemo } from 'react';
import { Order, OrderStatus } from '../types';
import { storageService } from '../services/storageService';
import toast from 'react-hot-toast';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

interface BatchStats {
    id: string;
    date: number;
    orderCount: number;
    revenue: number;
    cost: number;
    profit: number;
}

const RevenueReport: React.FC<Props> = ({ isOpen, onClose }) => {
    const [loading, setLoading] = useState(false);
    const [orders, setOrders] = useState<Order[]>([]);
    
    // FETCH DATA
    useEffect(() => {
        if (isOpen) {
            setLoading(true);
            storageService.fetchLongTermStats()
                .then(data => {
                    setOrders(data);
                })
                .catch(err => {
                    toast.error("Lỗi tải báo cáo: " + err.message);
                })
                .finally(() => setLoading(false));
        }
    }, [isOpen]);

    // --- CALCULATIONS ---
    const stats = useMemo(() => {
        const monthlyData: Record<string, number> = {};
        const batchDataMap: Record<string, BatchStats> = {};
        
        let totalRevenue = 0;
        let totalProfit = 0;

        orders.forEach(o => {
            if (o.status === OrderStatus.CANCELLED) return;

            // 1. Monthly (YYYY-MM)
            const date = new Date(o.createdAt);
            const monthKey = `${date.getMonth() + 1}/${date.getFullYear()}`;
            monthlyData[monthKey] = (monthlyData[monthKey] || 0) + o.totalPrice;

            // 2. Batch Logic
            const batchId = o.batchId || 'Không Lô';
            if (!batchDataMap[batchId]) {
                batchDataMap[batchId] = {
                    id: batchId,
                    date: o.createdAt,
                    orderCount: 0,
                    revenue: 0,
                    cost: 0,
                    profit: 0
                };
            }
            
            // Calc Profit for this order
            let orderCost = 0;
            o.items.forEach(item => {
                const cost = item.importPrice || 0;
                orderCost += cost * item.quantity;
            });
            
            const orderProfit = o.totalPrice - orderCost;

            // Update Batch Stats
            batchDataMap[batchId].orderCount += 1;
            batchDataMap[batchId].revenue += o.totalPrice;
            batchDataMap[batchId].cost += orderCost;
            batchDataMap[batchId].profit += orderProfit;
            // Update timestamp to latest order in batch
            batchDataMap[batchId].date = Math.max(batchDataMap[batchId].date, o.createdAt);

            totalRevenue += o.totalPrice;
            totalProfit += orderProfit;
        });

        // Convert Monthly Data to Array (Last 12 months sorted)
        const monthlyLabels = Object.keys(monthlyData).sort((a,b) => {
            const [mA, yA] = a.split('/').map(Number);
            const [mB, yB] = b.split('/').map(Number);
            return (yA - yB) || (mA - mB);
        });
        const monthlyValues = monthlyLabels.map(k => monthlyData[k]);

        // Convert Batch Data to Array (Sorted by Date Desc)
        const batchList = Object.values(batchDataMap).sort((a, b) => b.date - a.date);

        return {
            monthlyLabels,
            monthlyValues,
            batchList,
            totalRevenue,
            totalProfit,
            margin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0
        };
    }, [orders]);

    // --- CHART HELPERS ---
    const maxMonthly = Math.max(...stats.monthlyValues, 1);
    
    // Simple Pie Chart Data (Top 5 Batches by Revenue)
    const pieBatches = stats.batchList.slice(0, 5);
    const otherRevenue = stats.batchList.slice(5).reduce((sum, b) => sum + b.revenue, 0);
    if (otherRevenue > 0) {
        pieBatches.push({ id: 'Khác', revenue: otherRevenue } as any);
    }
    
    // Generate Conic Gradient for Pie Chart
    let currentAngle = 0;
    const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#9ca3af'];
    const gradientParts = pieBatches.map((b, idx) => {
        const percent = (b.revenue / stats.totalRevenue) * 100;
        const start = currentAngle;
        currentAngle += percent;
        return `${colors[idx % colors.length]} ${start}% ${currentAngle}%`;
    });
    const pieStyle = { background: `conic-gradient(${gradientParts.join(', ')})` };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-gray-50 flex flex-col animate-fade-in overflow-hidden">
            {/* Header */}
            <div className="bg-white border-b border-gray-200 px-6 py-4 flex justify-between items-center shadow-sm">
                <div>
                    <h2 className="text-xl font-black text-gray-800 flex items-center gap-2">
                        <i className="fas fa-chart-line text-blue-600"></i> Báo Cáo Hiệu Suất
                    </h2>
                    <p className="text-xs text-gray-500">Dữ liệu 12 tháng gần nhất (Đơn đã giao)</p>
                </div>
                <button onClick={onClose} className="w-10 h-10 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors">
                    <i className="fas fa-times text-gray-600"></i>
                </button>
            </div>

            {/* Content */}
            <div className="flex-grow overflow-y-auto p-4 sm:p-6 space-y-6">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64">
                        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
                        <span className="mt-4 text-sm font-bold text-gray-500">Đang tổng hợp dữ liệu...</span>
                    </div>
                ) : (
                    <>
                        {/* Summary Cards */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                                <div className="text-xs text-gray-400 font-bold uppercase mb-1">Tổng Doanh Thu</div>
                                <div className="text-2xl font-black text-blue-600">{new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(stats.totalRevenue)}</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                                <div className="text-xs text-gray-400 font-bold uppercase mb-1">Lợi Nhuận Gộp</div>
                                <div className="text-2xl font-black text-green-600">{new Intl.NumberFormat('vi-VN', { notation: "compact" }).format(stats.totalProfit)}</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                                <div className="text-xs text-gray-400 font-bold uppercase mb-1">% Lợi Nhuận</div>
                                <div className="text-2xl font-black text-purple-600">{stats.margin.toFixed(1)}%</div>
                            </div>
                            <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100">
                                <div className="text-xs text-gray-400 font-bold uppercase mb-1">Số Lô Hàng</div>
                                <div className="text-2xl font-black text-gray-800">{stats.batchList.length}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Monthly Chart */}
                            <div className="lg:col-span-2 bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                                <h3 className="font-bold text-gray-800 mb-6">Doanh Thu Theo Tháng</h3>
                                <div className="flex items-end gap-2 h-48 w-full overflow-x-auto pb-2">
                                    {stats.monthlyValues.map((val, idx) => (
                                        <div key={idx} className="flex flex-col items-center flex-1 min-w-[40px] group">
                                            <div className="relative w-full flex justify-center items-end h-full">
                                                <div 
                                                    className="w-full bg-blue-100 hover:bg-blue-500 transition-all rounded-t-md relative group-hover:shadow-lg"
                                                    style={{ height: `${(val / maxMonthly) * 100}%` }}
                                                >
                                                    <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-black text-white text-[10px] px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-10 pointer-events-none font-bold">
                                                        {new Intl.NumberFormat('vi-VN').format(val)}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-gray-400 font-bold mt-2 rotate-0 sm:rotate-0 truncate w-full text-center">
                                                {stats.monthlyLabels[idx]}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Batch Distribution (Pie) */}
                            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col items-center justify-center">
                                <h3 className="font-bold text-gray-800 mb-6 w-full text-left">Tỷ Trọng Doanh Thu (Top Lô)</h3>
                                <div className="w-40 h-40 rounded-full shadow-inner relative" style={pieStyle}>
                                    <div className="absolute inset-8 bg-white rounded-full flex items-center justify-center shadow-sm">
                                        <span className="text-xs font-bold text-gray-400">Total</span>
                                    </div>
                                </div>
                                <div className="mt-6 w-full space-y-2">
                                    {pieBatches.map((b, idx) => (
                                        <div key={b.id} className="flex justify-between items-center text-xs">
                                            <div className="flex items-center gap-2">
                                                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[idx % colors.length] }}></div>
                                                <span className="font-medium text-gray-600 truncate max-w-[100px]">{b.id}</span>
                                            </div>
                                            <span className="font-bold text-gray-800">{((b.revenue / stats.totalRevenue) * 100).toFixed(1)}%</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Detailed Batch Table */}
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                            <div className="p-5 border-b border-gray-100">
                                <h3 className="font-bold text-gray-800">Chi Tiết Hiệu Quả Từng Lô</h3>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead className="bg-gray-50 text-gray-500 font-bold text-[10px] uppercase tracking-wider">
                                        <tr>
                                            <th className="p-4">Tên Lô</th>
                                            <th className="p-4 text-center">Ngày nhập</th>
                                            <th className="p-4 text-center">Đã bán</th>
                                            <th className="p-4 text-right">Doanh thu</th>
                                            <th className="p-4 text-right hidden sm:table-cell">Giá vốn</th>
                                            <th className="p-4 text-right">Lợi nhuận</th>
                                            <th className="p-4 text-right hidden sm:table-cell">% Margin</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50 text-sm">
                                        {stats.batchList.map(batch => {
                                            const margin = batch.revenue > 0 ? (batch.profit / batch.revenue) * 100 : 0;
                                            return (
                                                <tr key={batch.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="p-4 font-bold text-gray-800">{batch.id}</td>
                                                    <td className="p-4 text-center text-gray-500 text-xs">{new Date(batch.date).toLocaleDateString('vi-VN')}</td>
                                                    <td className="p-4 text-center font-medium">{batch.orderCount} đơn</td>
                                                    <td className="p-4 text-right font-bold text-blue-600">{new Intl.NumberFormat('vi-VN').format(batch.revenue)}</td>
                                                    <td className="p-4 text-right text-gray-500 hidden sm:table-cell">{new Intl.NumberFormat('vi-VN').format(batch.cost)}</td>
                                                    <td className="p-4 text-right font-bold text-green-600">{new Intl.NumberFormat('vi-VN').format(batch.profit)}</td>
                                                    <td className="p-4 text-right font-bold hidden sm:table-cell">
                                                        <span className={`px-2 py-1 rounded text-xs ${margin > 20 ? 'bg-green-100 text-green-700' : margin > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                                                            {margin.toFixed(1)}%
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default RevenueReport;
