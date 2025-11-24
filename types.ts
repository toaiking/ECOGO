
export enum OrderStatus {
  PENDING = 'PENDING',       // Chờ xử lý
  PICKED_UP = 'PICKED_UP',   // Đã lấy hàng
  IN_TRANSIT = 'IN_TRANSIT', // Đang giao
  DELIVERED = 'DELIVERED',   // Đã giao
  CANCELLED = 'CANCELLED'    // Đã hủy
}

export enum PaymentMethod {
  CASH = 'CASH',       // Tiền mặt (COD)
  TRANSFER = 'TRANSFER', // Chuyển khoản
  PAID = 'PAID'        // Đã thanh toán trước
}

export interface OrderItem {
  id: string;
  productId?: string; // Link to inventory
  name: string;
  quantity: number;
  price: number;
}

export interface Order {
  id: string;
  batchId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  items: OrderItem[]; 
  notes: string;
  // weight removed from Order interface as requested
  totalPrice: number; 
  paymentMethod: PaymentMethod;
  paymentVerified?: boolean; // New: Check if transfer received
  status: OrderStatus;
  createdAt: number;
  updatedAt: number;
  orderIndex: number; 
  deliveryProof?: string;
  lastUpdatedBy?: string; // Tên người xử lý trạng thái cuối cùng
}

export interface Product {
  id: string;
  name: string;
  defaultPrice: number;
  defaultWeight: number; // kg per unit
  stockQuantity: number; // Current Stock
  totalImported?: number; // Total Imported History
  lastImportDate: number; 
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  lastOrderDate: number;
}

export interface SmartParseResult {
  customerName: string;
  customerPhone: string;
  address: string;
  itemsString: string; 
  price?: number;
  notes?: string;
  paymentMethod?: PaymentMethod;
}
