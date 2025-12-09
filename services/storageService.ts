import { Order, OrderStatus, Product, Customer, BankConfig, ShopConfig, Notification } from '../types';
import { db } from '../firebaseConfig';
import { doc, setDoc, updateDoc, deleteDoc, writeBatch, increment } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

const ORDER_KEY = 'ecogo_orders';
const PRODUCT_KEY = 'ecogo_products_v1';
const CUSTOMER_KEY = 'ecogo_customers';
const BANK_KEY = 'ecogo_bank_config';
const SHOP_KEY = 'ecogo_shop_config';
const TAGS_KEY = 'ecogo_quick_tags';
const LOGO_KEY = 'ecogo_logo';

let _memoryOrders: Order[] = [];
let _memoryProducts: Product[] = [];
let _memoryCustomers: Customer[] = [];

const isOnline = () => !!db;

const safeCloudOp = async (op: () => Promise<any>) => {
    try {
        if (isOnline()) await op();
    } catch (e) {
        console.error("Cloud op failed", e);
    }
};

const sanitize = (obj: any) => JSON.parse(JSON.stringify(obj));

const ensureProductsLoaded = (): Product[] => {
    if (_memoryProducts.length === 0) {
        const local = localStorage.getItem(PRODUCT_KEY);
        if (local) _memoryProducts = JSON.parse(local);
    }
    return _memoryProducts;
};

export const generateProductSku = (name: string): string => {
    return normalizeString(name).toUpperCase().replace(/\s+/g, '_');
};

export const normalizeString = (str: string): string => {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
};

export const normalizePhone = (phone: string): string => {
    return phone.replace(/[^0-9]/g, '');
};

export const storageService = {
    getCurrentUser: () => localStorage.getItem('ecogo_last_username'),
    login: (username: string) => localStorage.setItem('ecogo_last_username', username),
    logout: () => localStorage.removeItem('ecogo_last_username'),
    
    // Products
    subscribeProducts: (callback: (products: Product[]) => void) => {
        const load = () => {
            const list = ensureProductsLoaded();
            callback(list);
        };
        load();
        window.addEventListener('storage_' + PRODUCT_KEY, load);
        return () => window.removeEventListener('storage_' + PRODUCT_KEY, load);
    },
    getAllProducts: () => ensureProductsLoaded(),
    getProductBySku: (sku: string) => ensureProductsLoaded().find(p => p.id === sku),
    saveProduct: async (product: Product) => {
        let list = ensureProductsLoaded();
        const idx = list.findIndex(p => p.id === product.id);
        if (idx >= 0) list[idx] = product;
        else list.push(product);
        _memoryProducts = list;
        localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
        
        if (isOnline()) {
             await setDoc(doc(db, 'products', product.id), sanitize(product));
        }
    },
    deleteProduct: async (id: string) => {
        let list = ensureProductsLoaded();
        list = list.filter(p => p.id !== id);
        _memoryProducts = list;
        localStorage.setItem(PRODUCT_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
        if (isOnline()) await deleteDoc(doc(db, 'products', id));
    },
    adjustStockAtomic: async (id: string, qty: number, meta: { price: number, note: string }) => {
        const products = ensureProductsLoaded();
        const product = products.find(p => p.id === id);
        if (product) {
            product.stockQuantity += qty;
            product.totalImported = (product.totalImported || 0) + (qty > 0 ? qty : 0);
            if (qty > 0) {
                 product.importHistory = product.importHistory || [];
                 product.importHistory.push({
                     id: uuidv4(),
                     date: Date.now(),
                     quantity: qty,
                     price: meta.price,
                     note: meta.note
                 });
            }
            localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
            window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
             if (isOnline()) {
                 await updateDoc(doc(db, 'products', id), {
                     stockQuantity: increment(qty),
                     totalImported: increment(qty > 0 ? qty : 0)
                 });
             }
        }
    },
    cleanAndMergeDuplicateProducts: async () => { return { mergedCount: 0, fixedOrders: 0 }; },
    recalculateInventoryFromOrders: async () => 0,
    syncProductToPendingOrders: async (product: Product) => 0,
    fetchLongTermStats: async () => [],

    // Orders
    subscribeOrders: (callback: (orders: Order[]) => void) => {
        const load = () => {
             const local = localStorage.getItem(ORDER_KEY);
             const list = local ? JSON.parse(local) : [];
             _memoryOrders = list;
             callback(list);
        };
        load();
        window.addEventListener('storage_' + ORDER_KEY, load);
        return () => window.removeEventListener('storage_' + ORDER_KEY, load);
    },
    saveOrder: async (order: Order) => {
        let list = _memoryOrders;
        if (list.length === 0) {
             const local = localStorage.getItem(ORDER_KEY);
             if (local) list = JSON.parse(local);
        }
        list.unshift(order);
        _memoryOrders = list;
        localStorage.setItem(ORDER_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('storage_' + ORDER_KEY));
        
        // Decrement stock
        if (order.status !== OrderStatus.CANCELLED) {
             const products = ensureProductsLoaded();
             let changed = false;
             order.items.forEach(item => {
                 if (item.productId) {
                     const p = products.find(p => p.id === item.productId);
                     if (p) {
                         p.stockQuantity -= item.quantity;
                         changed = true;
                     }
                 }
             });
             if (changed) {
                 localStorage.setItem(PRODUCT_KEY, JSON.stringify(products));
                 window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
             }
        }

        if (isOnline()) await setDoc(doc(db, 'orders', order.id), sanitize(order));
    },
    updateOrderDetails: async (order: Order) => {
        let list = _memoryOrders || [];
        if (list.length === 0) {
            const local = localStorage.getItem(ORDER_KEY);
            if(local) list = JSON.parse(local);
        }
        const idx = list.findIndex(o => o.id === order.id);
        if (idx >= 0) {
            const oldOrder = list[idx];
            
            // CHỈ CẬP NHẬT KHO NẾU ĐƠN HÀNG KHÔNG BỊ HỦY
            if (order.status !== OrderStatus.CANCELLED) {
                // 1. TÍNH TOÁN CHÊNH LỆCH (DELTA)
                const productDeltas = new Map<string, number>();
    
                // Hoàn lại số lượng cũ vào kho (Cộng lại)
                oldOrder.items.forEach(item => {
                    if (item.productId) {
                        const current = productDeltas.get(item.productId) || 0;
                        productDeltas.set(item.productId, current + (Number(item.quantity) || 0));
                    }
                });
    
                // Trừ số lượng mới khỏi kho (Trừ đi)
                order.items.forEach(item => {
                    if (item.productId) {
                        const current = productDeltas.get(item.productId) || 0;
                        productDeltas.set(item.productId, current - (Number(item.quantity) || 0));
                    }
                });
    
                // 2. ÁP DỤNG VÀO KHO (Memory & Cloud)
                const allProducts = ensureProductsLoaded();
                const batch = writeBatch(db); 
                let hasCloudUpdates = false;
    
                for (const [prodId, delta] of productDeltas.entries()) {
                    if (delta === 0) continue;
    
                    // Update Memory
                    const product = allProducts.find(p => p.id === prodId);
                    if (product) {
                        product.stockQuantity = (product.stockQuantity || 0) + delta;
                        
                        // Update Cloud
                        if (isOnline()) {
                            const ref = doc(db, "products", prodId);
                            batch.update(ref, { stockQuantity: increment(delta) });
                            hasCloudUpdates = true;
                        }
                    }
                }
    
                // Lưu thay đổi kho vào LocalStorage
                if (productDeltas.size > 0) {
                    localStorage.setItem(PRODUCT_KEY, JSON.stringify(allProducts));
                    window.dispatchEvent(new Event('storage_' + PRODUCT_KEY));
                }
                
                // Commit thay đổi kho lên Cloud
                if (hasCloudUpdates && isOnline()) {
                    await safeCloudOp(() => batch.commit());
                }
            }
    
            // 3. LƯU ĐƠN HÀNG
            list[idx] = order;
            _memoryOrders = list;
            localStorage.setItem(ORDER_KEY, JSON.stringify(list));
            window.dispatchEvent(new Event('storage_' + ORDER_KEY));
            
            if (isOnline()) {
                await safeCloudOp(() => setDoc(doc(db, "orders", order.id), sanitize(order)));
            }
        }
    },
    updateStatus: async (id: string, status: OrderStatus, proof?: string, meta?: any) => {
         let list = _memoryOrders;
         const order = list.find(o => o.id === id);
         if (order) {
             order.status = status;
             if (proof) order.deliveryProof = proof;
             localStorage.setItem(ORDER_KEY, JSON.stringify(list));
             window.dispatchEvent(new Event('storage_' + ORDER_KEY));
             if (isOnline()) await updateDoc(doc(db, 'orders', id), { status, deliveryProof: proof || null });
         }
    },
    deleteDeliveryProof: async (id: string) => {
         let list = _memoryOrders;
         const order = list.find(o => o.id === id);
         if (order) {
             order.deliveryProof = undefined;
             localStorage.setItem(ORDER_KEY, JSON.stringify(list));
             window.dispatchEvent(new Event('storage_' + ORDER_KEY));
             if (isOnline()) await updateDoc(doc(db, 'orders', id), { deliveryProof: null });
         }
    },
    updatePaymentVerification: async (id: string, verified: boolean, meta?: any) => {
         let list = _memoryOrders;
         const order = list.find(o => o.id === id);
         if (order) {
             order.paymentVerified = verified;
             localStorage.setItem(ORDER_KEY, JSON.stringify(list));
             window.dispatchEvent(new Event('storage_' + ORDER_KEY));
             if (isOnline()) await updateDoc(doc(db, 'orders', id), { paymentVerified: verified });
         }
    },
    getProductOrderHistory: (productId: string) => {
         const list = _memoryOrders;
         const history: {order: Order, quantity: number}[] = [];
         list.forEach(o => {
             const item = o.items.find(i => i.productId === productId);
             if (item) history.push({ order: o, quantity: item.quantity });
         });
         return history;
    },
    
    // Customers
    subscribeCustomers: (callback: (customers: Customer[]) => void) => {
        const load = () => {
             const local = localStorage.getItem(CUSTOMER_KEY);
             _memoryCustomers = local ? JSON.parse(local) : [];
             callback(_memoryCustomers);
        };
        load();
        window.addEventListener('storage_' + CUSTOMER_KEY, load);
        return () => window.removeEventListener('storage_' + CUSTOMER_KEY, load);
    },
    upsertCustomer: async (customer: Customer) => {
         let list = _memoryCustomers;
         const idx = list.findIndex(c => c.id === customer.id);
         if (idx >= 0) list[idx] = customer;
         else list.push(customer);
         _memoryCustomers = list;
         localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
         window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
         if (isOnline()) await setDoc(doc(db, 'customers', customer.id), sanitize(customer));
    },
    deleteCustomer: async (id: string) => {
        let list = _memoryCustomers.filter(c => c.id !== id);
        _memoryCustomers = list;
        localStorage.setItem(CUSTOMER_KEY, JSON.stringify(list));
        window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
        if (isOnline()) await deleteDoc(doc(db, 'customers', id));
    },
    clearAllCustomers: async (isLocal: boolean) => {
         localStorage.removeItem(CUSTOMER_KEY);
         _memoryCustomers = [];
         window.dispatchEvent(new Event('storage_' + CUSTOMER_KEY));
    },
    findMatchingCustomer: (phone: string, address: string) => {
         return _memoryCustomers.find(c => c.phone === phone);
    },
    importCustomersBatch: async (customers: Customer[], isLocal: boolean) => {
         customers.forEach(c => storageService.upsertCustomer(c));
    },
    markAllCustomersAsOld: async () => 0,
    fixDuplicateCustomerIds: async () => 0,
    mergeCustomersByPhone: async () => 0,
    generatePerformanceData: async (count: number) => ({count, duration: 0}),
    
    // Configs
    getBankConfig: async () => {
         const local = localStorage.getItem(BANK_KEY);
         return local ? JSON.parse(local) : null;
    },
    saveBankConfig: async (config: BankConfig) => {
         localStorage.setItem(BANK_KEY, JSON.stringify(config));
         if (isOnline()) await setDoc(doc(db, 'config', 'bank'), config);
    },
    getShopConfig: async () => {
         const local = localStorage.getItem(SHOP_KEY);
         return local ? JSON.parse(local) : null;
    },
    saveShopConfig: async (config: ShopConfig) => {
         localStorage.setItem(SHOP_KEY, JSON.stringify(config));
    },
    
    // Tags & Logo
    getQuickTags: () => {
         const local = localStorage.getItem(TAGS_KEY);
         return local ? JSON.parse(local) : [];
    },
    saveQuickTags: async (tags: string[]) => {
         localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
    },
    fetchQuickTagsFromCloud: async () => [],
    getLogo: () => localStorage.getItem(LOGO_KEY),
    saveLogo: (base64: string) => {
         localStorage.setItem(LOGO_KEY, base64);
         window.dispatchEvent(new Event('logo_updated'));
    },
    removeLogo: () => {
         localStorage.removeItem(LOGO_KEY);
         window.dispatchEvent(new Event('logo_updated'));
    },
    
    // Notifications
    subscribeNotifications: (callback: (notifs: Notification[]) => void) => {
        callback([]);
        return () => {};
    },
    markNotificationRead: (id: string) => {},
    markAllNotificationsRead: () => {},
    clearAllNotifications: () => {},
    
    // Sync
    syncLocalToCloud: async () => 0,
    incrementReminderCount: async (ids: string[]) => {}
};
