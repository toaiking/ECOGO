import { Order, OrderStatus, Product, Customer, BankConfig, Notification } from '../types';
import { db } from '../firebaseConfig';
import { v4 as uuidv4 } from 'uuid';
import { 
  collection, 
  addDoc, 
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
  Timestamp
} from "firebase/firestore";

const ORDER_KEY = 'ecogo_orders_v3'; 
const PRODUCT_KEY = 'ecogo_products_v1';
const CUSTOMER_KEY = 'ecogo_customers_v1';
const USER_KEY = 'ecogo_current_user';
const BANK_KEY = 'ecogo_bank_config';
const NOTIF_KEY = 'ecogo_notifications_v1';
const TAGS_KEY = 'ecogo_quick_tags';
const QUOTA_KEY = 'ecogo_quota_status';
const LOGO_KEY = 'ecogo_company_logo';

// --- CIRCUIT BREAKER FOR QUOTA ---
const checkQuotaStatus = () => {
    try {
        const stored = localStorage.getItem(QUOTA_KEY);
        if (stored) {
            const { date, exhausted } = JSON.parse(stored);
            const today = new Date().toDateString();
            if (date === today && exhausted) {
                console.warn("⚠️ Quota limit recorded for today. Starting in Offline Mode.");
                return true;
            }
            if (date !== today) {
                localStorage.removeItem(QUOTA_KEY);
            }
        }
    } catch (e) {
        console.error(e);
    }
    return false;
};

let _quotaExhausted = checkQuotaStatus();

const markQuotaExhausted = () => {
    if (!_quotaExhausted) {
        _quotaExhausted = true;
        const status = { date: new Date().toDateString(), exhausted: true };
        localStorage.setItem(QUOTA_KEY, JSON.stringify(status));
        console.warn("🔥 Firebase Quota Exceeded. Switching to Local-Only mode for the rest of the day.");
        window.dispatchEvent(new Event('quota_exhausted'));
    }
};

const isOnline = () => !!db && !_quotaExhausted;

// --- PERFORMANCE OPTIMIZATION: IN-MEMORY CACHE ---
let _memoryCustomers: Customer[] | null = null;
let _memoryOrders: Order[] | null = null;
let _memoryProducts: Product[] | null = null;

// Indices for O(1) lookup
let _phoneIndex: Map<string, Customer> | null = null;
let _addressIndex: Map<string, Customer> | null = null;
let _idIndex: Map<string, Customer> | null = null;

// Debounce timers
let _customerSaveTimer: any = null;
let _orderSaveTimer: any = null;

const invalidateIndices = () => {
    _phoneIndex = null;
    _addressIndex = null;
    _idIndex = null;
};

// String Normalization Helper
const normalizeString = (str: string): string => {
    if (!str) return "";
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9\s]/g, " ") 
        .replace(/\s+/g, " ") 
        .trim()
        .toLowerCase();
};

const normalizePhone = (phone: string) => {
    if (!phone) return '';
    let p = phone.replace(/[^0-9]/g, '');
    if (p.startsWith('84')) p = '0' + p.slice(2);
    return p;
};

// --- CUSTOMER ID GENERATION STRATEGY ---
const generateCustomerId = (name: string, phone: string, address: string): string => {
    const cleanPhone = normalizePhone(phone);
    if (cleanPhone && cleanPhone.length > 5) return cleanPhone;
    
    const key = normalizeString(name) + "_" + normalizeString(address);
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        const char = key.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return `NOP_${Math.abs(hash).toString(16)}`;
};

const ensureCustomersLoaded = () => {
    if (_memoryCustomers) return _memoryCustomers;
    try {
        const local = localStorage.getItem(CUSTOMER_KEY);
        _memoryCustomers = local ? JSON.parse(local) : [];
    } catch {
        _memoryCustomers = [];
    }
    return _memoryCustomers;
};

const ensureOrdersLoaded = () => {
    if (_memoryOrders) return _memoryOrders;
    try {
        const local = localStorage.getItem(ORDER_KEY);
        _memoryOrders = local ? JSON.parse(local) : [];
    } catch {
        _memoryOrders = [];
    }
    return _memoryOrders;
};

const buildIndices = () => {
    if (_phoneIndex && _addressIndex && _idIndex) return;
    
    const list = ensureCustomersLoaded();
    if (!list) return;

    _phoneIndex = new Map<string, Customer>();
    _addressIndex = new Map<string, Customer>();
    _idIndex = new Map<string, Customer>();

    for (const c of list) {
        _idIndex.set(c.id, c);
        if (c.phone && c.phone.length > 5) {
            _phoneIndex.set(normalizePhone(c.phone), c);
        }
        if (c.address && c.address.length > 5) {
            const normAddr = normalizeString(c.address);
            const existing = _addressIndex.get(normAddr);
            if (!existing || (c.priorityScore || 999) < (existing.priorityScore || 999)) {
                _addressIndex.set(normAddr, c);
            }
        }
    }
};

const findMatchingCustomer = (orderPhone: string, orderAddress: string): Customer | undefined => {
    buildIndices(); 
    
    if (orderPhone) {
        const normPhone = normalizePhone(orderPhone);
        if (_phoneIndex?.has(normPhone)) {
            return _phoneIndex.get(normPhone);
        }
    }

    if (orderAddress) {
        const normAddr = normalizeString(orderAddress);
        if (_addressIndex?.has(normAddr)) {
            return _addressIndex.get(normAddr);
        }
    }

    return undefined;
};

const sanitize = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj));
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const safeCloudOp = async (operation: () => Promise<any>) => {
    if (!isOnline()) return;
    try {
        await operation();
    } catch (error: any) {
        if (error.code === 'resource-exhausted') {
            markQuotaExhausted();
        } else {
            console.error("Cloud Op Failed:", error);
        }
    }
};

const DEFAULT_TAGS = ["Giao giờ HC", "Gọi trước", "Dễ vỡ", "Cho xem hàng", "Giao gấp", "Cổng sau"];

export const storageService = {
  login: (username: string) => { localStorage.setItem(USER_KEY, username); },
  logout: () => { localStorage.removeItem(USER_KEY); },
  getCurrentUser: (): string | null => { return localStorage.getItem(USER_KEY); },

  // --- LOGO MANAGEMENT ---
  getLogo: (): string | null => {
      return localStorage.getItem(LOGO_KEY);
  },
  
  saveLogo: (base64String: string) => {
      try {
          localStorage.setItem(LOGO_KEY, base64String);
          window.dispatchEvent(new Event('logo_updated'));
      } catch (e) {
          console.error("Logo too large for localStorage", e);
          throw new Error("Ảnh quá lớn, vui lòng chọn ảnh nhỏ hơn (< 4MB)");
      }
  },

  removeLogo: () => {
      localStorage.removeItem(LOGO_KEY);
      window.dispatchEvent(new Event('logo_updated'));
  },

  // --- QUICK TAGS ---
  getQuickTags: (): string[] => {
      try {
          const local = localStorage.getItem(TAGS_KEY);
          return local ? JSON.parse(local) : DEFAULT_TAGS;
      } catch {
          return DEFAULT_TAGS;
      }
  },

  saveQuickTags: async (tags: string[]) => {
      localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
      window.dispatchEvent(new Event('local_tags_updated'));
      await safeCloudOp(() => setDoc(doc(db, "settings", "quickTags"), { tags }));
  },

  fetchQuickTagsFromCloud: async () => {
      if (isOnline()) {
          try {
              const snap = await getDoc(doc(db, "settings", "quickTags"));
              if (snap.exists()) {
                  const data = snap.data();
                  if (data.tags && Array.isArray(data.tags)) {
                      localStorage.setItem(TAGS_KEY, JSON.stringify(data.tags));
                      window.dispatchEvent(new Event('local_tags_updated'));
                      return data.tags;
                  }
              }
          } catch (e) { console.warn("Fetch tags failed", e); }
      }
      return storageService.getQuickTags();
  },

  // --- BANK CONFIG ---
  saveBankConfig: async (config: BankConfig): Promise<void> => {
      localStorage.setItem(BANK_KEY, JSON.stringify(config));
      await safeCloudOp(() => setDoc(doc(db, "settings", "bankConfig"), sanitize(config)));
  },

  getBankConfig: async (): Promise<BankConfig | null> => {
      const localData = localStorage.getItem(BANK_KEY);
      if (localData) return JSON.parse(localData);
      
      let config: BankConfig | null = null;
      await safeCloudOp(async () => {
             const snap = await getDocs(collection(db, "settings"));
             snap.forEach(d => { if (d.id === 'bankConfig') config = d.data() as BankConfig; });
      });
      
      if (config) { localStorage.setItem(BANK_KEY, JSON.stringify(config)); }
      return config;
  },

  // --- SYNC ---
  syncLocalToCloud: async (): Promise<number> => {
    if (!isOnline()) throw new Error("Chưa kết nối Firebase hoặc Hết hạn mức");
    
    try {
        const localOrders = ensureOrdersLoaded();
        const localProducts = JSON.parse(localStorage.getItem(PRODUCT_KEY) || '[]');
        const localCustomers = ensureCustomersLoaded();
        const localTags = storageService.getQuickTags();

        let totalSynced = 0;
        const CHUNK_SIZE = 300; 

        // Sync settings first
        await safeCloudOp(() => setDoc(doc(db, "settings", "quickTags"), { tags: localTags }));

        const syncCollection = async (items: any[], colName: string) => {
            if (!items || items.length === 0) return;
            if (_quotaExhausted) return; 
            
            for (let i = 0; i < items.length; i += CHUNK_SIZE) {
                if (_quotaExhausted) break;

                const chunk = items.slice(i, i + CHUNK_SIZE);
                const batch = writeBatch(db);
                
                chunk.forEach(item => {
                    if (item.id) {
                        batch.set(doc(db, colName, item.id), sanitize(item));
                    }
                });

                try {
                    await batch.commit();
                    totalSynced += chunk.length;
                    await delay(500); 
                } catch (e: any) {
                    if (e.code === 'resource-exhausted') {
                         markQuotaExhausted();
                         throw new Error("Hết hạn mức Firebase. Đã dừng đồng bộ.");
                    }
                    throw e; 
                }
            }
        };

        if (localOrders) await syncCollection(localOrders, "orders");
        await syncCollection(localProducts, "products");
        if (localCustomers) await syncCollection(localCustomers, "customers");

        return totalSynced;
    } catch (error) { 
        console.error("Sync error:", error); 
        throw error; 
    }
  },

  // --- PRODUCTS ---
  subscribeProducts: (callback: (products: Product[]) => void) => {
    const load = () => { 
        try {
            const data = localStorage.getItem(PRODUCT_KEY); 
            _memoryProducts = data ? JSON.parse(data) : [];
            callback(_memoryProducts || []); 
        } catch { callback([]); }
    };
    load();

    if (isOnline()) {
        const q = query(collection(db, "products"));
        return onSnapshot(q, (snapshot) => {
            const list: Product[] = [];
            snapshot.forEach(d => list.push(d.data() as Product));
            _memoryProducts = list;
            localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
            callback(list);
        }, (err) => {
            if (err.code === 'resource-exhausted') {
                markQuotaExhausted();
            }
        });
    } else {
        const handler = () => load();
        window.addEventListener('storage_' + PRODUCT_KEY, handler);
        return () => window.removeEventListener('storage_' + PRODUCT_KEY, handler);
    }
  },

  saveProduct: async (product: Product) => {
      let list = _memoryProducts || [];
      if (list.length === 0) {
           const local = localStorage.getItem(PRODUCT_KEY);
           if(local) list = JSON.parse(local);
      }
      const idx = list.findIndex(p => p.id === product.id);
      if (idx >= 0) list[idx] = product; else list.push(product);
      
      _memoryProducts = list;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));

      await safeCloudOp(() => setDoc(doc(db, "products", product.id), sanitize(product)));
  },

  deleteProduct: async (id: string) => {
      let list = _memoryProducts || [];
      if (list.length === 0) {
           const local = localStorage.getItem(PRODUCT_KEY);
           if(local) list = JSON.parse(local);
      }
      list = list.filter(p => p.id !== id);
      _memoryProducts = list;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
      await safeCloudOp(() => deleteDoc(doc(db, "products", id)));
  },

  // --- CUSTOMERS (DELTA SYNC ENGINE) ---
  subscribeCustomers: (callback: (customers: Customer[]) => void) => {
      const list = ensureCustomersLoaded();
      if (list) callback(list);

      if (isOnline()) {
          const fetchDelta = async () => {
              try {
                  const maxUpdatedAt = list ? Math.max(...list.map(c => c.updatedAt || 0)) : 0;
                  const q = query(collection(db, "customers"), where("updatedAt", ">", maxUpdatedAt));
                  const snapshot = await getDocs(q);
                  
                  if (!snapshot.empty) {
                      const currentList = ensureCustomersLoaded() || [];
                      const customerMap = new Map<string, Customer>();
                      currentList.forEach(c => customerMap.set(c.id, c));

                      let changesCount = 0;
                      snapshot.forEach(doc => {
                          const data = doc.data() as Customer;
                          const existing = customerMap.get(data.id);
                          if (!existing || (data.updatedAt || 0) > (existing.updatedAt || 0)) {
                              customerMap.set(data.id, data);
                              changesCount++;
                          }
                      });

                      const newList = Array.from(customerMap.values());
                      _memoryCustomers = newList;
                      invalidateIndices();
                      
                      callback(newList);
                      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(newList));
                  }

                  const now = Date.now();
                  const rtQuery = query(collection(db, "customers"), where("updatedAt", ">", now));
                  
                  return onSnapshot(rtQuery, (snap) => {
                      if(snap.empty) return;
                      const current = ensureCustomersLoaded() || [];
                      const map = new Map(current.map(c => [c.id, c]));
                      
                      snap.forEach(d => {
                          const data = d.data() as Customer;
                          map.set(data.id, data);
                      });
                      
                      const updatedList = Array.from(map.values());
                      _memoryCustomers = updatedList;
                      invalidateIndices();
                      callback(updatedList);
                      
                      if (_customerSaveTimer) clearTimeout(_customerSaveTimer);
                      _customerSaveTimer = setTimeout(() => {
                          localStorage.setItem(CUSTOMER_KEY, JSON.stringify(updatedList));
                      }, 2000);
                  }, (error) => {
                      if (error.code === 'resource-exhausted') {
                          markQuotaExhausted();
                      }
                  });

              } catch (e: any) {
                  if (e.code === 'resource-exhausted') {
                      markQuotaExhausted();
                  } else {
                      console.warn("Delta sync skipped/failed:", e.message);
                  }
              }
          };

          fetchDelta();
      } else {
          const handler = () => {
              const list = ensureCustomersLoaded();
              if (list) callback(list);
          };
          window.addEventListener('storage_' + CUSTOMER_KEY, handler);
          return () => window.removeEventListener('storage_' + CUSTOMER_KEY, handler);
      }
  },

  searchCustomers: async (term: string): Promise<Customer[]> => {
      const list = ensureCustomersLoaded();
      if (!list || !term) return [];
      
      const lowerTerm = term.toLowerCase().trim();
      const results: Customer[] = [];
      const MAX_RESULTS = 10;
      
      for (const c of list) {
          if (results.length >= MAX_RESULTS) break;
          if (c.name.toLowerCase().includes(lowerTerm) || 
              (c.phone && c.phone.includes(lowerTerm)) || 
              c.address.toLowerCase().includes(lowerTerm)) {
              results.push(c);
          }
      }
      return results;
  },

  upsertCustomer: async (customer: Customer) => {
      const list = ensureCustomersLoaded() || [];
      const idx = list.findIndex(c => c.id === customer.id);
      
      const customerToSave = { ...customer, updatedAt: Date.now() };
      
      if (idx >= 0) list[idx] = customerToSave; 
      else list.push(customerToSave);
      
      _memoryCustomers = list;
      invalidateIndices();

      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
      
      if (_customerSaveTimer) clearTimeout(_customerSaveTimer);
      _customerSaveTimer = setTimeout(() => {
           localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
      }, 1000);

      await safeCloudOp(() => setDoc(doc(db, "customers", customerToSave.id), sanitize(customerToSave)));
  },

  deleteCustomer: async (id: string) => {
      let list = ensureCustomersLoaded() || [];
      list = list.filter(c => c.id !== id);
      _memoryCustomers = list;
      invalidateIndices();
      
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));

      await safeCloudOp(() => deleteDoc(doc(db, "customers", id)));
  },

  clearAllCustomers: async (skipCloud = false) => {
      _memoryCustomers = [];
      invalidateIndices();
      localStorage.removeItem(CUSTOMER_KEY);
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
      
      if (!skipCloud && isOnline()) {
          const deleteBatch = async () => {
             if (_quotaExhausted) return;

             const q = query(collection(db, "customers"), limit(400));
             try {
                const snap = await getDocs(q);
                if (snap.empty) return;

                const batch = writeBatch(db);
                snap.forEach(d => batch.delete(d.ref));
                await batch.commit();
                await delay(500); 
                await deleteBatch();
             } catch (e: any) {
                if (e.code === 'resource-exhausted') {
                    markQuotaExhausted();
                }
             }
          };

          await safeCloudOp(async () => {
              await deleteBatch();
          });
      }
  },

  importCustomersBatch: async (customers: Customer[], skipCloud = false) => {
      const currentList = ensureCustomersLoaded() || [];
      const map = new Map<string, Customer>();
      
      currentList.forEach(c => map.set(c.id, c));
      
      customers.forEach(c => {
          const id = c.id || generateCustomerId(c.name, c.phone, c.address);
          const finalCustomer = { ...c, id, updatedAt: Date.now() };
          
          const existing = map.get(id);
          if (!existing) {
              map.set(id, finalCustomer);
          } else {
              map.set(id, {
                  ...finalCustomer,
                  lastOrderDate: Math.max(existing.lastOrderDate, finalCustomer.lastOrderDate),
                  totalOrders: existing.totalOrders
              });
          }
      }); 
      
      const newList = Array.from(map.values());
      _memoryCustomers = newList;
      invalidateIndices(); 

      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(newList));
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));

      if (isOnline() && !skipCloud) {
          const CHUNK_SIZE = 200; 
          for (let i = 0; i < customers.length; i += CHUNK_SIZE) {
              if (_quotaExhausted) break;
              const chunk = customers.slice(i, i + CHUNK_SIZE);
              const batch = writeBatch(db);
              chunk.forEach(c => {
                  const id = c.id || generateCustomerId(c.name, c.phone, c.address);
                  batch.set(doc(db, "customers", id), sanitize({ ...c, id, updatedAt: Date.now() }));
              });
              try {
                await batch.commit();
                await delay(300); 
              } catch (e: any) {
                 if (e.code === 'resource-exhausted') {
                     markQuotaExhausted();
                     break; 
                 }
              }
          }
      }
      return customers.length;
  },

  // --- ORDERS ---
  subscribeOrders: (callback: (orders: Order[]) => void) => {
      const list = ensureOrdersLoaded();
      if (list) callback(list);

      if (isOnline()) {
          const q = query(collection(db, "orders"));
          return onSnapshot(q, (snapshot) => {
              const newList: Order[] = [];
              snapshot.forEach(d => newList.push(d.data() as Order));
              
              _memoryOrders = newList;
              callback(newList);

              if (_orderSaveTimer) clearTimeout(_orderSaveTimer);
              _orderSaveTimer = setTimeout(() => {
                  localStorage.setItem(ORDER_KEY, JSON.stringify(newList));
              }, 2000);
          }, (err) => {
              if (err.code === 'resource-exhausted') {
                  markQuotaExhausted();
              }
          });
      } else {
          const handler = () => {
              const list = ensureOrdersLoaded();
              if (list) callback(list);
          };
          window.addEventListener('storage_' + ORDER_KEY, handler);
          return () => window.removeEventListener('storage_' + ORDER_KEY, handler);
      }
  },

  saveOrder: async (order: Order) => {
      const cleanOrder = sanitize(order);
      const list = ensureOrdersLoaded() || [];
      list.unshift(cleanOrder);
      
      _memoryOrders = list;
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      
      await safeCloudOp(async () => {
          await setDoc(doc(db, "orders", order.id), cleanOrder);
      });
      
      await storageService.addNotification("Đơn hàng mới", `Đơn #${order.id} của ${order.customerName} đã được tạo.`, 'info', order.id);
  },

  deleteOrder: async (id: string, details?: { name: string, address: string }) => {
      let list = ensureOrdersLoaded() || [];
      list = list.filter(o => o.id !== id);
      
      _memoryOrders = list;
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      
      await safeCloudOp(() => deleteDoc(doc(db, "orders", id)));

      if (details) {
           await storageService.addNotification("Đã xóa đơn", `Đơn #${id} (${details.name}) đã bị xóa.`, 'warning');
      }
  },

  updateOrderDetails: async (order: Order) => {
      const updated = { 
          ...order, 
          updatedAt: Date.now(), 
          lastUpdatedBy: localStorage.getItem(USER_KEY) || 'Admin' 
      };

      const list = ensureOrdersLoaded() || [];
      const idx = list.findIndex(o => o.id === order.id);
      if (idx >= 0) {
           list[idx] = updated;
           _memoryOrders = list;
           window.dispatchEvent(new Event('storage_' + ORDER_KEY));
           localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      }

      await safeCloudOp(() => setDoc(doc(db, "orders", order.id), sanitize(updated)));
  },

  updateStatus: async (id: string, status: OrderStatus, proof?: string, details?: {name: string, address: string}) => {
      const updateData: any = { 
          status, 
          updatedAt: Date.now(),
          lastUpdatedBy: localStorage.getItem(USER_KEY) || 'Admin'
      };
      if (proof) updateData.deliveryProof = proof;

      const list = ensureOrdersLoaded() || [];
      const idx = list.findIndex(o => o.id === id);
      if (idx >= 0) {
           list[idx] = { ...list[idx], ...updateData };
           _memoryOrders = list;
           window.dispatchEvent(new Event('storage_' + ORDER_KEY));
           localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      }

      await safeCloudOp(() => updateDoc(doc(db, "orders", id), updateData));

      if (details && (status === OrderStatus.DELIVERED || status === OrderStatus.CANCELLED)) {
           const type = status === OrderStatus.DELIVERED ? 'success' : 'error';
           const msg = status === OrderStatus.DELIVERED ? `Đã giao thành công đơn #${id}` : `Đã hủy đơn #${id}`;
           await storageService.addNotification("Cập nhật trạng thái", msg, type, id);
      }
  },

  deleteDeliveryProof: async (id: string) => {
      const list = ensureOrdersLoaded() || [];
      const idx = list.findIndex(o => o.id === id);
      if (idx >= 0) {
           delete list[idx].deliveryProof;
           _memoryOrders = list;
           window.dispatchEvent(new Event('storage_' + ORDER_KEY));
           localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      }
      await safeCloudOp(() => updateDoc(doc(db, "orders", id), { deliveryProof: deleteField() }));
  },

  updatePaymentVerification: async (id: string, verified: boolean, details?: {name: string}) => {
      const updateData = { 
          paymentVerified: verified,
          updatedAt: Date.now(),
          lastUpdatedBy: localStorage.getItem(USER_KEY) || 'Admin'
      };

      const list = ensureOrdersLoaded() || [];
      const idx = list.findIndex(o => o.id === id);
      if (idx >= 0) {
           list[idx] = { ...list[idx], ...updateData };
           _memoryOrders = list;
           window.dispatchEvent(new Event('storage_' + ORDER_KEY));
           localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      }

      await safeCloudOp(() => updateDoc(doc(db, "orders", id), updateData));

      if (verified && details) {
          await storageService.addNotification("Xác nhận thanh toán", `Đã nhận tiền đơn #${id} (${details.name})`, 'success', id);
      }
  },

  saveOrdersList: async (orders: Order[]) => {
      _memoryOrders = orders;
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      await safeCloudOp(async () => {
          const batch = writeBatch(db);
          orders.forEach(o => {
              batch.update(doc(db, "orders", o.id), { orderIndex: o.orderIndex });
          });
          await batch.commit();
      });
  },

  splitOrderToNextBatch: async (id: string, currentBatch: string) => {
      let nextBatch = currentBatch.includes('-Split') ? currentBatch : (currentBatch + "-Split");
      const list = ensureOrdersLoaded() || [];
      const order = list.find(o => o.id === id);

      if (order) {
           const updated = { ...order, batchId: nextBatch, updatedAt: Date.now() };
           await storageService.updateOrderDetails(updated);
           await storageService.addNotification("Tách lô", `Đơn #${id} đã chuyển sang lô ${nextBatch}`, 'warning', id);
      }
  },
  
  autoSortOrders: async (orders: Order[]) => {
      buildIndices(); 

      const sorted = [...orders].sort((a, b) => {
          const customerA = findMatchingCustomer(a.customerPhone, a.address);
          const customerB = findMatchingCustomer(b.customerPhone, b.address);

          const pA = customerA?.priorityScore || 999;
          const pB = customerB?.priorityScore || 999;
          
          if (pA !== pB) return pA - pB;
          
          const addrA = normalizeString(a.address);
          const addrB = normalizeString(b.address);
          const addrCompare = addrA.localeCompare(addrB);
          
          if (addrCompare !== 0) return addrCompare;

          return (a.createdAt - b.createdAt);
      });

      const reindexed = sorted.map((o, idx) => ({ ...o, orderIndex: idx }));
      await storageService.saveOrdersList(reindexed);
      
      return reindexed.length;
  },

  isNewCustomer: (phone: string, address: string): boolean => {
      buildIndices();
      const match = findMatchingCustomer(phone, address);
      return !match;
  },

  // --- NOTIFICATIONS ---
  addNotification: async (title: string, message: string, type: 'info' | 'success' | 'warning' | 'error', relatedOrderId?: string) => {
      const notifData: any = { 
          id: uuidv4(), 
          title, 
          message, 
          type, 
          isRead: false, 
          createdAt: Date.now() 
      };
      if (relatedOrderId) notifData.relatedOrderId = relatedOrderId;

      const local = localStorage.getItem(NOTIF_KEY);
      const list: Notification[] = local ? JSON.parse(local) : [];
      list.unshift(notifData as Notification);
      if (list.length > 20) list.splice(20); 
      localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_notif'));

      await safeCloudOp(() => addDoc(collection(db, "notifications"), sanitize(notifData)));
  },

  subscribeNotifications: (callback: (notifs: Notification[]) => void) => {
      try { const data = localStorage.getItem(NOTIF_KEY); callback(data ? JSON.parse(data) : []); } catch { callback([]); }

      if (isOnline()) {
          const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(20));
          return onSnapshot(q, (snapshot) => {
              const list: Notification[] = [];
              snapshot.forEach(d => list.push({ ...d.data(), id: d.id } as Notification));
              localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
              callback(list);
          }, (err) => {
              if (err.code === 'resource-exhausted') {
                  markQuotaExhausted();
              }
          });
      } else {
          const handler = () => { try { const data = localStorage.getItem(NOTIF_KEY); callback(data ? JSON.parse(data) : []); } catch {} };
          window.addEventListener('storage_notif', handler);
          return () => window.removeEventListener('storage_notif', handler);
      }
  },

  markNotificationRead: async (id: string) => {
      const local = localStorage.getItem(NOTIF_KEY);
      if (local) {
          const list: Notification[] = JSON.parse(local);
          const idx = list.findIndex(n => n.id === id);
          if (idx !== -1) { 
              list[idx].isRead = true; 
              localStorage.setItem(NOTIF_KEY, JSON.stringify(list)); 
              window.dispatchEvent(new Event('storage_notif')); 
          }
      }
      window.dispatchEvent(new CustomEvent('local_notif_read', { detail: id }));
      await safeCloudOp(() => updateDoc(doc(db, "notifications", id), { isRead: true }));
  },

  markAllNotificationsRead: async () => {
      window.dispatchEvent(new Event('local_notif_read_all'));
      const local = localStorage.getItem(NOTIF_KEY);
      if (local) {
          const list: Notification[] = JSON.parse(local).map((n: Notification) => ({ ...n, isRead: true }));
          localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_notif'));
      }
      await safeCloudOp(async () => {
          const q = query(collection(db, "notifications"), limit(50));
          const snap = await getDocs(q);
          const batch = writeBatch(db);
          let count = 0;
          snap.forEach(d => { if (!d.data().isRead) { batch.update(d.ref, { isRead: true }); count++; } });
          if (count > 0) await batch.commit();
      });
  },

  clearAllNotifications: async () => {
      localStorage.removeItem(NOTIF_KEY);
      window.dispatchEvent(new Event('storage_notif'));
      await safeCloudOp(async () => {
           const q = query(collection(db, "notifications"), limit(100));
           const snap = await getDocs(q);
           const batch = writeBatch(db);
           snap.forEach(d => batch.delete(d.ref));
           await batch.commit();
      });
  },

  // --- STRESS TEST TOOL ---
  generatePerformanceData: async (count: number) => {
      const startTime = performance.now();
      const dummyCustomers: Customer[] = [];
      const streets = ['Lê Lợi', 'Nguyễn Huệ', 'Trần Hưng Đạo', 'Cách Mạng Tháng 8', 'Điện Biên Phủ'];
      const districts = ['Quận 1', 'Quận 3', 'Quận 5', 'Quận 10', 'Bình Thạnh'];

      for (let i = 0; i < count; i++) {
          const street = streets[Math.floor(Math.random() * streets.length)];
          const district = districts[Math.floor(Math.random() * districts.length)];
          dummyCustomers.push({
              id: uuidv4(),
              name: `Khách hàng Test ${i + 1}`,
              phone: `09${Math.floor(Math.random() * 100000000)}`,
              address: `Số ${i} ${street}, ${district}, TP.HCM`,
              priorityScore: Math.floor(Math.random() * 6000),
              lastOrderDate: Date.now(),
              updatedAt: Date.now()
          });
      }

      await storageService.importCustomersBatch(dummyCustomers, true);

      const endTime = performance.now();
      return {
          duration: Math.round(endTime - startTime),
          count: count
      };
  }
};