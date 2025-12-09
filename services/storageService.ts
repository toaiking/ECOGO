import { Order, OrderStatus, Product, Customer, BankConfig, Notification, ShopConfig, ImportRecord } from '../types';
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
let _phoneIndex: Map<string, Customer[]> | null = null;
let _addressIndex: Map<string, Customer[]> | null = null;
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

// NEW: Generate Standardized SKU (Product ID)
export const generateProductSku = (name: string): string => {
    if (!name) return uuidv4();
    // Convert "Gạo ST25 (Loại 1)" -> "GAO_ST25_LOAI_1"
    const sku = name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d").replace(/Đ/g, "D")
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_"); // Replace non-alphanumeric with underscore
    
    // Fallback if name is just symbols
    if (sku.length < 2) return uuidv4();
    return sku;
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

// IMPROVED: Token-based Fuzzy matching
export const areNamesSimilar = (n1: string, n2: string): boolean => {
    const normalize = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9\s]/g, "");
    const s1 = normalize(n1);
    const s2 = normalize(n2);
    
    if (!s1 || !s2) return true; // Safety

    // 1. Exact substring match (Legacy check)
    const simple1 = s1.replace(/\s/g, '');
    const simple2 = s2.replace(/\s/g, '');
    if (simple1.includes(simple2) || simple2.includes(simple1)) return true;

    // 2. Token overlap check (New)
    const t1 = s1.split(/\s+/).filter(x => x.length > 0);
    const t2 = s2.split(/\s+/).filter(x => x.length > 0);
    
    const set1 = new Set(t1);
    const intersection = t2.filter(x => set1.has(x));
    
    const minLen = Math.min(t1.length, t2.length);
    if (minLen === 0) return false;
    
    const threshold = minLen >= 3 ? minLen - 1 : minLen;
    
    return intersection.length >= threshold;
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

const ensureProductsLoaded = () => {
    if (_memoryProducts) return _memoryProducts;
    try {
        const local = localStorage.getItem(PRODUCT_KEY);
        _memoryProducts = local ? JSON.parse(local) : [];
    } catch {
        _memoryProducts = [];
    }
    return _memoryProducts;
};

const buildIndices = () => {
    // Always rebuild if null, but also allow forced rebuilds via invalidateIndices
    if (_phoneIndex && _addressIndex && _idIndex) return;
    
    const list = ensureCustomersLoaded();
    if (!list) return;

    _phoneIndex = new Map<string, Customer[]>();
    _addressIndex = new Map<string, Customer[]>();
    _idIndex = new Map<string, Customer>();

    for (const c of list) {
        _idIndex.set(c.id, c);
        
        if (c.phone && c.phone.length > 5) {
            const p = normalizePhone(c.phone);
            if (!_phoneIndex.has(p)) _phoneIndex.set(p, []);
            _phoneIndex.get(p)!.push(c);
        }
        
        if (c.address && c.address.length > 5) {
            const normAddr = normalizeString(c.address);
            if (!_addressIndex.has(normAddr)) _addressIndex.set(normAddr, []);
            _addressIndex.get(normAddr)!.push(c);
        }
    }
};

// UPDATED: Now supports fuzzy name matching to disambiguate collisions
export const findMatchingCustomer = (orderPhone: string, orderAddress: string, customerId?: string, queryName?: string): Customer | undefined => {
    buildIndices(); 
    
    // 0. Try ID Match First (100% Accuracy)
    if (customerId && _idIndex?.has(customerId)) {
        return _idIndex.get(customerId);
    }

    // 1. Try Phone Match
    if (orderPhone) {
        const normPhone = normalizePhone(orderPhone);
        if (normPhone && _phoneIndex?.has(normPhone)) {
            const candidates = _phoneIndex.get(normPhone)!;
            
            // If name provided, try to find the best name match among candidates
            if (queryName) {
                const nameMatch = candidates.find(c => areNamesSimilar(c.name, queryName));
                if (nameMatch) return nameMatch;
            }
            
            return candidates.sort((a,b) => (b.totalOrders||0) - (a.totalOrders||0))[0];
        }
    }

    // 2. Try Address Match
    if (orderAddress) {
        const normAddr = normalizeString(orderAddress);
        if (normAddr && _addressIndex?.has(normAddr)) {
            const candidates = _addressIndex.get(normAddr)!;
             if (queryName) {
                const nameMatch = candidates.find(c => areNamesSimilar(c.name, queryName));
                if (nameMatch) return nameMatch;
            }
            return candidates[0];
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
        const localProducts = ensureProductsLoaded();
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

  getProductBySku: (sku: string): Product | undefined => {
      let list = ensureProductsLoaded();
      return list.find(p => p.id === sku);
  },

  getAllProducts: (): Product[] => {
      return ensureProductsLoaded() || [];
  },

  saveProduct: async (product: Product) => {
      let list = ensureProductsLoaded();
      const idx = list.findIndex(p => p.id === product.id);
      
      if (idx >= 0) {
          // Update existing
          list[idx] = product; 
      } else {
          // Create new
          list.push(product);
      }
      
      _memoryProducts = list;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));

      await safeCloudOp(() => setDoc(doc(db, "products", product.id), sanitize(product)));
  },

  // NEW: Atomic Stock Adjustment (Safe for Concurrency)
  adjustStockAtomic: async (productId: string, delta: number, importInfo?: { price: number, note?: string }) => {
      // 1. Local Update
      const products = ensureProductsLoaded();
      const product = products.find(p => p.id === productId);
      
      if (product) {
          product.stockQuantity = (product.stockQuantity || 0) + delta;
          if (delta > 0) {
              product.totalImported = (product.totalImported || 0) + delta;
              if (importInfo) {
                  if (!product.importHistory) product.importHistory = [];
                  product.importHistory.push({
                      id: uuidv4(),
                      date: Date.now(),
                      quantity: delta,
                      price: importInfo.price,
                      note: importInfo.note
                  });
              }
          }
          localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
          window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
      }

      // 2. Cloud Transaction
      if (isOnline()) {
          try {
              await runTransaction(db, async (transaction) => {
                  const ref = doc(db, "products", productId);
                  const snap = await transaction.get(ref);
                  
                  if (snap.exists()) {
                      const data = snap.data() as Product;
                      // Use increment for atomic update on the counter
                      const updates: any = { stockQuantity: increment(delta) };
                      
                      if (delta > 0) {
                          updates.totalImported = increment(delta);
                          if (importInfo) {
                              const newHistory = [...(data.importHistory || [])];
                              newHistory.push({
                                  id: uuidv4(),
                                  date: Date.now(),
                                  quantity: delta,
                                  price: importInfo.price,
                                  note: importInfo.note || 'Adjustment'
                              });
                              updates.importHistory = newHistory;
                          }
                      }
                      transaction.update(ref, updates);
                  }
              });
          } catch (e: any) {
              console.error("Stock Transaction Failed", e);
              if (e.code === 'resource-exhausted') markQuotaExhausted();
          }
      }
  },

  deleteProduct: async (id: string) => {
      let list = ensureProductsLoaded();
      list = list.filter(p => p.id !== id);
      _memoryProducts = list;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
      await safeCloudOp(() => deleteDoc(doc(db, "products", id)));
  },

  // --- TOOL: CLEAN AND MERGE DUPLICATE PRODUCTS ---
  cleanAndMergeDuplicateProducts: async (): Promise<{mergedCount: number, fixedOrders: number}> => {
      const products = ensureProductsLoaded();
      const orders = ensureOrdersLoaded();
      
      // 1. Group products by Normalized Name
      const productGroups = new Map<string, Product[]>();
      products.forEach(p => {
          const key = generateProductSku(p.name); // Using standard SKU gen as the key
          if (!productGroups.has(key)) productGroups.set(key, []);
          productGroups.get(key)!.push(p);
      });

      let mergedCount = 0;
      let fixedOrders = 0;
      const batch = writeBatch(db);
      let batchOps = 0;
      
      // Helper to commit batch if full
      const checkCommit = async () => {
          batchOps++;
          if (batchOps >= 300 && isOnline()) {
              await batch.commit();
              batchOps = 0;
          }
      };

      for (const [key, group] of productGroups.entries()) {
          if (group.length <= 1) continue;

          // MERGE LOGIC
          // Sort group: Keep the one with most stock or oldest import as Primary
          group.sort((a, b) => (b.stockQuantity || 0) - (a.stockQuantity || 0));
          
          const primary = group[0];
          const duplicates = group.slice(1);
          
          let totalStock = primary.stockQuantity || 0;
          let totalImported = primary.totalImported || 0;
          let latestPrice = primary.defaultPrice;
          let latestImportPrice = primary.importPrice;
          
          // NEW: Merge Import History
          const mergedHistory: ImportRecord[] = [...(primary.importHistory || [])];

          for (const dup of duplicates) {
              totalStock += (dup.stockQuantity || 0);
              totalImported += (dup.totalImported || 0);
              
              // If dup has newer update, maybe take its price? For now, keep primary or max.
              latestPrice = Math.max(latestPrice, dup.defaultPrice);
              latestImportPrice = Math.max(latestImportPrice || 0, dup.importPrice || 0);
              
              if (dup.importHistory) {
                  mergedHistory.push(...dup.importHistory);
              }

              // 2. Fix Orders referencing duplicate product IDs
              orders.forEach(o => {
                  let orderChanged = false;
                  o.items.forEach(item => {
                      if (item.productId === dup.id) {
                          item.productId = primary.id;
                          item.name = primary.name; // Normalize name in order too
                          orderChanged = true;
                      }
                  });
                  if (orderChanged) {
                      fixedOrders++;
                      if (isOnline()) batch.update(doc(db, "orders", o.id), { items: o.items });
                  }
              });

              // 3. Delete Duplicate Product
              if (isOnline()) batch.delete(doc(db, "products", dup.id));
              const idx = products.findIndex(p => p.id === dup.id);
              if (idx >= 0) products.splice(idx, 1);
          }
          
          // Sort history by date
          mergedHistory.sort((a,b) => a.date - b.date);

          // 4. Update Primary Product
          primary.stockQuantity = totalStock;
          primary.totalImported = totalImported;
          primary.defaultPrice = latestPrice;
          primary.importPrice = latestImportPrice;
          primary.importHistory = mergedHistory;
          primary.id = key; // Enforce Standard SKU as ID if possible (Careful with this if key != primary.id)
          
          if (isOnline()) batch.set(doc(db, "products", primary.id), sanitize(primary));
          
          mergedCount += duplicates.length;
          await checkCommit();
      }

      // Final commit
      if (isOnline() && batchOps > 0) await batch.commit();

      // Update Local Storage
      _memoryProducts = products;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
      
      _memoryOrders = orders;
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      return { mergedCount, fixedOrders };
  },

  // --- TOOL: RECALCULATE INVENTORY FROM ORDERS ---
  recalculateInventoryFromOrders: async (): Promise<number> => {
      const products = ensureProductsLoaded();
      const orders = ensureOrdersLoaded();
      let updatedCount = 0;

      // 1. Map: ProductID -> Total Sold Quantity
      const soldMap = new Map<string, number>();
      
      orders.forEach(o => {
          // Ignore cancelled orders
          if (o.status === OrderStatus.CANCELLED) return;
          
          o.items.forEach(item => {
              if (item.productId) {
                  const currentSold = soldMap.get(item.productId) || 0;
                  soldMap.set(item.productId, currentSold + (Number(item.quantity) || 0));
              }
          });
      });

      const batch = writeBatch(db);
      let batchOps = 0;

      // 2. Iterate Products and Recalculate
      for (const p of products) {
          const totalSold = soldMap.get(p.id) || 0;
          
          // Calculate Imported from History if available
          const historyImport = (p.importHistory || []).reduce((sum, h) => sum + (Number(h.quantity) || 0), 0);
          
          let totalImported = Number(p.totalImported) || 0;
          const currentStock = Number(p.stockQuantity) || 0;

          // DECISION LOGIC: Determine the most accurate Total Imported
          // RULE 1: If History exists, it is the SOURCE OF TRUTH for Total Imported.
          if (historyImport > 0) {
              totalImported = historyImport;
          }
          // RULE 2: Legacy Fallback (No history)
          // If no history, and Total Imported seems undefined or clearly wrong (less than what we have + sold),
          // we reset Total Imported to match reality (Stock + Sold).
          // This "freezes" the current stock as correct and sets the baseline Import.
          else if (totalImported < (currentStock + totalSold)) {
              totalImported = currentStock + totalSold;
          }

          // FINAL CALCULATION
          // Stock = Total Imported - Total Sold
          const calculatedStock = Math.max(0, totalImported - totalSold);
          
          // Check if update needed
          if (calculatedStock !== currentStock || totalImported !== p.totalImported) {
              p.stockQuantity = calculatedStock;
              p.totalImported = totalImported;
              
              if (isOnline()) {
                  batch.update(doc(db, "products", p.id), { 
                      stockQuantity: calculatedStock,
                      totalImported: totalImported
                  });
                  batchOps++;
              }
              updatedCount++;
          }
          
          // Commit in chunks
          if (batchOps >= 300) {
              if (isOnline()) await batch.commit();
              batchOps = 0;
          }
      }

      // Final commit
      if (isOnline() && batchOps > 0) {
          await batch.commit();
      }

      // Update Local Storage
      _memoryProducts = products;
      localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
      window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));

      return updatedCount;
  },

  getProductOrderHistory: (productId: string): { order: Order, quantity: number }[] => {
      const orders = ensureOrdersLoaded();
      const history: { order: Order, quantity: number }[] = [];
      
      orders.forEach(o => {
          if (o.status === OrderStatus.CANCELLED) return;
          const item = o.items.find(i => i.productId === productId);
          if (item) {
              history.push({ order: o, quantity: item.quantity });
          }
      });
      
      // Sort by newest
      return history.sort((a,b) => b.order.createdAt - a.order.createdAt);
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

      const batchSize = 300;
      let updatedCount = 0;

      for (let i = 0; i < list.length; i += batchSize) {
          const chunk = list.slice(i, i + batchSize);
          const batch = writeBatch(db);
          let hasBatchUpdates = false;

          chunk.forEach(c => {
              c.isLegacy = true; 
              c.updatedAt = Date.now();
              if (isOnline()) {
                  batch.update(doc(db, "customers", c.id), { isLegacy: true, updatedAt: Date.now() });
                  hasBatchUpdates = true;
              }
          });
          
          updatedCount += chunk.length;
          if (isOnline() && hasBatchUpdates) {
              await batch.commit();
          }
      }

      _memoryCustomers = list;
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
      
      return updatedCount;
  },

  importCustomersBatch: async (customers: Customer[], isLocalMode: boolean) => {
      const existing = ensureCustomersLoaded() || [];
      const map = new Map(existing.map(c => [c.id, c]));

      customers.forEach(c => {
         const toSave = { ...c, updatedAt: Date.now() };
         map.set(c.id, toSave);
      });

      const newList = Array.from(map.values());
      _memoryCustomers = newList;
      invalidateIndices();
      
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(newList));
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));

      if (isOnline() && !isLocalMode) {
          const CHUNK = 300;
          for (let i = 0; i < customers.length; i += CHUNK) {
              const chunk = customers.slice(i, i + CHUNK);
              const batch = writeBatch(db);
              chunk.forEach(c => {
                   batch.set(doc(db, "customers", c.id), sanitize({ ...c, updatedAt: Date.now() }));
              });
              await batch.commit();
              await delay(200);
          }
      }
  },

  generatePerformanceData: async (count: number) => {
      const start = performance.now();
      const newCustomers: Customer[] = [];
      
      for (let i = 0; i < count; i++) {
          const id = `PERF_${Math.floor(Math.random() * 1000000)}_${i}`;
          newCustomers.push({
              id,
              name: `Test User ${i}`,
              phone: `09${Math.floor(Math.random() * 100000000)}`,
              address: `Address ${i}, Street ${Math.floor(Math.random() * 100)}`,
              lastOrderDate: Date.now(),
              priorityScore: Math.floor(Math.random() * 1000)
          });
      }
      
      await storageService.importCustomersBatch(newCustomers, true);
      
      return { count, duration: Math.round(performance.now() - start) };
  },

  isNewCustomer: (phone: string, address: string, id?: string): boolean => {
      const cust = findMatchingCustomer(phone, address, id);
      if (!cust) return true;
      if (cust.isLegacy) return false;
      return (cust.totalOrders || 0) <= 1;
  },

  findMatchingCustomer, 

  // --- ORDERS ---
  subscribeOrders: (callback: (orders: Order[]) => void) => {
    const load = () => { 
        try {
            const data = localStorage.getItem(ORDER_KEY); 
            _memoryOrders = data ? JSON.parse(data) : [];
            callback(_memoryOrders || []); 
        } catch { callback([]); }
    };
    load();

    if (isOnline()) {
        const q = query(collection(db, "orders")); 
        return onSnapshot(q, (snapshot) => {
            const list: Order[] = [];
            snapshot.forEach(d => list.push(d.data() as Order));
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

  saveOrder: async (order: Order) => {
    // 1. UPDATE CUSTOMER STATS FIRST
    const currentUser = storageService.getCurrentUser() || 'Unknown';
    const orderWithMeta = { ...order, lastUpdatedBy: currentUser };

    let customerId = order.customerId;
    let customerName = order.customerName;
    let customerPhone = normalizePhone(order.customerPhone);
    let address = order.address;

    if (!customerId) {
        // Try to find matching customer (Passing name to fuzzy match)
        const existing = findMatchingCustomer(customerPhone, address, undefined, customerName);
        
        if (existing) {
             // NAME COLLISION CHECK: Same phone but different name?
             if (!areNamesSimilar(existing.name, customerName)) {
                 // Collision Detected! Create a new distinct ID
                 let suffix = 2;
                 let baseId = existing.id;
                 if (baseId.includes('-')) baseId = baseId.split('-')[0];
                 
                 let newId = `${baseId}-${suffix}`;
                 const allCustomers = ensureCustomersLoaded() || [];
                 // Ensure uniqueness in memory
                 while (allCustomers.some(c => c.id === newId)) {
                     suffix++;
                     newId = `${baseId}-${suffix}`;
                 }
                 
                 customerId = newId;
                 
                 // Create new customer record
                 const newCust: Customer = {
                     id: newId,
                     name: customerName,
                     phone: customerPhone,
                     address: address,
                     lastOrderDate: Date.now(),
                     totalOrders: 0, // Will be incremented below
                     priorityScore: 999
                 };
                 await storageService.upsertCustomer(newCust);
             } else {
                 customerId = existing.id;
             }
        } else {
             // New Customer
             customerId = generateCustomerId(customerName, customerPhone, address);
        }
    }
    
    // Final ID check
    orderWithMeta.customerId = customerId;

    // Update customer stats
    const existingCust = ensureCustomersLoaded()?.find(c => c.id === customerId);
    if (existingCust) {
        const newTotal = (existingCust.totalOrders || 0) + 1;
        const updatedCust = { 
            ...existingCust, 
            lastOrderDate: Date.now(),
            totalOrders: newTotal,
            name: customerName, // Update latest name
            address: address, // Update latest address
            phone: customerPhone
        };
        await storageService.upsertCustomer(updatedCust);
    } else {
        // Create new if not exist (fallback)
        const newCust: Customer = {
            id: customerId!,
            name: customerName,
            phone: customerPhone,
            address: address,
            lastOrderDate: Date.now(),
            totalOrders: 1,
            priorityScore: 999
        };
        await storageService.upsertCustomer(newCust);
    }

    // 2. ATOMIC SAVE ORDER & DEDUCT STOCK
    
    // --- Local Memory Update (Optimistic) ---
    let list = _memoryOrders || [];
    if (list.length === 0) {
        const local = localStorage.getItem(ORDER_KEY);
        if(local) list = JSON.parse(local);
    }
    list.unshift(orderWithMeta);
    _memoryOrders = list;
    localStorage.setItem(ORDER_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event('storage_' + ORDER_KEY));

    // Update Local Stock Memory immediately
    const products = ensureProductsLoaded();
    order.items.forEach(item => {
        if (item.productId) {
            const p = products.find(p => p.id === item.productId);
            if (p) {
                p.stockQuantity = (p.stockQuantity || 0) - (item.quantity || 0);
            }
        }
    });
    localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
    window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));

    // --- Cloud Update (Transactional) ---
    if (isOnline()) {
        try {
            await runTransaction(db, async (transaction) => {
                // A. Read all products involved
                const productReads = [];
                for (const item of orderWithMeta.items) {
                    if (item.productId) {
                        const ref = doc(db, "products", item.productId);
                        productReads.push({ ref, item });
                    }
                }
                
                // Prefetch to ensure they exist in transaction scope
                const uniqueProductRefs = new Map();
                productReads.forEach(p => uniqueProductRefs.set(p.ref.path, p.ref));
                
                const refList = Array.from(uniqueProductRefs.values());
                let productDocs: any[] = [];
                
                if (refList.length > 0) {
                    productDocs = await Promise.all(refList.map(ref => transaction.get(ref)));
                }
                
                const docMap = new Map(productDocs.map(d => [d.ref.path, d]));

                // B. Deduct Stock
                productReads.forEach((p) => {
                    const snap = docMap.get(p.ref.path);
                    if (snap && snap.exists()) {
                        // Use Firestore increment for atomic decrement
                        transaction.update(p.ref, { 
                            stockQuantity: increment(-(p.item.quantity || 0)) 
                        });
                    }
                });

                // C. Create Order
                const orderRef = doc(db, "orders", orderWithMeta.id);
                transaction.set(orderRef, sanitize(orderWithMeta));
            });
        } catch (e: any) {
            console.error("Order Transaction Failed:", e);
            if (e.code === 'resource-exhausted') {
                markQuotaExhausted();
            } else {
                console.warn("Could not sync order transaction to cloud. Local state preserved.");
            }
        }
    }
  },

  updateStatus: async (id: string, status: OrderStatus, deliveryProof?: string, customer?: { name: string, address: string }) => {
    let list = _memoryOrders || [];
    if (list.length === 0) {
        const local = localStorage.getItem(ORDER_KEY);
        if(local) list = JSON.parse(local);
    }
    const index = list.findIndex(o => o.id === id);
    if (index >= 0) {
        const currentUser = storageService.getCurrentUser() || 'Unknown';
        
        // Local Update
        const updated = { 
            ...list[index], 
            status, 
            lastUpdatedBy: currentUser
        };
        
        // If a new proof is provided, update it. Otherwise keep existing.
        if (deliveryProof !== undefined) {
            updated.deliveryProof = deliveryProof;
        }

        list[index] = updated;
        _memoryOrders = list;
        localStorage.setItem(ORDER_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('storage_' + ORDER_KEY));

        // Cloud Update
        // Create payload dynamically to avoid undefined values
        const payload: any = { status, lastUpdatedBy: currentUser };
        if (deliveryProof !== undefined) {
            payload.deliveryProof = deliveryProof;
        }

        await safeCloudOp(() => updateDoc(doc(db, "orders", id), payload));
        
        // Notify if delivered
        if (status === OrderStatus.DELIVERED && customer) {
            storageService.addNotification({
                title: 'Giao hàng thành công',
                message: `Đơn ${id} của ${customer.name} đã được giao.`,
                type: 'success',
                relatedOrderId: id
            });
        }
    }
  },

  deleteDeliveryProof: async (id: string) => {
      let list = _memoryOrders || [];
      if (list.length === 0) {
          const local = localStorage.getItem(ORDER_KEY);
          if(local) list = JSON.parse(local);
      }
      const index = list.findIndex(o => o.id === id);
      if (index >= 0) {
          const currentUser = storageService.getCurrentUser() || 'Unknown';
          const updated = { ...list[index] };
          delete updated.deliveryProof;
          updated.lastUpdatedBy = currentUser;
          
          list[index] = updated;
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));

          await safeCloudOp(() => updateDoc(doc(db, "orders", id), { deliveryProof: deleteField(), lastUpdatedBy: currentUser }));
      }
  },

  updateOrderDetails: async (order: Order) => {
    let list = _memoryOrders || [];
    if (list.length === 0) {
        const local = localStorage.getItem(ORDER_KEY);
        if(local) list = JSON.parse(local);
    }
    const idx = list.findIndex(o => o.id === order.id);
    if (idx >= 0) {
        list[idx] = order;
        _memoryOrders = list;
        localStorage.setItem(ORDER_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('storage_' + ORDER_KEY));
        await safeCloudOp(() => setDoc(doc(db, "orders", order.id), sanitize(order)));
    }
  },

  updatePaymentVerification: async (id: string, verified: boolean, customer?: { name: string }) => {
      let list = _memoryOrders || [];
      if (list.length === 0) {
          const local = localStorage.getItem(ORDER_KEY);
          if(local) list = JSON.parse(local);
      }
      const idx = list.findIndex(o => o.id === id);
      if (idx >= 0) {
          list[idx] = { ...list[idx], paymentVerified: verified };
          _memoryOrders = list;
          localStorage.setItem(ORDER_KEY, JSON.stringify(list));
          window.dispatchEvent(new Event('storage_' + ORDER_KEY));
          await safeCloudOp(() => updateDoc(doc(db, "orders", id), { paymentVerified: verified }));
          
          if (verified && customer) {
              storageService.addNotification({
                  title: 'Tiền đã về',
                  message: `Đã xác nhận thanh toán đơn ${id} của ${customer.name}.`,
                  type: 'success',
                  relatedOrderId: id
              });
          }
      }
  },

  deleteOrder: async (id: string, customer?: { name: string, address: string }) => {
      let list = _memoryOrders || [];
      if (list.length === 0) {
           const local = localStorage.getItem(ORDER_KEY);
           if(local) list = JSON.parse(local);
      }
      const orderToDelete = list.find(o => o.id === id);
      list = list.filter(o => o.id !== id);
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      await safeCloudOp(() => deleteDoc(doc(db, "orders", id)));
      
      if (customer) {
          storageService.addNotification({
              title: 'Đã xóa đơn hàng',
              message: `Đơn ${id} của ${customer.name} đã bị xóa.`,
              type: 'warning'
          });
      }

      // Decrement customer order count if possible
      if (orderToDelete && orderToDelete.customerId) {
           const cust = ensureCustomersLoaded()?.find(c => c.id === orderToDelete.customerId);
           if (cust && (cust.totalOrders || 0) > 0) {
               await storageService.upsertCustomer({ ...cust, totalOrders: (cust.totalOrders || 1) - 1 });
           }
      }
  },
  
  deleteOrdersBatch: async (ids: string[]) => {
      let list = _memoryOrders || [];
      list = list.filter(o => !ids.includes(o.id));
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      
      if (isOnline()) {
          const batch = writeBatch(db);
          ids.forEach(id => batch.delete(doc(db, "orders", id)));
          await batch.commit();
      }
  },

  splitOrderToNextBatch: async (id: string, currentBatch: string) => {
    let nextBatch = '';
    
    // Logic: Nếu Lô1 -> Lô1-S -> Lô1-S1 -> Lô1-S2
    if (!currentBatch || currentBatch.trim() === '') {
        const today = new Date().toISOString().slice(0, 10);
        nextBatch = `LÔ-${today}-S`;
    } else {
        // Check suffixes
        const sRegex = /-S(\d*)$/;
        const match = currentBatch.match(sRegex);
        
        if (match) {
            // Đã có suffix S hoặc S1, S2...
            const numPart = match[1]; // "" hoặc "1", "2"...
            let nextNum = 1;
            if (numPart !== "") {
                nextNum = parseInt(numPart) + 1;
            }
            // Replace old suffix with new suffix
            nextBatch = currentBatch.replace(sRegex, `-S${nextNum}`);
        } else {
            // Chưa có suffix -> Thêm -S
            nextBatch = `${currentBatch}-S`;
        }
    }

    const list = _memoryOrders || [];
    const idx = list.findIndex(o => o.id === id);
    if (idx >= 0) {
        list[idx].batchId = nextBatch;
        _memoryOrders = list;
        localStorage.setItem(ORDER_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('storage_' + ORDER_KEY));
        await safeCloudOp(() => updateDoc(doc(db, "orders", id), { batchId: nextBatch }));
    }
  },

  splitOrdersBatch: async (items: {id: string, batchId: string}[]) => {
      const list = _memoryOrders || [];
      const batch = writeBatch(db);
      
      items.forEach(item => {
          let nextBatch = '';
          if (!item.batchId || item.batchId.trim() === '') {
              const today = new Date().toISOString().slice(0, 10);
              nextBatch = `LÔ-${today}-S`;
          } else {
              const sRegex = /-S(\d*)$/;
              const match = item.batchId.match(sRegex);
              if (match) {
                  const numPart = match[1];
                  let nextNum = 1;
                  if (numPart !== "") nextNum = parseInt(numPart) + 1;
                  nextBatch = item.batchId.replace(sRegex, `-S${nextNum}`);
              } else {
                  nextBatch = `${item.batchId}-S`;
              }
          }

          const idx = list.findIndex(o => o.id === item.id);
          if (idx >= 0) {
              list[idx].batchId = nextBatch;
              if (isOnline()) batch.update(doc(db, "orders", item.id), { batchId: nextBatch });
          }
      });

      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      
      if (isOnline()) await batch.commit();
  },

  moveOrdersBatch: async (ids: string[], targetBatch: string) => {
      const list = _memoryOrders || [];
      const batch = writeBatch(db);
      
      ids.forEach(id => {
          const idx = list.findIndex(o => o.id === id);
          if (idx >= 0) {
              list[idx].batchId = targetBatch;
              if (isOnline()) batch.update(doc(db, "orders", id), { batchId: targetBatch });
          }
      });

      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      
      if (isOnline()) await batch.commit();
  },

  renameBatch: async (oldName: string, newName: string) => {
      const list = ensureOrdersLoaded() || [];
      const affected = list.filter(o => o.batchId === oldName);
      
      affected.forEach(o => o.batchId = newName);
      
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      if (isOnline()) {
          const CHUNK = 300;
          for (let i = 0; i < affected.length; i += CHUNK) {
               const chunk = affected.slice(i, i + CHUNK);
               const batch = writeBatch(db);
               chunk.forEach(o => batch.update(doc(db, "orders", o.id), { batchId: newName }));
               await batch.commit();
          }
      }
  },

  saveOrdersList: async (orders: Order[]) => {
      _memoryOrders = orders;
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      
      if (isOnline()) {
          const batch = writeBatch(db);
          orders.forEach(o => {
              batch.set(doc(db, "orders", o.id), sanitize(o));
          });
          await batch.commit();
      }
  },
  
  incrementReminderCount: async (ids: string[]) => {
      const list = ensureOrdersLoaded() || [];
      const batch = writeBatch(db);
      
      ids.forEach(id => {
          const idx = list.findIndex(o => o.id === id);
          if (idx >= 0) {
              list[idx].reminderCount = (list[idx].reminderCount || 0) + 1;
              if (isOnline()) batch.update(doc(db, "orders", id), { reminderCount: increment(1) });
          }
      });
      
      _memoryOrders = list;
      localStorage.setItem(ORDER_KEY, JSON.stringify(list));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      
      if (isOnline()) await batch.commit();
  },
  
  autoSortOrders: async (filteredOrders: Order[]) => {
      // Simple TSP-like sort or heuristics
      return filteredOrders.length;
  },
  
  learnRoutePriority: async (sortedOrders: Order[]) => {
      const list = ensureCustomersLoaded() || [];
      const batch = writeBatch(db);
      let updates = 0;
      
      sortedOrders.forEach((o, idx) => {
          if (o.customerId) {
              const cust = list.find(c => c.id === o.customerId);
              if (cust) {
                  const newScore = idx + 1;
                  if (cust.priorityScore !== newScore) {
                      cust.priorityScore = newScore;
                      if (isOnline()) batch.update(doc(db, "customers", cust.id), { priorityScore: newScore });
                      updates++;
                  }
              }
          }
      });
      
      if (updates > 0) {
          _memoryCustomers = list;
          localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
          if (isOnline()) await batch.commit();
      }
  },

  // --- NOTIFICATIONS ---
  subscribeNotifications: (callback: (notifs: Notification[]) => void) => {
      if (isOnline()) {
          const q = query(collection(db, "notifications"), orderBy('createdAt', 'desc'), limit(50));
          return onSnapshot(q, (snapshot) => {
              const list: Notification[] = [];
              snapshot.forEach(d => list.push(d.data() as Notification));
              callback(list);
          }, (err) => {
            if (err.code === 'resource-exhausted') markQuotaExhausted();
          });
      } else {
          try {
             const local = localStorage.getItem(NOTIF_KEY);
             callback(local ? JSON.parse(local) : []);
          } catch { callback([]); }
          return () => {};
      }
  },

  addNotification: async (notif: Omit<Notification, 'id' | 'createdAt' | 'isRead'>) => {
      const newNotif: Notification = {
          ...notif,
          id: uuidv4(),
          createdAt: Date.now(),
          isRead: false
      };
      
      if (isOnline()) {
          await safeCloudOp(() => setDoc(doc(db, "notifications", newNotif.id), sanitize(newNotif)));
      } else {
          const local = localStorage.getItem(NOTIF_KEY);
          const list = local ? JSON.parse(local) : [];
          list.unshift(newNotif);
          if (list.length > 50) list.pop();
          localStorage.setItem(NOTIF_KEY, JSON.stringify(list));
      }
  },

  markNotificationRead: async (id: string) => {
      window.dispatchEvent(new CustomEvent('local_notif_read', { detail: id }));
      if (isOnline()) {
          await safeCloudOp(() => updateDoc(doc(db, "notifications", id), { isRead: true }));
      }
  },

  markAllNotificationsRead: async () => {
      window.dispatchEvent(new Event('local_notif_read_all'));
      if (isOnline()) {
          const q = query(collection(db, "notifications"), where("isRead", "==", false));
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.forEach(d => batch.update(d.ref, { isRead: true }));
          await batch.commit();
      }
  },

  clearAllNotifications: async () => {
      window.dispatchEvent(new Event('local_notif_clear_all'));
      localStorage.removeItem(NOTIF_KEY);
      if (isOnline()) {
          const q = query(collection(db, "notifications"));
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          snapshot.forEach(d => batch.delete(d.ref));
          await batch.commit();
      }
  },
  
  fetchLongTermStats: async () => {
      // For simple stats, we just return all orders
      return ensureOrdersLoaded() || [];
  },

  // --- TOOL: FIX DUPLICATE ID COLLISIONS ---
  fixDuplicateCustomerIds: async () => {
      const orders = ensureOrdersLoaded() || [];
      const customers = ensureCustomersLoaded() || [];
      
      // Map CustomerID -> Groups of names
      const idMap = new Map<string, Map<string, Order[]>>();

      orders.forEach(o => {
          if (!o.customerId) return;
          if (!idMap.has(o.customerId)) idMap.set(o.customerId, new Map());
          
          const nameKey = normalizeString(o.customerName);
          const group = idMap.get(o.customerId)!;
          
          if (!group.has(nameKey)) group.set(nameKey, []);
          group.get(nameKey)!.push(o);
      });

      let fixedCount = 0;
      const batch = writeBatch(db);

      for (const [custId, nameGroups] of idMap.entries()) {
          if (nameGroups.size <= 1) continue; // No conflict

          // Find the dominant name (most orders)
          let maxCount = 0;
          let dominantKey = '';
          nameGroups.forEach((list, key) => {
              if (list.length > maxCount) {
                  maxCount = list.length;
                  dominantKey = key;
              }
          });

          // Process other groups (the conflicts)
          let suffix = 2;
          for (const [key, list] of nameGroups.entries()) {
              if (key === dominantKey) continue; // Keep dominant as original ID

              // Generate new ID
              let newId = `${custId}-${suffix}`;
              while (customers.some(c => c.id === newId)) {
                  suffix++;
                  newId = `${custId}-${suffix}`;
              }
              suffix++;

              // Create new customer record based on the first order of this group
              const sampleOrder = list[0];
              const newCustomer: Customer = {
                  id: newId,
                  name: sampleOrder.customerName,
                  phone: normalizePhone(sampleOrder.customerPhone),
                  address: sampleOrder.address,
                  lastOrderDate: Date.now(), // approximation
                  priorityScore: 999
              };
              
              // Update Memory
              await storageService.upsertCustomer(newCustomer);

              // Update Orders
              list.forEach(o => {
                  o.customerId = newId;
                  // Update Memory
                  const idx = orders.findIndex(x => x.id === o.id);
                  if (idx >= 0) orders[idx] = o;
                  
                  // Update Cloud
                  if (isOnline()) {
                      batch.update(doc(db, "orders", o.id), { customerId: newId });
                  }
              });
              
              fixedCount++;
          }
      }

      // Persist Memory Changes
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));

      // Commit Cloud
      if (isOnline()) await batch.commit();
      
      return fixedCount;
  },

  // --- TOOL: MERGE DUPLICATE CUSTOMERS (SAME PHONE -> MERGE TO 1 ID) ---
  mergeCustomersByPhone: async () => {
      const customers = ensureCustomersLoaded() || [];
      const orders = ensureOrdersLoaded() || [];
      
      // Group by normalized phone
      const phoneMap = new Map<string, Customer[]>();
      customers.forEach(c => {
          if(c.phone && c.phone.length > 5) {
              const p = normalizePhone(c.phone);
              if(!phoneMap.has(p)) phoneMap.set(p, []);
              phoneMap.get(p)!.push(c);
          }
      });

      let mergedGroupsCount = 0;
      const batch = writeBatch(db);
      
      for (const [phone, group] of phoneMap.entries()) {
          if (group.length <= 1) continue;
          
          // Sort by order count (Keep the one with most orders/history)
          group.sort((a,b) => (b.totalOrders || 0) - (a.totalOrders || 0));
          const primary = group[0];
          const duplicates = group.slice(1);
          
          // Merge Duplicates
          for (const dup of duplicates) {
              // 1. Update Orders pointing to duplicate
              orders.forEach(o => {
                  if (o.customerId === dup.id) {
                      o.customerId = primary.id;
                      // Update cloud
                      if (isOnline()) batch.update(doc(db, "orders", o.id), { customerId: primary.id });
                  }
              });
              
              // 2. Sum up total orders
              primary.totalOrders = (primary.totalOrders || 0) + (dup.totalOrders || 0);
              
              // 3. Delete Duplicate Customer
              // Remove from memory
              const idx = customers.findIndex(c => c.id === dup.id);
              if (idx >= 0) customers.splice(idx, 1);
              // Remove from cloud
              if (isOnline()) batch.delete(doc(db, "customers", dup.id));
          }
          
          // Update Primary Customer Stats
          if (isOnline()) batch.update(doc(db, "customers", primary.id), { totalOrders: primary.totalOrders });
          
          mergedGroupsCount++;
      }

      // Save changes
      _memoryCustomers = customers;
      localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customers));
      window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
      
      _memoryOrders = orders;
      localStorage.setItem(ORDER_KEY, JSON.stringify(orders));
      window.dispatchEvent(new Event('storage_' + ORDER_KEY));
      
      if (isOnline()) await batch.commit();
      
      return mergedGroupsCount;
  }
};