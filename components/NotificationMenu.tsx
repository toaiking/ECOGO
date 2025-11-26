
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { storageService } from '../services/storageService';
import { Notification } from '../types';
import { formatDistanceToNow } from 'date-fns';
import { vi } from 'date-fns/locale';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    ignoreRef?: React.RefObject<HTMLElement>;
}

const NotificationMenu: React.FC<Props> = ({ isOpen, onClose, ignoreRef }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [readIds, setReadIds] = useState<Set<string>>(new Set());
    
    const menuRef = useRef<HTMLDivElement>(null);
    const navigate = useNavigate();

    useEffect(() => {
        const unsub = storageService.subscribeNotifications(setNotifications);
        return () => { if (unsub) unsub(); };
    }, []);

    useEffect(() => {
        const handleLocalRead = (e: any) => { if (e.detail) setReadIds(prev => new Set(prev).add(e.detail)); };
        const handleLocalReadAll = () => { setReadIds(new Set(notifications.map(n => n.id))); };
        const handleLocalClearAll = () => { setNotifications([]); };
        
        window.addEventListener('local_notif_read', handleLocalRead);
        window.addEventListener('local_notif_read_all', handleLocalReadAll);
        window.addEventListener('local_notif_clear_all', handleLocalClearAll);
        return () => {
            window.removeEventListener('local_notif_read', handleLocalRead);
            window.removeEventListener('local_notif_read_all', handleLocalReadAll);
            window.removeEventListener('local_notif_clear_all', handleLocalClearAll);
        }
    }, [notifications]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (!isOpen) return;
            if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
            if (ignoreRef?.current && ignoreRef.current.contains(event.target as Node)) return;
            onClose();
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose, ignoreRef]);

    useEffect(() => { if (!isOpen) setReadIds(new Set()); }, [isOpen]);

    const handleItemInteraction = (notif: Notification, e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setReadIds(prev => new Set(prev).add(notif.id));
        if (!notif.isRead) storageService.markNotificationRead(notif.id);
        if (notif.relatedOrderId) navigate('/tracking');
        onClose();
    };

    const handleMarkAllRead = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        storageService.markAllNotificationsRead();
        setReadIds(new Set(notifications.map(n => n.id)));
    };

    const handleClearAll = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Removed window.confirm to ensure immediate execution on touch devices
        storageService.clearAllNotifications();
        onClose();
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
            <div className="fixed inset-0 z-[90] md:hidden" onMouseDown={() => onClose()}></div>
            <div 
                ref={menuRef}
                className="fixed top-16 right-2 left-2 md:absolute md:top-12 md:left-auto md:right-0 md:w-96 bg-white rounded-2xl shadow-2xl border border-gray-100 z-[100] overflow-hidden animate-fade-in-down max-h-[70vh] flex flex-col"
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-gray-50 sticky top-0 z-10">
                    <h3 className="font-bold text-gray-800 text-base">Thông báo ({notifications.length})</h3>
                    <div className="flex gap-2">
                        {notifications.length > 0 && (
                            <>
                                <button 
                                    onMouseDown={handleMarkAllRead} 
                                    className="text-xs text-blue-600 hover:underline font-bold bg-blue-50 px-2 py-1 rounded-md transition-colors active:scale-95"
                                >
                                    <i className="fas fa-check-double mr-1"></i>Đọc hết
                                </button>
                                <button 
                                    onMouseDown={handleClearAll} 
                                    className="text-xs text-red-600 hover:underline font-bold bg-red-50 px-2 py-1 rounded-md transition-colors active:scale-95"
                                >
                                    <i className="fas fa-trash-alt mr-1"></i>Xóa
                                </button>
                            </>
                        )}
                    </div>
                </div>
                
                <div className="overflow-y-auto flex-grow overscroll-contain">
                    {notifications.length === 0 ? (
                        <div className="p-10 text-center text-gray-400 flex flex-col items-center">
                            <i className="fas fa-bell-slash text-4xl mb-3 opacity-30 block"></i>
                            <p className="text-sm">Không có thông báo mới</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {notifications.map(notif => {
                                const isRead = notif.isRead || readIds.has(notif.id);
                                return (
                                    <div 
                                        key={notif.id} 
                                        onMouseDown={(e) => handleItemInteraction(notif, e)}
                                        className={`p-4 hover:bg-gray-50 cursor-pointer transition-colors flex gap-3 group relative ${!isRead ? 'bg-blue-50/60' : ''}`}
                                    >
                                        {!isRead && <div className="absolute left-0 top-0 bottom-0 w-1 bg-blue-500"></div>}
                                        <div className="mt-1 flex-shrink-0 text-lg group-hover:scale-110 transition-transform">
                                            <i className={`fas ${getIcon(notif.type)}`}></i>
                                        </div>
                                        <div className="flex-grow min-w-0">
                                            {/* Title is Customer Name (BOLD) */}
                                            <div className="flex justify-between items-start gap-2 mb-1">
                                                <h4 className={`text-sm truncate ${!isRead ? 'font-black text-gray-900' : 'font-bold text-gray-700'}`}>
                                                    {notif.title}
                                                </h4>
                                                <span className="text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0 bg-gray-100 px-1.5 py-0.5 rounded">
                                                    {formatDistanceToNow(notif.createdAt, { addSuffix: true, locale: vi })}
                                                </span>
                                            </div>
                                            {/* Message is Status • Address */}
                                            <p className={`text-xs leading-relaxed break-words ${!isRead ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
                                                {notif.message}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default NotificationMenu;