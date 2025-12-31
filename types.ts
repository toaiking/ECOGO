
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
  isPos?: boolean; // NEW: Flag for Point of Sale orders
}

export interface ImportRecord {
  id: string;
  date: number;
  quantity: number;
  price: number; // Import price at time
  note?: string;
}

export interface PriceTier {
  minQty: number;
  price: number;
}

export interface Product {
  id: string;
  name: string;
  defaultPrice: number;
  importPrice?: number;
  stockQuantity: number;
  totalImported?: number;
  updatedAt?: number;
  importHistory?: ImportRecord[];
  defaultWeight?: number;
  lastImportDate?: number;
  priceTiers?: PriceTier[]; // NEW: Tiered pricing (e.g., >=10 price is 90k)
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  lastOrderDate: number;
  totalOrders: number;
  priorityScore?: number;
  updatedAt?: number;
  isLegacy?: boolean;
  socialLink?: string;
  isAddressVerified?: boolean; // NEW: Flag for pinned location verification
}

export interface BankConfig {
  bankId: string;
  accountNo: string;
  accountName: string;
  template: string;
}

export interface ShopConfig {
  shopName: string;
  hotline: string;
  address: string;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  isRead: boolean;
  createdAt: number;
  relatedOrderId?: string;
}

export interface SmartParseResult {
  customerName: string;
  customerPhone: string;
  address: string;
  parsedItems: { productName: string, quantity: number }[];
  notes: string;
  paymentMethod: PaymentMethod;
}

export interface RawPDFImportData {
  unit_price: number;
  customer_name: string;
  address: string;
  phone: string | null;
  items_raw: string;
}
