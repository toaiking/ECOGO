
import React, { useState, useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { storageService } from '../services/storageService';
import { OrderStatus, PaymentMethod } from '../types';

const QuickActionWidget: React.FC = () => {
    const [isOpen, setIsOpen] = useState(false);
    const [unverifiedCount, setUnverifiedCount] = useState(0);
    const location = useLocation();

    useEffect(() => {
        const unsub = storageService.subscribeOrders((orders) => {
            const count = orders.filter(o => 
                o.paymentMethod === PaymentMethod.TRANSFER && 
                !o.paymentVerified && 
                o.status !== OrderStatus.CANCELLED
            ).length;
            setUnverifiedCount(count);
        });
        return () => unsub();
    }, []);

    // Đóng menu khi chuyển trang
    useEffect(() => setIsOpen(false), [location]);

    // Không hiển thị widget ở trang Đăng nhập
    if (location.pathname === '/login') return null;

    return (
        <div className="fixed bottom-24 right-4 z-[999] flex flex-col items-end gap-3 pointer-events-none">
            
            {/* Action Buttons (Animated) */}
            {isOpen && (
                <div className="flex flex-col gap-3 mb-2 animate-slide-up pointer-events-auto">
                    <NavLink 
                        to="/audit" 
                        className="bg-white border-2 border-gray-900 px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 active:scale-90 transition-all"
                    >
                        <span className="text-[10px] font-black uppercase text-gray-500">Đối soát nhanh</span>
                        <div className="w-8 h-8 bg-orange-100 text-orange-600 rounded-xl flex items-center justify-center">
                            <i className="fas fa-file-invoice-dollar"></i>
                        </div>
                    </NavLink>

                    <NavLink 
                        to="/order" 
                        className="bg-white border-2 border-gray-900 px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 active:scale-90 transition-all"
                    >
                        <span className="text-[10px] font-black uppercase text-gray-500">Quét đơn AI</span>
                        <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-xl flex items-center justify-center">
                            <i className="fas fa-magic"></i>
                        </div>
                    </NavLink>
                </div>
            )}

            {/* Main Toggle Button */}
            <button 
                onClick={() => setIsOpen(!isOpen)}
                className={`pointer-events-auto w-16 h-16 rounded-[2rem] border-4 border-gray-900 shadow-[6px_6px_0px_0px_rgba(0,0,0,1)] flex items-center justify-center text-2xl transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                    isOpen ? 'bg-gray-900 text-white' : 'bg-eco-500 text-white'
                }`}
            >
                {isOpen ? (
                    <i className="fas fa-times"></i>
                ) : (
                    <div className="relative">
                        <i className="fas fa-bolt"></i>
                        {unverifiedCount > 0 && (
                            <span className="absolute -top-3 -right-3 bg-red-600 text-white text-[10px] font-black w-6 h-6 rounded-full border-2 border-white flex items-center justify-center animate-pulse">
                                {unverifiedCount}
                            </span>
                        )}
                    </div>
                )}
            </button>
        </div>
    );
};

export default QuickActionWidget;
