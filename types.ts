
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
  priorityScore?: number; // 1 is highest priority, 999 is normal
  totalOrders?: number;
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

export interface BankConfig {
  bankId: string;       // Mã ngân hàng (VD: MB, VCB)
  accountNo: string;    // Số tài khoản
  accountName: string;  // Tên chủ tài khoản
  template: string;     // compact2 (mặc định)
  sepayApiToken?: string; // Token SePay để check biến động
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  createdAt: number;
  relatedOrderId?: string;
}