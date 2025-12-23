
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
    const [sortedList, setSortedList] = useState<Order[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);

    useEffect(() => {
        if (isOpen && orders.length > 0) {
            setIsProcessing(true);
            // Giả lập xử lý để tạo hiệu ứng mượt mà cho UI
            setTimeout(() => {
                const groups = routeService.groupOrdersByZone(orders);
                const flattened = groups.flatMap(g => g.orders);
                setSortedList(flattened);
                setIsProcessing(false);
            }, 300);
        }
    }, [isOpen, orders]);

    // Tính năng sắp xếp thủ công
    const moveItem = (index: number, direction: 'up' | 'down') => {
        const newList = [...sortedList];
        const targetIndex = direction === 'up' ? index - 1 : index + 1;
        
        if (targetIndex < 0 || targetIndex >= newList.length) return;
        
        const temp = newList[index];
        newList[index] = newList[targetIndex];
        newList[targetIndex] = temp;
        
        setSortedList(newList);
        // Phản hồi rung nhẹ trên di động nếu trình duyệt hỗ trợ
        if (navigator.vibrate) navigator.vibrate(30);
    };

    const handleApply = () => {
        onApplySort(sortedList);
        onClose();
        toast.success("Đã cập nhật thứ tự lộ trình mới!");
    };

    const handleCopyText = () => {
        const text = routeService.generateRouteText(sortedList);
        navigator.clipboard.writeText(text);
        toast.success("Đã copy lộ trình cho Shipper");
    };

    if (!isOpen) return null;

    // Grouping để hiển thị theo Zone trực quan
    const zones = routeService.groupOrdersByZone(sortedList);

    return (
        <div className="fixed inset-0 z-[100] bg-gray-900/70 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-4xl flex flex-col max-h-[95vh] overflow-hidden border-4 border-gray-900">
                
                {/* Header: Thanh công cụ */}
                <div className="p-5 border-b-4 border-gray-900 flex justify-between items-center bg-blue-50">
                    <div>
                        <h2 className="text-xl font-black text-gray-900 flex items-center gap-2 uppercase italic tracking-tighter">
                            <i className="fas fa-route text-blue-600"></i> Lộ trình Shipper
                        </h2>
                        <p className="text-[10px] font-black text-blue-600 uppercase tracking-widest mt-0.5">Tối ưu cho {sortedList.length} điểm dừng</p>
                    </div>
                    <button onClick={onClose} className="w-10 h-10 rounded-2xl bg-white border-2 border-gray-900 text-gray-400 hover:text-red-500 flex items-center justify-center transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                {/* Content: Timeline List */}
                <div className="flex-grow overflow-y-auto bg-gray-50/50 p-4 sm:p-8 no-scrollbar">
                    {isProcessing ? (
                        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
                            <div className="w-12 h-12 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
                            <p className="font-black uppercase text-xs tracking-widest">Đang tính toán tuyến đường...</p>
                        </div>
                    ) : (
                        <div className="space-y-10 relative">
                            {/* Vertical line connecting stops */}
                            <div className="absolute left-[19px] top-8 bottom-8 w-1 bg-gray-200 rounded-full"></div>

                            {zones.map((zone, zIdx) => (
                                <div key={zone.name} className="relative z-10">
                                    {/* Zone Divider Badge */}
                                    <div className="flex items-center gap-3 mb-6">
                                        <div className="w-10 h-10 rounded-2xl bg-gray-900 text-white flex items-center justify-center text-xs font-black shadow-lg border-2 border-white ring-4 ring-gray-100">
                                            <i className="fas fa-map-marker-alt"></i>
                                        </div>
                                        <div className="bg-white px-4 py-2 rounded-xl border-2 border-gray-900 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
                                            <span className="text-xs font-black text-gray-800 uppercase italic tracking-tight">{zone.name}</span>
                                            <span className="ml-2 text-[10px] font-bold text-gray-400">({zone.orders.length} đơn)</span>
                                        </div>
                                    </div>

                                    {/* Stop Cards in this Zone */}
                                    <div className="space-y-4 pl-10">
                                        {zone.orders.map((order) => {
                                            const globalIndex = sortedList.findIndex(o => o.id === order.id);
                                            return (
                                                <div key={order.id} className="bg-white rounded-[1.5rem] border-2 border-gray-100 p-4 shadow-sm hover:border-blue-400 transition-all group relative">
                                                    
                                                    {/* Sequence Number on the line */}
                                                    <div className="absolute -left-[37px] top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white border-2 border-gray-900 flex items-center justify-center text-[11px] font-black text-gray-900 shadow-md group-hover:bg-blue-600 group-hover:text-white group-hover:border-blue-600 transition-colors">
                                                        {globalIndex + 1}
                                                    </div>

                                                    <div className="flex justify-between items-center gap-4">
                                                        <div className="flex-grow min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <h4 className="font-black text-sm text-gray-900 uppercase truncate">{order.customerName}</h4>
                                                                <a 
                                                                    href={`tel:${order.customerPhone}`} 
                                                                    onClick={e => e.stopPropagation()} 
                                                                    className="text-[10px] font-mono font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-lg border border-blue-100 flex items-center gap-1"
                                                                >
                                                                    <i className="fas fa-phone-alt"></i> {order.customerPhone}
                                                                </a>
                                                            </div>
                                                            <p className="text-[11px] font-bold text-gray-500 leading-snug mb-3 pr-4">{order.address}</p>
                                                            
                                                            <div className="flex flex-wrap gap-2">
                                                                <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded-lg border border-gray-200">
                                                                    <i className="fas fa-box text-[9px] text-gray-400"></i>
                                                                    <span className="text-[9px] font-black text-gray-700 uppercase">{order.items.length} món</span>
                                                                </div>
                                                                
                                                                <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border font-black text-[9px] uppercase ${order.paymentMethod === 'CASH' ? 'bg-orange-50 text-orange-700 border-orange-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                                                                    <i className={`fas ${order.paymentMethod === 'CASH' ? 'fa-hand-holding-usd' : 'fa-check-circle'} text-[10px]`}></i>
                                                                    {order.paymentMethod === 'CASH' ? `Thu hộ: ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ` : 'Đã thanh toán'}
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Reorder Buttons (Always visible for ease of use) */}
                                                        <div className="flex flex-col gap-2 shrink-0">
                                                            <button 
                                                                onClick={() => moveItem(globalIndex, 'up')}
                                                                disabled={globalIndex === 0}
                                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all shadow-sm ${globalIndex === 0 ? 'bg-gray-50 border-gray-100 text-gray-200 cursor-not-allowed' : 'bg-white border-gray-200 text-gray-500 hover:border-blue-500 hover:text-blue-500 active:scale-90 active:bg-blue-50'}`}
                                                                title="Lên trên"
                                                            >
                                                                <i className="fas fa-chevron-up"></i>
                                                            </button>
                                                            <button 
                                                                onClick={() => moveItem(globalIndex, 'down')}
                                                                disabled={globalIndex === sortedList.length - 1}
                                                                className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all shadow-sm ${globalIndex === sortedList.length - 1 ? 'bg-gray-50 border-gray-100 text-gray-200 cursor-not-allowed' : 'bg-white border-gray-200 text-gray-500 hover:border-blue-500 hover:text-blue-500 active:scale-90 active:bg-blue-50'}`}
                                                                title="Xuống dưới"
                                                            >
                                                                <i className="fas fa-chevron-down"></i>
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="p-5 border-t-4 border-gray-900 flex flex-col sm:flex-row gap-4 bg-white">
                    <button 
                        onClick={handleCopyText}
                        className="flex-1 py-4 bg-gray-100 border-2 border-gray-900 text-gray-700 font-black rounded-2xl hover:bg-gray-200 transition-all flex items-center justify-center gap-3 uppercase text-[11px] tracking-widest shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                    >
                        <i className="fas fa-copy"></i> Copy cho Shipper
                    </button>
                    <button 
                        onClick={handleApply}
                        className="flex-1 py-4 bg-black text-white font-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(22,163,74,1)] hover:bg-gray-800 transition-all flex items-center justify-center gap-3 uppercase text-[11px] tracking-widest active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                    >
                        <i className="fas fa-check-circle text-eco-400"></i> Áp dụng lộ trình
                    </button>
                </div>
            </div>
        </div>
    );
};

export default RoutePlannerModal;
