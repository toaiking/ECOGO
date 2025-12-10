
import React, { useState, useEffect, useRef } from 'react';
import { Order, CarrierData, PaymentMethod } from '../types';
import { carrierService, CarrierQuote } from '../services/carrierService';
import toast from 'react-hot-toast';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    order: Order;
    onSuccess: (carrierData: CarrierData) => void;
}

const ShipmentModal: React.FC<Props> = ({ isOpen, onClose, order, onSuccess }) => {
    const [weight, setWeight] = useState(1000); // Default 1kg
    const [cod, setCod] = useState(0);
    const [selectedCarrierId, setSelectedCarrierId] = useState<string>('');
    const [quotes, setQuotes] = useState<CarrierQuote[]>([]);
    const [loadingQuotes, setLoadingQuotes] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    
    // Debounce timer for weight changes
    const debounceTimer = useRef<any>(null);

    // Initialize
    useEffect(() => {
        if (isOpen) {
            // Default COD rule: if Cash -> COD = Total, else 0
            setCod(order.paymentMethod === PaymentMethod.CASH ? order.totalPrice : 0);
            fetchQuotes(1000); // Initial fetch
        }
    }, [isOpen, order]);

    const fetchQuotes = async (w: number) => {
        setLoadingQuotes(true);
        try {
            const results = await carrierService.getQuotes(w);
            setQuotes(results);
            
            // Auto-select the Best Price by default if no selection yet
            if (results.length > 0) {
                const best = results[0]; // Already sorted by price in service
                setSelectedCarrierId(best.carrierId);
            }
        } catch (e) {
            console.error("Failed to fetch quotes", e);
            toast.error("Không tải được bảng giá");
        } finally {
            setLoadingQuotes(false);
        }
    };

    const handleWeightChange = (val: number) => {
        setWeight(val);
        // Debounce API call to avoid spamming while typing
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
        debounceTimer.current = setTimeout(() => {
            fetchQuotes(val);
        }, 600);
    };

    const handleSubmit = async () => {
        if (!selectedCarrierId) {
            toast.error("Vui lòng chọn đơn vị vận chuyển");
            return;
        }
        setIsSubmitting(true);
        try {
            const result = await carrierService.createShipment(order, selectedCarrierId, weight, cod);
            toast.success(`Đã tạo vận đơn: ${result.trackingCode}`);
            onSuccess(result);
            onClose();
        } catch (e) {
            toast.error("Lỗi tạo vận đơn");
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    const selectedQuote = quotes.find(q => q.carrierId === selectedCarrierId);

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-900/60 backdrop-blur-sm p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]">
                
                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <div>
                        <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                            <i className="fas fa-shipping-fast text-eco-600"></i> Đẩy Đơn Vận Chuyển
                        </h3>
                        <p className="text-xs text-gray-500">Đơn hàng #{order.id} • {order.customerName}</p>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center"><i className="fas fa-times"></i></button>
                </div>

                <div className="flex-grow overflow-y-auto bg-gray-50/30">
                    {/* 1. Configuration Section */}
                    <div className="p-5 bg-white border-b border-gray-100">
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Khối lượng (g)</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        value={weight} 
                                        onChange={e => handleWeightChange(Number(e.target.value))}
                                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:border-eco-500 focus:bg-white text-center"
                                    />
                                    <span className="absolute right-3 top-2.5 text-xs text-gray-400 font-medium">gram</span>
                                </div>
                            </div>
                            <div>
                                <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Tiền thu hộ (COD)</label>
                                <div className="relative">
                                    <input 
                                        type="number" 
                                        value={cod} 
                                        onChange={e => setCod(Number(e.target.value))}
                                        className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-xl font-bold text-gray-800 outline-none focus:border-eco-500 focus:bg-white text-center"
                                    />
                                    <span className="absolute right-3 top-2.5 text-xs text-gray-400 font-medium">đ</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* 2. Comparison List */}
                    <div className="p-5">
                        <h4 className="text-xs font-bold text-gray-500 uppercase mb-3 flex justify-between">
                            <span>So sánh giá ({quotes.length})</span>
                            {loadingQuotes && <span className="text-eco-600 animate-pulse"><i className="fas fa-sync fa-spin"></i> Đang tính...</span>}
                        </h4>
                        
                        <div className="space-y-2">
                            {quotes.map((quote) => (
                                <div 
                                    key={quote.carrierId}
                                    onClick={() => setSelectedCarrierId(quote.carrierId)}
                                    className={`relative p-3 rounded-xl border-2 cursor-pointer transition-all flex items-center justify-between group ${
                                        selectedCarrierId === quote.carrierId 
                                        ? 'border-eco-500 bg-eco-50 shadow-md' 
                                        : 'border-gray-100 bg-white hover:border-gray-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className={`w-10 h-10 rounded-lg ${quote.color} text-white flex items-center justify-center font-bold text-xs shadow-sm`}>
                                            {quote.shortName.substring(0,3)}
                                        </div>
                                        <div>
                                            <div className="font-bold text-gray-800 text-sm">{quote.name}</div>
                                            <div className="flex gap-2 mt-1">
                                                {quote.isBestPrice && (
                                                    <span className="text-[9px] font-bold bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded border border-yellow-200">
                                                        <i className="fas fa-crown text-yellow-600 mr-1"></i>Rẻ nhất
                                                    </span>
                                                )}
                                                {quote.isFastest && (
                                                    <span className="text-[9px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded border border-red-200">
                                                        <i className="fas fa-bolt mr-1"></i>Hỏa tốc
                                                    </span>
                                                )}
                                                {!quote.isBestPrice && !quote.isFastest && (
                                                    <span className="text-[9px] text-gray-400">Tiêu chuẩn</span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className={`text-sm font-black ${selectedCarrierId === quote.carrierId ? 'text-eco-700' : 'text-gray-700'}`}>
                                            {new Intl.NumberFormat('vi-VN').format(quote.fee)}đ
                                        </div>
                                        <div className="text-[10px] text-gray-400">Dự kiến 2-3 ngày</div>
                                    </div>
                                    
                                    {/* Radio indicator */}
                                    <div className={`absolute right-0 top-0 bottom-0 w-1.5 rounded-r-xl transition-all ${selectedCarrierId === quote.carrierId ? 'bg-eco-500' : 'bg-transparent'}`}></div>
                                </div>
                            ))}
                            
                            {quotes.length === 0 && !loadingQuotes && (
                                <div className="text-center py-8 text-gray-400">
                                    Không có báo giá nào.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="p-5 border-t border-gray-100 bg-white flex justify-between items-center">
                    <div>
                        <div className="text-[10px] text-gray-400 font-bold uppercase">Tổng phí</div>
                        <div className="text-xl font-black text-gray-800">
                            {selectedQuote ? new Intl.NumberFormat('vi-VN').format(selectedQuote.fee) : '0'}đ
                        </div>
                    </div>
                    <button 
                        onClick={handleSubmit}
                        disabled={isSubmitting || !selectedCarrierId}
                        className={`px-6 py-3 rounded-xl font-bold text-sm shadow-lg transition-all active:scale-95 flex items-center gap-2 ${
                            isSubmitting || !selectedCarrierId 
                            ? 'bg-gray-300 text-gray-500 cursor-not-allowed' 
                            : 'bg-black hover:bg-gray-800 text-white'
                        }`}
                    >
                        {isSubmitting ? (
                            <>Đang xử lý...</>
                        ) : (
                            <>
                                <i className="fas fa-paper-plane"></i> Đẩy Đơn Ngay
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShipmentModal;
