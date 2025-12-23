
import { Order, OrderStatus, Product, Customer, BankConfig, Notification, ShopConfig, ImportRecord } from '../types';
import { db } from '../firebaseConfig';
import { v4 as uuidv4 } from 'uuid';
import { 
  collection, 
  setDoc, 
  doc, 
  updateDoc, 
  deleteDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  getDocs, 
  writeBatch, 
  deleteField, 
  limit, 
  getDoc, 
  where, 
  increment, 
  runTransaction 
} from "firebase/firestore";

const ORDER_KEY = 'ecogo_orders_v3'; 
const PRODUCT_KEY = 'ecogo_products_v1';
const CUSTOMER_KEY = 'ecogo_customers_v1';
const USER_KEY = 'ecogo_current_user';
const BANK_KEY = 'ecogo_bank_config';
const SHOP_KEY = 'ecogo_shop_config';
const NOTIF_KEY = 'ecogo_notifications_v1';
const TAGS_KEY = 'ecogo_quick_tags';
const QUOTA_KEY = 'ecogo_quota_status';
const LOGO_KEY = 'ecogo_company_logo';

const checkQuotaStatus = () => {
    try {
        const stored = localStorage.getItem(QUOTA_KEY);
        if (stored) {
            const { date, exhausted } = JSON.parse(stored);
            if (date === new Date().toDateString() && exhausted) return true;
        }
    } catch {}
    return false;
};

let _quotaExhausted = checkQuotaStatus();
const isOnline = () => !!db && !_quotaExhausted;

const markQuotaExhausted = () => {
    if (!_quotaExhausted) {
        _quotaExhausted = true;
        localStorage.setItem(QUOTA_KEY, JSON.stringify({ date: new Date().toDateString(), exhausted: true }));
        window.dispatchEvent(new Event('quota_exhausted'));
    }
};

let _memoryCustomers: Customer[] | null = null;
let _memoryOrders: Order[] | null = null;
let _memoryProducts: Product[] | null = null;

const ensureProductsLoaded = (): Product[] => {
    if (_memoryProducts) return _memoryProducts;
    try {
        const local = localStorage.getItem(PRODUCT_KEY);
        _memoryProducts = local ? (JSON.parse(local) as Product[]) : [];
    } catch { _memoryProducts = []; }
    return _memoryProducts || [];
};

const ensureOrdersLoaded = (): Order[] => {
    if (_memoryOrders) return _memoryOrders;
    try {
        const local = localStorage.getItem(ORDER_KEY);
        _memoryOrders = local ? (JSON.parse(local) as Order[]) : [];
    } catch { _memoryOrders = []; }
    return _memoryOrders || [];
};

const ensureCustomersLoaded = (): Customer[] => {
    if (_memoryCustomers) return _memoryCustomers;
    try {
        const local = localStorage.getItem(CUSTOMER_KEY);
        _memoryCustomers = local ? (JSON.parse(local) as Customer[]) : [];
    } catch { _memoryCustomers = []; }
    return _memoryCustomers || [];
};

export const normalizeString = (str: string): string => {
    if (!str) return "";
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
};

export const generateProductSku = (name: string): string => {
    if (!name) return uuidv4();
    const sku = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return sku.length < 2 ? uuidv4() : sku;
};

export const normalizePhone = (phone: string) => {
    if (!phone) return '';
    let p = phone.replace(/[^0-9]/g, '');
    if (p.startsWith('84')) p = '0' + p.slice(2);
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    if (p.length === 9 && !p.startsWith('0')) p = '0' + p;
    return p;
};

const sanitize = <T>(obj: T): T => JSON.parse(JSON.stringify(obj));

const safeCloudOp = async (operation: () => Promise<any>) => {
    if (_quotaExhausted || !db) return;
    try { await operation(); } catch (error: any) {
        if (error.code === 'resource-exhausted') markQuotaExhausted();
    }
};

export const storageService = {
  login: (username: string) => localStorage.setItem(USER_KEY, username),
  logout: () => localStorage.removeItem(USER_KEY),
  getCurrentUser: () => localStorage.getItem(USER_KEY),

  getLogo: () => localStorage.getItem(LOGO_KEY),
  saveLogo: (base64: string) => { localStorage.setItem(LOGO_KEY, base64); window.dispatchEvent(new Event('logo_updated')); },
  removeLogo: () => { window.dispatchEvent(new Event('logo_updated')); localStorage.removeItem(LOGO_KEY); },

  getQuickTags: (): string[] => { try { const l = localStorage.getItem(TAGS_KEY); return l ? (JSON.parse(l) as string[]) : ["Dễ vỡ", "Gọi trước", "Cổng sau"]; } catch { return []; } },
  saveQuickTags: async (tags: string[]) => { localStorage.setItem(TAGS_KEY, JSON.stringify(tags)); await safeCloudOp(() => setDoc(doc(db, "settings", "quickTags"), { tags })); },
  fetchQuickTagsFromCloud: async () => { if (isOnline()) { try { const s = await getDoc(doc(db, "settings", "quickTags")); if (s.exists()) return s.data().tags as string[]; } catch {} } return storageService.getQuickTags(); },

  saveShopConfig: async (config: ShopConfig) => { localStorage.setItem(SHOP_KEY, JSON.stringify(config)); await safeCloudOp(() => setDoc(doc(db, "settings", "shopConfig"), sanitize(config))); },
  getShopConfig: async (): Promise<ShopConfig | null> => { 
      if (isOnline()) {
          try {
              const s = await getDoc(doc(db, "settings", "shopConfig"));
              if (s.exists()) {
                  const data = s.data() as ShopConfig;
                  localStorage.setItem(SHOP_KEY, JSON.stringify(data));
                  return data;
              }
          } catch (e) { console.error("Cloud Shop Config Error:", e); }
      }
      const l = localStorage.getItem(SHOP_KEY); 
      if (l) return JSON.parse(l) as ShopConfig; 
      return null; 
  },

  saveBankConfig: async (config: BankConfig) => { localStorage.setItem(BANK_KEY, JSON.stringify(config)); await safeCloudOp(() => setDoc(doc(db, "settings", "bankConfig"), sanitize(config))); },
  getBankConfig: async (): Promise<BankConfig | null> => { 
      if (isOnline()) {
          try {
              const s = await getDoc(doc(db, "settings", "bankConfig"));
              if (s.exists()) {
                  const data = s.data() as BankConfig;
                  localStorage.setItem(BANK_KEY, JSON.stringify(data));
                  return data;
              }
          } catch (e) { console.error("Cloud Bank Config Error:", e); }
      }
      const l = localStorage.getItem(BANK_KEY); 
      if (l) return JSON.parse(l) as BankConfig; 
      return null; 
  },

  syncLocalToCloud: async () => {
    if (!isOnline()) throw new Error("Offline");
    const orders = ensureOrdersLoaded();
    const prods = ensureProductsLoaded();
    const batch = writeBatch(db);
    orders.forEach(o => batch.set(doc(db, "orders", o.id), sanitize(o)));
    prods.forEach(p => batch.set(doc(db, "products", p.id), sanitize(p)));
    await batch.commit();
    return orders.length + prods.length;
  },

  // --- NOTIFICATION ENGINE ---
  addNotification: async (notif: Omit<Notification, 'id' | 'isRead' | 'createdAt'>) => {
      const newNotif: Notification = {
          ...notif,
          id: uuidv4(),
          isRead: false,
          createdAt: Date.now()
      };
      // Lưu local trước để phản hồi nhanh
      try {
          const local = localStorage.getItem(NOTIF_KEY);
          const list = local ? JSON.parse(local) : [];
          list.unshift(newNotif);
          localStorage.setItem(NOTIF_KEY, JSON.stringify(list.slice(0, 50))); // Giữ tối đa 50 thông báo
      } catch {}
      
      // Đồng bộ Cloud
      await safeCloudOp(() => setDoc(doc(db, "notifications", newNotif.id), sanitize(newNotif)));
  },

  // --- CUSTOMER INTELLIGENCE (LEARNING) ---
  learnCustomerInfo: async (order: Order) => {
      const customers = ensureCustomersLoaded();
      const phone = normalizePhone(order.customerPhone);
      let existing = customers.find(c => c.id === order.customerId);
      
      if (!existing && phone.length > 8) {
          existing = customers.find(c => normalizePhone(c.phone) === phone);
      }

      const now = Date.now();
      if (existing) {
          const updated: Customer = {
              ...existing,
              address: order.address || existing.address,
              phone: order.customerPhone || existing.phone,
              lastOrderDate: now,
              totalOrders: (existing.totalOrders || 0) + 1,
              updatedAt: now
          };
          await storageService.upsertCustomer(updated);
      } else if (order.customerName) {
          const newCust: Customer = {
              id: order.customerId || uuidv4(),
              name: order.customerName,
              phone: order.customerPhone,
              address: order.address,
              lastOrderDate: now,
              totalOrders: 1,
              priorityScore: 999,
              updatedAt: now
          };
          await storageService.upsertCustomer(newCust);
      }
  },

  // --- PRODUCT MANAGEMENT ---
  subscribeProducts: (callback: (products: Product[]) => void) => {
    // 1. Initial Load
    callback(ensureProductsLoaded());

    // 2. Listen for Local Updates (Fix: Immediate UI Refresh)
    const handleLocalUpdate = () => {
        callback(ensureProductsLoaded());
    };
    window.addEventListener('storage_' + PRODUCT_KEY, handleLocalUpdate);

    // 3. Listen for Cloud Updates
    let unsubFirestore = () => {};
    if (isOnline()) {
        const qry = query(collection(db, "products"), orderBy("updatedAt", "desc"), limit(500));
        unsubFirestore = onSnapshot(qry, (snap) => {
            const list: Product[] = [];
            snap.forEach(d => list.push(d.data() as Product));
            if (list.length > 0) {
                _memoryProducts = list;
                localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
                callback(list);
            }
        });
    }

    // Return Cleanup Function
    return () => {
        window.removeEventListener('storage_' + PRODUCT_KEY, handleLocalUpdate);
        unsubFirestore();
    };
  },

  getAllProducts: () => ensureProductsLoaded(),
  getProductBySku: (sku: string) => ensureProductsLoaded().find(p => p.id === sku),

  saveProduct: async (product: Product) => {
      const pSave = { ...product, updatedAt: Date.now() };
      const list = ensureProductsLoaded();
      const idx = list.findIndex(p => p.id === pSave.id);
      if (idx >= 0) list[idx] = pSave; else list.unshift(pSave);
      _memoryProducts = list;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
      await safeCloudOp(() => setDoc(doc(db, "products", pSave.id), sanitize(pSave)));
  },

  adjustStockAtomic: async (productId: string, delta: number, info?: { price: number, note?: string }) => {
      const now = Date.now();
      const list = ensureProductsLoaded();
      const p = list.find(x => x.id === productId);
      if (p) {
          const oldStock = p.stockQuantity || 0;
          p.stockQuantity = oldStock + delta;
          p.updatedAt = now;
          
          // Cảnh báo hết hàng tự động
          if (p.stockQuantity < 5 && oldStock >= 5) {
              storageService.addNotification({
                  title: 'Sắp hết hàng!',
                  message: `Sản phẩm "${p.name}" chỉ còn ${p.stockQuantity} món trong kho.`,
                  type: 'warning'
              });
          }

          if (delta > 0) {
              p.totalImported = (p.totalImported || 0) + delta;
              if (!p.importHistory) p.importHistory = [];
              p.importHistory.push({ id: uuidv4(), date: now, quantity: delta, price: info?.price || 0, note: info?.note });
          }
          localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
      }
      await safeCloudOp(() => runTransaction(db, async (tx) => {
          const ref = doc(db, "products", productId);
          const snap = await tx.get(ref);
          if (snap.exists()) {
              const data = snap.data() as Product;
              const updates: any = { stockQuantity: increment(delta), updatedAt: now };
              if (delta > 0) {
                  updates.totalImported = increment(delta);
                  const h = [...(data.importHistory || [])];
                  h.push({ id: uuidv4(), date: now, quantity: delta, price: info?.price || 0, note: info?.note });
                  updates.importHistory = h;
              }
              tx.update(ref, updates);
          }
      }));
  },

  deleteProduct: async (id: string) => {
      const list = ensureProductsLoaded().filter(p => p.id !== id);
      _memoryProducts = list;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY)); // Fix: Ensure deletion updates UI immediately
      await safeCloudOp(() => deleteDoc(doc(db, "products", id)));
  },

  getRealSalesCount: (productId: string): number => {
      const orders = ensureOrdersLoaded();
      let sold = 0;
      orders.forEach(o => {
          if (o.status !== OrderStatus.CANCELLED) {
              o.items.forEach(i => {
                  if (i.productId === productId) sold += (Number(i.quantity) || 0);
              });
          }
      });
      return sold;
  },

  recalculateInventoryFromOrders: async () => {
      // Logic: Loop all products.
      // Current Stock = Total Imported (History) - Total Sold (Order History)
      const prods = ensureProductsLoaded();
      const orders = ensureOrdersLoaded();
      
      const soldMap = new Map<string, number>();
      orders.forEach(o => {
          if (o.status === OrderStatus.CANCELLED) return;
          o.items.forEach(i => {
              if (i.productId) soldMap.set(i.productId, (soldMap.get(i.productId) || 0) + i.quantity);
          });
      });

      let updated = 0;
      for (const p of prods) {
          const sold = soldMap.get(p.id) || 0;
          const totalImported = p.totalImported || 0;
          
          // Fallback: If totalImported is 0 but we have sales or stock, assume initial imported was (CurrentStock + Sold)
          // This is only for legacy data migration. For correct logic, totalImported should rely on ImportHistory or User Input.
          const effectiveImported = totalImported === 0 && p.stockQuantity !== -sold 
                ? (p.stockQuantity + sold) 
                : totalImported;

          const calculatedStock = effectiveImported - sold;

          if (p.stockQuantity !== calculatedStock || p.totalImported !== effectiveImported) {
              p.stockQuantity = calculatedStock;
              p.totalImported = effectiveImported;
              p.updatedAt = Date.now();
              await storageService.saveProduct(p);
              updated++;
          }
      }
      return updated;
  },

  cleanAndMergeDuplicateProducts: async () => {
      const list = ensureProductsLoaded();
      const groups = new Map<string, Product[]>();
      list.forEach(p => {
          const k = generateProductSku(p.name);
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(p);
      });
      let merged = 0;
      for (const [key, group] of groups.entries()) {
          if (group.length <= 1) continue;
          group.sort((a,b) => b.stockQuantity - a.stockQuantity);
          const primary = group[0];
          const dups = group.slice(1);
          for (const d of dups) {
              primary.stockQuantity += d.stockQuantity;
              primary.totalImported = (primary.totalImported || 0) + (d.totalImported || 0);
              await storageService.deleteProduct(d.id);
              merged++;
          }
          primary.id = key;
          await storageService.saveProduct(primary);
      }
      return { mergedCount: merged, fixedOrders: 0 };
  },

  syncProductToPendingOrders: async (p: Product) => {
      const list = ensureOrdersLoaded();
      const ordersToUpdate: Order[] = [];
      
      list.forEach(o => {
          if (o.status === OrderStatus.PENDING) {
              let updated = false;
              const newItems = o.items.map(i => {
                  if (i.productId === p.id) {
                      // Check if name, price or importPrice changed
                      if (i.name !== p.name || i.price !== p.defaultPrice || i.importPrice !== p.importPrice) {
                          updated = true;
                          return {
                              ...i,
                              name: p.name,
                              price: p.defaultPrice,
                              importPrice: p.importPrice
                          };
                      }
                  }
                  return i;
              });
              
              if (updated) {
                  const newTotal = newItems.reduce((s, it) => s + (it.price * it.quantity), 0);
                  ordersToUpdate.push({ ...o, items: newItems, totalPrice: newTotal, updatedAt: Date.now() });
              }
          }
      });

      if (ordersToUpdate.length > 0) {
          await storageService.saveOrdersList(ordersToUpdate);
      }
      return ordersToUpdate.length;
  },

  refreshOrdersFromInventory: async (orderIds: string[]) => {
      const orders = ensureOrdersLoaded();
      const products = ensureProductsLoaded();
      const ordersToUpdate: Order[] = [];

      orders.forEach(o => {
          if (!orderIds.includes(o.id)) return;

          let updated = false;
          const newItems = o.items.map(item => {
              if (item.productId) {
                  const p = products.find(prod => prod.id === item.productId);
                  if (p) {
                      if (item.name !== p.name || item.price !== p.defaultPrice || item.importPrice !== p.importPrice) {
                          updated = true;
                          return {
                              ...item,
                              name: p.name,
                              price: p.defaultPrice,
                              importPrice: p.importPrice
                          };
                      }
                  }
              }
              return item;
          });

          if (updated) {
              const newTotal = newItems.reduce((s, it) => s + (it.price * it.quantity), 0);
              ordersToUpdate.push({ ...o, items: newItems, totalPrice: newTotal, updatedAt: Date.now() });
          }
      });

      if (ordersToUpdate.length > 0) {
          await storageService.saveOrdersList(ordersToUpdate);
      }
      return ordersToUpdate.length;
  },

  // --- ORDER MANAGEMENT ---
  subscribeOrders: (callback: (orders: Order[]) => void) => {
    // 1. Initial Load
    callback(ensureOrdersLoaded());

    // 2. Listen for Local Updates (Fix: Immediate UI Refresh)
    const handleLocalUpdate = () => {
        callback(ensureOrdersLoaded());
    };
    window.addEventListener('storage_' + ORDER_KEY, handleLocalUpdate);

    // 3. Listen for Cloud Updates
    let unsubFirestore = () => {};
    if (isOnline()) {
        const q = query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(400));
        unsubFirestore = onSnapshot(q, (snap) => {
            const list: Order[] = [];
            snap.forEach(d => list.push(d.data() as Order));
            _memoryOrders = list;
            localStorage.setItem(ORDER_KEY, JSON.stringify(list));
            callback(list);
        });
    }

    // Return Cleanup Function
    return () => {
        window.removeEventListener('storage_' + ORDER_KEY, handleLocalUpdate);
        unsubFirestore();
    };
  },

  saveOrder: async (order: Order) => {
    const now = Date.now();
    const oSave = { ...order, updatedAt: now };
    const list = ensureOrdersLoaded();
    list.unshift(oSave);
    _memoryOrders = list;
    localStorage.setItem(ORDER_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('storage_' + ORDER_KEY));

    // THÔNG BÁO: Đơn mới
    storageService.addNotification({
        title: 'Đơn hàng mới',
        message: `Khách "${order.customerName}" vừa đặt ${order.items.length} món. Tổng: ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ.`,
        type: 'success',
        relatedOrderId: order.id
    });

    // Learn from customer info automatically
    storageService.learnCustomerInfo(order);

    const prods = ensureProductsLoaded();
    order.items.forEach(item => {
        if (item.productId) {
            const p = prods.find(x => x.id === item.productId);
            if (p) { 
                const oldStock = p.stockQuantity;
                p.stockQuantity -= item.quantity; 
                p.updatedAt = now; 
                
                // Cảnh báo hết hàng ngay khi trừ kho
                if (p.stockQuantity < 5 && oldStock >= 5) {
                    storageService.addNotification({
                        title: 'Kho sắp cạn!',
                        message: `Hàng "${p.name}" chỉ còn ${p.stockQuantity} món sau đơn #${order.id}.`,
                        type: 'warning'
                    });
                }
            }
        }
    });
    localStorage.setItem(PRODUCT_KEY, JSON.stringify(prods));
    window.dispatchEvent(new Event('storage_' + PRODUCT_KEY)); // Fix: Notify inventory change immediately

    await safeCloudOp(() => runTransaction(db, async (tx) => {
        for (const item of order.items) {
            if (item.productId) {
                const ref = doc(db, "products", item.productId);
                tx.update(ref, { stockQuantity: increment(-item.quantity), updatedAt: now });
            }
        }
        tx.set(doc(db, "orders", oSave.id), sanitize(oSave));
    }));
  },

  updateOrderDetails: async (order: Order) => {
      const list = ensureOrdersLoaded();
      const idx = list.findIndex(o => o.id === order.id);
      if (idx >= 0) {
          list[idx] = { ...order, updatedAt: Date.now() };
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));
          await safeCloudOp(() => setDoc(doc(db, "orders", order.id), sanitize(list[idx])));
      }
  },

  saveOrdersList: async (orders: Order[]) => {
      const list = ensureOrdersLoaded();
      orders.forEach(updatedOrder => {
          const idx = list.findIndex(o => o.id === updatedOrder.id);
          if (idx >= 0) list[idx] = { ...updatedOrder, updatedAt: Date.now() };
      });
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      if (isOnline()) {
          const batch = writeBatch(db);
          orders.forEach(o => batch.set(doc(db, "orders", o.id), sanitize(o))); // Use set to update all fields including items
          await batch.commit();
      }
  },

  updateStatus: async (id: string, status: OrderStatus, proof?: string, cust?: any) => {
      const list = ensureOrdersLoaded();
      const idx = list.findIndex(o => o.id === id);
      if (idx >= 0) {
          list[idx] = { ...list[idx], status, updatedAt: Date.now(), deliveryProof: proof || list[idx].deliveryProof };
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));
          await safeCloudOp(() => updateDoc(doc(db, "orders", id), { status, updatedAt: Date.now(), deliveryProof: proof || deleteField() }));
      }
  },

  deleteOrder: async (id: string, cust?: any) => {
      const list = ensureOrdersLoaded().filter(o => o.id !== id);
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      await safeCloudOp(() => deleteDoc(doc(db, "orders", id)));
  },

  deleteOrdersBatch: async (ids: string[]) => {
      const list = ensureOrdersLoaded().filter(o => !ids.includes(o.id));
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      if (isOnline()) {
          const batch = writeBatch(db);
          ids.forEach(id => batch.delete(doc(db, "orders", id)));
          await batch.commit();
      }
  },

  moveOrdersBatch: async (ids: string[], targetBatch: string) => {
      const list = ensureOrdersLoaded();
      ids.forEach(id => {
          const o = list.find(x => x.id === id);
          if (o) o.batchId = targetBatch;
      });
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      if (isOnline()) {
          const batch = writeBatch(db);
          ids.forEach(id => batch.update(doc(db, "orders", id), { batchId: targetBatch, updatedAt: Date.now() }));
          await batch.commit();
      }
  },

  splitOrderToNextBatch: async (id: string, currentBatchId: string) => {
      const today = new Date().toISOString().slice(0, 10);
      const nextBatch = currentBatchId.includes(today) ? `LÔ-SAU-${today}` : `LÔ-${today}-2`;
      await storageService.moveOrdersBatch([id], nextBatch);
  },

  splitOrdersBatch: async (items: {id: string, batchId: string}[]) => {
      const today = new Date().toISOString().slice(0, 10);
      const ids = items.map(i => i.id);
      const nextBatch = `LÔ-SAU-${today}`;
      await storageService.moveOrdersBatch(ids, nextBatch);
  },

  renameBatch: async (oldName: string, newName: string) => {
      const list = ensureOrdersLoaded();
      const ids: string[] = [];
      list.forEach(o => {
          if (o.batchId === oldName) {
              o.batchId = newName;
              ids.push(o.id);
          }
      });
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      if (isOnline() && ids.length > 0) {
          const batch = writeBatch(db);
          ids.forEach(id => batch.update(doc(db, "orders", id), { batchId: newName, updatedAt: Date.now() }));
          await batch.commit();
      }
  },

  updatePaymentVerification: async (id: string, verified: boolean, cust?: any) => {
      const list = ensureOrdersLoaded();
      const idx = list.findIndex(o => o.id === id);
      if (idx >= 0) {
          list[idx].paymentVerified = verified;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));
          
          // THÔNG BÁO: Tiền về
          if (verified) {
              storageService.addNotification({
                  title: 'Xác nhận tiền về',
                  message: `Đơn #${id} của khách "${list[idx].customerName}" đã được thanh toán ${new Intl.NumberFormat('vi-VN').format(list[idx].totalPrice)}đ.`,
                  type: 'info',
                  relatedOrderId: id
              });
          }

          await safeCloudOp(() => updateDoc(doc(db, "orders", id), { paymentVerified: verified, updatedAt: Date.now() }));
      }
  },

  incrementReminderCount: async (ids: string[]) => {
      const list = ensureOrdersLoaded();
      ids.forEach(id => {
          const o = list.find(x => x.id === id);
          if (o) o.reminderCount = (o.reminderCount || 0) + 1;
      });
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      if (isOnline()) {
          const batch = writeBatch(db);
          ids.forEach(id => batch.update(doc(db, "orders", id), { reminderCount: increment(1) }));
          await batch.commit();
      }
  },

  deleteDeliveryProof: async (id: string) => {
      const list = ensureOrdersLoaded();
      const idx = list.findIndex(o => o.id === id);
      if (idx >= 0) {
          list[idx].deliveryProof = undefined;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));
          await safeCloudOp(() => updateDoc(doc(db, "orders", id), { deliveryProof: deleteField() }));
      }
  },

  getProductOrderHistory: (productId: string) => {
      const orders = ensureOrdersLoaded();
      const history: { order: Order, quantity: number }[] = [];
      orders.forEach(o => {
          o.items.forEach(i => {
              if (i.productId === productId) history.push({ order: o, quantity: i.quantity });
          });
      });
      return history;
  },

  learnRoutePriority: async (sortedOrders: Order[]) => {
      for (let i = 0; i < sortedOrders.length; i++) {
          const o = sortedOrders[i];
          if (o.customerId) {
              const custList = await storageService.getAllCustomers();
              const cust = custList.find(c => c.id === o.customerId);
              if (cust) {
                  cust.priorityScore = i + 1;
                  await storageService.upsertCustomer(cust);
              }
          }
      }
  },

  // --- CUSTOMER MANAGEMENT ---
  subscribeCustomers: (callback: (c: Customer[]) => void) => {
      callback(ensureCustomersLoaded());
      if (isOnline()) {
          return onSnapshot(collection(db, "customers"), (snap) => {
              const l: Customer[] = [];
              snap.forEach(d => l.push(d.data() as Customer));
              if (l.length > 0) {
                _memoryCustomers = l;
                localStorage.setItem(CUSTOMER_KEY, JSON.stringify(l));
                callback(l);
              }
          });
      }
  },

  getAllCustomers: async (): Promise<Customer[]> => {
      return ensureCustomersLoaded();
  },

  upsertCustomer: async (c: Customer) => {
      const list = ensureCustomersLoaded();
      const idx = list.findIndex(x => x.id === c.id);
      const cSave = { ...c, updatedAt: Date.now() };
      if (idx >= 0) list[idx] = cSave; else list.unshift(cSave);
      _memoryCustomers = list;
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
      await safeCloudOp(() => setDoc(doc(db, "customers", c.id), sanitize(cSave)));
  },

  deleteCustomer: async (id: string) => {
      const list = ensureCustomersLoaded().filter(c => c.id !== id);
      _memoryCustomers = list;
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
      await safeCloudOp(() => deleteDoc(doc(db, "customers", id)));
  },

  importCustomersBatch: async (customers: Customer[], localOnly: boolean = false) => {
      const list = ensureCustomersLoaded();
      const newMap = new Map<string, Customer>(list.map(c => [c.id, c]));
      customers.forEach(c => newMap.set(c.id, { ...c, updatedAt: Date.now() }));
      const finalList = Array.from(newMap.values());
      _memoryCustomers = finalList;
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(finalList));
      if (!localOnly && isOnline()) {
          const chunks = [];
          for (let i = 0; i < customers.length; i += 400) {
              chunks.push(customers.slice(i, i + 400));
          }
          for (const chunk of chunks) {
              const batch = writeBatch(db);
              chunk.forEach(c => batch.set(doc(db, "customers", c.id), sanitize(c)));
              await batch.commit();
          }
      }
  },

  clearAllCustomers: async (localOnly: boolean = false) => {
      localStorage.removeItem(CUSTOMER_KEY);
      _memoryCustomers = [];
      if (!localOnly && isOnline()) {
          const snap = await getDocs(collection(db, "customers"));
          const batch = writeBatch(db);
          snap.forEach(d => batch.delete(d.ref));
          await batch.commit();
      }
  },

  markAllCustomersAsOld: async () => {
      const list = ensureCustomersLoaded();
      list.forEach(c => { c.isLegacy = true; c.totalOrders = (c.totalOrders || 0) + 1; });
      await storageService.importCustomersBatch(list);
      return list.length;
  },

  fixDuplicateCustomerIds: async () => {
      const list = ensureCustomersLoaded();
      const seen = new Set();
      let fixed = 0;
      for (const c of list) {
          if (seen.has(c.id)) {
              c.id = uuidv4();
              fixed++;
          }
          seen.add(c.id);
      }
      if (fixed > 0) await storageService.importCustomersBatch(list);
      return fixed;
  },

  mergeCustomersByPhone: async () => {
      const list = ensureCustomersLoaded();
      const phoneMap = new Map<string, Customer[]>();
      list.forEach(c => {
          if (c.phone) {
              const p = normalizePhone(c.phone);
              if (!phoneMap.has(p)) phoneMap.set(p, []);
              phoneMap.get(p)!.push(c);
          }
      });
      let mergedGroups = 0;
      for (const [phone, group] of phoneMap.entries()) {
          if (group.length > 1) {
              group.sort((a, b) => (b.totalOrders || 0) - (a.totalOrders || 0));
              const primary = group[0];
              for (let i = 1; i < group.length; i++) {
                  primary.totalOrders = (primary.totalOrders || 0) + (group[i].totalOrders || 0);
                  await storageService.deleteCustomer(group[i].id);
              }
              await storageService.upsertCustomer(primary);
              mergedGroups++;
          }
      }
      return mergedGroups;
  },

  isNewCustomer: (phone: string, addr: string, id?: string) => {
      const list = ensureOrdersLoaded();
      if (id) return !list.some(o => o.customerId === id);
      const p = normalizePhone(phone);
      if (p.length > 8) return !list.some(o => normalizePhone(o.customerPhone) === p);
      return !list.some(o => normalizeString(o.address) === normalizeString(addr));
  },

  findMatchingCustomer: (phone: string, addr: string, id?: string) => {
      const list = ensureCustomersLoaded();
      if (id) return list.find(c => c.id === id);
      const p = normalizePhone(phone);
      if (p.length > 8) return list.find(c => normalizePhone(c.phone) === p);
      const nAddr = normalizeString(addr);
      return list.find(c => normalizeString(c.address) === nAddr);
  },

  // --- NOTIFICATION MANAGEMENT ---
  subscribeNotifications: (callback: (notifs: Notification[]) => void) => {
      const load = () => {
          try {
              const local = localStorage.getItem(NOTIF_KEY);
              callback(local ? (JSON.parse(local) as Notification[]) : []);
          } catch { callback([]); }
      };
      load();
      if (isOnline()) {
          return onSnapshot(query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(50)), (snap) => {
              const list: Notification[] = [];
              snap.forEach(d => list.push(d.data() as Notification));
              localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
              callback(list);
          });
      }
  },

  markNotificationRead: async (id: string) => {
      await safeCloudOp(() => updateDoc(doc(db, "notifications", id), { isRead: true }));
      window.dispatchEvent(new CustomEvent('local_notif_read', { detail: id }));
  },

  markAllNotificationsRead: async () => {
      if (isOnline()) {
          const snap = await getDocs(query(collection(db, "notifications"), where("isRead", "==", false)));
          const batch = writeBatch(db);
          snap.forEach(d => batch.update(d.ref, { isRead: true }));
          await batch.commit();
      }
      window.dispatchEvent(new Event('local_notif_read_all'));
  },

  clearAllNotifications: async () => {
      localStorage.removeItem(NOTIF_KEY);
      if (isOnline()) {
          const snap = await getDocs(collection(db, "notifications"));
          const batch = writeBatch(db);
          snap.forEach(d => batch.delete(d.ref));
          await batch.commit();
      }
      window.dispatchEvent(new Event('local_notif_clear_all'));
  },

  // --- UTILS ---
  fetchLongTermStats: async (): Promise<Order[]> => {
      if (isOnline()) {
          const snap = await getDocs(query(collection(db, "orders"), limit(2000)));
          return snap.docs.map(d => d.data() as Order);
      }
      return ensureOrdersLoaded();
  },

  generatePerformanceData: async (count: number) => {
      const start = Date.now();
      const fakeCustomers: Customer[] = [];
      for (let i = 0; i < count; i++) {
          const newCustomer: Customer = {
              id: uuidv4(),
              name: `Khách Hàng Ảo ${i}`,
              phone: `09${Math.floor(10000000 + Math.random() * 90000000)}`,
              address: `${i} Đường ABC, Quận XYZ, TP. HCM`,
              lastOrderDate: Date.now(),
              priorityScore: 999
          };
          fakeCustomers.push(newCustomer);
      }
      await storageService.importCustomersBatch(fakeCustomers, true);
      return { count, duration: Date.now() - start };
  }
};
