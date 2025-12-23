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
  importPrice?: number; // NEW: Cost price at the moment of sale
}

// Fix: Added CarrierData interface to support integrated shipping carrier data
export interface CarrierData {
  carrierId: string;
  carrierName: string;
  trackingCode: string;
  fee: number;
  weight: number;
  cod: number;
  createdAt: number;
}

export interface Order {
  id: string;
  customerId?: string; // NEW: Link directly to customer ID for 100% accuracy
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
  reminderCount?: number; // NEW: Number of times payment reminder sent
  // Fix: Added carrierData property to store external shipping information
  carrierData?: CarrierData;
}

export interface ImportRecord {
  id: string;
  date: number;
  quantity: number;
  price: number; // Import price at time of entry
  note?: string;
}

export interface Product {
  id: string;
  name: string;
  defaultPrice: number; // Selling Price
  importPrice?: number; // NEW: Cost Price (Optional)
  defaultWeight: number; // kg per unit
  stockQuantity: number; // Current Stock
  totalImported?: number; // Total Imported History
  lastImportDate: number; 
  importHistory?: ImportRecord[]; // NEW: Track distinct import batches
  updatedAt?: number; // NEW: Timestamp for Delta Sync optimization
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  lastOrderDate: number;
  priorityScore?: number; // 1 is highest priority, 999 is normal
  totalOrders?: number;
  updatedAt?: number; // Timestamp for Delta Sync
  isLegacy?: boolean; // NEW: Manually marked as "Old Customer" regardless of order count
  socialLink?: string; // NEW: Link to Facebook/Zalo/Messenger conversation
}

export interface SmartParseResult {
  customerName: string;
  customerPhone: string;
  address: string;
  itemsString?: string; 
  parsedItems?: { productName: string, quantity: number }[]; // Structured items
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

export interface ShopConfig {
  shopName: string;
  hotline: string;
  address: string; // NEW: Pickup address for API carriers
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

// Interface for PDF Import Module
export interface RawPDFImportData {
  unit_price: number;      // e.g. 120 (means 120,000)
  customer_name: string;
  address: string;
  phone?: string;
  items_raw: string;       // e.g. "đỏ2 xanh1"
}
