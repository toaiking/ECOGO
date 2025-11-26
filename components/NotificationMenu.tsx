
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageService } from '../services/storageService';
import { Notification } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const NotificationMenu: React.FC<Props> = ({ isOpen, onClose }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const unsub = storageService.subscribeNotifications(setNotifications);
        return () => { if (unsub) unsub(); };
    }, []);

    // Click outside handler
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    const handleNotificationClick = (notif: Notification, e: React.MouseEvent) => {
        // 1. Prevent bubbling immediately
        e.preventDefault();
        e.stopPropagation();

        // 2. Optimistic UI: Mark as read locally for immediate feedback
        if (!notif.isRead) {
            storageService.markNotificationRead(notif.id).catch(err => console.error("Mark read failed", err));
        }
        
        // 3. Close menu immediately
        onClose();

        // 4. Navigate immediately
        if (notif.relatedOrderId) {
            navigate('/tracking');
        }
    };

    const handleMarkAllRead = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        storageService.markAllNotificationsRead().catch(console.error);
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'success': return 'fa-check-circle text-green-500';
            case 'error': return 'fa-times-circle text-red-500';
            case 'warning': return 'fa-exclamation-triangle text-orange-500';
            default: return 'fa-info-circle text-blue-500';
        }
    };

    if (!isOpen) return null;

    return (
        <>
            {/* Overlay for mobile to catch clicks outside */}
            <div className="fixed inset-0 z-[99] bg-black/20 md:hidden" onClick={(e) => { e.stopPropagation(); onClose(); }}></div>
            
            {/* 
                Menu Container
                Mobile: Fixed Centered/Top to ensure it's visible
                Desktop: Absolute Right
            */}
            <div 
                ref={menuRef}
                onClick={(e) => e.stopPropagation()} 
                className="fixed top-16 left-4 right-4 md:absolute md:top-12 md:left-auto md:right-0 md:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[100] overflow-hidden animate-fade-in-down max-h-[70vh] flex flex-col"
            >
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 sticky top-0 z-10">
                    <h3 className="font-bold text-gray-800 text-base">Thông báo</h3>
                    <button 
                        onClick={handleMarkAllRead} 
                        className="text-xs text-blue-600 hover:underline font-bold bg-blue-50 px-2 py-1 rounded-md transition-colors active:scale-95"
                    >
                        Đọc tất cả
                    </button>
                </div>
                
                <div className="overflow-y-auto flex-grow overscroll-contain">
                    {notifications.length === 0 ? (
                        <div className="p-10 text-center text-gray-400 flex flex-col items-center">
                            <i className="fas fa-bell-slash text-4xl mb-3 opacity-30 block"></i>
                            <p className="text-sm">Không có thông báo mới</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {notifications.map(notif => (
                                <div 
                                    key={notif.id} 
                                    onClick={(e) => handleNotificationClick(notif, e)}
                                    className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors flex gap-3 group relative ${!notif.isRead ? 'bg-blue-50/60' : ''}`}
                                >
                                    {/* Unread Indicator Stripe */}
                                    {!notif.isRead && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>}

                                    <div className="mt-1 flex-shrink-0 text-lg group-hover:scale-110 transition-transform">
                                        <i className={`fas ${getIcon(notif.type)}`}></i>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <div className="flex justify-between items-start gap-2 mb-1">
                                            <h4 className={`text-sm leading-tight ${!notif.isRead ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>
                                                {notif.title}
                                            </h4>
                                            <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0 bg-gray-100 px-1.5 py-0.5 rounded">
                                                {formatDistanceToNow(notif.createdAt, { addSuffix: true, locale: vi })}
                                            </span>
                                        </div>
                                        <p className={`text-xs leading-relaxed break-words ${!notif.isRead ? 'text-gray-800' : 'text-gray-500'}`}>
                                            {notif.message}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default NotificationMenu;