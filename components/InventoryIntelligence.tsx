
import React, { useState, useEffect } from 'react';
import { storageService } from '../services/storageService';
import { getInventoryInsight } from '../services/geminiService';
import { Product, Order } from '../types';

const InventoryIntelligence: React.FC = () => {
    const [insight, setInsight] = useState<string>('Đang phân tích kho hàng...');
    const [isLoading, setIsLoading] = useState(false);

    const refreshInsight = async () => {
        setIsLoading(true);
        try {
            const products = storageService.getAllProducts();
            const orders = await storageService.fetchLongTermStats();
            const result = await getInventoryInsight(products, orders.slice(0, 50));
            setInsight(result);
        } catch (e) {
            setInsight("Không thể kết nối với trí tuệ nhân tạo.");
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshInsight();
    }, []);

    return (
        <div className="bg-white rounded-[2.5rem] border-2 border-gray-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] p-5 relative overflow-hidden group">
            <div className="flex justify-between items-center mb-3">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-yellow-100 text-yellow-600 rounded-xl flex items-center justify-center border-2 border-yellow-200">
                        <i className="fas fa-lightbulb"></i>
                    </div>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Thông thái AI</span>
                </div>
                <button 
                    onClick={refreshInsight}
                    disabled={isLoading}
                    className={`text-[10px] font-black uppercase text-blue-600 hover:underline ${isLoading ? 'animate-pulse' : ''}`}
                >
                    {isLoading ? 'Đang nghĩ...' : 'Cập nhật nhận định'}
                </button>
            </div>
            
            <p className={`text-sm font-bold text-gray-800 leading-relaxed italic ${isLoading ? 'opacity-50' : 'opacity-100 transition-opacity'}`}>
                "{insight}"
            </p>

            <div className="absolute -right-4 -bottom-4 opacity-[0.03] text-8xl group-hover:scale-110 transition-transform -rotate-12">
                <i className="fas fa-brain"></i>
            </div>
        </div>
    );
};

export default InventoryIntelligence;
