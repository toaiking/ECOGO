
import React, { useEffect, useRef, useState } from 'react';
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

    useEffect(() => {
        const unsub = storageService.subscribeNotifications(setNotifications);
        return () => { if (unsub) unsub(); };
    }, []);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                onClose();
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose]);

    const handleMarkRead = async (id: string) => {
        await storageService.markNotificationRead(id);
    };

    const handleMarkAllRead = async () => {
        await storageService.markAllNotificationsRead();
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
            {/* Overlay for mobile to help click-outside */}
            <div className="fixed inset-0 z-[99] bg-black/20 md:hidden" onClick={onClose}></div>
            
            {/* 
                Mobile: Fixed Position (Center/Top) to ensure visibility 
                Desktop: Absolute Position (Relative to Bell) 
            */}
            <div 
                ref={menuRef} 
                className="fixed top-16 left-4 right-4 md:absolute md:top-12 md:left-auto md:right-0 md:w-80 bg-white rounded-xl shadow-2xl border border-gray-100 z-[100] overflow-hidden animate-fade-in-down"
            >
                <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                    <h3 className="font-bold text-gray-800 text-sm">Thông báo</h3>
                    <button onClick={handleMarkAllRead} className="text-[10px] text-blue-600 hover:underline font-medium">
                        Đọc tất cả
                    </button>
                </div>
                <div className="max-h-[60vh] md:max-h-[400px] overflow-y-auto">
                    {notifications.length === 0 ? (
                        <div className="p-8 text-center text-gray-400 text-xs">
                            <i className="fas fa-bell-slash text-2xl mb-2 opacity-50"></i>
                            <p>Không có thông báo mới</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-gray-50">
                            {notifications.map(notif => (
                                <div 
                                    key={notif.id} 
                                    onClick={() => handleMarkRead(notif.id)}
                                    className={`p-3 hover:bg-gray-50 cursor-pointer transition-colors flex gap-3 ${!notif.isRead ? 'bg-blue-50/50' : ''}`}
                                >
                                    <div className="mt-1 flex-shrink-0">
                                        <i className={`fas ${getIcon(notif.type)}`}></i>
                                    </div>
                                    <div className="flex-grow min-w-0">
                                        <div className="flex justify-between items-start gap-2">
                                            <h4 className={`text-xs truncate ${!notif.isRead ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>{notif.title}</h4>
                                            <span className="text-[9px] text-gray-400 whitespace-nowrap flex-shrink-0">
                                                {formatDistanceToNow(notif.createdAt, { addSuffix: true, locale: vi })}
                                            </span>
                                        </div>
                                        <p className={`text-[11px] mt-0.5 break-words ${!notif.isRead ? 'text-gray-800' : 'text-gray-500'}`}>{notif.message}</p>
                                    </div>
                                    {!notif.isRead && (
                                        <div className="flex-shrink-0 self-center">
                                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                        </div>
                                    )}
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
