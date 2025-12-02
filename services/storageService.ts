
import { Order, OrderStatus, Product, Customer, BankConfig, Notification, ShopConfig } from '../types';
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
  Timestamp,
  increment
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

// String Normalization Helper - EXPORTED for UI consistency
export const normalizeString = (str: string): string => {
    if (!str) return "";
    return str
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .replace(/[^a-zA-Z0-9]/g, "") // Remove ALL special chars including spaces for strict matching
        .toLowerCase();
};

export const normalizePhone = (phone: string) => {
    if (!phone) return '';
    let p = phone.replace(/[^0-9]/g, '');
    if (p.startsWith('84')) p = '0' + p.slice(2);
    if (p.startsWith('+84')) p = '0' + p.slice(3);
    // Handle case where user might enter just 912345678 (missing 0)
    if (p.length === 9 && !p.startsWith('0')) p = '0' + p;
    return p;
};

// --- CUSTOMER ID GENERATION STRATEGY ---
const generateCustomerId = (name: string, phone: string, address: string): string => {
    const cleanPhone = normalizePhone(phone);
    if (cleanPhone && cleanPhone.length > 5) return cleanPhone;
    
    // If no phone, use hash of address
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
    // Always rebuild if null, but also allow forced rebuilds via invalidateIndices
    if (_phoneIndex && _addressIndex && _idIndex) return;
    
    const list = ensureCustomersLoaded();
    if (!list) return;

    _phoneIndex = new Map<string, Customer>();
    _addressIndex = new Map<string, Customer>();
    _idIndex = new Map<string, Customer>();

    for (const c of list) {
        _idIndex.set(c.id, c);
        
        if (c.phone && c.phone.length > 5) {
            const p = normalizePhone(c.phone);
            _phoneIndex.set(p, c);
        }
        
        if (c.address && c.address.length > 5) {
            const normAddr = normalizeString(c.address);
            // We want to keep the one with the lowest priority score (highest rank) if duplicates exist
            const existing = _addressIndex.get(normAddr);
            const currentScore = (c.priorityScore !== undefined && c.priorityScore !== null) ? c.priorityScore : 999999;
            const existingScore = (existing?.priorityScore !== undefined && existing.priorityScore !== null) ? existing.priorityScore : 999999;

            if (!existing || currentScore < existingScore) {
                _addressIndex.set(normAddr, c);
            }
        }
    }
};

export const findMatchingCustomer = (orderPhone: string, orderAddress: string, customerId?: string): Customer | undefined => {
    buildIndices(); 
    
    // 0. Try ID Match First (100% Accuracy)
    if (customerId && _idIndex?.has(customerId)) {
        return _idIndex.get(customerId);
    }

    // 1. Try Phone Match
    if (orderPhone) {
        const normPhone = normalizePhone(orderPhone);
        if (normPhone && _phoneIndex?.has(normPhone)) {
            return _phoneIndex.get(normPhone);
        }
    }

    // 2. Try Address Match
    if (orderAddress) {
        const normAddr = normalizeString(orderAddress);
        if (normAddr && _addressIndex?.has(normAddr)) {
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

  // --- SHOP CONFIG ---
  saveShopConfig: async (config: ShopConfig) => {
      localStorage.setItem(SHOP_KEY, JSON.stringify(config));
      await safeCloudOp(() => setDoc(doc(db, "settings", "shopConfig"), sanitize(config)));
  },

  getShopConfig: async (): Promise<ShopConfig | null> => {
      const localData = localStorage.getItem(SHOP_KEY);
      if (localData) return JSON.parse(localData);
      
      let config: ShopConfig | null = null;
      if (isOnline()) {
          try {
            const snap = await getDoc(doc(db, "settings", "shopConfig"));
            if (snap.exists()) {
                config = snap.data() as ShopConfig;
            }
          } catch(e) { console.warn("Fetch shop config failed", e); }
      }
      
      if (config) { localStorage.setItem(SHOP_KEY, JSON.stringify(config)); }
      return config;
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

  // --- NEW: SYNC PRODUCT UPDATES TO PENDING ORDERS ---
  syncProductToPendingOrders: async (product: Product) => {
      const orders = ensureOrdersLoaded() || [];
      const pendingStatuses = [OrderStatus.PENDING, OrderStatus.PICKED_UP, OrderStatus.IN_TRANSIT];
      
      const ordersToUpdate: Order[] = [];

      for (const order of orders) {
          // Skip completed orders
          if (!pendingStatuses.includes(order.status)) continue;

          let hasChanges = false;
          
          // Check items in order
          const newItems = order.items.map(item => {
              if (item.productId === product.id) {
                  // Only update if something actually changed
                  if (item.name !== product.name || 
                      item.price !== product.defaultPrice || 
                      item.importPrice !== product.importPrice) {
                      
                      hasChanges = true;
                      return {
                          ...item,
                          name: product.name,
                          price: product.defaultPrice,
                          importPrice: product.importPrice
                      };
                  }
              }
              return item;
          });

          if (hasChanges) {
              const newTotal = newItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 1)), 0);
              const updatedOrder = { 
                  ...order, 
                  items: newItems, 
                  totalPrice: newTotal,
                  lastUpdatedBy: 'System (Sync)' 
              };
              ordersToUpdate.push(updatedOrder);
          }
      }

      if (ordersToUpdate.length > 0) {
          // Batch Update Memory
          const currentOrders = ensureOrdersLoaded() || [];
          ordersToUpdate.forEach(updatedOrder => {
              const idx = currentOrders.findIndex(o => o.id === updatedOrder.id);
              if (idx >= 0) currentOrders[idx] = updatedOrder;
          });
          
          _memoryOrders = currentOrders;
          localStorage.setItem(ORDER_KEY, JSON.stringify(currentOrders));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));

          // Batch Update Cloud
          if (isOnline()) {
              const CHUNK = 300;
              for (let i = 0; i < ordersToUpdate.length; i += CHUNK) {
                  const chunk = ordersToUpdate.slice(i, i + CHUNK);
                  const batch = writeBatch(db);
                  
                  chunk.forEach(o => {
                      const ref = doc(db, "orders", o.id);
                      batch.update(ref, { 
                          items: o.items, 
                          totalPrice: o.totalPrice,
                          lastUpdatedBy: 'System (Product Sync)' 
                      });
                  });
                  
                  try {
                      await batch.commit();
                  } catch (e) {
                      console.error("Failed to sync product to pending orders", e);
                  }
              }
          }
          return ordersToUpdate.length;
      }
      return 0;
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
          const q = query(collection(db, "customers"));
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.docs.forEach((doc) => batch.delete(doc.ref));
          await batch.commit();
      }
  },

  markAllCustomersAsOld: async () => {
      const list = ensureCustomersLoaded() || [];
      if (list.length === 0) return 0;

      // 1. Update in memory and local storage immediately for UI response
      list.forEach(c => {
          c.isLegacy = true;
          c.updatedAt = Date.now();
      });
      _memoryCustomers = list;
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));

      // 2. Batch Update to Cloud (Chunked)
      if (isOnline()) {
          const CHUNK = 400; // Safe limit
          let processed = 0;
          
          for (let i = 0; i < list.length; i += CHUNK) {
              if (_quotaExhausted) break;
              
              const batch = writeBatch(db);
              const chunk = list.slice(i, i + CHUNK);
              
              chunk.forEach(c => {
                   const ref = doc(db, "customers", c.id);
                   batch.update(ref, { isLegacy: true, updatedAt: Date.now() });
              });

              try {
                  await batch.commit();
                  processed += chunk.length;
                  await delay(200); // Small delay between batches
              } catch (e: any) {
                  if (e.code === 'resource-exhausted') markQuotaExhausted();
                  console.error("Batch update failed", e);
              }
          }
          return processed;
      }
      return list.length;
  },

  importCustomersBatch: async (newCustomers: Customer[], localOnly = false) => {
      const currentList = ensureCustomersLoaded() || [];
      const map = new Map<string, Customer>();
      
      currentList.forEach(c => map.set(c.id, c));
      
      newCustomers.forEach(c => {
          map.set(c.id, { ...c, updatedAt: Date.now() });
      });

      const mergedList = Array.from(map.values());
      _memoryCustomers = mergedList;
      invalidateIndices();

      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(mergedList));
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));

      if (!localOnly && isOnline()) {
          const CHUNK = 300;
          for (let i = 0; i < newCustomers.length; i += CHUNK) {
               if (_quotaExhausted) break;
               const batch = writeBatch(db);
               const chunk = newCustomers.slice(i, i + CHUNK);
               chunk.forEach(c => {
                   const ref = doc(db, "customers", c.id);
                   batch.set(ref, sanitize({ ...c, updatedAt: Date.now() }));
               });
               try {
                   await batch.commit();
                   await delay(500);
               } catch(e: any) {
                   if(e.code === 'resource-exhausted') markQuotaExhausted();
               }
          }
      }
  },

  generatePerformanceData: async (count: number) => {
      const startTime = Date.now();
      const dummy: Customer[] = [];
      for(let i=0; i<count; i++) {
          const id = uuidv4();
          dummy.push({
              id,
              name: `Khách Hàng Test ${i}`,
              phone: `09${Math.floor(Math.random()*100000000)}`,
              address: `Địa chỉ giả lập số ${i}, Quận ${i%10 + 1}, TP.HCM`,
              priorityScore: i,
              lastOrderDate: Date.now(),
              updatedAt: Date.now()
          });
      }
      
      // Local Only Import for Performance Test
      await storageService.importCustomersBatch(dummy, true);
      
      return { count, duration: Date.now() - startTime };
  },

  findMatchingCustomer: findMatchingCustomer,

  isNewCustomer: (phone: string, address: string, customerId?: string): boolean => {
      const c = findMatchingCustomer(phone, address, customerId);
      // If customer not found in DB, they are NEW
      if (!c) return true;
      
      // If explicitly marked as legacy (old), they are NOT new
      if (c.isLegacy) return false;

      // Otherwise fallback to order count logic
      return (c.totalOrders || 0) <= 1;
  },

  // --- ORDERS ---
  subscribeOrders: (callback: (orders: Order[]) => void) => {
      const load = () => { 
          try {
             const local = localStorage.getItem(ORDER_KEY);
             _memoryOrders = local ? JSON.parse(local) : [];
             callback(_memoryOrders || []); 
          } catch { callback([]); }
      };
      load();

      if (isOnline()) {
          // Chỉ lấy đơn hàng trong 30 ngày gần đây để tối ưu
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
          const q = query(collection(db, "orders"), where("createdAt", ">", thirtyDaysAgo));
          
          return onSnapshot(q, (snapshot) => {
              const list: Order[] = [];
              snapshot.forEach(d => list.push(d.data() as Order));
              
              // Merge with local older orders if needed (optional strategy)
              // For now, assume we just sync the active window
              _memoryOrders = list;
              localStorage.setItem(ORDER_KEY, JSON.stringify(list));
              callback(list);
          }, (err) => {
              if (err.code === 'resource-exhausted') {
                  markQuotaExhausted();
              }
          });
      } else {
          const handler = () => load();
          window.addEventListener('storage_' + ORDER_KEY, handler);
          return () => window.removeEventListener('storage_' + ORDER_KEY, handler);
      }
  },

  // NEW: Fetch Long Term Stats (12 Months) - One time fetch
  fetchLongTermStats: async (): Promise<Order[]> => {
      // 1. Get Local Data First
      let allOrders = ensureOrdersLoaded() || [];
      
      if (isOnline()) {
          try {
              // Fetch last 12 months delivered/completed orders
              const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
              
              // FIX: Query only by createdAt to avoid needing a Composite Index (createdAt + status).
              // We filter status client-side.
              const q = query(
                  collection(db, "orders"), 
                  where("createdAt", ">", oneYearAgo)
              );
              
              const snapshot = await getDocs(q);
              const cloudOrders: Order[] = [];
              snapshot.forEach(d => {
                  const data = d.data() as Order;
                  if (data.status === 'DELIVERED') {
                      cloudOrders.push(data);
                  }
              });
              
              // Merge: Create a Map of ID -> Order
              const mergedMap = new Map<string, Order>();
              allOrders.forEach(o => mergedMap.set(o.id, o));
              cloudOrders.forEach(o => mergedMap.set(o.id, o));
              
              return Array.from(mergedMap.values());
          } catch (e) {
              console.error("Failed to fetch long term stats", e);
              return allOrders; // Fallback to local
          }
      }
      return allOrders;
  },

  saveOrder: async (order: Order) => {
      let list = _memoryOrders || [];
      if (list.length === 0) {
           const local = localStorage.getItem(ORDER_KEY);
           if(local) list = JSON.parse(local);
      }
      
      // AUTO LINK CUSTOMER LOGIC
      // 1. Check if customer already exists by Phone/Address
      let existingCust = findMatchingCustomer(order.customerPhone, order.address, order.customerId);
      
      if (!existingCust) {
          // Create New Customer
          const newCustId = generateCustomerId(order.customerName, order.customerPhone, order.address);
          const newCust: Customer = {
              id: newCustId,
              name: order.customerName,
              phone: order.customerPhone,
              address: order.address,
              lastOrderDate: Date.now(),
              totalOrders: 1,
              priorityScore: 999999
          };
          await storageService.upsertCustomer(newCust);
          // LINK ORDER TO NEW ID
          order.customerId = newCustId;
      } else {
          // Update Existing Customer
          existingCust.lastOrderDate = Date.now();
          existingCust.totalOrders = (existingCust.totalOrders || 0) + 1;
          await storageService.upsertCustomer(existingCust);
          // LINK ORDER TO EXISTING ID
          order.customerId = existingCust.id;
      }

      // 2. Save Order
      const idx = list.findIndex(o => o.id === order.id);
      if (idx >= 0) list[idx] = order; else list.push(order);
      
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      await safeCloudOp(() => setDoc(doc(db, "orders", order.id), sanitize(order)));
  },

  deleteOrder: async (id: string, customerContext?: { name: string, address: string }) => {
      let list = _memoryOrders || [];
      list = list.filter(o => o.id !== id);
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      await safeCloudOp(() => deleteDoc(doc(db, "orders", id)));
      if (customerContext) {
           storageService.createNotification({
              id: uuidv4(),
              title: "Đơn hàng bị xóa",
              message: `Đơn ${id} của ${customerContext.name} đã bị xóa bởi ${storageService.getCurrentUser()}`,
              type: 'warning',
              isRead: false,
              createdAt: Date.now()
          });
      }
  },
  
  deleteOrdersBatch: async (ids: string[]) => {
      if (!ids || ids.length === 0) return;
      
      // 1. Local Delete (Instant UI Feedback)
      let list = _memoryOrders || [];
      list = list.filter(o => !ids.includes(o.id));
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      
      // 2. Cloud Delete (Batched)
      if (isOnline()) {
          const CHUNK = 400; // Limit for batch writes is 500
          for (let i = 0; i < ids.length; i += CHUNK) {
               const chunk = ids.slice(i, i + CHUNK);
               const batch = writeBatch(db);
               chunk.forEach(id => {
                   batch.delete(doc(db, "orders", id));
               });
               
               try {
                   await batch.commit();
                   await delay(200); // Small delay
               } catch(e) {
                   console.error("Batch delete failed", e);
               }
          }
      }
  },

  updateStatus: async (orderId: string, status: OrderStatus, proofImage?: string, customerContext?: { name: string, address: string }) => {
      const list = _memoryOrders || [];
      const idx = list.findIndex(o => o.id === orderId);
      if (idx >= 0) {
          const finalProof = proofImage || list[idx].deliveryProof;
          
          const updated = { 
              ...list[idx], 
              status, 
              deliveryProof: finalProof,
              lastUpdatedBy: storageService.getCurrentUser() || 'Unknown' 
          };
          list[idx] = updated;
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));

          // Create cloud update payload dynamically to avoid undefined values
          const updatePayload: any = { 
              status, 
              lastUpdatedBy: storageService.getCurrentUser() || 'Unknown'
          };
          
          if (finalProof !== undefined) {
              updatePayload.deliveryProof = finalProof;
          }

          await safeCloudOp(() => updateDoc(doc(db, "orders", orderId), updatePayload));

          if (customerContext) {
              storageService.createNotification({
                  id: uuidv4(),
                  title: `Cập nhật trạng thái đơn ${orderId}`,
                  message: `Đơn của ${customerContext.name} đã chuyển sang: ${status}`,
                  type: 'info',
                  isRead: false,
                  createdAt: Date.now(),
                  relatedOrderId: orderId
              });
          }
      }
  },

  deleteDeliveryProof: async (orderId: string) => {
      const list = _memoryOrders || [];
      const idx = list.findIndex(o => o.id === orderId);
      if (idx >= 0) {
          const updated = { ...list[idx] };
          delete updated.deliveryProof;
          
          list[idx] = updated;
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));

          await safeCloudOp(() => updateDoc(doc(db, "orders", orderId), { 
              deliveryProof: deleteField()
          }));
      }
  },

  updatePaymentVerification: async (orderId: string, verified: boolean, customerContext?: { name: string }) => {
      const list = _memoryOrders || [];
      const idx = list.findIndex(o => o.id === orderId);
      if (idx >= 0) {
          const updated = { ...list[idx], paymentVerified: verified };
          list[idx] = updated;
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));

          await safeCloudOp(() => updateDoc(doc(db, "orders", orderId), { paymentVerified: verified }));

          if (verified && customerContext) {
              storageService.createNotification({
                  id: uuidv4(),
                  title: "Thanh toán thành công",
                  message: `Đơn ${orderId} của ${customerContext.name} đã xác nhận nhận tiền.`,
                  type: 'success',
                  isRead: false,
                  createdAt: Date.now(),
                  relatedOrderId: orderId
              });
          }
      }
  },

  incrementReminderCount: async (orderIds: string[]) => {
      if (!orderIds || orderIds.length === 0) return;
      
      const list = _memoryOrders || [];
      
      // Update local first
      orderIds.forEach(id => {
          const idx = list.findIndex(o => o.id === id);
          if (idx >= 0) {
              const current = list[idx].reminderCount || 0;
              list[idx] = { ...list[idx], reminderCount: current + 1 };
          }
      });
      
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      // Batch update Cloud
      if (isOnline()) {
          const batch = writeBatch(db);
          orderIds.forEach(id => {
               const ref = doc(db, "orders", id);
               batch.update(ref, { reminderCount: increment(1) });
          });
          try {
              await batch.commit();
          } catch(e) {
              console.error("Failed to increment reminders", e);
          }
      }
  },

  updateOrderDetails: async (order: Order) => {
      const list = _memoryOrders || [];
      const idx = list.findIndex(o => o.id === order.id);
      if (idx >= 0) {
          list[idx] = order;
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));
          await safeCloudOp(() => setDoc(doc(db, "orders", order.id), sanitize(order)));
      }
  },

  saveOrdersList: async (orders: Order[]) => {
      // Batch save local
      _memoryOrders = orders;
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      // Cloud update orderIndex & Link ID if missing
      if (isOnline()) {
           const batch = writeBatch(db);
           orders.forEach(o => {
               const ref = doc(db, "orders", o.id);
               const updateData: any = { orderIndex: o.orderIndex };
               // If we just linked an ID during sort, save it to cloud too
               if (o.customerId) {
                   updateData.customerId = o.customerId;
               }
               batch.update(ref, updateData);
           });
           await batch.commit();
      }
  },

  autoSortOrders: async (orders: Order[]) => {
     // CRITICAL: Force rebuild indices to ensure we have latest customer scores from LocalStorage
     invalidateIndices();
     ensureCustomersLoaded(); 
     buildIndices(); 
     
     const sorted = [...orders].sort((a, b) => {
         const custA = findMatchingCustomer(a.customerPhone, a.address, a.customerId);
         const custB = findMatchingCustomer(b.customerPhone, b.address, b.customerId);
         
         // Inject customerId back into order object if found (Healing self)
         if (custA && !a.customerId) a.customerId = custA.id;
         if (custB && !b.customerId) b.customerId = custB.id;

         // Use strict default to ensure math works
         // Default to extremely high number if not found so they go to bottom
         const scoreA = (custA?.priorityScore !== undefined && custA.priorityScore !== null) ? custA.priorityScore : 999999;
         const scoreB = (custB?.priorityScore !== undefined && custB.priorityScore !== null) ? custB.priorityScore : 999999;
         
         // 1. Primary Sort: Customer Priority Score (Low number = High priority)
         // Ascending order: 1, 2, 3 ... 
         if (scoreA !== scoreB) return scoreA - scoreB;
         
         // 2. Secondary Sort: Stability using existing orderIndex (visual order)
         return (a.orderIndex || 0) - (b.orderIndex || 0);
     });

     // Re-assign indexes
     const reindexed = sorted.map((o, idx) => ({ ...o, orderIndex: idx }));
     
     await storageService.saveOrdersList(reindexed);
     return reindexed.length;
  },

  // --- ROUTE LEARNING LOGIC (ROBUST BACKWARD RIPPLE) ---
  learnRoutePriority: async (orders: Order[]) => {
    // Force Load fresh customer list from storage to avoid reference issues
    const freshCustomerList = ensureCustomersLoaded();
    if (!freshCustomerList) return;

    // Create a Map for O(1) access during the loop
    const customerMap = new Map<string, Customer>();
    freshCustomerList.forEach(c => customerMap.set(c.id, c));
    
    // Also build a quick lookup for order -> customer ID
    // Optimization: Build Index ONCE.
    invalidateIndices();
    buildIndices();

    const uniqueCustomerIdsInOrder: string[] = [];
    const seenIDs = new Set<string>();

    // 1. Extract Unique Customer IDs from the new sorted order
    for (const order of orders) {
        const c = findMatchingCustomer(order.customerPhone, order.address, order.customerId);
        if (c && !seenIDs.has(c.id)) {
            uniqueCustomerIdsInOrder.push(c.id);
            seenIDs.add(c.id);
        }
    }

    if (uniqueCustomerIdsInOrder.length < 2) return;

    // 2. BACKWARD RIPPLE ALGORITHM
    // We modify the objects inside customerMap directly, then save the array back.
    let memoryUpdated = false;
    const batch = writeBatch(db);
    let commitNeeded = false;
    
    // Loop from second-to-last down to 0
    for (let i = uniqueCustomerIdsInOrder.length - 2; i >= 0; i--) {
        const currentId = uniqueCustomerIdsInOrder[i];
        const nextId = uniqueCustomerIdsInOrder[i+1];

        const currentCust = customerMap.get(currentId);
        const nextCust = customerMap.get(nextId);

        if (!currentCust || !nextCust) continue;

        const currentScore = (currentCust.priorityScore !== undefined && currentCust.priorityScore !== null) ? currentCust.priorityScore : 999999;
        const nextScore = (nextCust.priorityScore !== undefined && nextCust.priorityScore !== null) ? nextCust.priorityScore : 999999;

        // VIOLATION DETECTED: Current should be smaller than Next (Priority 1 is better than 10)
        // If they are equal, or current is larger, we must push current down (make it smaller number)
        if (currentScore >= nextScore) {
            const newScore = nextScore - 1;
            
            // UPDATE IN MEMORY OBJECT
            if (currentCust.priorityScore !== newScore) {
                currentCust.priorityScore = newScore;
                currentCust.updatedAt = Date.now();
                memoryUpdated = true;

                if (isOnline()) {
                    const ref = doc(db, "customers", currentCust.id);
                    batch.update(ref, { priorityScore: newScore, updatedAt: Date.now() });
                    commitNeeded = true;
                }
            }
        }
    }
    
    // 3. Save Changes
    if (memoryUpdated) {
        // Re-construct array from map
        const updatedList = Array.from(customerMap.values());
        _memoryCustomers = updatedList;
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify(_memoryCustomers));
        
        // CRITICAL: Clear indices so next Auto Sort uses the new scores immediately
        invalidateIndices(); 
        
        window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
        console.log("Route learned: Updated priorities in local storage.");
    }

    // Commit Cloud Batch
    if (commitNeeded && isOnline()) {
        try {
            await batch.commit();
            console.log("Route preference learned and saved to Cloud.");
        } catch (e) {
            console.error("Failed to learn route:", e);
        }
    }
  },

  // --- BATCH MANAGEMENT ---
  renameBatch: async (oldBatchId: string, newBatchId: string) => {
      // 1. Local update (Memory Orders)
      let list = ensureOrdersLoaded() || [];
      const toUpdate = list.filter(o => o.batchId === oldBatchId);
      
      if (toUpdate.length === 0) return;
      
      toUpdate.forEach(o => o.batchId = newBatchId);
      
      // Update memory reference & Save to LocalStorage immediately for UI reactivity
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      // 2. Cloud update (Batched)
      if (isOnline()) {
          const CHUNK = 400;
          for (let i = 0; i < toUpdate.length; i += CHUNK) {
               const chunk = toUpdate.slice(i, i + CHUNK);
               const batch = writeBatch(db);
               chunk.forEach(o => {
                   batch.update(doc(db, "orders", o.id), { batchId: newBatchId });
               });
               try {
                   await batch.commit();
               } catch(e) { console.error("Batch rename failed", e); }
          }
      }
  },

  // --- NOTIFICATIONS ---
  subscribeNotifications: (callback: (notifs: Notification[]) => void) => {
      const load = () => {
          try {
              const local = localStorage.getItem(NOTIF_KEY);
              callback(local ? JSON.parse(local) : []);
          } catch { callback([]); }
      };
      load();

      if (isOnline()) {
          // Listen to last 20 notifications
          const q = query(collection(db, "notifications"), orderBy("createdAt", "desc"), limit(20));
          return onSnapshot(q, (snapshot) => {
              const list: Notification[] = [];
              snapshot.forEach(d => list.push(d.data() as Notification));
              localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
              callback(list);
          }, (err) => {
              // ignore quota error for notifs
          });
      } else {
          const handler = () => load();
          window.addEventListener('storage_' + NOTIF_KEY, handler);
          return () => window.removeEventListener('storage_' + NOTIF_KEY, handler);
      }
  },

  createNotification: async (notif: Notification) => {
      // Local first
      const local = localStorage.getItem(NOTIF_KEY);
      const list: Notification[] = local ? JSON.parse(local) : [];
      list.unshift(notif);
      if(list.length > 50) list.pop();
      localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + NOTIF_KEY));

      await safeCloudOp(() => setDoc(doc(db, "notifications", notif.id), sanitize(notif)));
  },

  markNotificationRead: async (id: string) => {
      const local = localStorage.getItem(NOTIF_KEY);
      if(local) {
          const list: Notification[] = JSON.parse(local);
          const item = list.find(n => n.id === id);
          if(item) {
              item.isRead = true;
              localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
              window.dispatchEvent(new Event('storage_' + NOTIF_KEY));
              // Dispatch specific event for UI feedback
              window.dispatchEvent(new CustomEvent('local_notif_read', { detail: id }));
          }
      }
      await safeCloudOp(() => updateDoc(doc(db, "notifications", id), { isRead: true }));
  },

  markAllNotificationsRead: async () => {
      const local = localStorage.getItem(NOTIF_KEY);
      if(local) {
          const list: Notification[] = JSON.parse(local);
          list.forEach(n => n.isRead = true);
          localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + NOTIF_KEY));
          window.dispatchEvent(new Event('local_notif_read_all'));
      }
      
      if(isOnline()) {
          const batch = writeBatch(db);
          const q = query(collection(db, "notifications"), where("isRead", "==", false), limit(20));
          const snap = await getDocs(q);
          snap.forEach(d => {
              batch.update(d.ref, { isRead: true });
          });
          if(!snap.empty) await batch.commit();
      }
  },

  clearAllNotifications: async () => {
      localStorage.removeItem(NOTIF_KEY);
      window.dispatchEvent(new Event('storage_' + NOTIF_KEY));
      window.dispatchEvent(new Event('local_notif_clear_all'));
      
      // Note: We don't clear from Cloud to keep audit trail, just local view
  },

  splitOrderToNextBatch: async (orderId: string, currentBatchId: string) => {
      const list = _memoryOrders || [];
      const order = list.find(o => o.id === orderId);
      if(!order) return;

      // Logic to find next batch name? 
      // Simplified: Just add suffix or date
      // If current is LÔ-2023-10-27, next is LÔ-2023-10-28 or LÔ-2023-10-27-CA-2
      const today = new Date();
      today.setDate(today.getDate() + 1);
      const nextDateStr = today.toISOString().slice(0, 10);
      const nextBatchId = `LÔ-${nextDateStr}`;
      
      const updated = { 
          ...order, 
          batchId: nextBatchId, 
          status: OrderStatus.PENDING,
          orderIndex: 0 // Reset index
      };
      
      await storageService.updateOrderDetails(updated);
      
      storageService.createNotification({
          id: uuidv4(),
          title: "Đơn hàng chuyển lô",
          message: `Đơn ${orderId} đã được chuyển sang lô ${nextBatchId}`,
          type: 'info',
          isRead: false,
          createdAt: Date.now(),
          relatedOrderId: orderId
      });
  },
  
  splitOrdersBatch: async (orders: {id: string, batchId: string}[]) => {
      // Reuse single logic in a loop or batch
      // Since splitting involves notifications and complex logic, we'll iterate
      for (const o of orders) {
          await storageService.splitOrderToNextBatch(o.id, o.batchId);
      }
  }
};