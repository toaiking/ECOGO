
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
  
  onRowDragStart?: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  onRowDragEnter?: (e: React.DragEvent<HTMLDivElement>, index: number) => void;
  
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragOver?: (e: React.DragEvent<HTMLDivElement>) => void;

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

  // New Prop
  onMoveBatch?: (order: Order) => void;
  
  // NEW: View Detail Handler for Compact Mode
  onViewDetail?: (order: Order) => void;
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

const CustomerBadge: React.FC<{ customer?: Customer, isNew?: boolean }> = React.memo(({ customer, isNew }) => {
    if (isNew || (customer && (customer.totalOrders || 0) <= 1 && !customer.isLegacy)) {
        return <span title="Khách Mới" className="text-xs leading-none ml-1">🌱</span>;
    }
    if (!customer) return null;
    const count = customer.totalOrders || 0;
    if (count > 20) return <span title={`VIP (${count} đơn)`} className="text-xs leading-none ml-1 animate-pulse">💎</span>;
    if (count > 5) return <span title={`Khách Quen (${count} đơn)`} className="text-xs leading-none ml-1">🌟</span>;
    if (count > 2) return <span title={`Tiềm Năng (${count} đơn)`} className="text-xs leading-none ml-1">🚀</span>;
    return null;
});

export const OrderCard: React.FC<Props> = ({ 
  order, onUpdate, onDelete, onEdit, 
  isSortMode, index, isCompactMode,
  onTouchStart, onTouchMove, onTouchEnd,
  onRowDragStart, onRowDragEnter, onDragEnd, onDragOver,
  isNewCustomer, onSplitBatch, priorityScore,
  customerData,
  isSelectionMode, isSelected, onToggleSelect, onLongPress,
  onShowQR, onMoveBatch, onViewDetail
}) => {
  const [uploading, setUploading] = useState(false);
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

  // Long press logic for selection mode
  const handleTouchStartSelection = (e: React.TouchEvent<HTMLDivElement>) => {
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

  const handleTouchMoveSelection = (e: React.TouchEvent<HTMLDivElement>) => {
      if (startPos.current) {
          const moveX = Math.abs(e.touches[0].clientX - startPos.current.x);
          const moveY = Math.abs(e.touches[0].clientY - startPos.current.y);
          if (moveX > 10 || moveY > 10) {
              if (longPressTimer.current) clearTimeout(longPressTimer.current);
          }
      }
  };

  const handleTouchEndSelection = (e: React.TouchEvent<HTMLDivElement>) => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (isLongPressing.current) e.preventDefault();
  };

  const handleCardClick = (e: React.MouseEvent) => {
      if (isSelectionMode && onToggleSelect) {
          e.preventDefault();
          e.stopPropagation();
          onToggleSelect(order.id);
      } else if (!isLongPressing.current) {
          if (isCompactMode && onViewDetail) {
              onViewDetail(order);
          } else {
              onEdit(order);
          }
      }
      isLongPressing.current = false;
  };

  const handleStatusChange = async (newStatus: OrderStatus) => { 
      await storageService.updateStatus(order.id, newStatus, undefined, { name: order.customerName, address: order.address }); 
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

  const nextStatus = (e: React.MouseEvent) => { e.stopPropagation(); if(order.status === OrderStatus.PENDING) handleStatusChange(OrderStatus.PICKED_UP); else if(order.status === OrderStatus.PICKED_UP) handleStatusChange(OrderStatus.IN_TRANSIT); else if(order.status === OrderStatus.IN_TRANSIT) setShowCompactPaymentChoice(true); }
  
  const handlePrint = () => {
    const printWindow = window.open('', '_blank'); if (!printWindow) return;
    const itemsStr = order.items.map(i => `<tr><td style="padding:8px;border:1px solid #000;font-weight:bold;">${i.name}</td><td style="padding:8px;border:1px solid #000;text-align:center;">${i.quantity}</td><td style="padding:8px;border:1px solid #000;text-align:right;">${new Intl.NumberFormat('vi-VN').format(i.price)}</td><td style="padding:8px;border:1px solid #000;text-align:right;font-weight:bold;">${new Intl.NumberFormat('vi-VN').format(i.price * i.quantity)}</td></tr>`).join('');
    const htmlContent = `<html><head><title>Phiếu #${order.id}</title><style>body { font-family: 'Helvetica', sans-serif; padding: 20px; font-size: 14px; color: #000; }h2 { text-align:center; border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }table { width: 100%; border-collapse: collapse; margin-top: 20px; }th { border: 1px solid #000; padding: 10px; background: #fff; text-align: left; font-weight: bold; text-transform: uppercase; }.info { margin-bottom: 5px; font-size: 15px; }.label { display:inline-block; width: 80px; font-weight: bold; }.total-row td { border-top: 2px solid #000; font-size: 16px; font-weight: bold; padding: 15px 5px; }</style></head><body><h2>PHIẾU GIAO HÀNG #${order.id}</h2><div class="info"><span class="label">Khách:</span> <b>${order.customerName}</b></div><div class="info"><span class="label">SĐT:</span> ${order.customerPhone}</div><div class="info"><span class="label">Địa chỉ:</span> ${order.address}</div>${order.notes ? `<div class="info" style="margin-top:10px;font-style:italic;">Ghi chú: ${order.notes}</div>` : ''}<table><thead><tr><th>Sản phẩm</th><th style="width:50px;text-align:center;">SL</th><th style="text-align:right;">Đơn giá</th><th style="text-align:right;">Thành tiền</th></tr></thead><tbody>${itemsStr}<tr class="total-row"><td colspan="3" style="text-align:right;">TỔNG CỘNG:</td><td style="text-align:right;">${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ</td></tr></tbody></table><div style="margin-top: 40px; border-top: 1px dashed #000; padding-top: 10px; text-align: center; font-size: 12px; font-style: italic;">Cảm ơn quý khách!</div></body></html>`;
    printWindow.document.write(htmlContent); printWindow.document.close(); printWindow.print();
  };
  
  const handleMessengerClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (customerData?.socialLink) {
          window.open(customerData.socialLink, '_blank');
      } else if (order.customerPhone) {
          window.open(`https://www.facebook.com/search/top?q=${order.customerPhone}`, '_blank');
      }
  };

  const config = statusConfig[order.status];
  const isCompleted = order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED;
  
  const PaymentBadge = ({ compact = false }: { compact?: boolean }) => {
    // Show badge if: Completed (Any Method), OR Transfer, OR Paid. 
    // This allows toggling "Chờ CK" -> "Đã nhận" or changing method if Completed
    const showText = isCompleted || order.paymentMethod === PaymentMethod.TRANSFER || order.paymentMethod === PaymentMethod.PAID;
    
    if (!showText && compact) return null;
    
    const isTransfer = order.paymentMethod === PaymentMethod.TRANSFER;
    let text = '', style = '';
    
    if (order.paymentMethod === PaymentMethod.CASH) {
        if (!isCompleted) return null; // Don't show for pending Cash orders
        text = 'Tiền mặt';
        style = 'text-emerald-700 bg-emerald-50 border-emerald-100';
    } else if (order.paymentMethod === PaymentMethod.PAID) { 
        text = 'Đã TT'; 
        style = 'text-green-700 bg-green-50 border-green-100'; 
    } else { 
        text = order.paymentVerified ? 'Đã nhận' : 'Chờ CK'; 
        style = order.paymentVerified ? 'text-green-700 bg-green-50 border-green-100' : 'text-blue-600 bg-blue-50 border-blue-100'; 
    }

    // Interaction Logic: Allow if Transfer OR if Completed (to fix mistakes/change method)
    const canInteract = isCompleted || isTransfer;
    const interactionStyle = canInteract ? 'cursor-pointer hover:opacity-80 hover:shadow-sm' : '';

    const handleClick = (e: React.MouseEvent) => {
        if (!canInteract) return;
        e.stopPropagation();
        
        if (isTransfer) {
            // Toggle verification directly for transfers
            togglePaymentVerification();
        } else {
            // For Paid/Cash completed orders, allow re-opening the choice modal to switch method
            setShowCompactPaymentChoice(true);
        }
    };
    
    return (
        <div className="flex items-center gap-1" onClick={handleClick}>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap transition-all ${style} ${interactionStyle}`}>
                {text}
            </span>
        </div>
    );
  };

  const HeaderPaymentBadge = () => {
      // Ẩn thông tin thanh toán cho tất cả các đơn chưa hoàn thành
      if (!isCompleted) return null;

      let label = ''; let style = ''; const isTransfer = order.paymentMethod === PaymentMethod.TRANSFER;
      
      if (order.paymentMethod === PaymentMethod.CASH) {
          label = 'Tiền mặt';
          style = 'bg-emerald-50 text-emerald-700 border-emerald-100';
      } else if (order.paymentMethod === PaymentMethod.PAID) { 
          label = 'Đã TT'; 
          style = 'bg-green-50 text-green-700 border-green-100'; 
      } else { 
          if (order.paymentVerified) { 
              label = 'Đã CK'; 
              style = 'bg-green-50 text-green-700 border-green-100'; 
          } else { 
              label = 'Chờ CK'; 
              style = 'bg-blue-50 text-blue-600 border-blue-100 cursor-pointer hover:bg-blue-100'; 
          } 
      }
      
      const handleClick = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (isTransfer) togglePaymentVerification();
          else setShowCompactPaymentChoice(true);
      };

      return (<span onClick={handleClick} className={`text-[9px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap transition-colors cursor-pointer hover:shadow-sm ${style}`} title="Bấm để đổi trạng thái">{label}</span>);
  };

  const CheckboxOverlay = () => { if (!isSelectionMode) return null; return (<div className={`absolute top-0 bottom-0 left-0 w-1.5 ${isSelected ? 'bg-eco-500' : 'bg-transparent'}`}></div>); }

  const SelectTrigger = ({ compact = false }: { compact?: boolean }) => {
    if (isSelectionMode) { return (<div className={`w-5 h-5 rounded border flex items-center justify-center transition-all ${compact ? '' : 'mr-3'} flex-shrink-0 ${isSelected ? 'bg-eco-500 border-eco-500 text-white' : 'border-gray-300 bg-white'}`}><i className="fas fa-check text-[10px]"></i></div>); }
    return (<div onClick={(e) => { e.stopPropagation(); if (onToggleSelect) onToggleSelect(order.id); }} className={`w-5 h-5 rounded border border-gray-300 bg-white ${compact ? '' : 'mr-3'} flex-shrink-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:border-eco-500 hover:bg-eco-50`} title="Chọn đơn này" aria-label="Chọn đơn hàng"><i className="fas fa-check text-[10px] text-gray-300"></i></div>);
  };
  
  const DragHandle = () => {
      if (!isSortMode) return null;
      return (<div className="absolute top-0 right-0 bottom-0 w-8 md:w-12 flex items-center justify-center cursor-move z-20 touch-none text-gray-300 hover:text-eco-600 hover:bg-eco-50 transition-colors" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onDragStart={(e) => { if (onRowDragStart && index !== undefined) { onRowDragStart(e, index); } }} onDragEnter={(e) => { if (onRowDragEnter && index !== undefined) { onRowDragEnter(e, index); } }} onDragEnd={onDragEnd} onDragOver={onDragOver} draggable={true}><i className="fas fa-grip-vertical text-lg"></i></div>);
  };

  if (isCompactMode) {
      return (
          <>
          <div className={`sm:hidden relative border-b border-gray-100 p-3 bg-white hover:bg-gray-50 transition-colors cursor-pointer select-none group ${isSelected ? 'bg-eco-50' : ''} ${isSortMode ? 'pr-12' : ''}`} onClick={handleCardClick} onTouchStart={handleTouchStartSelection} onTouchMove={handleTouchMoveSelection} onTouchEnd={handleTouchEndSelection}><CheckboxOverlay /><DragHandle /><div className="flex items-start"><div className="mr-3"><SelectTrigger /></div><div className={`w-1 self-stretch rounded-full mr-3 flex-shrink-0 ${config.bg.replace('50', '500').replace('100', '500')}`}></div><div className="flex-grow min-w-0 flex flex-col gap-0.5"><div className="flex justify-between items-baseline"><div className="flex items-center gap-1 min-w-0"><span className="font-bold text-gray-900 text-sm truncate">{order.customerName}</span><CustomerBadge customer={customerData} isNew={isNewCustomer} /></div><div className="flex-shrink-0 flex items-center gap-2"><span className="font-bold text-sm text-gray-900">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<span className="text-[10px] text-gray-400 font-normal">đ</span></span><PaymentBadge compact /></div></div><div className="text-xs text-gray-800 font-medium truncate pr-2">{order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}</div><div className="flex justify-between items-end mt-1"><div className="text-[10px] text-gray-400 truncate mr-2 max-w-[55%] font-bold flex items-center gap-1">{customerData?.isAddressVerified && <i className="fas fa-check-circle text-green-500 text-[10px]" title="Đã xác thực vị trí"></i>}{order.address}</div><div className="flex items-center gap-2 flex-shrink-0"><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${config.bg} ${config.color}`}>{config.label}</span></div></div></div></div></div>
          <div className={`hidden sm:grid grid-cols-[40px_1.5fr_2fr_3.5fr_100px_110px] gap-2 items-center border-b border-gray-100 py-2 px-3 bg-white hover:bg-blue-50 transition-colors cursor-pointer select-none text-xs group ${isSelected ? 'bg-eco-50' : ''}`} onClick={handleCardClick}><div className="flex items-center justify-center relative h-full"><div className={`absolute left-0 top-0 bottom-0 w-1 rounded-r ${config.bg.replace('50', '500').replace('100', '500')}`}></div>{isSelectionMode ? <SelectTrigger compact /> : <span className="text-gray-400 font-mono text-[10px] group-hover:hidden">{index !== undefined ? index + 1 : ''}</span>}{!isSelectionMode && <div className="hidden group-hover:block"><SelectTrigger compact /></div>}</div><div className="truncate pr-2"><div className="flex items-center gap-1"><span className="font-bold text-gray-800 truncate" title={order.customerName}>{order.customerName}</span><CustomerBadge customer={customerData} isNew={isNewCustomer} /></div><div className="text-[10px] text-gray-500 font-mono">{order.customerPhone}</div></div><div className="truncate text-gray-800 font-bold flex items-center gap-1" title={order.address}>{customerData?.isAddressVerified && <i className="fas fa-check-circle text-green-500 text-[10px]" title="Đã xác thực vị trí"></i>}{order.address}</div><div className="truncate" title={order.items.map(i => `${i.name} (${i.quantity})`).join(', ')}><span className="font-medium text-gray-800">{order.items.map((i, idx) => (<span key={idx} className={idx > 0 ? "ml-2 pl-2 border-l border-gray-300" : ""}>{i.name} <span className="font-bold text-gray-900">({i.quantity})</span></span>))}</span>{order.notes && <span className="ml-2 text-[10px] text-orange-600 italic bg-orange-50 px-1 rounded">{order.notes}</span>}</div><div className="text-right"><div className="font-bold text-gray-900 whitespace-nowrap">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<span className="text-[10px] text-gray-400 font-normal">đ</span></div><div className="flex justify-end mt-0.5"><PaymentBadge compact /></div></div><div className="flex justify-center"><span className={`text-[10px] font-bold uppercase px-2 py-1 rounded border border-transparent shadow-sm whitespace-nowrap ${config.bg} ${config.color} border-opacity-20`}>{config.label}</span></div></div>
          {showCompactPaymentChoice && (<div className="fixed inset-0 z-[99999] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowCompactPaymentChoice(false); }}><div className="bg-white w-full max-w-xs rounded-xl shadow-2xl p-4" onClick={e => e.stopPropagation()}><h3 className="text-center font-bold text-gray-800 mb-3 text-sm uppercase">Hoàn tất đơn hàng</h3><div className="grid grid-cols-2 gap-3"><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.CASH); }} className="p-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-center"><span className="block text-xl">💵</span><span className="text-xs font-bold text-emerald-700">TIỀN MẶT</span></button><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.TRANSFER); }} className="p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-center"><span className="block text-xl">💳</span><span className="text-xs font-bold text-blue-700">CHUYỂN KHOẢN</span></button></div></div></div>)}
          </>
      );
  }

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden hover:shadow-md transition-all h-full flex flex-col relative select-none group ${isSelected ? 'ring-2 ring-eco-500 bg-eco-50' : ''}`} onClick={handleCardClick} onTouchStart={handleTouchStartSelection} onTouchMove={handleTouchMoveSelection} onTouchEnd={handleTouchEndSelection}><CheckboxOverlay /><DragHandle /><div className="p-3 pb-2 flex justify-between items-start"><div className="flex-grow min-w-0 pr-2"><div className="flex items-center gap-2"><SelectTrigger /><h3 className="font-bold text-gray-800 text-sm truncate leading-tight" title={order.customerName}>{order.customerName}</h3><CustomerBadge customer={customerData} isNew={isNewCustomer} /></div><div className="mt-1 pl-7 text-xs text-gray-600"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><div className="flex items-center gap-1.5 font-medium shrink-1 min-w-0"><i className="fas fa-map-marker-alt text-gray-400 shrink-0" style={{ fontSize: '10px' }}></i><span className="leading-snug truncate max-w-[180px] sm:max-w-xs" title={order.address}>{order.address}</span>{customerData?.isAddressVerified && <i className="fas fa-check-circle text-green-500 text-[10px]" title="Đã xác thực vị trí"></i>}</div>{order.customerPhone && (<a href={`tel:${order.customerPhone}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 font-mono text-gray-500 hover:text-blue-600 bg-gray-50 px-1.5 rounded border border-gray-100 hover:border-blue-200 transition-colors"><i className="fas fa-phone-alt text-[9px]"></i><span>{order.customerPhone}</span></a>)}{customerData?.socialLink && (<button onClick={handleMessengerClick} className="text-blue-500 hover:text-blue-700" title="Mạng xã hội"><i className="fab fa-facebook-messenger"></i></button>)}</div></div></div><div className="flex flex-col items-end gap-1 shrink-0"><div className="flex items-center gap-1"><HeaderPaymentBadge /><span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded border border-transparent ${config.bg} ${config.color}`}>{config.label}</span></div>{isSortMode && index !== undefined && (<span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-1 rounded">#{index + 1}</span>)}</div></div><div className="px-3 py-1 flex-grow"><div className="bg-gray-50 rounded-lg p-2 border border-gray-100 space-y-1">{order.items.map((item, idx) => (<div key={idx} className="flex justify-between items-start text-xs text-gray-700"><span className="font-medium truncate mr-2 leading-relaxed">{item.name}</span><span className="font-bold text-gray-900 whitespace-nowrap">x{item.quantity}</span></div>))}</div>{order.notes && (<div className="flex items-start gap-1.5 mt-1.5 ml-1"><i className="fas fa-sticky-note text-yellow-500 text-[10px] mt-0.5"></i><p className="text-[10px] text-yellow-700 italic line-clamp-2 leading-tight">{order.notes}</p></div>)}</div><div className="px-3 py-2 mt-auto border-t border-gray-50"><div className="flex justify-between items-end"><span className="text-[10px] font-bold text-gray-400 uppercase mb-1">Tổng thu:</span><div className="text-right"><div className="font-black text-gray-900 text-lg leading-none">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<span className="text-xs text-gray-400 font-normal ml-0.5">đ</span></div>{!isCompleted && (<div className="flex justify-end mt-1"><PaymentBadge /></div>)}</div></div></div><div className="p-3 pt-0"><div className="grid grid-cols-[1fr_1fr_1fr_2fr] gap-2 mb-2"><button onClick={handleMessengerClick} className="flex items-center justify-center py-2 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors" title="Nhắn tin"><i className="fas fa-comment-dots"></i></button><button onClick={(e) => { e.stopPropagation(); handlePrint(); }} className="flex items-center justify-center py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors" title="In phiếu"><i className="fas fa-print"></i></button><button onClick={(e) => { e.stopPropagation(); requestQR(e); }} className="flex items-center justify-center py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-blue-50 hover:text-blue-600 transition-colors" title="Mã QR"><i className="fas fa-qrcode"></i></button><button onClick={nextStatus} className={`flex items-center justify-center gap-2 py-2 rounded-lg font-bold text-xs text-white shadow-sm transition-all active:scale-95 ${order.status === OrderStatus.DELIVERED ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-800 hover:bg-gray-900'}`}>{order.status === OrderStatus.DELIVERED ? (<>Hoàn tất <i className="fas fa-check"></i></>) : (<>Tiếp theo <i className="fas fa-arrow-right"></i></>)}</button></div><div className="flex justify-between items-center text-[10px] text-gray-400 pt-1 border-t border-gray-50"><div className="font-mono">{order.batchId || 'NO-BATCH'}</div><div className="flex gap-3">{order.status !== OrderStatus.DELIVERED && onSplitBatch && (<button onClick={(e) => { e.stopPropagation(); onSplitBatch(order); }} className="hover:text-orange-500 font-bold transition-colors" title="Chuyển sang lô sau">Hoãn</button>)}{onMoveBatch && (<button onClick={(e) => { e.stopPropagation(); onMoveBatch(order); }} className="hover:text-indigo-500 font-bold transition-colors" title="Chuyển lô">Chuyển</button>)}</div></div></div>{showCompactPaymentChoice && (<div className="fixed inset-0 z-[99999] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowCompactPaymentChoice(false); }}><div className="bg-white w-full max-w-xs rounded-xl shadow-2xl p-4" onClick={e => e.stopPropagation()}><h3 className="text-center font-bold text-gray-800 mb-3 text-sm uppercase">Hoàn tất đơn hàng</h3><div className="grid grid-cols-2 gap-3"><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.CASH); }} className="p-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-center"><span className="block text-xl">💵</span><span className="text-xs font-bold text-emerald-700">TIỀN MẶT</span></button><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.TRANSFER); }} className="p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-center"><span className="block text-xl">💳</span><span className="text-xs font-bold text-blue-700">CHUYỂN KHOẢN</span></button></div></div></div>)}</div>
  );
}
