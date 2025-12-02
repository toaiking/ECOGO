
import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod, Customer } from '../types';
import { storageService } from '../services/storageService';
import { generateDeliveryMessage } from '../services/geminiService';

interface Props {
  order: Order;
  onUpdate: (order: Order) => void;
  onDelete: (id: string) => void;
  onEdit: (order: Order) => void;
  isSortMode?: boolean;
  index?: number;
  isCompactMode?: boolean; 
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void;
  isNewCustomer?: boolean;
  onSplitBatch?: (order: Order) => void;
  priorityScore?: number;
  customerData?: Customer;
  
  // Selection Props
  isSelectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
  onLongPress?: (id: string) => void;
  
  // QR Handler from Parent
  onShowQR?: (order: Order) => void;
}

const statusConfig: Record<OrderStatus, { color: string; bg: string; label: string; icon: string }> = {
  [OrderStatus.PENDING]: { bg: 'bg-yellow-100', color: 'text-yellow-800', label: 'Chờ xử lý', icon: 'fa-clock' },
  [OrderStatus.PICKED_UP]: { bg: 'bg-blue-100', color: 'text-blue-800', label: 'Đã lấy', icon: 'fa-box-open' },
  [OrderStatus.IN_TRANSIT]: { bg: 'bg-purple-100', color: 'text-purple-800', label: 'Đang giao', icon: 'fa-shipping-fast' },
  [OrderStatus.DELIVERED]: { bg: 'bg-green-100', color: 'text-green-800', label: 'Hoàn tất', icon: 'fa-check-circle' },
  [OrderStatus.CANCELLED]: { bg: 'bg-red-100', color: 'text-red-800', label: 'Đã hủy', icon: 'fa-times-circle' },
};

const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(img.src); return; }
                const MAX_DIM = 800;
                let width = img.width;
                let height = img.height;
                if (width > height) { if (width > MAX_DIM) { height *= MAX_DIM / width; width = MAX_DIM; } } else { if (height > MAX_DIM) { width *= MAX_DIM / height; height = MAX_DIM; } }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
};

const CustomerBadge: React.FC<{ customer?: Customer, isNew?: boolean }> = ({ customer, isNew }) => {
    if (isNew || (customer && (customer.totalOrders || 0) <= 1 && !customer.isLegacy)) {
        return <span title="Khách Mới" className="text-sm leading-none ml-1">🌱</span>;
    }
    if (!customer) return null;
    const count = customer.totalOrders || 0;
    if (count > 20) return <span title={`VIP (${count} đơn)`} className="text-sm leading-none ml-1 animate-pulse">💎</span>;
    if (count > 5) return <span title={`Khách Quen (${count} đơn)`} className="text-sm leading-none ml-1">🌟</span>;
    if (count > 2) return <span title={`Tiềm Năng (${count} đơn)`} className="text-sm leading-none ml-1">🚀</span>;
    return null;
};

export const OrderCard: React.FC<Props> = ({ 
  order, onUpdate, onDelete, onEdit, 
  isSortMode, index, isCompactMode,
  onTouchStart, onTouchMove, onTouchEnd,
  isNewCustomer, onSplitBatch, priorityScore,
  customerData,
  isSelectionMode, isSelected, onToggleSelect, onLongPress,
  onShowQR
}) => {
  const [uploading, setUploading] = useState(false);
  const [showImageModal, setShowImageModal] = useState(false);
  const [showCompactPaymentChoice, setShowCompactPaymentChoice] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  
  const longPressTimer = useRef<any>(null);
  const isLongPressing = useRef(false);
  const startPos = useRef<{x: number, y: number} | null>(null);

  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
              setShowActionMenu(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleTouchStartInternal = (e: React.TouchEvent<HTMLDivElement>) => {
      if (onTouchStart) onTouchStart(e);
      if (isSortMode || isSelectionMode) return;
      
      startPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      isLongPressing.current = false;
      
      longPressTimer.current = setTimeout(() => {
          isLongPressing.current = true;
          if (onLongPress) {
              if (navigator.vibrate) navigator.vibrate(50);
              onLongPress(order.id);
          }
      }, 500);
  };

  const handleTouchMoveInternal = (e: React.TouchEvent<HTMLDivElement>) => {
      if (onTouchMove) onTouchMove(e);
      if (startPos.current) {
          const moveX = Math.abs(e.touches[0].clientX - startPos.current.x);
          const moveY = Math.abs(e.touches[0].clientY - startPos.current.y);
          if (moveX > 10 || moveY > 10) {
              if (longPressTimer.current) clearTimeout(longPressTimer.current);
          }
      }
  };

  const handleTouchEndInternal = (e: React.TouchEvent<HTMLDivElement>) => {
      if (onTouchEnd) onTouchEnd(e);
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (isLongPressing.current) e.preventDefault();
  };

  const handleCardClick = (e: React.MouseEvent) => {
      if (isSelectionMode && onToggleSelect) {
          e.preventDefault();
          e.stopPropagation();
          onToggleSelect(order.id);
      } else if (!isLongPressing.current) {
          onEdit(order);
      }
      isLongPressing.current = false;
  };

  const handleStatusChange = async (newStatus: OrderStatus) => { 
      await storageService.updateStatus(order.id, newStatus, undefined, { name: order.customerName, address: order.address }); 
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
          const compressedBase64 = await compressImage(file);
          await storageService.updateStatus(order.id, OrderStatus.DELIVERED, compressedBase64, { name: order.customerName, address: order.address });
          toast.success('Đã lưu ảnh & Hoàn tất');
      } catch (error) { toast.error("Lỗi xử lý ảnh"); } finally { setUploading(false); }
    }
  };
  const handleDeletePhoto = async () => { if (window.confirm("Xóa ảnh?")) { await storageService.deleteDeliveryProof(order.id); toast.success("Đã xóa"); } };
  const handleShareProof = async () => {
      if (!order.deliveryProof) { toast.error("Chưa có ảnh xác thực"); return; }
      try {
          const base64Response = await fetch(order.deliveryProof);
          const blob = await base64Response.blob();
          const file = new File([blob], `delivery-${order.id}.jpg`, { type: "image/jpeg" });
          const text = `Đã giao đơn #${order.id} - ${order.customerName}`;
          if (navigator.share) { await navigator.share({ title: `Giao hàng #${order.id}`, text: text, files: [file] }); } else { toast.error('Trình duyệt không hỗ trợ Share ảnh.'); }
      } catch (e) { toast.error("Lỗi chia sẻ"); }
  };
  const handleFinishOrder = async (method: PaymentMethod) => {
      const updated = { ...order, paymentMethod: method };
      await storageService.updateOrderDetails(updated);
      await storageService.updateStatus(order.id, OrderStatus.DELIVERED, undefined, { name: order.customerName, address: order.address });
      toast.success(`Xong: ${method === PaymentMethod.CASH ? 'Tiền mặt' : 'Chuyển khoản'}`);
      setShowCompactPaymentChoice(false);
  };
  
  const togglePaymentVerification = async () => { 
      const newState = !order.paymentVerified;
      await storageService.updatePaymentVerification(order.id, newState, { name: order.customerName }); 
      if (newState) toast.success("Đã xác nhận tiền!"); 
      else toast("Đã chuyển về: Chờ Chuyển khoản");
  };
  
  const requestQR = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (onShowQR) onShowQR(order);
      else toast.error("Tính năng QR chưa sẵn sàng");
  };

  const sendSMS = async () => { const msg = await generateDeliveryMessage(order); const ua = navigator.userAgent.toLowerCase(); const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1; const separator = isIOS ? '&' : '?'; window.open(`sms:${order.customerPhone}${separator}body=${encodeURIComponent(msg)}`, '_self'); };
  const nextStatus = (e: React.MouseEvent) => { e.stopPropagation(); if(order.status === OrderStatus.PENDING) handleStatusChange(OrderStatus.PICKED_UP); else if(order.status === OrderStatus.PICKED_UP) handleStatusChange(OrderStatus.IN_TRANSIT); else if(order.status === OrderStatus.IN_TRANSIT) setShowCompactPaymentChoice(true); }
  const handlePrint = () => {
    const printWindow = window.open('', '_blank'); if (!printWindow) return;
    const itemsStr = order.items.map(i => `<tr><td style="padding:5px;border-bottom:1px solid #ddd;">${i.name}</td><td style="padding:5px;border-bottom:1px solid #ddd;text-align:center;">${i.quantity}</td><td style="padding:5px;border-bottom:1px solid #ddd;text-align:right;">${new Intl.NumberFormat('vi-VN').format(i.price)}</td><td style="padding:5px;border-bottom:1px solid #ddd;text-align:right;">${new Intl.NumberFormat('vi-VN').format(i.price * i.quantity)}</td></tr>`).join('');
    printWindow.document.write(`<html><head><title>Phiếu Giao Hàng</title><style>body{font-family:sans-serif;padding:20px;font-size:13px}table{width:100%;border-collapse:collapse}th{text-align:left;background:#f0f0f0;padding:8px;border-bottom:2px solid #ddd}</style></head><body><h2>PHIẾU GIAO HÀNG #${order.id}</h2><div>Khách: <b>${order.customerName}</b> - ${order.customerPhone}</div><div>ĐC: ${order.address}</div><br/><table><thead><tr><th>Sản phẩm</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>${itemsStr}<tr><td colspan="3" style="text-align:right;font-weight:bold;padding-top:10px">TỔNG:</td><td style="font-weight:bold;padding-top:10px">${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ</td></tr></tbody></table></body></html>`);
    printWindow.document.close(); printWindow.print();
  };
  
  // NEW: Handle Messenger Click
  const handleMessengerClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (customerData?.socialLink) {
          window.open(customerData.socialLink, '_blank');
      } else if (order.customerPhone) {
          // If no specific link, try to search facebook by phone or just open messenger main page
          // Searching by phone on FB is restricted now, so we just open the search page
          window.open(`https://www.facebook.com/search/top?q=${order.customerPhone}`, '_blank');
      }
  };

  const config = statusConfig[order.status];
  const isCompleted = order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED;
  
  const PaymentBadge = ({ compact = false }) => {
    const showText = isCompleted || order.paymentVerified;
    if (!showText && !compact) {
         return <button onClick={(e) => { e.stopPropagation(); requestQR(e); }} className="text-blue-600"><i className="fas fa-qrcode"></i></button>;
    }
    const isTransfer = order.paymentMethod === PaymentMethod.TRANSFER;
    let text = '', style = '';
    if (order.paymentMethod === PaymentMethod.CASH) { text = 'Tiền mặt'; style = 'text-gray-500 bg-gray-50 border-gray-200'; }
    else if (order.paymentMethod === PaymentMethod.PAID) { text = 'Đã TT'; style = 'text-green-700 bg-green-50 border-green-100'; }
    else { text = order.paymentVerified ? 'Đã nhận' : 'Chờ CK'; style = order.paymentVerified ? 'text-green-700 bg-green-50 border-green-100 cursor-pointer' : 'text-blue-600 bg-blue-50 border-blue-100 cursor-pointer'; }
    return (<div className="flex items-center gap-1" onClick={(e) => { if (isTransfer) { e.stopPropagation(); togglePaymentVerification(); } }}><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap ${style}`}>{text}</span>{(!isCompleted && !order.paymentVerified) && <button onClick={requestQR} className="text-blue-600 ml-0.5"><i className="fas fa-qrcode text-[10px]"></i></button>}</div>);
  };

  const CheckboxOverlay = () => { if (!isSelectionMode) return null; return (<div className={`absolute top-0 bottom-0 left-0 w-1.5 ${isSelected ? 'bg-eco-500' : 'bg-transparent'}`}></div>); }

  const SelectTrigger = () => {
    // Mode Active: Always show
    if (isSelectionMode) {
        return (
            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-all mr-3 flex-shrink-0 ${isSelected ? 'bg-eco-500 border-eco-500 text-white' : 'border-gray-300 bg-white'}`}>
                <i className="fas fa-check text-[10px]"></i>
            </div>
        );
    }
    // Hover Trigger for Desktop
    return (
         <div 
            onClick={(e) => {
                e.stopPropagation();
                if (onToggleSelect) onToggleSelect(order.id);
            }}
            className="w-5 h-5 rounded border border-gray-300 bg-white mr-3 flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:border-eco-500 hover:bg-eco-50"
            title="Chọn đơn này"
         >
             <i className="fas fa-check text-[10px] text-gray-300"></i>
         </div>
    );
  };

  // --- COMPACT MODE ---
  if (isCompactMode) {
      return (
          <>
          <div 
            className={`relative border-b border-gray-100 p-3 bg-white hover:bg-gray-50 transition-colors cursor-pointer select-none group ${isSelected ? 'bg-eco-50' : ''}`}
            onClick={handleCardClick}
            onTouchStart={handleTouchStartInternal}
            onTouchMove={handleTouchMoveInternal}
            onTouchEnd={handleTouchEndInternal}
          >
               <CheckboxOverlay />
               <div className="flex items-start">
                   <SelectTrigger />
                   <div className={`w-1 self-stretch rounded-full mr-3 flex-shrink-0 ${config.bg.replace('50', '500').replace('100', '500')}`}></div>
                   <div className="flex-grow min-w-0 flex flex-col gap-0.5">
                        <div className="flex justify-between items-baseline">
                             <div className="flex items-center gap-1 min-w-0">
                                 <span className="font-bold text-gray-900 text-sm truncate">{order.customerName}</span>
                                 <CustomerBadge customer={customerData} isNew={isNewCustomer} />
                             </div>
                             <div className="flex-shrink-0 flex items-center gap-2">
                                 <span className="font-bold text-sm text-gray-900">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<span className="text-[10px] text-gray-400 font-normal">đ</span></span>
                                 <PaymentBadge compact />
                             </div>
                        </div>
                        <div className="text-xs text-gray-800 font-medium truncate pr-2">
                            {order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                        </div>
                        <div className="flex justify-between items-end mt-1">
                             <div className="text-[10px] text-gray-400 truncate mr-2 max-w-[55%]">{order.address}</div>
                             <div className="flex items-center gap-2 flex-shrink-0">
                                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>{config.label}</span>
                                  <div className="flex items-center gap-1.5 pl-1 border-l border-gray-100">
                                      <a href={`tel:${order.customerPhone}`} onClick={(e)=>e.stopPropagation()} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-green-100 text-gray-500 hover:text-green-600 flex items-center justify-center transition-colors"><i className="fas fa-phone text-[10px]"></i></a>
                                      {!isCompleted && (<button onClick={nextStatus} className={`w-6 h-6 rounded-full text-white flex items-center justify-center shadow-sm ${config.bg.replace('50', '500').replace('100', '500')}`}><i className="fas fa-arrow-right text-[10px]"></i></button>)}
                                      <div className="relative" ref={actionMenuRef}><button onClick={(e) => { e.stopPropagation(); setShowActionMenu(!showActionMenu); }} className="w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center"><i className="fas fa-ellipsis-v text-[10px]"></i></button>{showActionMenu && (<div className="absolute bottom-full right-0 mb-1 bg-white shadow-xl border border-gray-100 rounded-lg p-1 min-w-[120px] z-20"><button onClick={() => { sendSMS(); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-blue-600 font-bold rounded"><i className="fas fa-comment-dots mr-2"></i>Nhắn tin</button><button onClick={() => { onEdit(order); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-gray-700 font-bold rounded"><i className="fas fa-edit mr-2"></i>Sửa đơn</button>{order.batchId && onSplitBatch && <button onClick={() => { onSplitBatch(order); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-orange-600 font-bold rounded"><i className="fas fa-history mr-2"></i>Giao sau</button>}<div className="border-t border-gray-50 my-1"></div><button onClick={() => { onDelete(order.id); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-red-50 text-xs text-red-600 font-bold rounded"><i className="fas fa-trash mr-2"></i>Xóa đơn</button></div>)}</div>
                                  </div>
                             </div>
                        </div>
                   </div>
               </div>
          </div>
          {showCompactPaymentChoice && (<div className="fixed inset-0 z-[99999] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowCompactPaymentChoice(false); }}><div className="bg-white w-full max-w-xs rounded-xl shadow-2xl p-4" onClick={e => e.stopPropagation()}><h3 className="text-center font-bold text-gray-800 mb-3 text-sm uppercase">Hoàn tất đơn hàng</h3><div className="grid grid-cols-2 gap-3"><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.CASH); }} className="p-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-center"><span className="block text-xl">💵</span><span className="text-xs font-bold text-emerald-700">TIỀN MẶT</span></button><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.TRANSFER); }} className="p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-center"><span className="block text-xl">💳</span><span className="text-xs font-bold text-blue-700">CHUYỂN KHOẢN</span></button></div></div></div>)}
          </>
      );
  }

  // --- DETAIL MODE ---
  return (
    <div 
        className={`relative bg-white rounded-xl border transition-all duration-200 select-none flex flex-col group ${isSortMode ? 'border-dashed border-2 border-gray-300' : isSelected ? 'border-eco-500 ring-1 ring-eco-500 bg-eco-50/10' : 'border-gray-200 shadow-sm hover:shadow-md'}`}
        onClick={handleCardClick}
        onTouchStart={handleTouchStartInternal}
        onTouchMove={handleTouchMoveInternal}
        onTouchEnd={handleTouchEndInternal}
    >
        {isSortMode && (<div className="absolute top-0 right-0 p-3 text-gray-300 z-10"><i className="fas fa-grip-vertical"></i></div>)}
        <div className="p-3 pb-2 flex items-start">
             <div className="pt-1">
                 <SelectTrigger />
             </div>
             <div className="flex-grow">
                <div className="flex justify-between items-start mb-1">
                    <div className="flex items-center gap-1.5 flex-wrap pr-6">
                        <h3 className="font-bold text-gray-900 text-sm leading-tight">{order.customerName}</h3>
                        <CustomerBadge customer={customerData} isNew={isNewCustomer} />
                    </div>
                    <div className="text-right flex-shrink-0">
                        <div className="text-sm font-black text-gray-900">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<span className="text-[10px] text-gray-400 ml-0.5 font-normal">đ</span></div>
                    </div>
                </div>
                <div className="flex justify-between items-center text-[10px]">
                     <div className="flex gap-2">
                         <span className={`px-1.5 py-0.5 rounded font-bold uppercase tracking-wide ${config.bg} ${config.color}`}>{config.label}</span>
                         <PaymentBadge />
                     </div>
                </div>
             </div>
        </div>
        <div className="px-3 py-2 bg-gray-50/50 border-t border-b border-gray-50 text-xs flex-grow">
            {order.notes && <div className="text-[10px] text-yellow-700 bg-yellow-50 px-2 py-1 rounded italic mb-2 border border-yellow-100 flex items-start gap-1"><i className="fas fa-sticky-note mt-0.5"></i> {order.notes}</div>}
            <div className="space-y-1">
                {order.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-start leading-snug">
                        <span className="text-gray-700 font-medium">{item.name}</span>
                        <span className="font-bold text-gray-900 ml-2">x{item.quantity}</span>
                    </div>
                ))}
            </div>
        </div>
        <div className="p-3 pt-2">
            <div className="text-[10px] text-gray-400 mb-3 truncate flex items-center gap-1"><i className="fas fa-map-marker-alt"></i> {order.address}</div>
            <div className="flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-2">
                    {order.status === OrderStatus.PENDING && (<button onClick={() => handleStatusChange(OrderStatus.PICKED_UP)} className="px-3 py-1.5 bg-gray-800 text-white text-[10px] font-bold rounded-lg hover:bg-black transition-colors shadow-sm">NHẬN ĐƠN</button>)}
                    {order.status === OrderStatus.PICKED_UP && (<button onClick={() => handleStatusChange(OrderStatus.IN_TRANSIT)} className="px-3 py-1.5 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 transition-colors shadow-sm shadow-blue-200">GIAO HÀNG</button>)}
                    {order.status === OrderStatus.IN_TRANSIT && (<div className="flex gap-1"><button onClick={() => handleFinishOrder(PaymentMethod.CASH)} className="px-3 py-1.5 bg-emerald-600 text-white text-[10px] font-bold rounded-lg hover:bg-emerald-700 shadow-sm shadow-emerald-200">TM</button><button onClick={() => handleFinishOrder(PaymentMethod.TRANSFER)} className="px-3 py-1.5 bg-blue-600 text-white text-[10px] font-bold rounded-lg hover:bg-blue-700 shadow-sm shadow-blue-200">CK</button><label className="w-7 h-7 flex items-center justify-center border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50 text-gray-400 bg-white"><input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} disabled={uploading} /><i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i></label></div>)}
                    {isCompleted && order.deliveryProof && (<button onClick={() => setShowImageModal(true)} className="px-2 py-1 bg-green-50 text-green-700 text-[10px] font-bold rounded border border-green-100 flex items-center gap-1"><i className="fas fa-image"></i> Ảnh</button>)}
                </div>
                <div className="flex items-center gap-1.5 text-gray-400">
                    {/* MESSENGER BUTTON */}
                    <button 
                        onClick={handleMessengerClick} 
                        className={`w-7 h-7 flex items-center justify-center rounded-full border transition-colors ${customerData?.socialLink ? 'bg-blue-50 text-blue-600 border-blue-200 shadow-sm' : 'border-gray-100 hover:bg-blue-50 hover:text-blue-500 hover:border-blue-100'}`} 
                        title={customerData?.socialLink ? "Mở hội thoại Messenger/Zalo đã lưu" : "Tìm khách trên Facebook"}
                    >
                        <i className="fab fa-facebook-messenger text-xs"></i>
                    </button>
                    
                    <a href={`tel:${order.customerPhone}`} className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-100 hover:bg-green-50 hover:text-green-600 hover:border-green-200 transition-colors"><i className="fas fa-phone text-xs"></i></a>
                    <a href={`https://zalo.me/${order.customerPhone}`} target="_blank" className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-100 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200 transition-colors font-bold text-[9px]">Z</a>
                    <button onClick={() => sendSMS()} className="w-7 h-7 flex items-center justify-center rounded-full border border-gray-100 hover:bg-yellow-50 hover:text-yellow-600 hover:border-yellow-200 transition-colors"><i className="fas fa-comment-dots text-xs"></i></button>
                    <div className="relative" ref={actionMenuRef}>
                        <button onClick={() => setShowActionMenu(!showActionMenu)} className="w-7 h-7 flex items-center justify-center rounded-full border border-transparent hover:bg-gray-100 hover:text-gray-600 transition-colors"><i className="fas fa-ellipsis-v text-xs"></i></button>
                        {showActionMenu && (<div className="absolute bottom-full right-0 mb-1 bg-white shadow-xl border border-gray-200 rounded-lg p-1 min-w-[130px] z-20 animate-fade-in"><button onClick={() => { onEdit(order); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-blue-600 font-bold flex items-center gap-2 rounded"><i className="fas fa-edit"></i> Sửa đơn</button>{onSplitBatch && order.batchId && (<button onClick={() => { onSplitBatch(order); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-orange-600 flex items-center gap-2 rounded font-bold"><i className="fas fa-history"></i> Giao sau</button>)}<button onClick={() => { handlePrint(); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-gray-600 flex items-center gap-2 rounded"><i className="fas fa-print"></i> In phiếu</button>{order.deliveryProof && <button onClick={() => { handleShareProof(); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-purple-600 flex items-center gap-2 rounded"><i className="fas fa-share-alt"></i> Gửi ảnh</button>}<div className="border-t border-gray-100 my-1"></div>{order.deliveryProof && <button onClick={() => { handleDeletePhoto(); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-red-50 text-xs text-red-500 flex items-center gap-2 rounded"><i className="fas fa-image"></i> Xóa ảnh</button>}<button onClick={() => { onDelete(order.id); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-red-50 text-xs text-red-600 flex items-center gap-2 rounded"><i className="fas fa-trash"></i> Xóa đơn</button></div>)}
                    </div>
                </div>
            </div>
        </div>
        {showImageModal && order.deliveryProof && (<div className="fixed inset-0 z-[99999] bg-black/95 flex items-center justify-center p-4" onClick={() => setShowImageModal(false)}><img src={order.deliveryProof} className="max-w-full max-h-full object-contain rounded" onClick={e=>e.stopPropagation()} /><button onClick={() => setShowImageModal(false)} className="absolute top-4 right-4 text-white text-2xl"><i className="fas fa-times"></i></button></div>)}
    </div>
  );
};