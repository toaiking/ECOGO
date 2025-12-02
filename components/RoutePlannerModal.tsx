
import React, { useState, useEffect } from 'react';
import { Order } from '../types';
import { routeService } from '../services/routeService';
import toast from 'react-hot-toast';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    orders: Order[];
    onApplySort: (sortedOrders: Order[]) => void;
}

const RoutePlannerModal: React.FC<Props> = ({ isOpen, onClose, orders, onApplySort }) => {
    const [groupedData, setGroupedData] = useState<{ name: string, orders: Order[] }[]>([]);
    const [sortedList, setSortedList] = useState<Order[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (isOpen && orders.length > 0) {
            setIsProcessing(true);
            // Simulate processing delay for UI feedback
            setTimeout(() => {
                const groups = routeService.groupOrdersByZone(orders);
                const flattened = groups.flatMap(g => g.orders);
                
                setGroupedData(groups);
                setSortedList(flattened);
                setIsProcessing(false);
            }, 100);
        }
    }, [isOpen, orders]);

    const handleApply = () => {
        onApplySort(sortedList);
        onClose();
        toast.success("Đã cập nhật lộ trình mới!");
    };

    const handleCopyText = () => {
        const text = routeService.generateRouteText(sortedList);
        navigator.clipboard.writeText(text);
        toast.success("Đã copy lộ trình vào bộ nhớ tạm");
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50 rounded-t-2xl">
                    <div>
                        <h2 className="text-xl font-black text-gray-800 flex items-center gap-2">
                            <i className="fas fa-map-marked-alt text-blue-600"></i> Lộ Trình Thông Minh
                        </h2>
                        <p className="text-xs text-gray-500 mt-1">Tự động sắp xếp {orders.length} đơn hàng theo tuyến đường tối ưu</p>
                    </div>
                    <button onClick={onClose} className="w-9 h-9 rounded-full bg-white hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-grow overflow-hidden flex flex-col md:flex-row">
                    
                    {/* Left Col: Summary */}
                    <div className="md:w-1/3 bg-gray-50 p-4 overflow-y-auto border-r border-gray-100">
                        <h3 className="text-xs font-bold text-gray-400 uppercase mb-3">Tổng quan tuyến đường</h3>
                        {isProcessing ? (
                            <div className="text-center py-10 text-gray-400">
                                <i className="fas fa-circle-notch fa-spin text-2xl mb-2"></i>
                                <p>Đang tính toán...</p>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {groupedData.map((g, idx) => (
                                    <div key={idx} className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center hover:border-blue-300 transition-colors">
                                        <div className="flex items-center gap-2 overflow-hidden">
                                            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-bold flex items-center justify-center flex-shrink-0">
                                                {idx + 1}
                                            </div>
                                            <span className="text-sm font-bold text-gray-700 truncate" title={g.name}>{g.name}</span>
                                        </div>
                                        <span className="text-xs font-bold bg-gray-100 px-2 py-1 rounded-md text-gray-600">{g.orders.length} đơn</span>
                                    </div>
                                ))}
                                {groupedData.length === 0 && <p className="text-sm text-gray-400 text-center">Không có dữ liệu</p>}
                            </div>
                        )}
                    </div>

                    {/* Right Col: Detail List */}
                    <div className="md:w-2/3 p-4 overflow-y-auto bg-white">
                        <h3 className="text-xs font-bold text-gray-400 uppercase mb-3">Chi tiết thứ tự giao</h3>
                        <div className="space-y-4">
                            {groupedData.map((g, gIdx) => (
                                <div key={gIdx}>
                                    <div className="sticky top-0 bg-blue-50/95 backdrop-blur px-3 py-2 rounded-lg mb-2 flex items-center gap-2 border border-blue-100 z-10">
                                        <i className="fas fa-map-pin text-blue-500"></i>
                                        <span className="text-sm font-bold text-blue-800">{g.name}</span>
                                    </div>
                                    <div className="space-y-2 pl-2 border-l-2 border-gray-100 ml-3">
                                        {g.orders.map((o, oIdx) => (
                                            <div key={o.id} className="bg-white p-3 rounded-lg border border-gray-100 hover:shadow-md transition-shadow relative group">
                                                <div className="absolute -left-[19px] top-3 w-3 h-3 bg-gray-200 rounded-full border-2 border-white"></div>
                                                <div className="flex justify-between items-start">
                                                    <div>
                                                        <div className="font-bold text-sm text-gray-800">{o.customerName}</div>
                                                        <div className="text-xs text-gray-500 mt-0.5">{o.address}</div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="font-mono text-xs text-gray-400">{o.customerPhone}</div>
                                                        <div className="font-bold text-xs text-blue-600 mt-1">{new Intl.NumberFormat('vi-VN').format(o.totalPrice)}đ</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-100 flex justify-between items-center bg-gray-50 rounded-b-2xl">
                    <button 
                        onClick={handleCopyText}
                        className="px-4 py-2 bg-white border border-gray-200 text-gray-700 font-bold rounded-xl hover:bg-gray-50 hover:text-blue-600 transition-colors shadow-sm flex items-center gap-2"
                    >
                        <i className="fas fa-copy"></i> Copy List Zalo
                    </button>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-5 py-2 text-gray-500 font-bold hover:text-gray-700">Hủy</button>
                        <button 
                            onClick={handleApply}
                            className="px-6 py-2 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-200 hover:bg-blue-700 transition-transform active:scale-95 flex items-center gap-2"
                        >
                            <i className="fas fa-check"></i> Áp Dụng Sắp Xếp
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RoutePlannerModal;
