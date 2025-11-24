
import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod } from '../types';
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
}

const statusConfig: Record<OrderStatus, { color: string; bg: string; label: string; icon: string }> = {
  [OrderStatus.PENDING]: { bg: 'bg-yellow-100', color: 'text-yellow-700', label: 'Chờ xử lý', icon: 'fa-clock' },
  [OrderStatus.PICKED_UP]: { bg: 'bg-blue-100', color: 'text-blue-700', label: 'Đã lấy', icon: 'fa-box-open' },
  [OrderStatus.IN_TRANSIT]: { bg: 'bg-purple-100', color: 'text-purple-700', label: 'Đang giao', icon: 'fa-shipping-fast' },
  [OrderStatus.DELIVERED]: { bg: 'bg-green-100', color: 'text-green-700', label: 'Hoàn tất', icon: 'fa-check-circle' },
  [OrderStatus.CANCELLED]: { bg: 'bg-red-100', color: 'text-red-700', label: 'Hủy', icon: 'fa-times-circle' },
};

const OrderCard: React.FC<Props> = ({ 
  order, onUpdate, onDelete, onEdit, 
  isSortMode, index, isCompactMode
}) => {
  const [uploading, setUploading] = useState(false);
  
  const handleStatusChange = async (newStatus: OrderStatus) => {
    await storageService.updateStatus(order.id, newStatus);
    // Subscription handles UI update
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      const reader = new FileReader();
      reader.onloadend = async () => {
        await storageService.updateStatus(order.id, OrderStatus.DELIVERED, reader.result as string);
        setUploading(false);
        toast.success('Đã lưu ảnh & Hoàn tất đơn');
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePaymentMethodChange = async (method: PaymentMethod) => {
      const updated = { ...order, paymentMethod: method };
      await storageService.updateOrderDetails(updated);
      toast.success('Đã cập nhật thanh toán');
  };

  const togglePaymentVerification = async () => {
      // Optimistic logic is complex here without passing props, simpler to just trigger update
      await storageService.updatePaymentVerification(order.id, !order.paymentVerified);
      // Optional: Toast handled by parent or subscription
  };

  const copyMessage = async () => {
    const msg = await generateDeliveryMessage(order);
    navigator.clipboard.writeText(msg);
    toast.success('Đã copy tin nhắn!');
  };

  const handlePrint = (e: React.MouseEvent) => {
      e.stopPropagation();
      const printWindow = window.open('', '_blank');
      if (printWindow) {
          const itemsHtml = order.items.map(item => `
             <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.name}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${new Intl.NumberFormat('vi-VN').format(item.price * item.quantity)}</td>
             </tr>
          `).join('');

          const dateStr = new Date(order.createdAt).toLocaleDateString('vi-VN');

          printWindow.document.write(`
              <html>
                <head>
                  <title>Phiếu Giao Hàng - ${order.id}</title>
                  <style>
                    body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
                    h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
                    .info { margin-bottom: 20px; }
                    .info p { margin: 5px 0; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    th { text-align: left; border-bottom: 2px solid #000; padding: 8px; }
                    .total { text-align: right; font-size: 1.2em; font-weight: bold; margin-top: 20px; }
                    .footer { margin-top: 40px; text-align: center; font-size: 0.8em; font-style: italic; }
                  </style>
                </head>
                <body>
                  <h1>PHIẾU GIAO HÀNG</h1>
                  <div class="info">
                      <p><strong>Mã đơn:</strong> #${order.id}</p>
                      <p><strong>Khách hàng:</strong> ${order.customerName}</p>
                      <p><strong>SĐT:</strong> ${order.customerPhone}</p>
                      <p><strong>Địa chỉ:</strong> ${order.address}</p>
                      <p><strong>Ngày:</strong> ${dateStr}</p>
                  </div>
                  <table>
                    <thead>
                        <tr>
                            <th>Tên hàng</th>
                            <th style="text-align: center;">SL</th>
                            <th style="text-align: right;">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                  </table>
                  <div class="total">
                      Tổng thu: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.totalPrice)}
                      <br>
                      <span style="font-size: 0.7em; font-weight: normal;">(${order.paymentMethod === PaymentMethod.CASH ? 'Tiền mặt' : 'Chuyển khoản/Đã TT'})</span>
                  </div>
                  <div class="footer">
                      Cảm ơn quý khách đã mua hàng!<br>
                      EcoGo Logistics
                  </div>
                </body>
              </html>
          `);
          printWindow.document.close();
          printWindow.print();
      }
  };

  const nextStatus = (e: React.MouseEvent) => {
      e.stopPropagation();
      if(order.status === OrderStatus.PENDING) handleStatusChange(OrderStatus.PICKED_UP);
      else if(order.status === OrderStatus.PICKED_UP) handleStatusChange(OrderStatus.IN_TRANSIT);
      else if(order.status === OrderStatus.IN_TRANSIT) handleStatusChange(OrderStatus.DELIVERED);
  }

  const config = statusConfig[order.status];
  const isCompleted = order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED;
  
  // Payment Badge Component
  const PaymentBadge = () => {
    if (order.paymentMethod === PaymentMethod.CASH) {
        return <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-1 rounded border border-gray-200">TM</span>;
    }
    if (order.paymentMethod === PaymentMethod.PAID) {
        return <span className="text-[10px] font-bold text-green-700 bg-green-100 px-1 rounded border border-green-200">Đã TT</span>;
    }
    return (
        <span 
            className={`text-[10px] font-bold px-1 rounded border cursor-pointer ${order.paymentVerified ? 'text-green-700 bg-green-100 border-green-200' : 'text-blue-600 bg-blue-50 border-blue-200'}`}
            onClick={(e) => { e.stopPropagation(); togglePaymentVerification(); }}
            title={order.paymentVerified ? "Đã nhận tiền" : "Chờ xác nhận"}
        >
           {order.paymentVerified ? 'CK-OK' : 'CK?'}
        </span>
    );
  };

  // --- COMPACT VIEW MODE ---
  if (isCompactMode) {
      return (
          <div className="group px-3 py-2 hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => onEdit(order)}>
               {/* Desktop: Single Row */}
               <div className="hidden md:flex items-center gap-3 text-sm">
                    {/* Status Dot */}
                    <div 
                        className={`w-2.5 h-2.5 rounded-full flex-shrink-0 cursor-pointer ${config.bg.replace('100','500')}`} 
                        title={`${config.label} ${order.lastUpdatedBy ? `- bởi ${order.lastUpdatedBy}` : ''}`}
                    ></div>
                    
                    {/* Customer */}
                    <div className="w-40 font-bold text-gray-800 truncate" title={order.customerName}>{order.customerName}</div>
                    
                    {/* Items & Address */}
                    <div className="flex-grow flex items-center text-gray-500 text-xs gap-2 overflow-hidden">
                        <span className="truncate max-w-[200px] text-gray-900">{order.address}</span>
                        <span className="text-gray-300">|</span>
                        <span className="italic truncate text-gray-600">
                            {order.items.map((i, idx) => (
                                <span key={idx}>
                                    {i.name} <b className="text-gray-900">x{i.quantity}</b>{idx < order.items.length - 1 ? ', ' : ''}
                                </span>
                            ))}
                        </span>
                    </div>

                    {/* Price & Payment */}
                    <div className="w-28 text-right flex flex-col items-end leading-tight">
                         <span className="font-bold text-gray-900">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}</span>
                         <div className="mt-0.5"><PaymentBadge /></div>
                    </div>

                    {/* Simple Compact Actions */}
                    <div className="flex items-center gap-1 w-20 justify-end pl-2 border-l border-gray-100">
                         {/* Status Advance Button */}
                         {!isCompleted && (
                             <button 
                                onClick={nextStatus}
                                className="w-7 h-7 flex items-center justify-center rounded bg-gray-100 text-gray-600 hover:bg-black hover:text-white transition-colors"
                                title="Chuyển trạng thái tiếp theo"
                             >
                                <i className="fas fa-arrow-right text-[10px]"></i>
                             </button>
                         )}
                         {/* Print Button */}
                         <button onClick={handlePrint} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors" title="In phiếu">
                            <i className="fas fa-print text-[10px]"></i>
                         </button>
                    </div>
               </div>

               {/* Mobile: 2 Rows Strictly */}
               <div className="md:hidden flex flex-col gap-0.5">
                    {/* Row 1: Status Dot | Name | Price | Payment */}
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 overflow-hidden">
                            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${config.bg.replace('100','500')}`}></div>
                            <span className="font-bold text-gray-800 text-sm truncate">{order.customerName}</span>
                            {order.lastUpdatedBy && (
                                <span className="text-[9px] text-gray-400 bg-gray-100 px-1 rounded flex items-center gap-0.5">
                                    <i className="fas fa-user-edit text-[8px]"></i> {order.lastUpdatedBy}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                             <span className="font-bold text-gray-900 text-sm">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}</span>
                             <PaymentBadge />
                        </div>
                    </div>
                    
                    {/* Row 2: Address/Items | Actions */}
                    <div className="flex justify-between items-center text-xs text-gray-500">
                        <div className="flex-grow truncate pr-2">
                             <span className="text-gray-900 mr-1">{order.items.length > 0 ? `${order.items[0].name} (x${order.items[0].quantity})` : 'Chưa có hàng'}</span>
                             {order.items.length > 1 && <span className="text-gray-400">+{order.items.length - 1} món</span>}
                             <span className="mx-1 text-gray-300">-</span>
                             <span className="italic">{order.address}</span>
                        </div>
                        
                        <div className="flex items-center gap-2 flex-shrink-0">
                            {!isCompleted && (
                                <button 
                                    onClick={nextStatus}
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold text-white bg-gray-800`}
                                >
                                    {config.label} <i className="fas fa-chevron-right ml-0.5 text-[8px]"></i>
                                </button>
                            )}
                        </div>
                    </div>
               </div>
          </div>
      );
  }

  // --- FULL CARD MODE (Existing) ---
  return (
    <div 
      className={`
        group relative bg-white rounded-2xl border shadow-sm transition-all duration-300 overflow-hidden
        ${isSortMode ? 'border-dashed border-2 border-gray-300 hover:border-eco-400' : 'border-gray-100 hover:shadow-md'}
    `}>
      
      {/* Visual Grip Handle for Sort Mode */}
      {isSortMode && (
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gray-50 flex items-center justify-center border-r border-gray-100 z-10 cursor-grab active:cursor-grabbing">
              <span className="text-sm font-bold text-gray-400 transform -rotate-90">#{index !== undefined ? index + 1 : ''}</span>
          </div>
      )}

      <div className={`${isSortMode ? 'pl-8' : ''}`}>
          {/* Header */}
          <div className="flex justify-between items-start p-4 pb-2">
             <div className="flex flex-col">
                 <div className="flex items-center flex-wrap gap-2 mb-1">
                    <span className="font-bold text-gray-900 text-base">{order.customerName}</span>
                    {order.batchId && (
                        <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded border border-gray-200">
                            {order.batchId}
                        </span>
                    )}
                    <div className="flex items-center gap-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${config.bg} ${config.color}`}>
                           {config.label}
                        </span>
                        {/* Compact User Indicator */}
                        {order.lastUpdatedBy && (
                            <span className="text-[10px] text-gray-400 flex items-center gap-0.5 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-100" title={`Cập nhật bởi ${order.lastUpdatedBy}`}>
                               <i className="fas fa-user-edit text-[8px]"></i> {order.lastUpdatedBy}
                            </span>
                        )}
                    </div>
                 </div>
                 <div className="flex items-start gap-1.5 text-gray-500 text-sm">
                    <i className="fas fa-map-marker-alt mt-1 text-gray-300"></i>
                    <span className="line-clamp-2 leading-tight">{order.address}</span>
                 </div>
             </div>
             
             {/* Context Menu (Edit/Delete/Print) */}
             <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                <button onClick={handlePrint} className="p-1.5 text-gray-400 hover:text-gray-800 hover:bg-gray-100 rounded-lg transition-colors" title="In phiếu"><i className="fas fa-print text-xs"></i></button>
                <button onClick={(e) => { e.stopPropagation(); onEdit(order); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"><i className="fas fa-pen text-xs"></i></button>
                <button onClick={(e) => { e.stopPropagation(); onDelete(order.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"><i className="fas fa-trash text-xs"></i></button>
             </div>
          </div>

          {/* Content Body */}
          <div className="px-4 py-2">
            {order.notes && (
                <div className="mb-3 px-3 py-2 bg-yellow-50/50 border border-yellow-100 rounded-lg text-xs text-yellow-800 flex gap-2">
                    <i className="fas fa-comment-alt mt-0.5 text-yellow-400"></i>
                    <span className="italic">{order.notes}</span>
                </div>
            )}

            {/* Items */}
            <div className="space-y-1 mb-4">
               {order.items.map((item, idx) => (
                 <div key={idx} className="flex justify-between items-center text-sm group/item">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-200 group-hover/item:bg-eco-400 transition-colors"></span>
                        <span className="text-gray-700 truncate">{item.name}</span>
                        <span className="text-gray-400 text-xs">x{item.quantity}</span>
                    </div>
                    <span className="font-medium text-gray-900">{new Intl.NumberFormat('vi-VN').format(item.price * item.quantity)}</span>
                 </div>
               ))}
            </div>

            {/* Price & Payment Footer */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-50">
               <div className="flex items-center gap-2">
                   {/* Price */}
                   <span className="text-lg font-black text-gray-900">
                     {new Intl.NumberFormat('vi-VN').format(order.totalPrice)}
                   </span>
                   
                   {/* Payment Info - Only show when completed */}
                   {isCompleted && (
                       <>
                           {order.paymentMethod === PaymentMethod.CASH ? (
                               <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-500 border border-gray-200">Tiền mặt</span>
                           ) : order.paymentMethod === PaymentMethod.PAID ? (
                               <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700 border border-green-200">Đã TT</span>
                           ) : (
                               <button 
                                 onClick={(e) => { e.stopPropagation(); togglePaymentVerification(); }}
                                 className={`px-2 py-0.5 rounded text-[10px] font-bold border flex items-center gap-1 transition-all ${order.paymentVerified ? 'bg-green-100 text-green-700 border-green-200' : 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'}`}
                               >
                                 {order.paymentVerified ? <i className="fas fa-check-circle"></i> : <i className="far fa-circle"></i>} CK
                               </button>
                           )}
                       </>
                   )}
               </div>

               <button 
                  onClick={(e) => { e.stopPropagation(); copyMessage(); }} 
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gray-50 text-gray-600 text-xs font-bold hover:bg-eco-50 hover:text-eco-700 transition-colors"
               >
                   <i className="fas fa-sms"></i> <span className="hidden sm:inline">SMS</span>
               </button>
            </div>
          </div>

          {/* Action Bar (Shipper Tools) */}
          <div className="p-3 bg-gray-50/50 border-t border-gray-100 relative z-10" onClick={(e) => e.stopPropagation()}>
            {order.status === OrderStatus.PENDING && (
                <button onClick={() => handleStatusChange(OrderStatus.PICKED_UP)} className="w-full py-2.5 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-gray-800 transition-all shadow-lg shadow-gray-200">
                Nhận Đơn
                </button>
            )}
            
            {order.status === OrderStatus.PICKED_UP && (
                <button onClick={() => handleStatusChange(OrderStatus.IN_TRANSIT)} className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100">
                <i className="fas fa-motorcycle mr-2"></i> Giao Hàng
                </button>
            )}
            
            {order.status === OrderStatus.IN_TRANSIT && (
                <div className="space-y-3">
                    {/* Quick Payment Switch - Needed for operation but card badge is hidden */}
                    <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
                        <button 
                            onClick={() => handlePaymentMethodChange(PaymentMethod.CASH)}
                            className={`flex-1 text-xs font-bold py-1.5 rounded-md transition-all ${order.paymentMethod === PaymentMethod.CASH ? 'bg-gray-100 text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Tiền mặt
                        </button>
                        <div className="w-px bg-gray-200 my-1"></div>
                        <button 
                            onClick={() => handlePaymentMethodChange(PaymentMethod.TRANSFER)}
                            className={`flex-1 text-xs font-bold py-1.5 rounded-md transition-all ${order.paymentMethod === PaymentMethod.TRANSFER ? 'bg-blue-50 text-blue-600' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            Chuyển khoản
                        </button>
                    </div>
                    
                    <div className="flex gap-2">
                        {/* Camera Button */}
                        <label className={`w-12 h-10 flex items-center justify-center rounded-xl border border-gray-200 cursor-pointer transition-colors ${uploading ? 'bg-gray-100' : 'bg-white hover:border-eco-500 hover:text-eco-500 text-gray-500'}`}>
                            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
                            {uploading ? <i className="fas fa-spinner fa-spin text-sm"></i> : <i className="fas fa-camera text-lg"></i>}
                        </label>
                        
                        {/* Complete Button */}
                        <button onClick={() => handleStatusChange(OrderStatus.DELIVERED)} className="flex-1 py-2 rounded-xl bg-green-600 text-white text-sm font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-100">
                            Hoàn Tất
                        </button>
                    </div>
                </div>
            )}
            
            {isCompleted && (
                <div className="flex items-center justify-center pt-1">
                    {order.deliveryProof ? (
                        <a href={order.deliveryProof} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-xs font-bold text-eco-600 hover:underline">
                            <i className="fas fa-image"></i> Xem ảnh xác thực
                        </a>
                    ) : (
                        <span className="text-xs font-medium text-gray-400">
                            {order.status === OrderStatus.DELIVERED ? <><i className="fas fa-check mr-1"></i> Đã giao</> : <><i className="fas fa-times mr-1"></i> Đã hủy</>}
                        </span>
                    )}
                </div>
            )}
          </div>
      </div>
    </div>
  );
};

export default OrderCard;
